import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getProviderKey, getProviderHeaderConfig, validateAllKeys, getLocalUserId, clearKeyCache } from '../src/keyVault';

describe('Key Vault', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        clearKeyCache();
        // Clean provider env vars
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        delete process.env.NVIDIA_API_KEY;
        delete process.env.NVIDIA_KEY;
    });

    afterEach(() => {
        clearKeyCache();
        // Restore only the env vars we need
        process.env = { ...originalEnv };
    });

    describe('getProviderKey', () => {
        it('should return key from primary env var', () => {
            process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-12345';
            const result = getProviderKey('anthropic');
            expect('key' in result).toBe(true);
            if ('key' in result) {
                expect(result.key).toBe('sk-ant-test-key-12345');
            }
        });

        it('should fall back to secondary env var', () => {
            process.env.ANTHROPIC_KEY = 'sk-ant-fallback-key';
            const result = getProviderKey('anthropic');
            expect('key' in result).toBe(true);
            if ('key' in result) {
                expect(result.key).toBe('sk-ant-fallback-key');
            }
        });

        it('should prefer primary over secondary env var', () => {
            process.env.ANTHROPIC_API_KEY = 'primary';
            process.env.ANTHROPIC_KEY = 'secondary';
            const result = getProviderKey('anthropic');
            expect('key' in result).toBe(true);
            if ('key' in result) {
                expect(result.key).toBe('primary');
            }
        });

        it('should return error when no key configured', () => {
            const result = getProviderKey('anthropic');
            expect('error' in result).toBe(true);
            if ('error' in result) {
                expect(result.error).toContain('No API key configured');
                expect(result.error).toContain('ANTHROPIC_API_KEY');
                // Must NOT contain any actual key value
                expect(result.error).not.toContain('sk-');
            }
        });

        it('should work for OpenAI', () => {
            process.env.OPENAI_API_KEY = 'sk-openai-test';
            const result = getProviderKey('openai');
            expect('key' in result).toBe(true);
        });

        it('should work for Gemini', () => {
            process.env.GOOGLE_API_KEY = 'AIza-gemini-test';
            const result = getProviderKey('gemini');
            expect('key' in result).toBe(true);
        });

        it('should work for NVIDIA', () => {
            process.env.NVIDIA_API_KEY = 'nvapi-test';
            const result = getProviderKey('nvidia');
            expect('key' in result).toBe(true);
        });

        it('should cache keys after first read', () => {
            process.env.ANTHROPIC_API_KEY = 'cached-key';
            const first = getProviderKey('anthropic');
            // Remove env var — should still return cached
            delete process.env.ANTHROPIC_API_KEY;
            const second = getProviderKey('anthropic');
            expect('key' in first && 'key' in second).toBe(true);
            if ('key' in first && 'key' in second) {
                expect(first.key).toBe(second.key);
            }
        });

        it('should trim whitespace from keys', () => {
            process.env.ANTHROPIC_API_KEY = '  sk-ant-spaces  ';
            const result = getProviderKey('anthropic');
            expect('key' in result).toBe(true);
            if ('key' in result) {
                expect(result.key).toBe('sk-ant-spaces');
            }
        });

        it('should treat empty string as missing', () => {
            process.env.ANTHROPIC_API_KEY = '';
            const result = getProviderKey('anthropic');
            expect('error' in result).toBe(true);
        });
    });

    describe('getProviderHeaderConfig', () => {
        it('should return x-api-key for Anthropic', () => {
            const config = getProviderHeaderConfig('anthropic');
            expect(config.headerName).toBe('x-api-key');
            expect(config.headerPrefix).toBe('');
        });

        it('should return Authorization Bearer for OpenAI', () => {
            const config = getProviderHeaderConfig('openai');
            expect(config.headerName).toBe('authorization');
            expect(config.headerPrefix).toBe('Bearer ');
        });

        it('should return x-goog-api-key for Gemini', () => {
            const config = getProviderHeaderConfig('gemini');
            expect(config.headerName).toBe('x-goog-api-key');
            expect(config.headerPrefix).toBe('');
        });
    });

    describe('validateAllKeys', () => {
        it('should report all missing when no keys set', () => {
            const result = validateAllKeys();
            expect(result.missing.length).toBe(4);
            expect(result.valid.length).toBe(0);
        });

        it('should report configured providers', () => {
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.OPENAI_API_KEY = 'test-key-2';
            const result = validateAllKeys();
            expect(result.valid).toContain('Anthropic');
            expect(result.valid).toContain('OpenAI');
            expect(result.missing).toContain('Gemini');
            expect(result.missing).toContain('NVIDIA');
        });
    });

    describe('getLocalUserId', () => {
        it('should return a 12-char hex string', () => {
            const id = getLocalUserId();
            expect(id).toHaveLength(12);
            expect(id).toMatch(/^[a-f0-9]+$/);
        });

        it('should be stable across calls', () => {
            const a = getLocalUserId();
            const b = getLocalUserId();
            expect(a).toBe(b);
        });
    });
});
