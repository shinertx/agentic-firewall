import { Request, Response as ExpressResponse } from 'express';
import { checkCircuitBreaker } from './circuitBreaker';
import { attemptShadowRouterFailover, attemptCrossProviderFailover } from './shadowRouter';
import { getInputCost, getOutputCost, CACHE_READ_DISCOUNT, CACHE_CREATION_SURCHARGE } from './pricing';
import { generateCacheKey } from './tokenCounter';
import { getUserId, checkBudget, recordUserSpend, recordUserLoop, reconcileUserSpend } from './budgetGovernor';
import { checkNoProgress } from './noProgress';
import { smartRoute } from './smartRouter';
import { optimizeToolResults } from './toolResultOptimizer';
import { trimContext } from './contextTrimmer';
import { compressPrompt, type CompressionResult } from './promptCompressor';
import { getCachedResponse, setCachedResponse } from './responseCache';
import { parseUsageFromChunks } from './usageParser';
import { acquireSlot, releaseSlot, autoTuneFromHeaders, QueueFullError, QueueTimeoutError } from './requestQueue';
import { globalStats, recordActivity } from './stats';
import { resolveSessionId, getOrCreateSession, recordSessionSpend, recordSessionLoop, reconcileSessionSpend } from './sessionTracker';
import { CDN_MIN_CHARS_ANTHROPIC, CDN_MIN_TOKENS_OPENAI } from './config';
import { getLocalUserId, getProviderHeaderConfig, getProviderKey, type Provider } from './keyVault';

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
    tools?: any[];
    stream?: boolean;
    stream_options?: Record<string, any>;
}

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const OPENAI_BASE_URL = 'https://api.openai.com';
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com';

// DRY Helper for Anthropic Cache Injection
// Threshold: CDN_MIN_CHARS_ANTHROPIC chars ≈ 1024 tokens — Anthropic's minimum for prompt caching.
// Below this, cache_control is silently ignored but we'd pay the 25% write surcharge.
function injectEphemeralCache(block: any): { modified: boolean, content: any } {
    if (typeof block === 'string' && block.length > CDN_MIN_CHARS_ANTHROPIC) {
        return {
            modified: true,
            content: [{ type: 'text', text: block, cache_control: { type: 'ephemeral' } }]
        };
    } else if (Array.isArray(block) && block.length > 0) {
        const last = block[block.length - 1];
        if (last.type === 'text' && !last.cache_control && last.text.length > CDN_MIN_CHARS_ANTHROPIC) {
            last.cache_control = { type: 'ephemeral' };
            return { modified: true, content: block };
        }
    }
    return { modified: false, content: block };
}

// Anthropic enforces strict non-increasing TTL ordering across cache_control blocks
// (tools → system → messages). Clients like the VS Code plugin may send mixed TTLs
// (e.g., 5m on tools, 1h on messages), causing 400 errors. This function normalizes
// all cache_control blocks to the same TTL to prevent ordering violations.
const TTL_RANK: Record<string, number> = { '5m': 1, '1h': 2 };

type ProxyHeaders = Record<string, string>;

export function injectAnthropicOAuthBeta(headers: ProxyHeaders): boolean {
    const authHeader = headers['authorization'] || '';
    if (!authHeader.includes('sk-ant-oat')) return false;

    const currentBeta = headers['anthropic-beta'] || '';
    if (currentBeta.includes('oauth-2025-04-20')) return false;

    headers['anthropic-beta'] = currentBeta ? `${currentBeta},oauth-2025-04-20` : 'oauth-2025-04-20';
    return true;
}

export function injectOpenAIStreamUsage(body: LLMRequest | undefined, isOpenAI: boolean, reqUrl: string = ''): boolean {
    const isResponsesPath = reqUrl.includes('/v1/responses');
    if (!isOpenAI || !body || body.stream !== true || isResponsesPath) return false;
    if (!body.stream_options) body.stream_options = {};
    body.stream_options.include_usage = true;
    return true;
}

