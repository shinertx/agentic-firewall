import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/ollamaClient', () => ({
    isOllamaAvailable: vi.fn().mockResolvedValue(true),
    ollamaGenerate: vi.fn().mockResolvedValue('compressed content here'),
}));
vi.mock('../src/stats', () => ({
    globalStats: { ollamaCalls: 0 },
}));

import { compressPrompt, getCompressionStats } from '../src/promptCompressor';
import { isOllamaAvailable, ollamaGenerate } from '../src/ollamaClient';
import { globalStats } from '../src/stats';

beforeEach(() => {
    vi.mocked(isOllamaAvailable).mockResolvedValue(true);
    vi.mocked(ollamaGenerate).mockResolvedValue('compressed content here');
    globalStats.ollamaCalls = 0;
});

const largeSystem = 'a'.repeat(15000);

describe('Prompt Compressor', () => {

    it('should skip when Ollama is unavailable', async () => {
        vi.mocked(isOllamaAvailable).mockResolvedValueOnce(false);

        const body = {
            system: largeSystem,
            messages: [{ role: 'user', content: 'Hello' }],
            model: 'claude-sonnet-4-6',
        };

        const result = await compressPrompt(body, false, false, 'claude-sonnet-4-6');
        expect(result.compressed).toBe(false);
        expect(result.body).toBe(body);
    });

    it('should skip when body is null', async () => {
        const result = await compressPrompt(null, false, false, 'claude-sonnet-4-6');
        expect(result.compressed).toBe(false);
        expect(result.body).toBeNull();
    });

    it('should compress large Anthropic system prompt (>10k chars, string body.system)', async () => {
        const body = {
            system: largeSystem,
            messages: [{ role: 'user', content: 'Hello' }],
            model: 'claude-sonnet-4-6',
        };

        const result = await compressPrompt(body, false, false, 'claude-sonnet-4-6');
        expect(result.compressed).toBe(true);
        expect(result.body.system).toBe('compressed content here');
        expect(result.savedTokens).toBeGreaterThan(0);
        expect(result.originalTokens).toBeGreaterThan(0);
        expect(result.compressionRatio).toBeLessThan(1);
    });

    it('should compress large OpenAI system message (>10k chars)', async () => {
        const body = {
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: largeSystem },
                { role: 'user', content: 'Hello' },
            ],
        };

        const result = await compressPrompt(body, false, true, 'gpt-4o');
        expect(result.compressed).toBe(true);
        // The system message content should be replaced with the compressed text
        const systemMsg = result.body.messages.find((m: any) => m.role === 'system');
        expect(systemMsg.content).toBe('compressed content here');
        expect(result.savedTokens).toBeGreaterThan(0);
    });

    it('should compress large Gemini systemInstruction (>10k chars)', async () => {
        const body = {
            systemInstruction: { parts: [{ text: largeSystem }] },
            contents: [
                { role: 'user', parts: [{ text: 'Hello' }] },
            ],
        };

        const result = await compressPrompt(body, true, false, 'gemini-2.5-pro');
        expect(result.compressed).toBe(true);
        expect(result.body.systemInstruction.parts[0].text).toBe('compressed content here');
        expect(result.savedTokens).toBeGreaterThan(0);
    });

    it('should skip small system prompt (<10k chars)', async () => {
        const body = {
            system: 'You are a helpful assistant.',
            messages: [{ role: 'user', content: 'Hello' }],
            model: 'claude-sonnet-4-6',
        };

        const result = await compressPrompt(body, false, false, 'claude-sonnet-4-6');
        expect(result.compressed).toBe(false);
        expect(result.body.system).toBe('You are a helpful assistant.');
    });

    it('should compress long conversation history (>50 messages) and replace middle messages', async () => {
        vi.mocked(ollamaGenerate).mockResolvedValue('Summary of middle conversation segment');

        const messages = Array.from({ length: 60 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `Message number ${i} with enough content to pass minimum length checks and make the conversation sufficiently long for compression.`,
        }));

        const body = {
            system: 'Short system prompt.',
            messages,
            model: 'claude-sonnet-4-6',
        };

        const result = await compressPrompt(body, false, false, 'claude-sonnet-4-6');
        expect(result.compressed).toBe(true);
        // The middle messages should be replaced — total messages should be fewer than 60
        expect(result.body.messages.length).toBeLessThan(60);
        // Should contain the summary message
        const summaryMsg = result.body.messages.find((m: any) =>
            typeof m.content === 'string' && m.content.includes('[Compressed conversation summary]')
        );
        expect(summaryMsg).toBeDefined();
    });

    it('should return cacheHit=true on second call with same content', async () => {
        const body = {
            system: largeSystem,
            messages: [{ role: 'user', content: 'Hello' }],
            model: 'claude-sonnet-4-6',
        };

        // First call — populates cache
        const first = await compressPrompt(body, false, false, 'claude-sonnet-4-6');
        expect(first.compressed).toBe(true);

        // Second call — should hit cache
        const second = await compressPrompt(body, false, false, 'claude-sonnet-4-6');
        expect(second.compressed).toBe(true);
        expect(second.cacheHit).toBe(true);
    });

    it('should skip compression when Ollama returns invalid (too short) result', async () => {
        vi.mocked(ollamaGenerate).mockResolvedValueOnce('short');

        // Use unique content to avoid cache hits from previous tests
        const uniqueLargeSystem = 'unique_invalid_test_' + 'z'.repeat(15000);
        const body = {
            system: uniqueLargeSystem,
            messages: [{ role: 'user', content: 'Hello' }],
            model: 'claude-sonnet-4-6',
        };

        const result = await compressPrompt(body, false, false, 'claude-sonnet-4-6');
        // The result of ollamaGenerate ('short') is <= 10 chars, so compression is skipped
        expect(result.compressed).toBe(false);
        expect(result.body.system).toBe(uniqueLargeSystem);
    });

    it('should return correct counters from getCompressionStats after compression', async () => {
        const body = {
            system: largeSystem,
            messages: [{ role: 'user', content: 'Hello' }],
            model: 'claude-sonnet-4-6',
        };

        await compressPrompt(body, false, false, 'claude-sonnet-4-6');

        const stats = getCompressionStats();
        expect(stats.totalCompressed).toBeGreaterThan(0);
        expect(stats.tokensSaved).toBeGreaterThan(0);
        expect(stats.avgRatio).toBeGreaterThan(0);
        expect(stats.avgRatio).toBeLessThan(1);
    });
});
