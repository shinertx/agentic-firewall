const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

interface FailoverConfig {
    pattern: string;
    fallbackModel: string;
    provider: 'anthropic' | 'openai' | 'gemini';
}

// Same-provider failover: expensive model → cheaper equivalent on same provider.
// On 429, drop one tier to keep the request flowing.
//
// ORDER MATTERS — more specific patterns must come first so 'gpt-4o-mini'
// doesn't accidentally match the 'gpt-4o' rule, etc.
//
// ┌──────────────────────────────────────────────────────────────────────┐
// │                     SAME-PROVIDER FAILOVER CHAINS                   │
// │                                                                     │
// │ Anthropic:  Opus → Sonnet → Haiku                                  │
// │ OpenAI:     o3/o1 → o4-mini (reasoning stays reasoning)            │
// │             GPT-5.2 Pro → GPT-5.2 → GPT-4.1                       │
// │             GPT-5 → GPT-4.1 → GPT-4o → GPT-4o-mini               │
// │ Gemini:     2.5 Pro → 2.5 Flash, 2.0 Pro → 2.0 Flash             │
// │                                                                     │
// │ Input cost reference (per 1M tokens, May 2025):                    │
// │   Anthropic: Opus $15, Sonnet $3, Haiku $0.80                     │
// │   OpenAI:    o3 $10, o4-mini $1.10, GPT-4o $2.50, 4o-mini $0.15  │
// │              GPT-4.1 $2, 4.1-nano $0.10, GPT-5 ~$2               │
// │   Gemini:    2.5 Pro $1.25, 2.5 Flash $0.15, 2.0 Flash $0.10     │
// └──────────────────────────────────────────────────────────────────────┘
const FAILOVER_MAP: FailoverConfig[] = [
    // --- Anthropic ---
    { pattern: 'opus', fallbackModel: 'claude-sonnet-4-6', provider: 'anthropic' },
    { pattern: 'sonnet', fallbackModel: 'claude-haiku-4-5', provider: 'anthropic' },

    // --- OpenAI: Reasoning (o-series) ---
    { pattern: 'o3', fallbackModel: 'o4-mini', provider: 'openai' },
    { pattern: 'o1', fallbackModel: 'o4-mini', provider: 'openai' },

    // --- OpenAI: GPT-5 series (specific first) ---
    { pattern: 'gpt-5.2-pro', fallbackModel: 'gpt-5.2', provider: 'openai' },
    { pattern: 'gpt-5.2', fallbackModel: 'gpt-4.1', provider: 'openai' },
    { pattern: 'gpt-5', fallbackModel: 'gpt-4.1', provider: 'openai' },

    // --- OpenAI: GPT-4 series (specific first) ---
    { pattern: 'gpt-4.1-nano', fallbackModel: 'gpt-4o-mini', provider: 'openai' },
    { pattern: 'gpt-4.1', fallbackModel: 'gpt-4o', provider: 'openai' },
    { pattern: 'gpt-4o', fallbackModel: 'gpt-4o-mini', provider: 'openai' },
    { pattern: 'gpt-4', fallbackModel: 'gpt-4o-mini', provider: 'openai' },

    // --- Gemini ---
    { pattern: 'gemini-2.5-pro', fallbackModel: 'gemini-2.5-flash', provider: 'gemini' },
    { pattern: 'gemini-2.0-pro', fallbackModel: 'gemini-2.0-flash', provider: 'gemini' },
    { pattern: 'gemini-1.5-pro', fallbackModel: 'gemini-1.5-flash', provider: 'gemini' },
];

