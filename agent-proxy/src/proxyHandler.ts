import { Request, Response } from 'express';
import { checkCircuitBreaker } from './circuitBreaker';
import { attemptShadowRouterFailover } from './shadowRouter';
import { getInputCost, CACHE_SAVINGS_RATE } from './pricing';
import { generateCacheKey } from './tokenCounter';
import { getUserId, checkBudget, recordUserSpend, recordUserLoop, getOrCreateUser } from './budgetGovernor';
import { checkNoProgress } from './noProgress';

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

// Anthropic enforces strict non-increasing TTL ordering across cache_control blocks
// (tools → system → messages). Clients like the VS Code plugin may send mixed TTLs
// (e.g., 5m on tools, 1h on messages), causing 400 errors. This function normalizes
// all cache_control blocks to the same TTL to prevent ordering violations.
const TTL_RANK: Record<string, number> = { '5m': 1, '1h': 2 };

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

function hasExistingCacheControl(body: LLMRequest): boolean {
    const check = (obj: any): boolean => {
        if (!obj) return false;
        if (typeof obj !== 'object') return false;
        if (obj.cache_control) return true;
        if (Array.isArray(obj)) return obj.some(check);
        return Object.values(obj).some(check);
    };
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
        const bodyStr = JSON.stringify(body);
        const estimatedTokens = Math.round(bodyStr.length / 4);
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

    // Inject OAuth beta header for Claude Code Max/Pro users using OAuth tokens
    const authHeader = headers['authorization'] || '';
    if (authHeader.includes('sk-ant-oat')) {
        const currentBeta = headers['anthropic-beta'] || '';
        if (!currentBeta.includes('oauth-2025-04-20')) {
            headers['anthropic-beta'] = currentBeta ? `${currentBeta},oauth-2025-04-20` : 'oauth-2025-04-20';
        }
    }

    const init: RequestInit = {
        method: req.method,
        headers,
    };

    let optimizedBody = req.body;
    let originalBodyStr = req.body ? JSON.stringify(req.body) : "";
    const apiKey = (req.headers['x-api-key'] || req.headers['authorization'] || '') as string;
    const userId = getUserId(apiKey);

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
        const ip = req.ip || '127.0.0.1';
        const cb = checkCircuitBreaker(ip, req.body, apiKey || undefined);
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

        // Deep copy so we don't accidentally mutate the original request when passing it
        const result = applyContextCDN(JSON.parse(originalBodyStr), isGemini, req.originalUrl);
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

    let response = await fetch(url, init);

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

    // Record stats — ONLY for actual LLM API calls (POST with a body), not bot/crawler GET requests
    import('./stats').then(({ globalStats, recordActivity }) => {
        // Extract model name accurately before math
        let displayModel = optimizedBody?.model || 'unknown';
        if (isGemini) {
            const urlMatch = req.originalUrl.match(/models\/(gemini-[^:]+)/);
            if (urlMatch) displayModel = urlMatch[1];
        } else if (isOpenAI || (typeof isNvidia !== 'undefined' && isNvidia)) {
            displayModel = optimizedBody?.model || 'unknown';
        }

        // Skip stats for non-LLM traffic (GET requests, bot crawlers, health checks, favicon etc.)
        if (req.method === 'GET' || req.method === 'HEAD' || !req.body || Object.keys(req.body).length === 0) {
            return; // Do NOT count bots/crawlers in our stats
        }

        globalStats.totalRequests++;

        // Estimate prompt size: 1 token ~= 4 characters.
        const estimatedPromptTokens = Math.max(Math.round(originalBodyStr.length / 4), 1000);

        const optimizedStr = optimizedBody ? JSON.stringify(optimizedBody) : "";
        const isCDN = statusText === 'Pass-through' && optimizedStr !== originalBodyStr;

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

        // Record per-user spend
        recordUserSpend(userId, displayModel, estimatedPromptTokens, isCDN);

        recordActivity({
            time: new Date().toLocaleTimeString(),
            model: displayModel,
            tokens: estimatedPromptTokens ? `${Math.round(estimatedPromptTokens / 1000)}k` : 'auto',
            status: statusText,
            statusColor
        });
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
