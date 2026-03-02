export async function attemptShadowRouterFailover(reqBody: any, originalHeaders: Record<string, string>): Promise<Response | null> {
    // If we originally requested a larger model, downgrade to Haiku on 429
    if (reqBody && typeof reqBody.model === 'string' && reqBody.model.includes('sonnet')) {
        console.log('[SHADOW ROUTER] 🔀 429 detected on Sonnet. Failing over to Haiku...');
        const failoverBody = { ...reqBody, model: 'claude-3-haiku-20240307' };

        const init: RequestInit = {
            method: 'POST',
            headers: originalHeaders,
            body: JSON.stringify(failoverBody),
        };

        try {
            const failoverRes = await fetch('https://api.anthropic.com/v1/messages', init);
            if (failoverRes.ok) {
                console.log('[SHADOW ROUTER] ✅ Failover successful!');
                return failoverRes;
            }
        } catch (e) {
            console.error('[SHADOW ROUTER] Failover request failed:', e);
        }
    }

    return null;
}
