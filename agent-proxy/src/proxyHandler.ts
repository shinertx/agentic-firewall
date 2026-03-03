import { Request, Response } from 'express';
import { checkCircuitBreaker } from './circuitBreaker';
import { attemptShadowRouterFailover, attemptCrossProviderFailover } from './shadowRouter';
import { getInputCost, CACHE_SAVINGS_RATE } from './pricing';
import { generateCacheKey } from './tokenCounter';
import { checkBudget, recordUserSpend, recordUserLoop, getOrCreateUser, reconcileUserSpend } from './budgetGovernor';
import { checkNoProgress } from './noProgress';
import { getProviderKey, getProviderHeaderConfig, getLocalUserId, Provider } from './keyVault';
import { globalStats, recordActivity } from './stats';
import { trimContext, applyOllamaSummary, TrimResult } from './contextTrimmer';
import { smartRoute, SmartRouteResult } from './smartRouter';
import { resolveSessionId, getOrCreateSession, recordSessionSpend, recordSessionLoop, reconcileSessionSpend } from './sessionTracker';
import { acquireSlot, releaseSlot, autoTuneFromHeaders, QueueFullError, QueueTimeoutError } from './requestQueue';
import { getCachedResponse, setCachedResponse } from './responseCache';
import { parseUsageFromChunks } from './usageParser';
import { compressPrompt } from './promptCompressor';

// Explicit Interfaces for Edge Case Handling
export interface LLMRequest {
    messages?: any[];
    system?: any;
    contents?: any[];
    systemInstruction?: any;
    model?: string;
    max_tokens?: number;
    prompt_cache_key?: string;
    prompt_cache_retention?: string;
}

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const OPENAI_BASE_URL = 'https://api.openai.com';
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com';

// DRY Helper for Anthropic Cache Injection
// Threshold: 4096 chars ≈ 1024 tokens — Anthropic's minimum for prompt caching.
// Below this, cache_control is silently ignored but we'd pay the 25% write surcharge.
function injectEphemeralCache(block: any): { modified: boolean, content: any } {
    if (typeof block === 'string' && block.length > 4096) {
        return {
            modified: true,
            content: [{ type: 'text', text: block, cache_control: { type: 'ephemeral' } }]
        };
    } else if (Array.isArray(block) && block.length > 0) {
        const last = block[block.length - 1];
        if (last.type === 'text' && !last.cache_control && last.text.length > 4096) {
            last.cache_control = { type: 'ephemeral' };
            return { modified: true, content: block };
        }
    }
    return { modified: false, content: block };
}

