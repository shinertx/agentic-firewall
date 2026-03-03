import { Request, Response } from 'express';
import { checkCircuitBreaker } from './circuitBreaker';
import { attemptShadowRouterFailover } from './shadowRouter';
import { getInputCost, CACHE_SAVINGS_RATE } from './pricing';
import { generateCacheKey } from './tokenCounter';
import { checkBudget, recordUserSpend, recordUserLoop, getOrCreateUser } from './budgetGovernor';
import { checkNoProgress } from './noProgress';
import { getProviderKey, getProviderHeaderConfig, getLocalUserId, Provider } from './keyVault';
import { globalStats, recordActivity } from './stats';
import { trimContext, applyOllamaSummary, TrimResult } from './contextTrimmer';
import { smartRoute, SmartRouteResult } from './smartRouter';

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
    // LOCAL-FIRST: User ID based on local machine identity, not API key
    const userId = getLocalUserId();

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
        const ip = req.ip || '127.0.0.1';
        const cb = checkCircuitBreaker(ip, req.body, userId);
        if (cb.blocked) {
            recordUserLoop(userId);
            res.status(400).json({ error: { message: cb.reason, type: 'agentic_firewall_blocked' } });
            return;
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

        // No-progress detection
        const npCheck = checkNoProgress(userId, req.body);
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

        // Deep copy via structuredClone (avoids JSON.parse(JSON.stringify(...)) roundtrip)
        const result = applyContextCDN(structuredClone(trimResult.body), isGemini, req.originalUrl, originalBodyStr.length);
        optimizedBody = result.body;
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

    let response = await fetch(fetchUrl, init);

    let statusText = 'Pass-through';
    let statusColor = 'text-gray-400 bg-gray-400/10';

    if (response.status === 429 && optimizedBody && !isGemini) {
        const failoverRes = await attemptShadowRouterFailover(optimizedBody, headers);
        if (failoverRes) {
            response = failoverRes;
            statusText = 'Shadow Router Failover';
            statusColor = 'text-yellow-400 bg-yellow-400/10';
        } else {
            statusText = '429 Rate Limited';
            statusColor = 'text-red-400 bg-red-400/10';
        }
    }

    // Record stats
    globalStats.totalRequests++;

    // Estimate prompt size: 1 token ~= 4 characters. This accurately measures massive NVIDIA/OpenAI payloads!
    // We floor at 1,000 for standard interactions, but RAG code scans easily hit 2,000,000 tokens per loop.
    const estimatedPromptTokens = Math.max(Math.round(originalBodyStr.length / 4), 1000);

    // Reuse pre-computed optimizedBodyStr — no re-serialization needed
    // Extract model name accurately before math
    let displayModel = optimizedBody?.model || 'unknown';
    if (isGemini) {
        const urlMatch = req.originalUrl.match(/models\/(gemini-[^:]+)/);
        if (urlMatch) displayModel = urlMatch[1];
    } else if (isOpenAI || (typeof isNvidia !== 'undefined' && isNvidia)) {
        displayModel = optimizedBody?.model || 'unknown'; // OpenAI/NVIDIA exact model specified in payload
    }

    const isCDN = statusText === 'Pass-through' && optimizedBodyStr !== originalBodyStr;

    if (isCDN) {
        statusText = 'Context CDN Hit';
        statusColor = 'text-emerald-400 bg-emerald-400/10';

        // Dynamic pricing via centralized pricing module
        const inputCostPerMillionTokens = getInputCost(displayModel);

        // Calculate the dollar value of cached tokens
        const baseCost = (estimatedPromptTokens / 1_000_000) * inputCostPerMillionTokens;
        const savingsCost = baseCost * CACHE_SAVINGS_RATE;
        const savedTokens = estimatedPromptTokens * CACHE_SAVINGS_RATE;

        globalStats.savedTokens += savedTokens;
        globalStats.savedMoney += savingsCost;
    }

    // Smart Route savings — price delta between original and downgraded model
    if (smartRouteResult && smartRouteResult.routed) {
        const originalCost = getInputCost(smartRouteResult.originalModel);
        const newCost = getInputCost(smartRouteResult.newModel);
        const costDelta = originalCost - newCost;
        if (costDelta > 0) {
            const savings = (estimatedPromptTokens / 1_000_000) * costDelta;
            globalStats.smartRouteSavings += savings;
            globalStats.savedMoney += savings;
        }

        // Override status for activity feed (unless CDN or failover already set)
        if (statusText === 'Pass-through') {
            statusText = `Smart Route: ${smartRouteResult.originalModel} → ${smartRouteResult.newModel}`;
            statusColor = 'text-blue-400 bg-blue-400/10';
        }
    }

    // Record per-user spend
    recordUserSpend(userId, displayModel, estimatedPromptTokens, isCDN);

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

    const reader = response.body.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
        }
    } catch (err) {
        console.error('[PROXY STREAM ERROR]', err);
    } finally {
        res.end();
    }
}
