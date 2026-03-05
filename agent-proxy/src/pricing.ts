// Model pricing tiers for Context CDN savings calculations.
// Input cost per million tokens — update these when provider pricing changes.
// Only used for dashboard savings reporting, not for actual billing or routing.
//
// The proxy is MODEL-AGNOSTIC: it forwards any model name untouched.
// This file only affects the "Money Saved" display on the dashboard.
// If a model isn't listed here, it falls back to DEFAULT_COST.

export interface PricingTier {
    pattern: string;
    costPerMillionTokens: number;
    label: string;
}

// ORDER MATTERS: more specific patterns must come before generic ones.
// e.g. 'gpt-5-mini' must match before 'gpt-5', 'gpt-4o-mini' before 'gpt-4o'.
// ┌───────────────────────────────────────────────────────────────────────┐
// │ MODEL PRICING REFERENCE — INPUT cost per million tokens (May 2025)  │
// │                                                                     │
// │ Refresh this periodically: providers change pricing every ~quarter. │
// │ Sorted by pattern length at runtime (see bottom of file).           │
// │ Specific patterns MUST come before generic ones in this list.       │
// └───────────────────────────────────────────────────────────────────────┘
export const MODEL_PRICING: PricingTier[] = [

    // === OpenAI — GPT-5 series ===
    { pattern: 'gpt-5.2-pro', costPerMillionTokens: 21.00, label: 'GPT-5.2 Pro' },
    { pattern: 'gpt-5.2', costPerMillionTokens: 1.75, label: 'GPT-5.2' },
    { pattern: 'gpt-5-mini', costPerMillionTokens: 0.25, label: 'GPT-5 Mini' },
    { pattern: 'gpt-5-nano', costPerMillionTokens: 0.10, label: 'GPT-5 Nano' },
    { pattern: 'gpt-5', costPerMillionTokens: 1.75, label: 'GPT-5' },

    // === OpenAI — Reasoning models (o-series) ===
    { pattern: 'o4-mini', costPerMillionTokens: 1.10, label: 'o4-mini' },
    { pattern: 'o3-mini', costPerMillionTokens: 1.10, label: 'o3-mini' },
    { pattern: 'o3', costPerMillionTokens: 10.00, label: 'o3' },
    { pattern: 'o1-mini', costPerMillionTokens: 1.10, label: 'o1-mini' },
    { pattern: 'o1', costPerMillionTokens: 15.00, label: 'o1' },

    // === OpenAI — GPT-4 series ===
    { pattern: 'gpt-4o-mini', costPerMillionTokens: 0.15, label: 'GPT-4o Mini' },
    { pattern: 'gpt-4o', costPerMillionTokens: 2.50, label: 'GPT-4o' },
    { pattern: 'gpt-4.1-mini', costPerMillionTokens: 0.10, label: 'GPT-4.1 Mini' },
    { pattern: 'gpt-4.1-nano', costPerMillionTokens: 0.10, label: 'GPT-4.1 Nano' },
    { pattern: 'gpt-4.1', costPerMillionTokens: 2.00, label: 'GPT-4.1' },
    { pattern: 'gpt-4-32k', costPerMillionTokens: 30.00, label: 'GPT-4 32k (legacy)' },
    { pattern: 'gpt-4', costPerMillionTokens: 30.00, label: 'GPT-4 (legacy)' },

    // === Anthropic — Claude 4.x series ===
    // Opus $15 input / $75 output, Sonnet $3 / $15, Haiku $0.80 / $4
    { pattern: 'opus', costPerMillionTokens: 15.00, label: 'Claude Opus' },
    { pattern: 'sonnet', costPerMillionTokens: 3.00, label: 'Claude Sonnet' },
    { pattern: 'haiku', costPerMillionTokens: 0.80, label: 'Claude Haiku' },

    // === Google — Gemini series ===
    // 2.5 Pro: $1.25 (≤200k), $2.50 (>200k). Flash: $0.15 / $0.30
    { pattern: 'gemini-2.5-pro', costPerMillionTokens: 1.25, label: 'Gemini 2.5 Pro' },
    { pattern: 'gemini-2.5-flash', costPerMillionTokens: 0.15, label: 'Gemini 2.5 Flash' },
    { pattern: 'gemini-2.0-flash', costPerMillionTokens: 0.10, label: 'Gemini 2.0 Flash' },
    { pattern: 'gemini-1.5-pro', costPerMillionTokens: 1.25, label: 'Gemini 1.5 Pro' },
    { pattern: 'gemini-1.5-flash', costPerMillionTokens: 0.075, label: 'Gemini 1.5 Flash' },
    { pattern: 'flash', costPerMillionTokens: 0.15, label: 'Gemini Flash' },
    { pattern: 'gemini-pro', costPerMillionTokens: 1.25, label: 'Gemini Pro' },
    { pattern: 'gemini', costPerMillionTokens: 1.25, label: 'Gemini' },

    // === NVIDIA NIM ===
    { pattern: 'meta/', costPerMillionTokens: 0.90, label: 'Meta Llama (NIM)' },
    { pattern: 'nvidia/', costPerMillionTokens: 0.90, label: 'NVIDIA NIM' },

    // === Budget catch-all ===
    { pattern: '-mini', costPerMillionTokens: 0.25, label: 'Mini models' },
    { pattern: '-nano', costPerMillionTokens: 0.10, label: 'Nano models' },
];

// Default cost when no model pattern matches (assumes mid-tier model)
export const DEFAULT_COST_PER_MILLION_TOKENS = 3.00;

// Anthropic prompt caching discount (server-side cache hit rate)
export const CACHE_SAVINGS_RATE = 0.90;

// Sort by pattern length descending at module load — longer patterns match first.
// This eliminates fragile skip logic: 'gpt-4o-mini' naturally matches before 'gpt-4o' before 'gpt-4'.
const SORTED_PRICING = [...MODEL_PRICING].sort((a, b) => b.pattern.length - a.pattern.length);

/**
 * Look up the input cost for a given model name.
 * Uses first-match against patterns sorted by length (longest first).
 * The proxy forwards ALL models regardless — this is only for dashboard math.
 */
export function getInputCost(modelName: string): number {
    const lower = modelName.toLowerCase();

    for (const tier of SORTED_PRICING) {
        if (lower.includes(tier.pattern)) {
            return tier.costPerMillionTokens;
        }
    }

    return DEFAULT_COST_PER_MILLION_TOKENS;
}
