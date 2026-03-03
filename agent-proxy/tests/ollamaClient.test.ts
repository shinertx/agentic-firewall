import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isOllamaAvailable, ollamaGenerate, ollamaClassify, resetHealthCache } from '../src/ollamaClient';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
    vi.stubEnv('OLLAMA_ENABLED', 'true');
    vi.stubEnv('OLLAMA_MODEL', 'qwen2.5:3b');
    resetHealthCache();
    mockFetch.mockReset();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('Ollama Client', () => {
    describe('isOllamaAvailable', () => {
        it('should return false when OLLAMA_ENABLED is not true', async () => {
            vi.stubEnv('OLLAMA_ENABLED', 'false');
            const result = await isOllamaAvailable();
            expect(result).toBe(false);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should return true when Ollama responds OK', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true });
            const result = await isOllamaAvailable();
            expect(result).toBe(true);
        });

        it('should return false when Ollama responds with error', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false });
            const result = await isOllamaAvailable();
            expect(result).toBe(false);
        });

        it('should return false when fetch throws (Ollama not running)', async () => {
            mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
            const result = await isOllamaAvailable();
            expect(result).toBe(false);
        });

        it('should cache the result for subsequent calls', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true });
            await isOllamaAvailable();
            await isOllamaAvailable();
            await isOllamaAvailable();
            // Only one fetch call — subsequent calls use cache
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('should refresh cache after reset', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true });
            await isOllamaAvailable();
            expect(mockFetch).toHaveBeenCalledTimes(1);

            resetHealthCache();
            mockFetch.mockResolvedValueOnce({ ok: false });
            const result = await isOllamaAvailable();
            expect(result).toBe(false);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('ollamaGenerate', () => {
        it('should return empty string when OLLAMA_ENABLED is false', async () => {
            vi.stubEnv('OLLAMA_ENABLED', 'false');
            const result = await ollamaGenerate('Hello');
            expect(result).toBe('');
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should return generated text on success', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ response: '  Hello back!  ' }),
            });
            const result = await ollamaGenerate('Hello');
            expect(result).toBe('Hello back!');
        });

        it('should return empty string on fetch error', async () => {
            mockFetch.mockRejectedValueOnce(new Error('timeout'));
            const result = await ollamaGenerate('Hello');
            expect(result).toBe('');
        });

        it('should return empty string on non-OK response', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false });
            const result = await ollamaGenerate('Hello');
            expect(result).toBe('');
        });

        it('should use custom model when specified', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ response: 'ok' }),
            });
            await ollamaGenerate('Hello', { model: 'llama3.2:1b' });
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.model).toBe('llama3.2:1b');
        });

        it('should use OLLAMA_MODEL env var as default', async () => {
            vi.stubEnv('OLLAMA_MODEL', 'phi3:mini');
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ response: 'ok' }),
            });
            await ollamaGenerate('Hello');
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.model).toBe('phi3:mini');
        });

        it('should send stream: false', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ response: 'ok' }),
            });
            await ollamaGenerate('Hello');
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.stream).toBe(false);
        });
    });

    describe('ollamaClassify', () => {
        it('should call ollamaGenerate with the prompt', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ response: 'LOW' }),
            });
            const result = await ollamaClassify('Is this complex?');
            expect(result).toBe('LOW');
        });

        it('should return empty string on failure', async () => {
            mockFetch.mockRejectedValueOnce(new Error('timeout'));
            const result = await ollamaClassify('Is this complex?');
            expect(result).toBe('');
        });
    });

    describe('env var opt-out', () => {
        it('should not call Ollama when OLLAMA_ENABLED is unset', async () => {
            delete process.env.OLLAMA_ENABLED;
            expect(await isOllamaAvailable()).toBe(false);
            expect(await ollamaGenerate('test')).toBe('');
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });
});
