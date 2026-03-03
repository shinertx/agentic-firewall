/**
 * Model context window registry.
 * Maps model name patterns to their maximum input context window in tokens.
 * Used by contextTrimmer to decide when/how much to trim.
 *
 * These are INPUT context limits — the total tokens the model can accept.
 * We trim to TARGET_RATIO of the window to leave headroom for the response.
 */

export interface ContextWindow {
    pattern: string;
    maxTokens: number;
    label: string;
}

export const MODEL_CONTEXT_WINDOWS: ContextWindow[] = [
    // OpenAI GPT-5 series
    { pattern: 'gpt-5.2-pro', maxTokens: 256_000, label: 'GPT-5.2 Pro' },
    { pattern: 'gpt-5.2', maxTokens: 256_000, label: 'GPT-5.2' },
    { pattern: 'gpt-5-mini', maxTokens: 128_000, label: 'GPT-5 Mini' },
    { pattern: 'gpt-5-nano', maxTokens: 128_000, label: 'GPT-5 Nano' },
    { pattern: 'gpt-5', maxTokens: 256_000, label: 'GPT-5' },

    // OpenAI reasoning models
    { pattern: 'o4-mini', maxTokens: 200_000, label: 'o4-mini' },
    { pattern: 'o3-mini', maxTokens: 200_000, label: 'o3-mini' },
    { pattern: 'o3', maxTokens: 200_000, label: 'o3' },
    { pattern: 'o1', maxTokens: 200_000, label: 'o1' },

    // OpenAI GPT-4 legacy
    { pattern: 'gpt-4o-mini', maxTokens: 128_000, label: 'GPT-4o Mini' },
    { pattern: 'gpt-4o', maxTokens: 128_000, label: 'GPT-4o' },
    { pattern: 'gpt-4.1-nano', maxTokens: 1_047_576, label: 'GPT-4.1 Nano' },
    { pattern: 'gpt-4.1', maxTokens: 1_047_576, label: 'GPT-4.1' },
    { pattern: 'gpt-4-32k', maxTokens: 32_768, label: 'GPT-4 32k' },
    { pattern: 'gpt-4', maxTokens: 8_192, label: 'GPT-4' },

    // Anthropic Claude
    { pattern: 'opus', maxTokens: 200_000, label: 'Claude Opus' },
    { pattern: 'sonnet', maxTokens: 200_000, label: 'Claude Sonnet' },
    { pattern: 'haiku', maxTokens: 200_000, label: 'Claude Haiku' },

    // Google Gemini
    { pattern: 'gemini-2.5-pro', maxTokens: 1_048_576, label: 'Gemini 2.5 Pro' },
    { pattern: 'gemini-2.5-flash', maxTokens: 1_048_576, label: 'Gemini 2.5 Flash' },
    { pattern: 'flash', maxTokens: 1_048_576, label: 'Gemini Flash' },
    { pattern: 'gemini-pro', maxTokens: 1_048_576, label: 'Gemini Pro' },
    { pattern: 'gemini', maxTokens: 1_048_576, label: 'Gemini' },

    // NVIDIA NIM
    { pattern: 'meta/', maxTokens: 128_000, label: 'Meta Llama' },
    { pattern: 'nvidia/', maxTokens: 128_000, label: 'NVIDIA NIM' },
];

// Default for unknown models — conservative estimate
export const DEFAULT_CONTEXT_WINDOW = 128_000;

// Trim target: use 80% of context window, leaving 20% for response generation
export const TARGET_RATIO = 0.80;

// Sort by pattern length descending — longer patterns match first (same approach as pricing.ts)
const SORTED_WINDOWS = [...MODEL_CONTEXT_WINDOWS].sort(
    (a, b) => b.pattern.length - a.pattern.length
);

/**
 * Get the context window size for a model.
 * Uses substring matching with longest-match-first for accuracy.
 */
export function getContextWindow(modelName: string): number {
    const lower = modelName.toLowerCase();
    for (const entry of SORTED_WINDOWS) {
        if (lower.includes(entry.pattern)) {
            return entry.maxTokens;
        }
    }
    return DEFAULT_CONTEXT_WINDOW;
}
