"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const proxyHandler_1 = require("../src/proxyHandler");
(0, vitest_1.describe)('applyContextCDN', () => {
    (0, vitest_1.it)('should inject ephemeral cache control into Anthropic string system prompts > 4096 chars', () => {
        const body = { system: 'A'.repeat(5000) };
        const result = (0, proxyHandler_1.applyContextCDN)(body, false);
        (0, vitest_1.expect)(result.body.system[0].cache_control?.type).toBe('ephemeral');
        (0, vitest_1.expect)(result.body.system[0].text.length).toBe(5000);
    });
    (0, vitest_1.it)('should inject ephemeral cache control into Anthropic array system prompts > 4096 chars', () => {
        const body = { system: [{ type: 'text', text: 'A'.repeat(5000) }] };
        const result = (0, proxyHandler_1.applyContextCDN)(body, false);
        (0, vitest_1.expect)(result.body.system[0].cache_control?.type).toBe('ephemeral');
    });
    (0, vitest_1.it)('should NOT inject cache control for small strings', () => {
        const body = { system: 'short string' };
        const result = (0, proxyHandler_1.applyContextCDN)(body, false);
        (0, vitest_1.expect)(result.body.system).toBe('short string'); // Remains unchanged string
    });
    (0, vitest_1.it)('should reorder system messages to front for OpenAI large prompts', () => {
        const body = {
            messages: [
                { role: 'user', content: 'A'.repeat(5000) },
                { role: 'system', content: 'B'.repeat(2000) },
            ]
        };
        const result = (0, proxyHandler_1.applyContextCDN)(body, false, '/v1/chat/completions');
        // System messages should be moved to front for prefix-stable caching
        (0, vitest_1.expect)(result.modified).toBe(true);
        (0, vitest_1.expect)(result.body.messages?.[0].role).toBe('system');
        (0, vitest_1.expect)(result.body.messages?.[1].role).toBe('user');
    });
    (0, vitest_1.it)('should not modify OpenAI payloads under 1024 tokens', () => {
        const body = { messages: [{ role: 'user', content: 'hello' }] };
        const result = (0, proxyHandler_1.applyContextCDN)(body, false, '/v1/chat/completions');
        (0, vitest_1.expect)(result.modified).toBe(false);
        (0, vitest_1.expect)(result.body.messages?.length).toBe(1);
    });
    (0, vitest_1.it)('should optimize Gemini large payloads with systemInstruction for implicit caching', () => {
        const body = {
            systemInstruction: { parts: [{ text: 'You are a helpful assistant.' }] },
            contents: [
                { role: 'user', parts: [{ text: 'A'.repeat(5000) }] },
            ]
        };
        const result = (0, proxyHandler_1.applyContextCDN)(body, true);
        (0, vitest_1.expect)(result.modified).toBe(true);
    });
    (0, vitest_1.it)('should not modify Gemini payloads under 1024 tokens', () => {
        const body = {
            contents: [
                { role: 'user', parts: [{ text: 'hello' }] },
            ]
        };
        const result = (0, proxyHandler_1.applyContextCDN)(body, true);
        (0, vitest_1.expect)(result.modified).toBe(false);
    });
    // === Milestone 1: OpenAI prompt_cache_key injection ===
    (0, vitest_1.it)('should inject prompt_cache_key on large OpenAI payloads with system messages', () => {
        const body = {
            messages: [
                { role: 'system', content: 'A'.repeat(2000) },
                { role: 'user', content: 'B'.repeat(3000) },
            ]
        };
        const result = (0, proxyHandler_1.applyContextCDN)(body, false, '/v1/chat/completions');
        (0, vitest_1.expect)(result.modified).toBe(true);
        (0, vitest_1.expect)(result.body.prompt_cache_key).toBeDefined();
        (0, vitest_1.expect)(typeof result.body.prompt_cache_key).toBe('string');
        (0, vitest_1.expect)(result.body.prompt_cache_key.length).toBe(32); // SHA-256 truncated to 32 hex chars
        (0, vitest_1.expect)(result.body.prompt_cache_retention).toBe('24h');
    });
    (0, vitest_1.it)('should NOT inject prompt_cache_key if system content is too small', () => {
        const body = {
            messages: [
                { role: 'system', content: 'short' },
                { role: 'user', content: 'A'.repeat(5000) },
            ]
        };
        const result = (0, proxyHandler_1.applyContextCDN)(body, false, '/v1/chat/completions');
        // Still modified (reordering) but no cache key because system content < 100 chars
        (0, vitest_1.expect)(result.modified).toBe(true);
        (0, vitest_1.expect)(result.body.prompt_cache_key).toBeUndefined();
    });
    (0, vitest_1.it)('should handle /v1/responses endpoint for OpenAI Agents SDK', () => {
        const body = {
            messages: [
                { role: 'system', content: 'A'.repeat(3000) },
                { role: 'user', content: 'B'.repeat(3000) },
            ]
        };
        const result = (0, proxyHandler_1.applyContextCDN)(body, false, '/v1/responses');
        (0, vitest_1.expect)(result.modified).toBe(true);
        (0, vitest_1.expect)(result.body.prompt_cache_key).toBeDefined();
    });
    (0, vitest_1.it)('should not overwrite existing prompt_cache_key', () => {
        const body = {
            messages: [
                { role: 'system', content: 'A'.repeat(2000) },
                { role: 'user', content: 'B'.repeat(3000) },
            ],
            prompt_cache_key: 'user-provided-key'
        };
        const result = (0, proxyHandler_1.applyContextCDN)(body, false, '/v1/chat/completions');
        (0, vitest_1.expect)(result.body.prompt_cache_key).toBe('user-provided-key');
    });
});
