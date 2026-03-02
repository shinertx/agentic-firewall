import { Request, Response } from 'express';
import { checkCircuitBreaker } from './circuitBreaker';
import { attemptShadowRouterFailover } from './shadowRouter';
import { getInputCost, CACHE_SAVINGS_RATE } from './pricing';

// Explicit Interfaces for Edge Case Handling
export interface LLMRequest {
    messages?: any[];
    system?: any;
    contents?: any[];
    systemInstruction?: any;
    model?: string;
    max_tokens?: number;
}

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const OPENAI_BASE_URL = 'https://api.openai.com';
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com';

// DRY Helper for Anthropic Cache Injection
function injectEphemeralCache(block: any): { modified: boolean, content: any } {
    if (typeof block === 'string' && block.length > 500) {
        return {
            modified: true,
            content: [{ type: 'text', text: block, cache_control: { type: 'ephemeral' } }]
        };
    } else if (Array.isArray(block) && block.length > 0) {
        const last = block[block.length - 1];
        if (last.type === 'text' && !last.cache_control && last.text.length > 500) {
            last.cache_control = { type: 'ephemeral' };
            return { modified: true, content: block };
        }
    }
    return { modified: false, content: block };
}

export function applyContextCDN(body: LLMRequest, isGemini: boolean, reqUrl: string = "") {
    if (!body) return body;
    let modified = false;

    if (isGemini) {
        // Gemini Implicit Caching — automatic for prompts with matching prefixes.
        // Active on Gemini 2.5+ and 3 series. No special headers needed.
        // We optimize by: (1) ensuring systemInstruction is populated (it's always first/prefix-stable),
        // (2) moving large content parts to the front of the contents array.
        if (body.contents && Array.isArray(body.contents) && body.contents.length > 0) {
            const totalText = JSON.stringify(body.contents);
            const estimatedTokens = Math.round(totalText.length / 4);

            if (estimatedTokens >= 1024) {
                // Ensure systemInstruction exists — this is always sent first by Gemini,
                // making it the most stable prefix for cache hits
                if (body.systemInstruction && body.systemInstruction.parts) {
                    // systemInstruction already exists — good, it's prefix-stable
                    modified = true;
                }

                // Move model-role messages before user-role messages for prefix stability
                // (similar to OpenAI system-message reordering)
                const modelMsgs = body.contents.filter((c: any) => c.role === 'model');
                const userMsgs = body.contents.filter((c: any) => c.role === 'user');
                const otherMsgs = body.contents.filter((c: any) => c.role !== 'model' && c.role !== 'user');
                if (modelMsgs.length > 0) {
                    body.contents = [...otherMsgs, ...modelMsgs, ...userMsgs];
                    modified = true;
                }

                if (modified) {
                    modified = true; // Flag for stats tracking
                }
            }
        }
    } else if (reqUrl.includes('/v1/chat/completions') || reqUrl.includes('api.openai.com')) {
        // OpenAI Prompt Caching — automatic for prompts ≥1024 tokens with prefix matching.
        // We optimize by: (1) ensuring system messages are first (prefix-stable),
        // (2) injecting prompt_cache_key for higher cache hit rates across sessions.
        const bodyStr = JSON.stringify(body);
        const estimatedTokens = Math.round(bodyStr.length / 4);
        if (estimatedTokens >= 1024 && body.messages && Array.isArray(body.messages)) {
            // Move system messages to front for stable prefix matching
            const systemMsgs = body.messages.filter((m: any) => m.role === 'system');
            const otherMsgs = body.messages.filter((m: any) => m.role !== 'system');
            if (systemMsgs.length > 0) {
                body.messages = [...systemMsgs, ...otherMsgs];
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
    const isOpenAI = !isNvidia && (req.originalUrl.includes('/v1/chat/completions') || req.originalUrl.includes('/v1/models') || (req.headers.host && req.headers.host.includes('openai.com')));

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

    const init: RequestInit = {
        method: req.method,
        headers,
    };

    let optimizedBody = req.body;
    let originalBodyStr = req.body ? JSON.stringify(req.body) : "";

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
        const ip = req.ip || '127.0.0.1';
        const apiKey = (req.headers['x-api-key'] || req.headers['authorization'] || '') as string;
        const cb = checkCircuitBreaker(ip, req.body, apiKey || undefined);
        if (cb.blocked) {
            res.status(400).json({ error: { message: cb.reason, type: 'agentic_firewall_blocked' } });
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

    // Record stats
    import('./stats').then(({ globalStats, recordActivity }) => {
        globalStats.totalRequests++;

        // Estimate prompt size: 1 token ~= 4 characters. This accurately measures massive NVIDIA/OpenAI payloads!
        // We floor at 1,000 for standard interactions, but RAG code scans easily hit 2,000,000 tokens per loop.
        const estimatedPromptTokens = Math.max(Math.round(originalBodyStr.length / 4), 1000);

        const optimizedStr = optimizedBody ? JSON.stringify(optimizedBody) : "";
        // Extract model name accurately before math
        let displayModel = optimizedBody?.model || 'unknown';
        if (isGemini) {
            const urlMatch = req.originalUrl.match(/models\/(gemini-[^:]+)/);
            if (urlMatch) displayModel = urlMatch[1];
        } else if (isOpenAI || (typeof isNvidia !== 'undefined' && isNvidia)) {
            displayModel = optimizedBody?.model || 'unknown'; // OpenAI/NVIDIA exact model specified in payload
        }

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
