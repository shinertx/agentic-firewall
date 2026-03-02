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
});
