const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

interface FailoverConfig {
    pattern: string;
    fallbackModel: string;
    provider: 'anthropic' | 'openai';
}

// Failover mappings: expensive model → cheaper equivalent
const FAILOVER_MAP: FailoverConfig[] = [
    // Anthropic: Sonnet → Haiku
    { pattern: 'sonnet', fallbackModel: 'claude-haiku-4-5', provider: 'anthropic' },
    { pattern: 'opus', fallbackModel: 'claude-sonnet-4-6', provider: 'anthropic' },
    // OpenAI: GPT-4o → GPT-4o-mini
    { pattern: 'gpt-4o', fallbackModel: 'gpt-4o-mini', provider: 'openai' },
    { pattern: 'gpt-4', fallbackModel: 'gpt-4o-mini', provider: 'openai' },
];

export async function attemptShadowRouterFailover(reqBody: any, originalHeaders: Record<string, string>): Promise<Response | null> {
    if (!reqBody || typeof reqBody.model !== 'string') return null;

    const model = reqBody.model.toLowerCase();

    // Find matching failover rule
    const config = FAILOVER_MAP.find(f => model.includes(f.pattern) && model !== f.fallbackModel);
    if (!config) return null;

    // Don't failover if we're already on the fallback model
    if (model.includes('mini') || model.includes('haiku')) return null;

    console.log(`[SHADOW ROUTER] 🔀 429 on ${reqBody.model}. Failing over to ${config.fallbackModel}...`);

    const failoverBody = { ...reqBody, model: config.fallbackModel };
    const url = config.provider === 'anthropic' ? ANTHROPIC_API_URL : OPENAI_API_URL;

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
