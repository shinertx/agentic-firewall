"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const proxyHandler_1 = require("../src/proxyHandler");
(0, vitest_1.describe)('Streaming Support', () => {
    (0, vitest_1.it)('should not mutate body for small streaming requests', () => {
        const body = {
            model: 'claude-sonnet-4-6',
            messages: [{ role: 'user', content: 'hello' }],
        };
        const result = (0, proxyHandler_1.applyContextCDN)(body, false);
        (0, vitest_1.expect)(result.modified).toBe(false);
    });
    (0, vitest_1.it)('should inject cache control even on streaming-flagged Anthropic requests', () => {
        // Streaming requests still benefit from prompt caching because
        // the cache_control header applies to the input, not the output stream
        const body = {
            model: 'claude-sonnet-4-6',
            system: 'A'.repeat(5000),
            messages: [{ role: 'user', content: 'stream this' }],
        };
        const result = (0, proxyHandler_1.applyContextCDN)(body, false);
        (0, vitest_1.expect)(result.modified).toBe(true);
        (0, vitest_1.expect)(result.body.system[0].cache_control?.type).toBe('ephemeral');
    });
    (0, vitest_1.it)('should handle OpenAI streaming with large payloads', () => {
        const body = {
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'A'.repeat(10000) },
            ],
        };
        const result = (0, proxyHandler_1.applyContextCDN)(body, false, '/v1/chat/completions');
        // System messages should be first for caching
        (0, vitest_1.expect)(result.modified).toBe(true);
        (0, vitest_1.expect)(result.body.messages?.[0].role).toBe('system');
    });
});
