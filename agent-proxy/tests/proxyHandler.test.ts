import { describe, it, expect } from 'vitest';
import { applyContextCDN, LLMRequest } from '../src/proxyHandler';

describe('applyContextCDN', () => {

    it('should inject ephemeral cache control into Anthropic string system prompts > 500 chars', () => {
        const body: LLMRequest = { system: 'A'.repeat(600) };
        const result = applyContextCDN(body, false);

        expect(result.body.system[0].cache_control?.type).toBe('ephemeral');
        expect(result.body.system[0].text.length).toBe(600);
    });

    it('should inject ephemeral cache control into Anthropic array system prompts > 500 chars', () => {
        const body: LLMRequest = { system: [{ type: 'text', text: 'A'.repeat(600) }] };
        const result = applyContextCDN(body, false);

        expect(result.body.system[0].cache_control?.type).toBe('ephemeral');
    });

    it('should NOT inject cache control for small strings', () => {
        const body: LLMRequest = { system: 'short string' };
        const result = applyContextCDN(body, false);

        expect(result.body.system).toBe('short string'); // Remains unchanged string
    });

    it('should reorder system messages to front for OpenAI large prompts', () => {
        const body: LLMRequest = {
            messages: [
                { role: 'user', content: 'A'.repeat(5000) },
                { role: 'system', content: 'B'.repeat(2000) },
            ]
        };
        const result = applyContextCDN(body, false, '/v1/chat/completions');

        // System messages should be moved to front for prefix-stable caching
        expect(result.modified).toBe(true);
        expect(result.body.messages?.[0].role).toBe('system');
        expect(result.body.messages?.[1].role).toBe('user');
    });

    it('should not modify OpenAI payloads under 1024 tokens', () => {
        const body: LLMRequest = { messages: [{ role: 'user', content: 'hello' }] };
        const result = applyContextCDN(body, false, '/v1/chat/completions');

        expect(result.modified).toBe(false);
        expect(result.body.messages?.length).toBe(1);
    });

    it('should optimize Gemini large payloads with systemInstruction for implicit caching', () => {
        const body: LLMRequest = {
            systemInstruction: { parts: [{ text: 'You are a helpful assistant.' }] },
            contents: [
                { role: 'user', parts: [{ text: 'A'.repeat(5000) }] },
            ]
        };
        const result = applyContextCDN(body, true);

        expect(result.modified).toBe(true);
    });

    it('should not modify Gemini payloads under 1024 tokens', () => {
        const body: LLMRequest = {
            contents: [
                { role: 'user', parts: [{ text: 'hello' }] },
            ]
        };
        const result = applyContextCDN(body, true);

        expect(result.modified).toBe(false);
    });

    // === Milestone 1: OpenAI prompt_cache_key injection ===

    it('should inject prompt_cache_key on large OpenAI payloads with system messages', () => {
        const body: LLMRequest = {
            messages: [
                { role: 'system', content: 'A'.repeat(2000) },
                { role: 'user', content: 'B'.repeat(3000) },
            ]
        };
        const result = applyContextCDN(body, false, '/v1/chat/completions');

        expect(result.modified).toBe(true);
        expect(result.body.prompt_cache_key).toBeDefined();
        expect(typeof result.body.prompt_cache_key).toBe('string');
        expect(result.body.prompt_cache_key!.length).toBe(32); // SHA-256 truncated to 32 hex chars
        expect(result.body.prompt_cache_retention).toBe('24h');
    });

    it('should NOT inject prompt_cache_key if system content is too small', () => {
        const body: LLMRequest = {
            messages: [
                { role: 'system', content: 'short' },
                { role: 'user', content: 'A'.repeat(5000) },
            ]
        };
        const result = applyContextCDN(body, false, '/v1/chat/completions');

        // Still modified (reordering) but no cache key because system content < 100 chars
        expect(result.modified).toBe(true);
        expect(result.body.prompt_cache_key).toBeUndefined();
    });

    it('should handle /v1/responses endpoint for OpenAI Agents SDK', () => {
        const body: LLMRequest = {
            messages: [
                { role: 'system', content: 'A'.repeat(3000) },
                { role: 'user', content: 'B'.repeat(3000) },
            ]
        };
        const result = applyContextCDN(body, false, '/v1/responses');

        expect(result.modified).toBe(true);
        expect(result.body.prompt_cache_key).toBeDefined();
    });

    it('should not overwrite existing prompt_cache_key', () => {
        const body: LLMRequest = {
            messages: [
                { role: 'system', content: 'A'.repeat(2000) },
                { role: 'user', content: 'B'.repeat(3000) },
            ],
            prompt_cache_key: 'user-provided-key'
        };
        const result = applyContextCDN(body, false, '/v1/chat/completions');

        expect(result.body.prompt_cache_key).toBe('user-provided-key');
    });
});
