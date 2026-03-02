/**
 * Token estimation utility for the Agentic Firewall.
 * Used for budget checks, cache threshold decisions, and dashboard reporting.
 *
 * This uses a simple heuristic (chars / 4) which is within ~10% of actual
 * tokenization for English code content. For exact counts, use the
 * /v1/messages/count_tokens endpoint (Anthropic) or tiktoken (OpenAI).
 */

/**
 * Estimate token count from a string using the 4-chars-per-token heuristic.
 * Works well for English text and code — the dominant agent payloads.
 */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.round(text.length / 4);
}

/**
 * Estimate tokens from a full LLM request body (stringified).
 * Floors at a minimum to avoid false zeros from tiny payloads.
 */
export function estimateBodyTokens(body: any, minTokens: number = 100): number {
    if (!body) return minTokens;
    const str = typeof body === 'string' ? body : JSON.stringify(body);
    return Math.max(estimateTokens(str), minTokens);
}

/**
 * Generate a stable SHA-256 hash for use as OpenAI prompt_cache_key.
 * Hashes only the system-level content (which is the stable prefix).
 */
export function generateCacheKey(body: any): string | null {
    if (!body?.messages || !Array.isArray(body.messages)) return null;

    const systemContent = body.messages
        .filter((m: any) => m.role === 'system')
        .map((m: any) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
        .join('');

    if (!systemContent || systemContent.length < 100) return null;

    // Use a simple hash — we import crypto at the top
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(systemContent).digest('hex').slice(0, 32);
}
