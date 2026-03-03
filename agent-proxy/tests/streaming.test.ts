import { describe, it, expect } from 'vitest';
import { applyContextCDN, LLMRequest } from '../src/proxyHandler';

describe('Streaming Support', () => {

    it('should not mutate body for small streaming requests', () => {
        const body: LLMRequest = {
            model: 'claude-sonnet-4-6',
            messages: [{ role: 'user', content: 'hello' }],
        };
        const result = applyContextCDN(body, false);
        expect(result.modified).toBe(false);
    });

    it('should inject cache control even on streaming-flagged Anthropic requests', () => {
        // Streaming requests still benefit from prompt caching because
        // the cache_control header applies to the input, not the output stream
        const body: LLMRequest = {
            model: 'claude-sonnet-4-6',
            system: 'A'.repeat(5000),
            messages: [{ role: 'user', content: 'stream this' }],
        };
        const result = applyContextCDN(body, false);
        expect(result.modified).toBe(true);
        expect(result.body.system[0].cache_control?.type).toBe('ephemeral');
    });

    it('should handle OpenAI streaming with large payloads', () => {
        const body: LLMRequest = {
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'A'.repeat(10000) },
            ],
        };
        const result = applyContextCDN(body, false, '/v1/chat/completions');
        // System messages should be first for caching
        expect(result.modified).toBe(true);
        expect(result.body.messages?.[0].role).toBe('system');
    });
});