export function applyContextCDN(body: LLMRequest, isGemini: boolean, reqUrl: string = "", originalBodyLength?: number) {
    if (!body) return body;
    let modified = false;

    if (isGemini) {
        // Gemini Implicit Caching — automatic for prompts with matching prefixes.
        // Active on Gemini 2.5+ and 3 series. No special headers needed.
        // We optimize by ensuring systemInstruction is populated (it's always first/prefix-stable).
        // NOTE: We do NOT reorder conversation turns — Gemini requires strict alternating
        // user/model turns. Reordering would cause 400 errors.
        if (body.contents && Array.isArray(body.contents) && body.contents.length > 0) {
            // Use pre-computed body length to avoid re-serialization
            const estimatedTokens = originalBodyLength
                ? Math.round(originalBodyLength / 4)
                : Math.round(JSON.stringify(body.contents).length / 4);

            if (estimatedTokens >= 1024) {
                // systemInstruction is always sent first by Gemini, making it the
                // most stable prefix for implicit cache hits
                if (body.systemInstruction && body.systemInstruction.parts) {
                    modified = true;
                }
            }
        }
    } else if (reqUrl.includes('/v1/chat/completions') || reqUrl.includes('/v1/responses') || reqUrl.includes('api.openai.com')) {
        // OpenAI Prompt Caching — automatic for prompts ≥1024 tokens with prefix matching.
        // We optimize by: (1) ensuring system messages are first (prefix-stable),
        // (2) injecting prompt_cache_key for deterministic cache hits across sessions,
        // (3) setting prompt_cache_retention to 24h for extended TTL.
        // Use pre-computed body length to avoid re-serialization
        const estimatedTokens = originalBodyLength
            ? Math.round(originalBodyLength / 4)
            : Math.round(JSON.stringify(body).length / 4);
        if (estimatedTokens >= 1024 && body.messages && Array.isArray(body.messages)) {
            // Move system messages to front for stable prefix matching
            const systemMsgs = body.messages.filter((m: any) => m.role === 'system');
            const otherMsgs = body.messages.filter((m: any) => m.role !== 'system');
            if (systemMsgs.length > 0) {
                body.messages = [...systemMsgs, ...otherMsgs];
            }

            // Inject prompt_cache_key — a stable hash of system content for cross-session cache hits
            const cacheKey = generateCacheKey(body);
            if (cacheKey && !body.prompt_cache_key) {
                body.prompt_cache_key = cacheKey;
                body.prompt_cache_retention = '24h';
            }

            modified = true;
        }
    } else {
        // Anthropic Cache injection (DRY Implementation)
        if (body.system) {
            const result = injectEphemeralCache(body.system);
            if (result.modified) {
                body.system = result.content;
                modified = true;
            }
        }

        if (body.messages && Array.isArray(body.messages) && body.messages.length > 0) {
            const lastMsgIndex = body.messages.length - 1;
            const lastMsg = body.messages[lastMsgIndex];

            if (lastMsg && lastMsg.role === 'user' && lastMsg.content) {
                const result = injectEphemeralCache(lastMsg.content);
                if (result.modified) {
                    lastMsg.content = result.content;
                    modified = true;
                }
            }
        }
    }

    if (modified) {
        let providerName = 'Anthropic';
        if (isGemini) providerName = 'Gemini';
        else if (reqUrl.includes('nvidia') || (body.model && body.model.includes('meta/'))) providerName = 'NVIDIA';
        else if (reqUrl.includes('/v1/chat/completions')) providerName = 'OpenAI';
        console.log(`[PROXY Context CDN] 🚀 Injected ephemeral cache_control headers for ${providerName}`);
    }
    return { modified, body };
}

