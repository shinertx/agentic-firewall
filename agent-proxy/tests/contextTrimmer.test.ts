import { describe, it, expect } from 'vitest';
import { trimContext } from '../src/contextTrimmer';

describe('Context Trimmer', () => {
    describe('Anthropic format', () => {
        it('should not trim when payload is under context window', () => {
            const body = {
                model: 'claude-sonnet-4-6',
                system: 'You are helpful',
                messages: [{ role: 'user', content: 'hello' }]
            };
            const result = trimContext(body, false, false, 'claude-sonnet-4-6');
            expect(result.trimmed).toBe(false);
            expect(result.body).toBe(body);
        });

        it('should trim old messages from front when over context window', () => {
            // Build a payload that exceeds 200k * 0.8 = 160k token target
            // Each message pair ~= 1000 chars = 250 tokens. 800 pairs = 200k tokens
            const messages = [];
            for (let i = 0; i < 800; i++) {
                messages.push({ role: 'user', content: 'A'.repeat(500) });
                messages.push({ role: 'assistant', content: 'B'.repeat(500) });
            }
            const body = { model: 'claude-sonnet-4-6', system: 'sys', messages };
            const result = trimContext(body, false, false, 'claude-sonnet-4-6');
            expect(result.trimmed).toBe(true);
            expect(result.removedMessages).toBeGreaterThan(0);
            expect(result.body.messages.length).toBeLessThan(messages.length);
        });

        it('should preserve tool_use/tool_result pairs', () => {
            // Filler to push over the 160k token target (200k * 0.8)
            // Need > 640k chars. 1600 messages * 500 chars = 800k chars = 200k tokens
            const filler = Array.from({ length: 1600 }, (_, i) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'X'.repeat(500),
            }));
            // Recent tool pair (should be kept since it's at the end)
            const toolPair = [
                {
                    role: 'assistant',
                    content: [{ type: 'tool_use', id: 'tool_1', name: 'read_file', input: {} }]
                },
                {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'file contents' }]
                },
            ];
            const body = {
                model: 'claude-sonnet-4-6',
                system: 'sys',
                messages: [...filler, ...toolPair, { role: 'user', content: 'Now analyze this' }]
            };
            const result = trimContext(body, false, false, 'claude-sonnet-4-6');
            expect(result.trimmed).toBe(true);

            // Verify the tool pair is preserved (it's near the end)
            const trimmedMsgs = result.body.messages;
            const toolUseMsg = trimmedMsgs.find((m: any) =>
                Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_use')
            );
            const toolResultMsg = trimmedMsgs.find((m: any) =>
                Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result')
            );
            expect(toolUseMsg).toBeDefined();
            expect(toolResultMsg).toBeDefined();
        });

        it('should ensure first message after trim is a user message', () => {
            const messages = [];
            for (let i = 0; i < 800; i++) {
                messages.push({ role: 'user', content: 'A'.repeat(500) });
                messages.push({ role: 'assistant', content: 'B'.repeat(500) });
            }
            const body = { model: 'claude-sonnet-4-6', system: 'sys', messages };
            const result = trimContext(body, false, false, 'claude-sonnet-4-6');
            if (result.trimmed && result.body.messages.length > 0) {
                expect(result.body.messages[0].role).not.toBe('assistant');
            }
        });

        it('should not leave orphaned tool_result when trim boundary falls on a tool pair', () => {
            // Reproduce: trimming removes old messages, leaving a tool_use/tool_result
            // pair as the first messages. The assistant gets shifted to satisfy
            // "first message must be user", but the paired tool_result must also be removed.
            const filler = Array.from({ length: 1600 }, (_, i) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'X'.repeat(500),
            }));
            // Place a tool pair right after the filler — this will be near the trim boundary
            const toolPair = [
                {
                    role: 'assistant',
                    content: [{ type: 'tool_use', id: 'toolu_orphan', name: 'read_file', input: {} }]
                },
                {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: 'toolu_orphan', content: 'result' }]
                },
            ];
            const recentMsgs = [
                { role: 'user', content: 'continue' },
                { role: 'assistant', content: 'ok' },
                { role: 'user', content: 'final question' },
            ];
            const body = {
                model: 'claude-sonnet-4-6',
                system: 'sys',
                messages: [...filler, ...toolPair, ...recentMsgs]
            };
            const result = trimContext(body, false, false, 'claude-sonnet-4-6');
            expect(result.trimmed).toBe(true);
            // First message must be a user message WITHOUT tool_result
            const firstMsg = result.body.messages[0];
            expect(firstMsg.role).toBe('user');
            if (Array.isArray(firstMsg.content)) {
                const hasOrphanedToolResult = firstMsg.content.some(
                    (b: any) => b.type === 'tool_result'
                );
                expect(hasOrphanedToolResult).toBe(false);
            }
        });

        it('should preserve system prompt entirely', () => {
            const longSystem = 'S'.repeat(100_000);
            const messages = Array.from({ length: 800 }, (_, i) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'M'.repeat(500),
            }));
            const body = { model: 'claude-sonnet-4-6', system: longSystem, messages };
            const result = trimContext(body, false, false, 'claude-sonnet-4-6');
            expect(result.body.system).toBe(longSystem);
        });
    });

    describe('OpenAI format', () => {
        it('should not trim when under context window', () => {
            const body = {
                model: 'gpt-5',
                messages: [
                    { role: 'system', content: 'You help with code' },
                    { role: 'user', content: 'hello' },
                ]
            };
            const result = trimContext(body, false, true, 'gpt-5');
            expect(result.trimmed).toBe(false);
        });

        it('should preserve system messages and trim old conversation', () => {
            const systemMsg = { role: 'system', content: 'SYSTEM'.repeat(100) };
            // Need to exceed gpt-4o's 128k * 0.8 = 102.4k token target
            // Each message ~500 chars = 125 tokens. 1000 messages = 125k tokens
            const convMsgs = Array.from({ length: 1000 }, (_, i) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'C'.repeat(500),
            }));
            const body = { model: 'gpt-4o', messages: [systemMsg, ...convMsgs] };
            const result = trimContext(body, false, true, 'gpt-4o');
            expect(result.trimmed).toBe(true);
            // System message must still be first
            expect(result.body.messages[0].role).toBe('system');
            expect(result.body.messages.length).toBeLessThan(body.messages.length);
        });

        it('should preserve tool_calls/tool response groups', () => {
            const filler = Array.from({ length: 1000 }, () => ({
                role: 'user',
                content: 'X'.repeat(500),
            }));
            // Recent tool call group at the end
            const toolGroup = [
                { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', function: { name: 'search', arguments: '{}' } }] },
                { role: 'tool', tool_call_id: 'call_1', content: 'search results' },
                { role: 'user', content: 'analyze this' },
            ];
            const body = {
                model: 'gpt-4o',
                messages: [{ role: 'system', content: 'sys' }, ...filler, ...toolGroup]
            };
            const result = trimContext(body, false, true, 'gpt-4o');
            expect(result.trimmed).toBe(true);
            // The tool group is at the end so should be preserved
            const toolCallMsg = result.body.messages.find((m: any) => m.tool_calls);
            const toolResponse = result.body.messages.find((m: any) => m.role === 'tool');
            expect(toolCallMsg).toBeDefined();
            expect(toolResponse).toBeDefined();
        });
    });

    describe('Gemini format', () => {
        it('should not trim when under context window', () => {
            const body = {
                systemInstruction: { parts: [{ text: 'You help' }] },
                contents: [
                    { role: 'user', parts: [{ text: 'hello' }] },
                ]
            };
            const result = trimContext(body, true, false, 'gemini-2.5-flash');
            expect(result.trimmed).toBe(false);
        });

        it('should trim when payload exceeds context window', () => {
            // Gemini has 1M token window. 1M * 0.8 = 800k target
            // Need > 800k tokens = > 3.2M chars
            // 2000 pairs * 2000 chars each = 4M chars = 1M tokens
            const contents = [];
            for (let i = 0; i < 2000; i++) {
                contents.push({ role: 'user', parts: [{ text: 'Q'.repeat(1000) }] });
                contents.push({ role: 'model', parts: [{ text: 'A'.repeat(1000) }] });
            }
            contents.push({ role: 'user', parts: [{ text: 'final question' }] });
            const body = {
                model: 'gemini-2.5-flash',
                systemInstruction: { parts: [{ text: 'sys' }] },
                contents
            };
            const result = trimContext(body, true, false, 'gemini-2.5-flash');
            expect(result.trimmed).toBe(true);
            expect(result.body.contents.length).toBeLessThan(contents.length);
        });

        it('should maintain user/model alternation after trim', () => {
            const contents = [];
            for (let i = 0; i < 2000; i++) {
                contents.push({ role: 'user', parts: [{ text: 'Q'.repeat(1000) }] });
                contents.push({ role: 'model', parts: [{ text: 'A'.repeat(1000) }] });
            }
            contents.push({ role: 'user', parts: [{ text: 'final' }] });
            const body = {
                model: 'gemini-2.5-flash',
                systemInstruction: { parts: [{ text: 'sys' }] },
                contents
            };
            const result = trimContext(body, true, false, 'gemini-2.5-flash');
            if (result.trimmed && result.body.contents.length > 0) {
                expect(result.body.contents[0].role).toBe('user');
            }
        });

        it('should preserve systemInstruction entirely', () => {
            const sysText = 'Important system context'.repeat(100);
            const contents = [];
            for (let i = 0; i < 2000; i++) {
                contents.push({ role: 'user', parts: [{ text: 'X'.repeat(1000) }] });
                contents.push({ role: 'model', parts: [{ text: 'Y'.repeat(1000) }] });
            }
            const body = {
                model: 'gemini-2.5-flash',
                systemInstruction: { parts: [{ text: sysText }] },
                contents
            };
            const result = trimContext(body, true, false, 'gemini-2.5-flash');
            expect(result.body.systemInstruction.parts[0].text).toBe(sysText);
        });
    });

    describe('Edge cases', () => {
        it('should handle null body', () => {
            const result = trimContext(null, false, false, 'unknown');
            expect(result.trimmed).toBe(false);
        });

        it('should handle body with no messages', () => {
            const result = trimContext({ model: 'gpt-4o' }, false, true, 'gpt-4o');
            expect(result.trimmed).toBe(false);
        });

        it('should handle unknown model (uses default 128k context window)', () => {
            // Default window = 128k. Target = 128k * 0.8 = 102.4k tokens = ~410k chars
            // 1000 messages * 500 chars = 500k chars = 125k tokens > 102.4k
            const messages = Array.from({ length: 1000 }, (_, i) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'X'.repeat(500),
            }));
            const body = { model: 'totally-unknown', messages };
            const result = trimContext(body, false, false, 'totally-unknown');
            expect(result.trimmed).toBe(true);
        });

        it('should use pre-computed body length when provided', () => {
            const body = { model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] };
            // Pass a small body length — should not trim
            const result = trimContext(body, false, true, 'gpt-5', 100);
            expect(result.trimmed).toBe(false);
        });

        it('should handle empty messages array', () => {
            const body = { model: 'claude-sonnet-4-6', system: 'sys', messages: [] };
            const result = trimContext(body, false, false, 'claude-sonnet-4-6');
            expect(result.trimmed).toBe(false);
        });

        it('should handle Gemini with empty contents', () => {
            const body = { systemInstruction: { parts: [] }, contents: [] };
            const result = trimContext(body, true, false, 'gemini-2.5-flash');
            expect(result.trimmed).toBe(false);
        });
    });
});
