import { describe, it, expect } from 'vitest';
import { optimizeToolResults } from '../src/toolResultOptimizer';

// Helper to build a long string of N lines
function lines(n: number, prefix = 'line'): string {
    return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}: ${'x'.repeat(80)}`).join('\n');
}

describe('Tool Result Optimizer', () => {
    describe('Anthropic format', () => {
        it('should dedup identical tool results, keeping the latest', () => {
            const fileContent = lines(50);
            const messages = [
                { role: 'user', content: 'read auth.ts' },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file: 'auth.ts' } }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: fileContent }] },
                // Padding to push first read outside recent window
                ...Array.from({ length: 10 }, (_, i) => ({
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    content: `padding ${i}`,
                })),
                // Second read — within recent window
                { role: 'user', content: 'read again' },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_2', name: 'Read', input: { file: 'auth.ts' } }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: fileContent }] },
                { role: 'assistant', content: 'done' },
                { role: 'user', content: 'thanks' },
            ];

            const result = optimizeToolResults({ messages }, false, false);
            expect(result.optimized).toBe(true);
            expect(result.dedupedCount).toBe(1);
            expect(result.savedChars).toBeGreaterThan(0);

            // The first tool_result (index 2) should be deduped
            expect(result.body.messages[2].content[0].content).toContain('Duplicate');
            // The second (index 15) should be intact
            expect(result.body.messages[15].content[0].content).toBe(fileContent);
        });

        it('should compress stale large tool results outside recent window', () => {
            const bigContent = lines(100);
            const messages = [
                { role: 'user', content: 'read big file' },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file: 'big.ts' } }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: bigContent }] },
                // 12 padding messages to push the tool result outside recent window
                ...Array.from({ length: 12 }, (_, i) => ({
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    content: `msg ${i}`,
                })),
            ];

            const result = optimizeToolResults({ messages }, false, false);
            expect(result.optimized).toBe(true);
            expect(result.compressedCount).toBe(1);
            expect(result.savedChars).toBeGreaterThan(0);

            const compressed = result.body.messages[2].content[0].content;
            expect(compressed).toContain('Compressed stale result');
            expect(compressed).toContain('Read()');
            expect(compressed).toContain('omitted');
            expect(compressed.length).toBeLessThan(bigContent.length);
        });

        it('should NOT compress tool results inside the recent window', () => {
            const bigContent = lines(100);
            const messages = [
                // 4 padding messages
                ...Array.from({ length: 4 }, (_, i) => ({
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    content: `msg ${i}`,
                })),
                { role: 'user', content: 'read big file' },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: bigContent }] },
                // Only 3 more messages — tool result is within recent window of 10
                { role: 'assistant', content: 'ok' },
                { role: 'user', content: 'thanks' },
                { role: 'assistant', content: 'done' },
                { role: 'user', content: 'bye' },
            ];

            const result = optimizeToolResults({ messages }, false, false);
            expect(result.optimized).toBe(false);
        });

        it('should NOT compress small tool results', () => {
            const messages = [
                { role: 'user', content: 'check' },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'OK' }] },
                ...Array.from({ length: 12 }, (_, i) => ({
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    content: `msg ${i}`,
                })),
            ];

            const result = optimizeToolResults({ messages }, false, false);
            expect(result.optimized).toBe(false);
        });

        it('should not mutate the original body', () => {
            const fileContent = lines(50);
            const original = {
                messages: [
                    { role: 'user', content: 'read' },
                    { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }] },
                    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: fileContent }] },
                    ...Array.from({ length: 12 }, (_, i) => ({
                        role: i % 2 === 0 ? 'user' : 'assistant',
                        content: `msg ${i}`,
                    })),
                ],
            };
            const originalStr = JSON.stringify(original);

            optimizeToolResults(original, false, false);

            expect(JSON.stringify(original)).toBe(originalStr);
        });
    });

    describe('OpenAI format', () => {
        it('should dedup identical OpenAI tool responses', () => {
            const fileContent = lines(50);
            const messages = [
                { role: 'user', content: 'read file' },
                { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
                { role: 'tool', tool_call_id: 'call_1', content: fileContent },
                // Padding to push first read outside recent window
                ...Array.from({ length: 10 }, (_, i) => ({
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    content: `padding ${i}`,
                })),
                // Second read — within recent window
                { role: 'user', content: 'read again' },
                { role: 'assistant', content: null, tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
                { role: 'tool', tool_call_id: 'call_2', content: fileContent },
                { role: 'assistant', content: 'done' },
                { role: 'user', content: 'thanks' },
            ];

            const result = optimizeToolResults({ messages }, false, true);
            expect(result.optimized).toBe(true);
            expect(result.dedupedCount).toBe(1);

            // First tool message deduped
            expect(result.body.messages[2].content).toContain('Duplicate');
            // Second tool message intact (index 15)
            expect(result.body.messages[15].content).toBe(fileContent);
        });

        it('should compress stale large OpenAI tool results', () => {
            const bigContent = lines(100);
            const messages = [
                { role: 'user', content: 'search' },
                { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{}' } }] },
                { role: 'tool', tool_call_id: 'call_1', content: bigContent },
                ...Array.from({ length: 12 }, (_, i) => ({
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    content: `msg ${i}`,
                })),
            ];

            const result = optimizeToolResults({ messages }, false, true);
            expect(result.optimized).toBe(true);
            expect(result.compressedCount).toBe(1);
            expect(result.body.messages[2].content).toContain('Compressed stale result');
        });
    });

    describe('Gemini format', () => {
        it('should compress stale large Gemini function responses', () => {
            const bigContent = lines(100);
            const contents = [
                { role: 'user', parts: [{ text: 'search files' }] },
                { role: 'model', parts: [{ functionCall: { name: 'search', args: {} } }] },
                { role: 'user', parts: [{ functionResponse: { name: 'search', response: { content: bigContent } } }] },
                ...Array.from({ length: 12 }, (_, i) => ({
                    role: i % 2 === 0 ? 'user' : 'model',
                    parts: [{ text: `msg ${i}` }],
                })),
            ];

            const result = optimizeToolResults({ contents }, true, false);
            expect(result.optimized).toBe(true);
            expect(result.compressedCount).toBe(1);

            const resp = result.body.contents[2].parts[0].functionResponse.response;
            expect(resp._optimized).toBe('Compressed stale result');
            expect(resp.summary).toContain('omitted');
        });

        it('should dedup identical Gemini function responses', () => {
            const fileContent = lines(50);
            const contents = [
                { role: 'user', parts: [{ functionResponse: { name: 'read', response: { content: fileContent } } }] },
                { role: 'model', parts: [{ text: 'ok' }] },
                // Padding to push first read outside recent window
                ...Array.from({ length: 10 }, (_, i) => ({
                    role: i % 2 === 0 ? 'user' : 'model',
                    parts: [{ text: `pad ${i}` }],
                })),
                // Second read — within recent window
                { role: 'user', parts: [{ functionResponse: { name: 'read', response: { content: fileContent } } }] },
                { role: 'model', parts: [{ text: 'done' }] },
                { role: 'user', parts: [{ text: 'thanks' }] },
            ];

            const result = optimizeToolResults({ contents }, true, false);
            expect(result.optimized).toBe(true);
            expect(result.dedupedCount).toBe(1);

            // First should be deduped
            const first = result.body.contents[0].parts[0].functionResponse.response;
            expect(first._optimized).toBe('duplicate');
        });
    });

    describe('Edge cases', () => {
        it('should return no-op for null body', () => {
            expect(optimizeToolResults(null, false, false).optimized).toBe(false);
        });

        it('should return no-op for short conversations', () => {
            const messages = [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hello' },
            ];
            expect(optimizeToolResults({ messages }, false, false).optimized).toBe(false);
        });

        it('should return no-op when no tool results exist', () => {
            const messages = Array.from({ length: 20 }, (_, i) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: `message ${i}`,
            }));
            expect(optimizeToolResults({ messages }, false, false).optimized).toBe(false);
        });

        it('should handle tool_result with array content blocks', () => {
            const bigText = lines(100);
            const messages = [
                { role: 'user', content: 'read' },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: bigText }] }] },
                ...Array.from({ length: 12 }, (_, i) => ({
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    content: `msg ${i}`,
                })),
            ];

            const result = optimizeToolResults({ messages }, false, false);
            expect(result.optimized).toBe(true);
            expect(result.compressedCount).toBe(1);
        });
    });
});