export async function handleProxyRequest(req: Request, res: Response) {
    const hasGoogKey = req.query.key || req.headers['x-goog-api-key'];
    const isGemini = !!(req.originalUrl.includes('/v1beta/models') || (req.originalUrl.includes('/v1/models') && hasGoogKey));
    const isNvidia = req.originalUrl.includes('integrate.api.nvidia.com') || (req.body?.model && (typeof req.body.model === 'string') && (req.body.model.startsWith('meta/') || req.body.model.startsWith('nvidia/')));
    const isOpenAI = !isNvidia && (req.originalUrl.includes('/v1/chat/completions') || req.originalUrl.includes('/v1/responses') || req.originalUrl.includes('/v1/models') || (req.headers.host && req.headers.host.includes('openai.com')));
    const isCountTokens = req.originalUrl.includes('/v1/messages/count_tokens');

    let baseUrl = ANTHROPIC_BASE_URL;
    if (isGemini) baseUrl = GEMINI_BASE_URL;
    if (isOpenAI) baseUrl = OPENAI_BASE_URL;
    if (isNvidia) baseUrl = NVIDIA_BASE_URL;

    // In rare cases agents hardcode the absolute url, so we only append the path if it's relative
    const url = req.originalUrl.startsWith('http') ? req.originalUrl : `${baseUrl}${req.originalUrl}`;

    const headers = { ...req.headers } as Record<string, string>;
    delete headers.host;
    delete headers.connection;

    // Clean up content-length as it will change if we mutate the body string later
    delete headers['content-length'];

    // LOCAL-FIRST: Strip any client-sent API key headers (defense in depth)
    // The proxy injects keys from local env vars — never forward client keys
    delete headers['x-api-key'];
    delete headers['authorization'];
    delete headers['x-goog-api-key'];

    // LOCAL-FIRST: Inject the real API key from local env vars
    const provider: Provider = isGemini ? 'gemini' : isNvidia ? 'nvidia' : isOpenAI ? 'openai' : 'anthropic';
    const vaultResult = getProviderKey(provider);
    if ('error' in vaultResult) {
        res.status(400).json({
            error: {
                message: vaultResult.error,
                type: 'provider_not_configured',
            }
        });
        return;
    }
    const { headerName, headerPrefix } = getProviderHeaderConfig(provider);
    headers[headerName] = `${headerPrefix}${vaultResult.key}`;

    // For Gemini query-param auth, also inject the key as a URL param
    if (isGemini && !req.query.key) {
        const separator = req.originalUrl.includes('?') ? '&' : '?';
        const geminiUrl = `${baseUrl}${req.originalUrl}${separator}key=${vaultResult.key}`;
        // We'll use this below when constructing the URL
        (req as any)._geminiUrl = geminiUrl;
    }

    const init: RequestInit = {
        method: req.method,
        headers,
    };

    let optimizedBody = req.body;
    let originalBodyStr = req.body ? JSON.stringify(req.body) : "";
    let optimizedBodyStr = "";
    let smartRouteResult: SmartRouteResult | null = null;
    let cbHash = '';
    let cbIdenticalCount = 0;
    // LOCAL-FIRST: User ID based on local machine identity, not API key
    const userId = getLocalUserId();
    // Session tracking
    const sessionId = resolveSessionId(req);
    getOrCreateSession(sessionId, userId);
    res.setHeader('X-Firewall-Session', sessionId);

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
        const ip = req.ip || '127.0.0.1';
        const cb = checkCircuitBreaker(ip, req.body, userId, sessionId);
        cbHash = cb.hash;
        cbIdenticalCount = cb.identicalCount;
        if (cb.blocked) {
            recordUserLoop(userId);
            recordSessionLoop(sessionId);
            res.status(400).json({ error: { message: cb.reason, type: 'agentic_firewall_blocked' } });
            return;
        }

        // Response cache — serve cached response on 2nd/3rd identical request (before 4th triggers circuit breaker)
        if (cbHash && cbIdenticalCount >= 2 && cbIdenticalCount < 4) {
            const cached = getCachedResponse(cbHash);
            if (cached) {
                globalStats.responseCacheHits++;
                globalStats.totalRequests++;
                for (const [k, v] of Object.entries(cached.headers)) {
                    if (k.toLowerCase() !== 'transfer-encoding' && k.toLowerCase() !== 'content-encoding') {
                        res.setHeader(k, v);
                    }
                }
                res.setHeader('X-Firewall-Cache', 'HIT');
                recordActivity({ time: new Date().toLocaleTimeString(), model: req.body?.model || 'unknown', tokens: 'cached', status: 'Response Cache Hit', statusColor: 'text-purple-400 bg-purple-400/10' });
                res.status(cached.statusCode).end(cached.body);
                return;
            }
            globalStats.responseCacheMisses++;
        }

        // Budget governor — check spend cap
        const budgetHeader = req.headers['x-budget-limit'] as string | undefined;
        const budgetLimit = budgetHeader ? parseFloat(budgetHeader) : null;
        const budgetCheck = checkBudget(userId, budgetLimit);
        if (!budgetCheck.allowed) {
            res.status(402).json({
                error: {
                    message: budgetCheck.reason,
                    type: 'budget_exceeded',
                    spent: budgetCheck.spent,
                    limit: budgetCheck.limit,
                    userId,
                }
            });
            return;
        }

        // No-progress detection (keyed on sessionId for per-session tracking)
        const npCheck = checkNoProgress(sessionId || userId, req.body);
        if (npCheck.noProgress) {
            res.status(400).json({
                error: {
                    message: npCheck.reason,
                    type: 'no_progress_detected',
                    consecutiveErrors: npCheck.consecutiveErrors,
                }
            });
            return;
        }

        // Smart Router — proactive model downgrade for simple tasks
        let modelName = req.body?.model || '';
        const noDowngrade = req.headers['x-no-downgrade'] === 'true';
        if (!noDowngrade && modelName) {
            smartRouteResult = await smartRoute(req.body, isGemini, isOpenAI || isNvidia);
            if (smartRouteResult.routed) {
                req.body.model = smartRouteResult.newModel;
                modelName = smartRouteResult.newModel;
                console.log(`[PROXY Smart Router] ${smartRouteResult.originalModel} → ${smartRouteResult.newModel} (${smartRouteResult.complexity})`);
                res.setHeader('X-Firewall-Routed', `${smartRouteResult.originalModel} → ${smartRouteResult.newModel}`);
                globalStats.smartRouteDowngrades++;
            }
        }

        // Context Trimmer — reduce oversized histories before CDN processing
        // Runs after smart router (which may change the model) and no-progress check
        const noTrim = req.headers['x-no-trim'] === 'true';
        let trimResult: TrimResult = { trimmed: false, body: req.body, originalTokens: 0, trimmedTokens: 0, removedMessages: 0 };
        if (!noTrim) {
            trimResult = trimContext(req.body, isGemini, isOpenAI || isNvidia, modelName, originalBodyStr.length);
        }

        // Ollama summarization — summarize dropped messages instead of just truncating
        if (trimResult.trimmed) {
            trimResult = await applyOllamaSummary(trimResult, isGemini);
        }

        if (trimResult.trimmed) {
            const suffix = trimResult.summarized ? ' (summarized)' : '';
            console.log(`[PROXY Context Trimmer] Removed ${trimResult.removedMessages} messages, saved ~${trimResult.trimmedTokens} tokens${suffix}`);
            res.setHeader('X-Firewall-Trimmed', `${trimResult.removedMessages} messages, ~${trimResult.trimmedTokens} tokens${suffix}`);
            globalStats.trimmedRequests++;
            globalStats.trimmedTokensSaved += trimResult.trimmedTokens;
        }

        // Prompt Compression — Ollama-powered system prompt + history compression
        if (process.env.OLLAMA_ENABLED === 'true' && !noTrim && req.headers['x-no-compress'] !== 'true') {
            const compression = await compressPrompt(trimResult.body, isGemini, isOpenAI || isNvidia, modelName);
            if (compression.compressed) {
                trimResult = { ...trimResult, body: compression.body };
                globalStats.compressedTokensSaved += compression.savedTokens;
                globalStats.compressionCalls++;
                if (compression.cacheHit) globalStats.compressionCacheHits++;
                res.setHeader('X-Firewall-Compressed', `${compression.savedTokens} tokens saved`);
            }
        }

        // Deep copy via structuredClone (avoids JSON.parse(JSON.stringify(...)) roundtrip)
        const result = applyContextCDN(structuredClone(trimResult.body), isGemini, req.originalUrl, originalBodyStr.length);
        optimizedBody = result.body;

        // OpenAI/NVIDIA: inject stream_options to get real token usage in streaming responses
        if ((isOpenAI || isNvidia) && optimizedBody?.stream === true) {
            optimizedBody.stream_options = { ...(optimizedBody.stream_options || {}), include_usage: true };
        }

        // Serialize optimized body once — reused for both init.body and stats comparison
        optimizedBodyStr = JSON.stringify(optimizedBody);
        init.body = optimizedBodyStr;

        // Anthropic strictly requires the beta header for prompt caching, otherwise it returns a 400 Bad Request
        if (result.modified && !isGemini && !isOpenAI && !isNvidia) {
            const currentBeta = headers['anthropic-beta'] || '';
            if (!currentBeta.includes('prompt-caching-2024-07-31')) {
                headers['anthropic-beta'] = currentBeta ? `${currentBeta},prompt-caching-2024-07-31` : 'prompt-caching-2024-07-31';
            }
        }

        // Add no-progress warning header if applicable
        if (npCheck.warning) {
            res.setHeader('X-Firewall-Warning', npCheck.warning);
        }

        // Add user ID and dashboard URL headers
        res.setHeader('X-Firewall-User', userId);
        res.setHeader('X-Firewall-Dashboard', `http://localhost:${process.env.PORT || 4000}/dashboard/${userId}`);
    }

    // Use Gemini URL with key param if injected
    const fetchUrl = (req as any)._geminiUrl || url;
    console.log(`[PROXY LOCAL] => ${req.method} ${url}`);

    // Request Queue — acquire slot before calling provider
    const noQueue = req.headers['x-no-queue'] === 'true';
    const queuePriority = req.headers['x-queue-priority'] === 'high' ? 'high' as const : 'normal' as const;
    if (!noQueue) {
        try {
            await acquireSlot(provider, queuePriority);
            globalStats.queuedRequests++;
        } catch (err) {
            if (err instanceof QueueFullError) globalStats.queueFullRejections++;
            else globalStats.queueTimeouts++;
            res.status(429).json({ error: { message: (err as Error).message, type: err instanceof QueueFullError ? 'queue_full' : 'queue_timeout' } });
            return;
        }
    }

    try {
    let response = await fetch(fetchUrl, init);

    // Auto-tune rate limits from provider response headers
    autoTuneFromHeaders(provider, response.headers);

    let statusText = 'Pass-through';
    let statusColor = 'text-gray-400 bg-gray-400/10';
    let crossProviderResult: { response: globalThis.Response; targetModel: string; targetProvider: string } | null = null;

    if (response.status === 429 && optimizedBody) {
        let failoverHandled = false;
        // Step 1: Same-provider failover (existing shadow router)
        if (!isGemini) {
            const failoverRes = await attemptShadowRouterFailover(optimizedBody, headers);
            if (failoverRes) {
                response = failoverRes;
                statusText = 'Shadow Router Failover';
                statusColor = 'text-yellow-400 bg-yellow-400/10';
                failoverHandled = true;
            }
        }
        // Step 2: Cross-provider failover (new)
        if (!failoverHandled && req.headers['x-no-cross-provider'] !== 'true') {
            const cross = await attemptCrossProviderFailover(optimizedBody, optimizedBody?.model || '', provider);
            if (cross) {
                response = cross.response;
                statusText = `Cross-Provider: ${provider} → ${cross.targetProvider}`;
                statusColor = 'text-orange-400 bg-orange-400/10';
                res.setHeader('X-Firewall-Cross-Provider', `${optimizedBody?.model}→${cross.targetModel}`);
                crossProviderResult = cross;
                failoverHandled = true;
            }
        }
        if (!failoverHandled) {
            statusText = '429 Rate Limited';
            statusColor = 'text-red-400 bg-red-400/10';
        }
    }

    // Record stats
    globalStats.totalRequests++;

    // Estimate prompt size: 1 token ~= 4 characters
    const estimatedPromptTokens = Math.max(Math.round(originalBodyStr.length / 4), 1000);

    let displayModel = optimizedBody?.model || 'unknown';
    if (isGemini) {
        const urlMatch = req.originalUrl.match(/models\/(gemini-[^:]+)/);
        if (urlMatch) displayModel = urlMatch[1];
    } else if (isOpenAI || (typeof isNvidia !== 'undefined' && isNvidia)) {
        displayModel = optimizedBody?.model || 'unknown';
    }

    const isCDN = statusText === 'Pass-through' && optimizedBodyStr !== originalBodyStr;

    if (isCDN) {
        statusText = 'Context CDN Hit';
        statusColor = 'text-emerald-400 bg-emerald-400/10';

        const inputCostPerMillionTokens = getInputCost(displayModel);
        const baseCost = (estimatedPromptTokens / 1_000_000) * inputCostPerMillionTokens;
        const savingsCost = baseCost * CACHE_SAVINGS_RATE;
        const savedTokens = estimatedPromptTokens * CACHE_SAVINGS_RATE;

        globalStats.savedTokens += savedTokens;
        globalStats.savedMoney += savingsCost;
    }

    // Smart Route savings
    if (smartRouteResult && smartRouteResult.routed) {
        const originalCost = getInputCost(smartRouteResult.originalModel);
        const newCost = getInputCost(smartRouteResult.newModel);
        const costDelta = originalCost - newCost;
        if (costDelta > 0) {
            const savings = (estimatedPromptTokens / 1_000_000) * costDelta;
            globalStats.smartRouteSavings += savings;
            globalStats.savedMoney += savings;
        }

        if (statusText === 'Pass-through') {
            statusText = `Smart Route: ${smartRouteResult.originalModel} → ${smartRouteResult.newModel}`;
            statusColor = 'text-blue-400 bg-blue-400/10';
        }
    }

    // Cross-provider failover savings
    if (crossProviderResult) {
        globalStats.crossProviderFailovers++;
        const originalCost = getInputCost(displayModel);
        const targetCost = getInputCost(crossProviderResult.targetModel);
        const costDelta = originalCost - targetCost;
        if (costDelta > 0) {
            const savings = (estimatedPromptTokens / 1_000_000) * costDelta;
            globalStats.crossProviderSavings += savings;
            globalStats.savedMoney += savings;
        }
    }

    // Record per-user + per-session spend
    recordUserSpend(userId, displayModel, estimatedPromptTokens, isCDN);
    recordSessionSpend(sessionId, displayModel, estimatedPromptTokens, isCDN);

    recordActivity({
        time: new Date().toLocaleTimeString(),
        model: displayModel,
        tokens: estimatedPromptTokens ? `${Math.round(estimatedPromptTokens / 1000)}k` : 'auto',
        status: statusText,
        statusColor
    });

    // Forward response headers
    response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-encoding') {
            res.setHeader(key, value);
        }
    });

    const isSSE = response.headers.get('content-type')?.includes('text/event-stream');
    if (isSSE) {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
    }

    res.status(response.status);

    if (!response.body) {
        return res.end();
    }

    // Stream response with chunk buffering for usage parsing + response caching
    const reader = response.body.getReader();
    const allChunks: Buffer[] = [];
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            allChunks.push(Buffer.from(value));
            res.write(value);
        }
    } catch (err) {
        console.error('[PROXY STREAM ERROR]', err);
    } finally {
        res.end();
    }

    // Parse real token usage from streamed chunks
    const providerType = isGemini ? 'gemini' : (isOpenAI || isNvidia) ? 'openai' : 'anthropic';
    const realUsage = parseUsageFromChunks(allChunks.slice(-5), providerType);
    if (realUsage && realUsage.inputTokens > 0) {
        globalStats.realInputTokens += realUsage.inputTokens;
        globalStats.realOutputTokens += realUsage.outputTokens;
        globalStats.realCachedTokens += realUsage.cachedTokens;
        globalStats.estimationErrorSum += Math.abs(estimatedPromptTokens - realUsage.inputTokens);
        globalStats.estimationSamples++;
        reconcileUserSpend(userId, displayModel, estimatedPromptTokens, realUsage.inputTokens, realUsage.outputTokens, isCDN);
        reconcileSessionSpend(sessionId, displayModel, estimatedPromptTokens, realUsage.inputTokens, realUsage.outputTokens, isCDN);
    }

    // Cache response for replay on repeated identical requests
    if (response.status === 200 && cbHash && allChunks.length > 0) {
        const fullBody = Buffer.concat(allChunks);
        const respHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => { respHeaders[k] = v; });
        setCachedResponse(cbHash, response.status, respHeaders, fullBody, response.headers.get('content-type') || '');
    }

    } finally {
        // Request Queue — release slot after response is complete
        if (!noQueue) {
            releaseSlot(provider);
        }
    }
}
