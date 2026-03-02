// Model pricing tiers for Context CDN savings calculations.
// Input cost per million tokens — update these when provider pricing changes.
// Only used for dashboard savings reporting, not for actual billing.

export interface PricingTier {
    pattern: string;
    costPerMillionTokens: number;
    label: string;
}

export const MODEL_PRICING: PricingTier[] = [
    // Premium reasoning models (highest cost)
    { pattern: 'o1', costPerMillionTokens: 15.00, label: 'OpenAI o1' },
    { pattern: 'o3', costPerMillionTokens: 15.00, label: 'OpenAI o3' },
    { pattern: 'opus', costPerMillionTokens: 15.00, label: 'Claude Opus' },

    // Legacy expensive models
    { pattern: 'gpt-4-32k', costPerMillionTokens: 30.00, label: 'GPT-4 32k' },
    { pattern: 'gpt-4', costPerMillionTokens: 30.00, label: 'GPT-4 (original)' },

    // Budget tier (MUST come before standard tier so gpt-4o-mini matches here, not gpt-4o)
    { pattern: 'gpt-4o-mini', costPerMillionTokens: 0.15, label: 'GPT-4o Mini' },
    { pattern: 'haiku', costPerMillionTokens: 0.80, label: 'Claude Haiku' },
    { pattern: 'mini', costPerMillionTokens: 0.15, label: 'Mini models' },
    { pattern: 'flash', costPerMillionTokens: 0.15, label: 'Gemini Flash' },

    // Standard tier
    { pattern: 'gpt-4o', costPerMillionTokens: 2.50, label: 'GPT-4o' },
    { pattern: 'sonnet', costPerMillionTokens: 3.00, label: 'Claude Sonnet' },
];

// Default cost when no model pattern matches
export const DEFAULT_COST_PER_MILLION_TOKENS = 3.00;

// Anthropic prompt caching discount (server-side cache hit rate)
export const CACHE_SAVINGS_RATE = 0.90;

/**
 * Look up the input cost for a given model name.
 * Uses first-match against the patterns above — order matters
 * (e.g., 'gpt-4-32k' must match before the generic 'gpt-4' pattern).
 */
export function getInputCost(modelName: string): number {
    const lower = modelName.toLowerCase();

    // Prevent 'gpt-4o' from matching the generic 'gpt-4' pattern
    for (const tier of MODEL_PRICING) {
        if (tier.pattern === 'gpt-4' && (lower.includes('gpt-4o') || lower.includes('gpt-4-turbo'))) {
            continue;
        }
        if (lower.includes(tier.pattern)) {
            return tier.costPerMillionTokens;
        }
    }

    return DEFAULT_COST_PER_MILLION_TOKENS;
}