export function normalizeCacheControlTTLs(body: LLMRequest): boolean {
    const allBlocks: any[] = [];

    // Collect all cache_control blocks in processing order: tools → system → messages
    const collect = (obj: any): void => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.cache_control) { allBlocks.push(obj); return; }
        if (Array.isArray(obj)) { obj.forEach(collect); return; }
        Object.values(obj).forEach(collect);
    };

    collect(body.tools);
    collect(body.system);
    collect(body.messages);

    if (allBlocks.length < 2) return false;

    // Find the minimum TTL — we'll normalize everything to this value
    // to guarantee non-increasing order (all equal = valid)
    let minTTL: string | undefined;
    for (const block of allBlocks) {
        const ttl = block.cache_control?.ttl;
        if (ttl && (!minTTL || (TTL_RANK[ttl] ?? 0) < (TTL_RANK[minTTL] ?? 0))) {
            minTTL = ttl;
        }
    }

    if (!minTTL) return false;

    // Check if there's actually a conflict
    const hasConflict = allBlocks.some(b => b.cache_control?.ttl && b.cache_control.ttl !== minTTL);
    if (!hasConflict) return false;

    // Normalize all explicit TTLs to the minimum
    for (const block of allBlocks) {
        if (block.cache_control?.ttl) {
            block.cache_control.ttl = minTTL;
        }
    }

    console.log(`[PROXY Context CDN] Normalized cache_control TTLs to '${minTTL}' to prevent ordering violation`);
    return true;
}

function hasExistingCacheControl(body: LLMRequest | undefined): boolean {
    const check = (obj: any): boolean => {
        if (!obj) return false;
        if (typeof obj !== 'object') return false;
        if (obj.cache_control) return true;
        if (Array.isArray(obj)) return obj.some(check);
        return Object.values(obj).some(check);
    };
    if (!body) return false;
    return check(body.system) || check(body.messages) || check(body.tools);
}