export async function attemptShadowRouterFailover(
    reqBody: any,
    originalHeaders: Record<string, string>,
    originalUrl?: string,
): Promise<Response | null> {
    // For Gemini, the model is in the URL path, not the body
    const bodyModel = reqBody?.model;
    const urlModel = originalUrl ? extractGeminiModel(originalUrl) : null;
    const modelStr = (typeof bodyModel === 'string' ? bodyModel : urlModel || '').toLowerCase();
    if (!modelStr) return null;

    // Find matching failover rule
    const config = FAILOVER_MAP.find(f => modelStr.includes(f.pattern) && modelStr !== f.fallbackModel);
    if (!config) return null;

    // Don't failover if we're already on the cheapest tier.
    // Note: use '-mini' not 'mini' — 'gemini' contains 'mini'!
    if (modelStr.includes('-mini') || modelStr.includes('-nano') || modelStr.includes('haiku') || modelStr.includes('flash')) return null;

    console.log(`[SHADOW ROUTER] 🔀 429 on ${bodyModel || urlModel}. Failing over to ${config.fallbackModel}...`);

    const failoverBody = { ...reqBody, model: config.fallbackModel };
    // Strip thinking parameters — fallback models may not support adaptive thinking
    delete failoverBody.thinking;

    let url: string;
    if (config.provider === 'gemini' && originalUrl) {
        // Gemini: swap the model in the URL path
        url = originalUrl.replace(/models\/[^:]+/, `models/${config.fallbackModel}`);
    } else if (config.provider === 'openai') {
        url = OPENAI_API_URL;
    } else {
        url = ANTHROPIC_API_URL;
    }

    const init: RequestInit = {
        method: 'POST',
        headers: originalHeaders,
        body: JSON.stringify(failoverBody),
    };

    try {
        const failoverRes = await fetch(url, init);
        if (failoverRes.ok) {
            console.log(`[SHADOW ROUTER] ✅ Failover to ${config.fallbackModel} successful!`);
            return failoverRes;
        } else {
            console.log(`[SHADOW ROUTER] ⚠️ Failover returned ${failoverRes.status}`);
        }
    } catch (e) {
        console.error('[SHADOW ROUTER] ❌ Failover request failed:', e);
    }

    return null;
}

function extractGeminiModel(url: string): string | null {
    const match = url.match(/models\/(gemini-[^:/?]+)/);
    return match ? match[1] : null;
}

/**
 * Cross-provider failover: translate the request to a different provider
 * and attempt the call there. Used when same-provider failover is not
 * available or also rate-limited.
 */
export async function attemptCrossProviderFailover(
    reqBody: any,
    originalModel: string,
    sourceProvider: string,
): Promise<{ response: Response; targetModel: string; targetProvider: string } | null> {
    try {
        const { detectFormat, findCrossProviderTarget, hasToolUseContent, translateRequest } = await import('./requestTranslator');
        const { acquireSlot, releaseSlot } = await import('./requestQueue');

        const target = findCrossProviderTarget(originalModel);
        if (!target) return null;

        const format = detectFormat(reqBody);
        if (hasToolUseContent(reqBody, format)) return null;

        const translation = translateRequest(reqBody, format, target.targetProvider, target.targetModel);
        if ('error' in translation) return null;

        console.log(`[SHADOW ROUTER] 🌐 Cross-provider failover: ${sourceProvider}/${originalModel} → ${target.targetProvider}/${target.targetModel}`);

        try {
            await acquireSlot(target.targetProvider, 'high');
        } catch {
            return null;
        }

        try {
            const response = await fetch(translation.url, {
                method: 'POST',
                headers: translation.headers,
                body: JSON.stringify(translation.body),
            });

            if (response.ok || response.status < 500) {
                console.log(`[SHADOW ROUTER] ✅ Cross-provider failover to ${target.targetProvider}/${target.targetModel} returned ${response.status}`);
                return { response, targetModel: target.targetModel, targetProvider: target.targetProvider };
            }

            console.log(`[SHADOW ROUTER] ⚠️ Cross-provider failover returned ${response.status}`);
            return null;
        } finally {
            releaseSlot(target.targetProvider);
        }
    } catch (e) {
        console.error('[SHADOW ROUTER] ❌ Cross-provider failover failed:', e);
        return null;
    }
}
