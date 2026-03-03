"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const tokenCounter_1 = require("../src/tokenCounter");
(0, vitest_1.describe)('Token Counter', () => {
    (0, vitest_1.it)('should estimate tokens from string (4 chars per token)', () => {
        (0, vitest_1.expect)((0, tokenCounter_1.estimateTokens)('hello world!')).toBe(3); // 12 chars / 4 = 3
    });
    (0, vitest_1.it)('should return 0 for empty string', () => {
        (0, vitest_1.expect)((0, tokenCounter_1.estimateTokens)('')).toBe(0);
    });
    (0, vitest_1.it)('should estimate body tokens with minimum floor', () => {
        const smallBody = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] };
        const result = (0, tokenCounter_1.estimateBodyTokens)(smallBody, 100);
        (0, vitest_1.expect)(result).toBe(100); // Floor kicks in
    });
    (0, vitest_1.it)('should estimate body tokens for large payloads', () => {
        const largeBody = { model: 'gpt-4o', messages: [{ role: 'user', content: 'A'.repeat(10000) }] };
        const result = (0, tokenCounter_1.estimateBodyTokens)(largeBody, 100);
        (0, vitest_1.expect)(result).toBeGreaterThan(2000);
    });
});
(0, vitest_1.describe)('generateCacheKey', () => {
    (0, vitest_1.it)('should generate a 32-char hex key from system messages', () => {
        const body = {
            messages: [
                { role: 'system', content: 'A'.repeat(500) },
                { role: 'user', content: 'hello' }
            ]
        };
        const key = (0, tokenCounter_1.generateCacheKey)(body);
        (0, vitest_1.expect)(key).toBeDefined();
        (0, vitest_1.expect)(key.length).toBe(32);
        (0, vitest_1.expect)(/^[a-f0-9]+$/.test(key)).toBe(true);
    });
    (0, vitest_1.it)('should return null when system content is too short', () => {
        const body = { messages: [{ role: 'system', content: 'short' }, { role: 'user', content: 'hello' }] };
        (0, vitest_1.expect)((0, tokenCounter_1.generateCacheKey)(body)).toBeNull();
    });
    (0, vitest_1.it)('should return null when no messages exist', () => {
        (0, vitest_1.expect)((0, tokenCounter_1.generateCacheKey)({})).toBeNull();
        (0, vitest_1.expect)((0, tokenCounter_1.generateCacheKey)({ messages: [] })).toBeNull();
    });
    (0, vitest_1.it)('should return same key for same system content', () => {
        const body1 = { messages: [{ role: 'system', content: 'A'.repeat(500) }] };
        const body2 = { messages: [{ role: 'system', content: 'A'.repeat(500) }] };
        (0, vitest_1.expect)((0, tokenCounter_1.generateCacheKey)(body1)).toBe((0, tokenCounter_1.generateCacheKey)(body2));
    });
    (0, vitest_1.it)('should return different key for different system content', () => {
        const body1 = { messages: [{ role: 'system', content: 'A'.repeat(500) }] };
        const body2 = { messages: [{ role: 'system', content: 'B'.repeat(500) }] };
        (0, vitest_1.expect)((0, tokenCounter_1.generateCacheKey)(body1)).not.toBe((0, tokenCounter_1.generateCacheKey)(body2));
    });
});