export function applyContextCDN(body: LLMRequest, isGemini: boolean, reqUrl: string = "") {
    if (!body) return body;
    let modified = false;

    // For Anthropic requests, normalize any existing cache_control TTLs to prevent
    // ordering violations (e.g., VS Code plugin sending 5m on tools, 1h on messages)
    const isOpenAIPath = reqUrl.includes('/v1/chat/completions') || reqUrl.includes('/v1/responses') || reqUrl.includes('api.openai.com');
    if (!isGemini && !isOpenAIPath) {
        if (normalizeCacheControlTTLs(body)) {
            modified = true;
        }
    }

    if (isGemini) {
        // Gemini Implicit Caching — automatic for prompts with matching prefixes.
        // Active on Gemini 2.5+ and 3 series. No special headers needed.
        // We optimize by ensuring systemInstruction is populated (it's always first/prefix-stable).
        // NOTE: We do NOT reorder conversation turns — Gemini requires strict alternating
        // user/model turns. Reordering would cause 400 errors.
        if (body.contents && Array.isArray(body.contents) && body.contents.length > 0) {
            const totalText = JSON.stringify(body.contents);
            const estimatedTokens = Math.round(totalText.length / 4);

            if (estimatedTokens >= CDN_MIN_TOKENS_OPENAI) {
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
        const bodyStr = JSON.stringify(body);
        const estimatedTokens = Math.round(bodyStr.length / 4);
        if (estimatedTokens >= CDN_MIN_TOKENS_OPENAI && body.messages && Array.isArray(body.messages)) {
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
    } else if (!hasExistingCacheControl(body)) {
        // Anthropic Cache injection (DRY Implementation)
        // Only inject when the request doesn't already have cache_control blocks
        if (body.system) {
            const result = injectEphemeralCache(body.system);
            if (result.modified) {
                body.system = result.content;
                modified = true;
            }
        }

        // NOTE: We intentionally do NOT inject cache_control on the last user message.
        // In agentic conversations, the last user message changes every turn (new tool
        // results, new user input). Injecting cache_control would pay the 25% cache WRITE
        // surcharge on every request with zero chance of a cache READ — a pure tax on some
        // of the largest content blocks in the request.
        // Only the system prompt (stable across turns) benefits from cache injection.
        if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
            // Tools definitions are stable across a conversation, so they benefit from caching
            const toolsStr = JSON.stringify(body.tools);
            if (toolsStr.length >= CDN_MIN_CHARS_ANTHROPIC) {
                const lastTool = body.tools[body.tools.length - 1];
                if (lastTool && typeof lastTool === 'object' && !lastTool.cache_control) {
                    lastTool.cache_control = { type: 'ephemeral' };
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

export async function handleProxyRequest(req: Request, res: ExpressResponse) {
    const isPublicMode = process.env.PUBLIC_MODE !== 'false' && process.env.PUBLIC_MODE !== '0';
    const hasGoogKey = req.query.key || req.headers['x-goog-api-key'];
    const isGemini = !!(req.originalUrl.includes('/v1beta/models') || (req.originalUrl.includes('/v1/models') && hasGoogKey));
    const isNvidia = req.originalUrl.includes('integrate.api.nvidia.com') || (req.body?.model && (typeof req.body.model === 'string') && (req.body.model.startsWith('meta/') || req.body.model.startsWith('nvidia/')));
    const isOpenAI = !isNvidia && (req.originalUrl.includes('/v1/chat/completions') || req.originalUrl.includes('/v1/responses') || req.originalUrl.includes('/v1/models') || (req.headers.host && req.headers.host.includes('openai.com')));
    const isCountTokens = req.originalUrl.includes('/v1/messages/count_tokens');
    const provider: Provider = isGemini ? 'gemini' : isOpenAI ? 'openai' : isNvidia ? 'nvidia' : 'anthropic';

    let baseUrl = ANTHROPIC_BASE_URL;
    if (isGemini) baseUrl = GEMINI_BASE_URL;
    if (isOpenAI) baseUrl = OPENAI_BASE_URL;
    if (isNvidia) baseUrl = NVIDIA_BASE_URL;

    // In rare cases agents hardcode the absolute url, so we only append the path if it's relative
    const url = req.originalUrl.startsWith('http') ? req.originalUrl : `${baseUrl}${req.originalUrl}`;

    const headers = { ...req.headers } as ProxyHeaders;
    delete headers.host;
    delete headers.connection;

    // Clean up content-length as it will change if we mutate the body string later
    delete headers['content-length'];

    // Claude OAuth requests require an explicit beta header upstream.
    injectAnthropicOAuthBeta(headers);

    if (!isPublicMode) {
        const { headerName, headerPrefix } = getProviderHeaderConfig(provider);
        const incomingAuth = headers[headerName] || '';
        const hasOauthToken = typeof incomingAuth === 'string' && incomingAuth.includes('eyJ');

        const hasProviderKey = provider === 'gemini'
            ? !!(req.query.key || headers[headerName])
            : !!headers[headerName];

        if (!hasProviderKey && !hasOauthToken) {
            const keyResult = getProviderKey(provider);
            if ('error' in keyResult) {
                res.status(400).json({ error: { message: keyResult.error } });
                return;
            }
            headers[headerName] = `${headerPrefix}${keyResult.key}`;
        }
    }

    const init: RequestInit = {
        method: req.method,
        headers,
    };

    // Fast pass-through for un-proxied endpoints (count_tokens)
    // Fast pass-through for un-proxied endpoints (count_tokens)
    const isRealtimeResponses = req.originalUrl.includes('/v1/responses');

    if (isCountTokens || isRealtimeResponses) {
        console.log(`[PROXY] => Pass-through (no inspection) to ${url}`);
        const ctInit: RequestInit = { method: req.method, headers, body: req.body && Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : undefined };
        const passThroughBodyStr = req.body ? JSON.stringify(req.body) : "";
        const fetchStartMs = Date.now();
        let ttftMs = 0;
        const chunks: Buffer[] = [];
        try {
            const ctRes = await fetch(url, ctInit);
            ctRes.headers.forEach((value, key) => {
                if (key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-encoding') {
                    res.setHeader(key, value);
                }
            });
            res.status(ctRes.status);
            if (!ctRes.body) return res.end();
            const reader = ctRes.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (ttftMs === 0) ttftMs = Date.now() - fetchStartMs;
                if (isRealtimeResponses) chunks.push(Buffer.from(value));
                res.write(value);
            }

            if (isRealtimeResponses && req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
                const totalResponseMs = Date.now() - fetchStartMs;
                const displayModel = req.body?.model || 'unknown';
                const estimatedPromptTokens = Math.max(Math.round(passThroughBodyStr.length / 4), 1000);
                const apiKey = (req.headers['x-api-key'] || req.headers['authorization'] || '') as string;
                const userId = !isPublicMode && !apiKey ? getLocalUserId() : getUserId(apiKey);
                const sessionId = resolveSessionId(req);
                getOrCreateSession(sessionId, userId);

                globalStats.totalRequests++;
                globalStats.totalTtftMs += ttftMs;
                globalStats.totalResponseMs += totalResponseMs;
                globalStats.timedRequests++;

                if (ctRes.ok) {
                    recordUserSpend(userId, displayModel, estimatedPromptTokens, false);
                    recordSessionSpend(sessionId, displayModel, estimatedPromptTokens, false);
                }

                const usage = parseUsageFromChunks(chunks, provider);
                if (usage) {
                    globalStats.realInputTokens += usage.inputTokens;
                    globalStats.realOutputTokens += usage.outputTokens;
                    globalStats.realCachedTokens += usage.cachedTokens;
                }

                recordActivity({
                    time: new Date().toLocaleTimeString(),
                    model: displayModel,
                    tokens: `${Math.round(estimatedPromptTokens / 1000)}k`,
                    status: ctRes.ok ? 'Pass-through' : `Upstream ${ctRes.status}`,
                    statusColor: ctRes.ok ? 'text-slate-300 bg-slate-300/10' : 'text-red-400 bg-red-400/10',
                    saved: '',
                    ttftMs,
                    totalMs: totalResponseMs,
                });
            }
        } catch (err) {
            console.error('[PROXY] pass-through error:', err);
            if (!res.headersSent) res.status(502).json({ error: { message: 'Failed to reach upstream endpoint' } });
        } finally {
            res.end();
        }
        return;
    }

    let optimizedBody = req.body;
    let originalBodyStr = req.body ? JSON.stringify(req.body) : "";
    const apiKey = (req.headers['x-api-key'] || req.headers['authorization'] || '') as string;
    const userId = !isPublicMode && !apiKey ? getLocalUserId() : getUserId(apiKey);
    const sessionId = resolveSessionId(req);
    getOrCreateSession(sessionId, userId);
    let requestHash = '';
    let compResult: CompressionResult = {
        compressed: false,
        body: optimizedBody,
        originalTokens: 0,
        compressedTokens: 0,
        savedTokens: 0,
        compressionRatio: 1,
        cacheHit: false,
        ollamaLatencyMs: 0,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
        const ip = req.ip || '127.0.0.1';
        const cb = await checkCircuitBreaker(ip, req.body, apiKey || undefined);
        if (cb.blocked) {
            recordUserLoop(userId);
            recordSessionLoop(sessionId);
            const model = req.body?.model || 'unknown';
            const stopMsg = `The Agentic Firewall detected a loop: the last 3 requests were identical. This request has been blocked to prevent waste. I need to try a different approach or ask the user for guidance instead of retrying the same operation.`;

            res.setHeader('X-Firewall-Action', 'circuit_breaker_blocked');

            if (isOpenAI) {
                res.status(200).json({
                    id: `chatcmpl-firewall-${Date.now()}`,
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [{ index: 0, message: { role: 'assistant', content: stopMsg }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                });
            } else {
                res.status(200).json({
                    id: `msg_firewall_${Date.now()}`,
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'text', text: stopMsg }],
                    model,
                    stop_reason: 'end_turn',
                    stop_sequence: null,
                    usage: { input_tokens: 0, output_tokens: 0 },
                });
            }

            recordActivity({ time: new Date().toLocaleTimeString(), model, tokens: 0, status: 'Loop Blocked', statusColor: 'text-red-400' });
            globalStats.blockedLoops++;
            console.log(`[FIREWALL] Circuit breaker blocked for ${userId}: ${cb.reason}`);
            return;
        }
        requestHash = cb.hash;

        // Response Cache — serve cached response for repeated identical requests
        if (cb.identicalCount >= 2) {
            const cached = getCachedResponse(cb.hash);
            if (cached) {
                console.log(`[RESPONSE CACHE] Serving cached response for repeat request (${cb.identicalCount}x identical)`);
                globalStats.responseCacheHits++;
                Object.entries(cached.headers).forEach(([key, value]) => {
                    res.setHeader(key, value);
                });
                res.status(cached.statusCode);
                res.end(cached.body);
                return;
            }
            globalStats.responseCacheMisses++;
        }

        // Budget governor — check spend cap
        const budgetHeader = req.headers['x-budget-limit'] as string | undefined;
        const budgetLimit = budgetHeader ? parseFloat(budgetHeader) : null;
        const budgetCheck = checkBudget(userId, budgetLimit);
        if (!budgetCheck.allowed) {
            const model = req.body?.model || 'unknown';
            const stopMsg = `The budget limit has been reached ($${budgetCheck.spent?.toFixed(2)} spent of $${budgetCheck.limit?.toFixed(2)} limit). The Agentic Firewall is blocking further requests to prevent overspend. I should stop making API calls and inform the user that their budget has been exhausted.`;

            res.setHeader('X-Firewall-Action', 'budget_exceeded');
            res.setHeader('X-Firewall-Spent', String(budgetCheck.spent || 0));
            res.setHeader('X-Firewall-Limit', String(budgetCheck.limit || 0));

            if (isOpenAI) {
                res.status(200).json({
                    id: `chatcmpl-firewall-${Date.now()}`,
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [{ index: 0, message: { role: 'assistant', content: stopMsg }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                });
            } else {
                res.status(200).json({
                    id: `msg_firewall_${Date.now()}`,
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'text', text: stopMsg }],
                    model,
                    stop_reason: 'end_turn',
                    stop_sequence: null,
                    usage: { input_tokens: 0, output_tokens: 0 },
                });
            }

            recordActivity({ time: new Date().toLocaleTimeString(), model, tokens: 0, status: 'Budget Exceeded', statusColor: 'text-red-400' });
            console.log(`[FIREWALL] Budget exceeded for ${userId}: ${budgetCheck.reason}`);
            return;
        }

        // Soft budget warning — alert agents approaching their spend limit
        if (budgetCheck.warningPct) {
            res.setHeader('X-Firewall-Budget-Warning', `${budgetCheck.warningPct}% of budget used ($${budgetCheck.spent?.toFixed(2)} of $${budgetCheck.limit?.toFixed(2)})`);
        }

        // No-progress detection — return a synthetic model response so the agent
        // processes it as a real turn and changes approach instead of retrying.
        const npCheck = checkNoProgress(userId, req.body);
        if (npCheck.noProgress) {
            const stopMsg = `I've been repeating the same failing operation ${npCheck.consecutiveErrors} times. The Agentic Firewall has stopped this loop to prevent waste. I need to try a completely different approach instead of retrying the same thing.`;
            const model = req.body?.model || 'unknown';

            res.setHeader('X-Firewall-Action', 'no_progress_blocked');
            res.setHeader('X-Firewall-Consecutive-Errors', String(npCheck.consecutiveErrors));

            if (isOpenAI) {
                // OpenAI Chat Completions format
                res.status(200).json({
                    id: `chatcmpl-firewall-${Date.now()}`,
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: stopMsg },
                        finish_reason: 'stop',
                    }],
                    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                });
            } else {
                // Anthropic Messages format (also used as fallback)
                res.status(200).json({
                    id: `msg_firewall_${Date.now()}`,
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'text', text: stopMsg }],
                    model,
                    stop_reason: 'end_turn',
                    stop_sequence: null,
                    usage: { input_tokens: 0, output_tokens: 0 },
                });
            }

            recordActivity({ time: new Date().toLocaleTimeString(), model, tokens: 0, status: 'No Progress Blocked', statusColor: 'text-red-400' });
            globalStats.blockedLoops++;
            console.log(`[FIREWALL] No-progress blocked for ${userId}: ${npCheck.reason}`);
            return;
        }

        // Smart Router — downgrade model for simple requests
        const smartResult = await smartRoute(optimizedBody, isGemini, !!isOpenAI);
        if (smartResult.routed) {
            optimizedBody = { ...optimizedBody, model: smartResult.newModel };
            // Strip thinking parameters — downgraded models may not support adaptive thinking
            delete optimizedBody.thinking;
            globalStats.smartRouteDowngrades++;
            const origCost = getInputCost(smartResult.originalModel);
            const newCost = getInputCost(smartResult.newModel);
            const estTokens = Math.round(originalBodyStr.length / 4);
            globalStats.smartRouteSavings += (estTokens / 1_000_000) * (origCost - newCost);
            console.log(`[SMART ROUTER] ${smartResult.originalModel} → ${smartResult.newModel} (${smartResult.complexity}: ${smartResult.reason})`);
        }

        // Tool Result Optimizer — dedup + compress stale tool results to reduce token waste
        const troResult = optimizeToolResults(optimizedBody, isGemini, !!isOpenAI);
        if (troResult.optimized) {
            optimizedBody = troResult.body;
            globalStats.toolResultDeduped += troResult.dedupedCount;
            globalStats.toolResultCompressed += troResult.compressedCount;
            globalStats.toolResultSavedChars += troResult.savedChars;
            console.log(`[TOOL RESULT OPTIMIZER] Deduped ${troResult.dedupedCount}, compressed ${troResult.compressedCount}, saved ~${Math.round(troResult.savedChars / 4)} tokens`);
        }

        // Context Trimmer — reduce oversized payloads before upstream dispatch
        const trimResult = trimContext(optimizedBody, isGemini, !!isOpenAI, optimizedBody?.model || '', originalBodyStr.length);
        if (trimResult.trimmed) {
            optimizedBody = trimResult.body;
            globalStats.trimmedRequests++;
            globalStats.trimmedTokensSaved += trimResult.trimmedTokens;
            console.log(`[CONTEXT TRIMMER] Trimmed ${trimResult.removedMessages} msgs, saved ~${trimResult.trimmedTokens} tokens`);
        }

        // Prompt Compressor — compress oversized system prompts and long histories via Ollama
        compResult = await compressPrompt(optimizedBody, isGemini, !!isOpenAI, optimizedBody?.model || '');
        if (compResult.compressed) {
            optimizedBody = compResult.body;
            globalStats.compressionCalls++;
            globalStats.compressedTokensSaved += compResult.savedTokens;
            if (compResult.cacheHit) globalStats.compressionCacheHits++;
            console.log(`[PROMPT COMPRESSOR] Saved ~${compResult.savedTokens} tokens (${(compResult.compressionRatio * 100).toFixed(0)}% of original, ${compResult.ollamaLatencyMs}ms${compResult.cacheHit ? ', cache hit' : ''})`);
        }

        // Only add stream usage metadata for actual streaming requests.
        injectOpenAIStreamUsage(optimizedBody, !!isOpenAI, req.originalUrl);

        // Apply Context CDN (cache headers) on the optimized body
        const result = applyContextCDN(JSON.parse(JSON.stringify(optimizedBody)), isGemini, req.originalUrl);
        optimizedBody = result.body;
        init.body = JSON.stringify(optimizedBody);

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
        res.setHeader('X-Firewall-Dashboard', `https://api.jockeyvc.com/dashboard/${userId}`);
    }

    console.log(`[PROXY] => ${req.method} ${url}`);

    // Request queue — acquire a concurrency slot for this provider
    try {
        await acquireSlot(provider);
        globalStats.queuedRequests++;
    } catch (err) {
        if (err instanceof QueueFullError) {
            globalStats.queueFullRejections++;
            res.status(429).json({ error: { message: `Agentic Firewall: Request queue full for ${provider}. Try again shortly.` } });
            return;
        }
        if (err instanceof QueueTimeoutError) {
            globalStats.queueTimeouts++;
            res.status(429).json({ error: { message: `Agentic Firewall: Request queue timeout for ${provider}. Provider may be overloaded.` } });
            return;
        }
        throw err;
    }

    const fetchStartMs = Date.now();
    let response: globalThis.Response;
    try {
        response = await fetch(url, init);
    } catch (fetchErr) {
        releaseSlot(provider);
        throw fetchErr;
    }

    let statusText = 'Pass-through';
    let statusColor = 'text-gray-400 bg-gray-400/10';

    if (response.status === 429 && optimizedBody) {
        // Same-provider failover (Anthropic, OpenAI, Gemini)
        const failoverRes = await attemptShadowRouterFailover(optimizedBody, headers, url);
        if (failoverRes) {
            response = failoverRes;
            statusText = 'Shadow Router Failover';
            statusColor = 'text-yellow-400 bg-yellow-400/10';
        } else {
            // Cross-provider failover as second-stage fallback
            const originalModel = optimizedBody?.model || '';
            const crossRes = await attemptCrossProviderFailover(optimizedBody, originalModel, provider, headers);
            if (crossRes) {
                response = crossRes.response;
                statusText = `Cross-Provider Failover (${crossRes.targetProvider})`;
                statusColor = 'text-yellow-400 bg-yellow-400/10';
            } else {
                statusText = '429 Rate Limited';
                statusColor = 'text-red-400 bg-red-400/10';
            }
        }
    }

    // Forward response headers
    response.headers.forEach((value: string, key: string) => {
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

    // Stream response and capture chunks for usage parsing + response caching
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let ttftMs = 0;
    let streamError = false;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (ttftMs === 0) ttftMs = Date.now() - fetchStartMs;
            chunks.push(Buffer.from(value));
            // Check if client is still connected before writing
            if (res.destroyed || res.writableEnded) {
                console.warn('[PROXY] Client disconnected mid-stream, aborting read');
                reader.cancel();
                streamError = true;
                break;
            }
            const writeOk = res.write(value);
            if (!writeOk) {
                // Backpressure — wait for drain or client disconnect (whichever comes first)
                await new Promise<void>(resolve => {
                    const onDrain = () => { res.off('close', onClose); resolve(); };
                    const onClose = () => { res.off('drain', onDrain); resolve(); };
                    res.once('drain', onDrain);
                    res.once('close', onClose);
                });
                if (res.destroyed || res.writableEnded) {
                    reader.cancel();
                    streamError = true;
                    break;
                }
            }
        }
    } catch (err) {
        streamError = true;
        console.error('[PROXY STREAM ERROR]', err);
        // Send SSE error event if streaming and headers already sent
        if (isSSE && !res.writableEnded && !res.destroyed) {
            try {
                res.write(`data: ${JSON.stringify({ error: { message: 'Stream interrupted', type: 'stream_error' } })}\n\n`);
            } catch { /* client gone */ }
        }
    } finally {
        if (!res.writableEnded) res.end();
        releaseSlot(provider);
    }
    const totalResponseMs = Date.now() - fetchStartMs;

    // Auto-tune rate limits from provider response headers
    autoTuneFromHeaders(provider, response.headers);

    // Pre-compute CDN status so reconciliation can use it
    const optimizedStr = optimizedBody ? JSON.stringify(optimizedBody) : "";
    const proxyModified = optimizedStr !== originalBodyStr;
    const clientHasCaching = hasExistingCacheControl(req.body);
    const isCDN = statusText === 'Pass-through' && (proxyModified || clientHasCaching);
    const requestSucceeded = response.ok;

    // Parse real token usage from the response stream
    const usage = parseUsageFromChunks(chunks, provider);
    if (usage) {
        globalStats.realInputTokens += usage.inputTokens;
        globalStats.realOutputTokens += usage.outputTokens;
        globalStats.realCachedTokens += usage.cachedTokens;

        // Track estimation accuracy (per-model)
        const estimated = Math.round(originalBodyStr.length / 4);
        const actual = usage.inputTokens + usage.cachedTokens + usage.cacheCreationTokens;
        if (actual > 0) {
            globalStats.estimationErrorSum += Math.abs(estimated - actual) / actual;
            globalStats.estimationSamples++;

            // Per-model calibration
            const modelKey = optimizedBody?.model || 'unknown';
            const entry = globalStats.perModelEstimation[modelKey] || { errorSum: 0, samples: 0 };
            entry.errorSum += Math.abs(estimated - actual) / actual;
            entry.samples++;
            globalStats.perModelEstimation[modelKey] = entry;
        }

        // Reconcile user and session spend with real token counts
        const displayModelForReconcile = optimizedBody?.model || 'unknown';
        reconcileUserSpend(userId, displayModelForReconcile, estimated, usage.inputTokens, usage.outputTokens, isCDN);
        reconcileSessionSpend(sessionId, displayModelForReconcile, estimated, usage.inputTokens, usage.outputTokens, isCDN);

        // Track real output token cost in globalStats
        const outputCostPerM = getOutputCost(displayModelForReconcile);
        globalStats.realOutputSpend += (usage.outputTokens / 1_000_000) * outputCostPerM;

        // Reconcile CDN savings with cache-aware math when real data available
        if (isCDN && (usage.cachedTokens > 0 || usage.cacheCreationTokens > 0)) {
            const inputCostPerM = getInputCost(displayModelForReconcile);
            // Cache reads save 90% of input cost
            const cacheReadSavings = (usage.cachedTokens / 1_000_000) * inputCostPerM * CACHE_READ_DISCOUNT;
            // Cache creation costs 125% (25% surcharge) — net negative savings
            const cacheCreationExtra = (usage.cacheCreationTokens / 1_000_000) * inputCostPerM * CACHE_CREATION_SURCHARGE;
            // The estimated savings was already added above; adjust with the real delta
            const estimatedSavings = (estimated / 1_000_000) * inputCostPerM * CACHE_READ_DISCOUNT;
            const realSavings = cacheReadSavings - cacheCreationExtra;
            globalStats.savedMoney += (realSavings - estimatedSavings);
        }
    }

    // Store in response cache for identical-request deduplication
    if (response.status === 200 && requestHash) {
        const fullBody = Buffer.concat(chunks);
        const contentType = response.headers.get('content-type') || '';
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((v: string, k: string) => {
            if (k.toLowerCase() !== 'transfer-encoding' && k.toLowerCase() !== 'content-encoding') {
                responseHeaders[k] = v;
            }
        });
        setCachedResponse(requestHash, 200, responseHeaders, fullBody, contentType);
    }

    // Record stats — ONLY for actual LLM API calls (POST with a body)
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
        let displayModel = optimizedBody?.model || 'unknown';
        if (isGemini) {
            const urlMatch = req.originalUrl.match(/models\/(gemini-[^:]+)/);
            if (urlMatch) displayModel = urlMatch[1];
        }

        globalStats.totalRequests++;

        const estimatedPromptTokens = Math.max(Math.round(originalBodyStr.length / 4), 1000);

        if (!requestSucceeded && statusText === 'Pass-through') {
            statusText = `Upstream ${response.status}`;
            statusColor = 'text-red-400 bg-red-400/10';
        } else if (isCDN && requestSucceeded) {
            statusText = compResult.compressed ? 'CDN + Compressed' : 'Context CDN Hit';
            statusColor = 'text-emerald-400 bg-emerald-400/10';

            // Estimate savings — will be reconciled with real usage when available
            const inputCostPerM = getInputCost(displayModel);
            const baseCost = (estimatedPromptTokens / 1_000_000) * inputCostPerM;
            const savingsCost = baseCost * CACHE_READ_DISCOUNT;
            const savedTokens = estimatedPromptTokens * CACHE_READ_DISCOUNT;

            globalStats.savedTokens += savedTokens;
            globalStats.savedMoney += savingsCost;
        } else if (compResult.compressed && requestSucceeded) {
            statusText = 'Compressed';
            statusColor = 'text-cyan-400 bg-cyan-400/10';
        }

        if (requestSucceeded) {
            recordUserSpend(userId, displayModel, estimatedPromptTokens, isCDN);
            recordSessionSpend(sessionId, displayModel, estimatedPromptTokens, isCDN);
        }

        // Compute per-request savings for the live feed
        let savedAmount = '';
        if (isCDN && requestSucceeded && estimatedPromptTokens) {
            const cost = (estimatedPromptTokens / 1_000_000) * getInputCost(displayModel) * CACHE_READ_DISCOUNT;
            savedAmount = cost >= 0.01 ? cost.toFixed(2) : cost.toFixed(4);
        }

        // Track response timing
        globalStats.totalTtftMs += ttftMs;
        globalStats.totalResponseMs += totalResponseMs;
        globalStats.timedRequests++;

        recordActivity({
            time: new Date().toLocaleTimeString(),
            model: displayModel,
            tokens: estimatedPromptTokens ? `${Math.round(estimatedPromptTokens / 1000)}k` : 'auto',
            status: statusText,
            statusColor,
            saved: savedAmount,
            ttftMs,
            totalMs: totalResponseMs,
        });
    }
}
