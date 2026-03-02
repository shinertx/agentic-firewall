import { describe, it, expect } from 'vitest';
import { applyContextCDN, LLMRequest } from '../src/proxyHandler';

describe('applyContextCDN', () => {

    it('should inject ephemeral cache control into Anthropic string system prompts > 500 chars', () => {
        const body: LLMRequest = { system: 'A'.repeat(600) };
        const result = applyContextCDN(body, false);

        expect(result.system[0].cache_control?.type).toBe('ephemeral');
        expect(result.system[0].text.length).toBe(600);
    });

    it('should inject ephemeral cache control into Anthropic array system prompts > 500 chars', () => {
        const body: LLMRequest = { system: [{ type: 'text', text: 'A'.repeat(600) }] };
        const result = applyContextCDN(body, false);

        expect(result.system[0].cache_control?.type).toBe('ephemeral');
    });

    it('should NOT inject cache control for small strings', () => {
        const body: LLMRequest = { system: 'short string' };
        const result = applyContextCDN(body, false);

        expect(result.system).toBe('short string'); // Remains unchanged string
    });

    it('should inject Context CDN Enabled mock label for OpenAI large prompts', () => {
        const body: LLMRequest = { messages: [{ role: 'system', content: 'A'.repeat(600) }] };
        const result = applyContextCDN(body, false, '/v1/chat/completions');

        expect(result.messages?.[0].content).toContain('[Context CDN Enabled - OpenAI Proxy]');
    });

    it('should prepend a system prompt if OpenAI user prompt is large and no system exists', () => {
        const body: LLMRequest = { messages: [{ role: 'user', content: 'A'.repeat(600) }] };
        const result = applyContextCDN(body, false, '/v1/chat/completions');

        expect(result.messages?.length).toBe(2);
        expect(result.messages?.[0].role).toBe('system');
        expect(result.messages?.[0].content).toContain('[Context CDN Enabled - OpenAI Proxy]');
        expect(result.messages?.[1].role).toBe('user');
    });
});
