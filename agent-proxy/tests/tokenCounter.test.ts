import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateBodyTokens, generateCacheKey } from '../src/tokenCounter';

describe('Token Counter', () => {

    it('should estimate tokens from string (4 chars per token)', () => {
        expect(estimateTokens('hello world!')).toBe(3); // 12 chars / 4 = 3
    });

    it('should return 0 for empty string', () => {
        expect(estimateTokens('')).toBe(0);
    });

    it('should estimate body tokens with minimum floor', () => {
        const smallBody = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] };
        const result = estimateBodyTokens(smallBody, 100);
        expect(result).toBe(100); // Floor kicks in
    });

    it('should estimate body tokens for large payloads', () => {
        const largeBody = { model: 'gpt-4o', messages: [{ role: 'user', content: 'A'.repeat(10000) }] };
        const result = estimateBodyTokens(largeBody, 100);
        expect(result).toBeGreaterThan(2000);
    });
});

describe('generateCacheKey', () => {

    it('should generate a 32-char hex key from system messages', () => {
        const body = {
            messages: [
                { role: 'system', content: 'A'.repeat(500) },
                { role: 'user', content: 'hello' }
            ]
        };
        const key = generateCacheKey(body);
        expect(key).toBeDefined();
        expect(key!.length).toBe(32);
        expect(/^[a-f0-9]+$/.test(key!)).toBe(true);
    });

    it('should return null when system content is too short', () => {
        const body = { messages: [{ role: 'system', content: 'short' }, { role: 'user', content: 'hello' }] };
        expect(generateCacheKey(body)).toBeNull();
    });

    it('should return null when no messages exist', () => {
        expect(generateCacheKey({})).toBeNull();
        expect(generateCacheKey({ messages: [] })).toBeNull();
    });

    it('should return same key for same system content', () => {
        const body1 = { messages: [{ role: 'system', content: 'A'.repeat(500) }] };
        const body2 = { messages: [{ role: 'system', content: 'A'.repeat(500) }] };
        expect(generateCacheKey(body1)).toBe(generateCacheKey(body2));
    });

    it('should return different key for different system content', () => {
        const body1 = { messages: [{ role: 'system', content: 'A'.repeat(500) }] };
        const body2 = { messages: [{ role: 'system', content: 'B'.repeat(500) }] };
        expect(generateCacheKey(body1)).not.toBe(generateCacheKey(body2));
    });
});
