import { describe, it, expect } from 'vitest';
import {
    parseAnthropicUsage,
    parseOpenAIUsage,
    parseGeminiUsage,
    parseUsageFromChunks,
} from '../src/usageParser';

// --- Realistic SSE data fixtures ---

const anthropicChunk = Buffer.from(
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":50}}}\n\n' +
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":200}}\n\n'
);

const openaiChunk = Buffer.from(
    'data: {"id":"chatcmpl-123","choices":[],"usage":{"prompt_tokens":150,"completion_tokens":75,"prompt_tokens_details":{"cached_tokens":30}}}\n\n' +
    'data: [DONE]\n\n'
);

const geminiChunk = Buffer.from(JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'hello' }] } }],
    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100, cachedContentTokenCount: 0 },
}));

describe('Usage Parser', () => {

    // === Anthropic ===

    describe('parseAnthropicUsage', () => {
        it('should parse message_start event with input_tokens and cache_read_input_tokens', () => {
            const messageStart = Buffer.from(
                'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":50}}}\n\n'
            );
            const result = parseAnthropicUsage([messageStart]);
            expect(result).not.toBeNull();
            expect(result!.inputTokens).toBe(100);
            expect(result!.cachedTokens).toBe(50);
            expect(result!.provider).toBe('anthropic');
        });

        it('should parse message_delta event with output_tokens', () => {
            const messageDelta = Buffer.from(
                'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":200}}\n\n'
            );
            const result = parseAnthropicUsage([messageDelta]);
            expect(result).not.toBeNull();
            expect(result!.outputTokens).toBe(200);
        });

        it('should parse both events in combined chunks', () => {
            const result = parseAnthropicUsage([anthropicChunk]);
            expect(result).not.toBeNull();
            expect(result!.inputTokens).toBe(100);
            expect(result!.cachedTokens).toBe(50);
            expect(result!.outputTokens).toBe(200);
            expect(result!.provider).toBe('anthropic');
        });

        it('should return null for chunks without usage events', () => {
            const noUsage = Buffer.from(
                'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hello"}}\n\n'
            );
            const result = parseAnthropicUsage([noUsage]);
            expect(result).toBeNull();
        });

        it('should handle malformed JSON gracefully (return null)', () => {
            const malformed = Buffer.from(
                'event: message_start\ndata: {not valid json}\n\n'
            );
            const result = parseAnthropicUsage([malformed]);
            // Malformed JSON in a message_start event means no usage found
            expect(result).toBeNull();
        });
    });

    // === OpenAI ===

    describe('parseOpenAIUsage', () => {
        it('should parse final chunk with usage field (prompt_tokens, completion_tokens)', () => {
            const result = parseOpenAIUsage([openaiChunk]);
            expect(result).not.toBeNull();
            expect(result!.inputTokens).toBe(150);
            expect(result!.outputTokens).toBe(75);
            expect(result!.provider).toBe('openai');
        });

        it('should parse usage with cached_tokens in prompt_tokens_details', () => {
            const result = parseOpenAIUsage([openaiChunk]);
            expect(result).not.toBeNull();
            expect(result!.cachedTokens).toBe(30);
        });

        it('should return null for chunks without usage', () => {
            const noUsage = Buffer.from(
                'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"hi"}}]}\n\n'
            );
            const result = parseOpenAIUsage([noUsage]);
            expect(result).toBeNull();
        });

        it('should handle [DONE] marker correctly', () => {
            const onlyDone = Buffer.from('data: [DONE]\n\n');
            const result = parseOpenAIUsage([onlyDone]);
            expect(result).toBeNull();
        });
    });

    // === Gemini ===

    describe('parseGeminiUsage', () => {
        it('should parse usageMetadata (promptTokenCount, candidatesTokenCount)', () => {
            const result = parseGeminiUsage([geminiChunk]);
            expect(result).not.toBeNull();
            expect(result!.inputTokens).toBe(200);
            expect(result!.outputTokens).toBe(100);
            expect(result!.cachedTokens).toBe(0);
            expect(result!.provider).toBe('gemini');
        });

        it('should return null for response without usageMetadata', () => {
            const noMeta = Buffer.from(JSON.stringify({
                candidates: [{ content: { parts: [{ text: 'hello' }] } }],
            }));
            const result = parseGeminiUsage([noMeta]);
            expect(result).toBeNull();
        });

        it('should handle malformed JSON', () => {
            const malformed = Buffer.from('this is not json at all');
            const result = parseGeminiUsage([malformed]);
            expect(result).toBeNull();
        });
    });

    // === parseUsageFromChunks (dispatcher) ===

    describe('parseUsageFromChunks', () => {
        it('should dispatch to correct parser based on provider string', () => {
            const anthropicResult = parseUsageFromChunks([anthropicChunk], 'anthropic');
            expect(anthropicResult).not.toBeNull();
            expect(anthropicResult!.provider).toBe('anthropic');

            const openaiResult = parseUsageFromChunks([openaiChunk], 'openai');
            expect(openaiResult).not.toBeNull();
            expect(openaiResult!.provider).toBe('openai');

            const geminiResult = parseUsageFromChunks([geminiChunk], 'gemini');
            expect(geminiResult).not.toBeNull();
            expect(geminiResult!.provider).toBe('gemini');
        });

        it('should return null for empty chunks', () => {
            const result = parseUsageFromChunks([], 'anthropic');
            expect(result).toBeNull();
        });

        it('should try all parsers for unknown provider', () => {
            // Should find anthropic usage when given anthropic data with unknown provider
            const result = parseUsageFromChunks([anthropicChunk], 'some-unknown-provider');
            expect(result).not.toBeNull();
            expect(result!.provider).toBe('anthropic');
        });

        it('should return null for unknown provider with unrecognizable data', () => {
            const garbage = Buffer.from('completely unrecognizable data');
            const result = parseUsageFromChunks([garbage], 'unknown-provider');
            expect(result).toBeNull();
        });
    });
});
