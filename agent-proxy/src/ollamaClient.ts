/**
 * Ollama HTTP Client — zero-dependency interface to local Ollama instance.
 *
 * Uses native fetch() to http://localhost:11434. All calls have hard timeouts
 * so proxy latency stays bounded. If OLLAMA_ENABLED !== 'true', every function
 * short-circuits immediately (zero overhead).
 */

import { OLLAMA_HEALTH_CACHE_TTL_MS, OLLAMA_CLASSIFY_TIMEOUT_MS, OLLAMA_SUMMARIZE_TIMEOUT_MS, OLLAMA_HEALTH_TIMEOUT_MS, OLLAMA_MAX_RETRIES } from './config';

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const HEALTH_CACHE_TTL_MS = OLLAMA_HEALTH_CACHE_TTL_MS;
const CLASSIFY_TIMEOUT_MS = OLLAMA_CLASSIFY_TIMEOUT_MS;
const SUMMARIZE_TIMEOUT_MS = OLLAMA_SUMMARIZE_TIMEOUT_MS;
const HEALTH_TIMEOUT_MS = OLLAMA_HEALTH_TIMEOUT_MS;

// Cached health check result
let cachedAvailable: boolean | null = null;
let cachedAt = 0;

function isEnabled(): boolean {
    return process.env.OLLAMA_ENABLED === 'true';
}

function getModel(): string {
    return process.env.OLLAMA_MODEL || 'qwen2.5:3b';
}

/**
 * Check if Ollama is running and responsive.
 * Result is cached for 30 seconds to avoid per-request overhead.
 */
export async function isOllamaAvailable(): Promise<boolean> {
    if (!isEnabled()) return false;

    const now = Date.now();
    if (cachedAvailable !== null && now - cachedAt < HEALTH_CACHE_TTL_MS) {
        return cachedAvailable;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
        const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
            signal: controller.signal,
        });
        clearTimeout(timeout);
        cachedAvailable = res.ok;
    } catch {
        cachedAvailable = false;
    }
    cachedAt = now;
    return cachedAvailable;
}

/**
 * Generate text from Ollama. Returns empty string on any failure.
 * Retries once on timeout/network error with exponential backoff.
 */
export async function ollamaGenerate(
    prompt: string,
    options?: { model?: string; timeout?: number; retries?: number }
): Promise<string> {
    if (!isEnabled()) return '';

    const model = options?.model || getModel();
    const timeoutMs = options?.timeout || SUMMARIZE_TIMEOUT_MS;
    const maxRetries = options?.retries ?? OLLAMA_MAX_RETRIES;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, prompt, stream: false }),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!res.ok) return '';

            const data = await res.json() as { response?: string };
            return data.response?.trim() || '';
        } catch {
            if (attempt < maxRetries) {
                // Brief backoff before retry (200ms, 400ms, ...)
                await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
                // Invalidate health cache so next check re-probes
                cachedAvailable = null;
                continue;
            }
            return '';
        }
    }
    return '';
}

/**
 * Classify text using Ollama with a tight 2-second timeout.
 * Returns empty string on any failure (caller should treat as conservative/HIGH).
 */
export async function ollamaClassify(prompt: string): Promise<string> {
    return ollamaGenerate(prompt, { timeout: CLASSIFY_TIMEOUT_MS });
}

/** Invalidate cached health check (useful for testing). */
export function resetHealthCache(): void {
    cachedAvailable = null;
    cachedAt = 0;
}
