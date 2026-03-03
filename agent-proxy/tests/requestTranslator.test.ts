import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/keyVault', () => ({
    getProviderKey: vi.fn().mockReturnValue({ key: 'test-key-123' }),
    getProviderHeaderConfig: vi.fn().mockReturnValue({ headerName: 'authorization', headerPrefix: 'Bearer ' }),
}));
vi.mock('../src/contextWindows', () => ({
    getContextWindow: vi.fn().mockReturnValue(128000),
}));

import { detectFormat, hasToolUseContent, findCrossProviderTarget, translateRequest } from '../src/requestTranslator';
import { getProviderKey } from '../src/keyVault';
import { getContextWindow } from '../src/contextWindows';

beforeEach(() => {
    vi.mocked(getProviderKey).mockReturnValue({ key: 'test-key-123' });
    vi.mocked(getContextWindow).mockReturnValue(128000);
});

describe('Request Translator', () => {

    // ========== detectFormat ==========
    describe('detectFormat', () => {
        it('should detect gemini format (body has contents array)', () => {
            const body = {
                contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
            };
            expect(detectFormat(body)).toBe('gemini');
        });

        it('should detect anthropic format (body has system field)', () => {
            const body = {
                system: 'You are a helpful assistant.',
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'claude-sonnet-4-6',
            };
            expect(detectFormat(body)).toBe('anthropic');
        });

        it('should default to openai format', () => {
            const body = {
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'Hello' }],
            };
            expect(detectFormat(body)).toBe('openai');
        });

        it('should handle null/undefined body safely', () => {
            expect(detectFormat(null)).toBe('openai');
            expect(detectFormat(undefined)).toBe('openai');
        });
    });

    // ========== hasToolUseContent ==========
    describe('hasToolUseContent', () => {
        it('should detect anthropic tool_use blocks', () => {
            const body = {
                messages: [
                    { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'read_file', input: {} }] },
                ],
            };
            expect(hasToolUseContent(body, 'anthropic')).toBe(true);
        });

        it('should detect anthropic tool_result blocks', () => {
            const body = {
                messages: [
                    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'file contents' }] },
                ],
            };
            expect(hasToolUseContent(body, 'anthropic')).toBe(true);
        });

        it('should detect openai tool_calls', () => {
            const body = {
                messages: [
                    { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', function: { name: 'search', arguments: '{}' } }] },
                ],
            };
            expect(hasToolUseContent(body, 'openai')).toBe(true);
        });

        it('should detect openai tool role messages', () => {
            const body = {
                messages: [
                    { role: 'tool', tool_call_id: 'call_1', content: 'results' },
                ],
            };
            expect(hasToolUseContent(body, 'openai')).toBe(true);
        });

        it('should detect gemini functionCall parts', () => {
            const body = {
                contents: [
                    { role: 'model', parts: [{ functionCall: { name: 'search', args: {} } }] },
                ],
            };
            expect(hasToolUseContent(body, 'gemini')).toBe(true);
        });

        it('should detect gemini functionResponse parts', () => {
            const body = {
                contents: [
                    { role: 'user', parts: [{ functionResponse: { name: 'search', response: { result: 'ok' } } }] },
                ],
            };
            expect(hasToolUseContent(body, 'gemini')).toBe(true);
        });

        it('should return false for messages without tools', () => {
            const anthropicBody = {
                messages: [{ role: 'user', content: 'Hello' }],
            };
            expect(hasToolUseContent(anthropicBody, 'anthropic')).toBe(false);

            const openaiBody = {
                messages: [{ role: 'user', content: 'Hello' }],
            };
            expect(hasToolUseContent(openaiBody, 'openai')).toBe(false);

            const geminiBody = {
                contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
            };
            expect(hasToolUseContent(geminiBody, 'gemini')).toBe(false);
        });

        it('should handle empty/null body safely', () => {
            expect(hasToolUseContent(null, 'anthropic')).toBe(false);
            expect(hasToolUseContent({}, 'openai')).toBe(false);
            expect(hasToolUseContent({ contents: [] }, 'gemini')).toBe(false);
        });
    });

    // ========== findCrossProviderTarget ==========
    describe('findCrossProviderTarget', () => {
        it('should map sonnet to gpt-4o (openai)', () => {
            const result = findCrossProviderTarget('claude-sonnet-4-6');
            expect(result).not.toBeNull();
            expect(result!.targetModel).toBe('gpt-4o');
            expect(result!.targetProvider).toBe('openai');
        });

        it('should map opus to gpt-4o (openai)', () => {
            const result = findCrossProviderTarget('claude-opus-4-6');
            expect(result).not.toBeNull();
            expect(result!.targetModel).toBe('gpt-4o');
            expect(result!.targetProvider).toBe('openai');
        });

        it('should map gpt-4o to claude-sonnet-4-6 (anthropic)', () => {
            const result = findCrossProviderTarget('gpt-4o');
            expect(result).not.toBeNull();
            expect(result!.targetModel).toBe('claude-sonnet-4-6');
            expect(result!.targetProvider).toBe('anthropic');
        });

        it('should map gemini-2.5-pro to claude-sonnet-4-6 (anthropic)', () => {
            const result = findCrossProviderTarget('gemini-2.5-pro');
            expect(result).not.toBeNull();
            expect(result!.targetModel).toBe('claude-sonnet-4-6');
            expect(result!.targetProvider).toBe('anthropic');
        });

        it('should map gemini-2.5-flash to gpt-4o-mini (openai)', () => {
            const result = findCrossProviderTarget('gemini-2.5-flash');
            expect(result).not.toBeNull();
            expect(result!.targetModel).toBe('gpt-4o-mini');
            expect(result!.targetProvider).toBe('openai');
        });

        it('should return null for unknown model', () => {
            const result = findCrossProviderTarget('totally-unknown-model-xyz');
            expect(result).toBeNull();
        });
    });

    // ========== translateRequest ==========
    describe('translateRequest', () => {
        it('should translate Anthropic to OpenAI: system prompt becomes system message', () => {
            const body = {
                model: 'claude-sonnet-4-6',
                system: 'You are a coding assistant.',
                messages: [
                    { role: 'user', content: 'Write a function' },
                    { role: 'assistant', content: 'Here is the function' },
                ],
                max_tokens: 1024,
                stream: true,
            };

            const result = translateRequest(body, 'anthropic', 'openai', 'gpt-4o');
            expect('error' in result).toBe(false);

            const translated = result as any;
            expect(translated.body.model).toBe('gpt-4o');
            expect(translated.body.messages[0].role).toBe('system');
            expect(translated.body.messages[0].content).toBe('You are a coding assistant.');
            expect(translated.body.messages[1].role).toBe('user');
            expect(translated.body.messages[2].role).toBe('assistant');
        });

        it('should translate OpenAI to Anthropic: system messages extracted to body.system', () => {
            const body = {
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'Hello' },
                    { role: 'assistant', content: 'Hi there!' },
                ],
            };

            const result = translateRequest(body, 'openai', 'anthropic', 'claude-sonnet-4-6');
            expect('error' in result).toBe(false);

            const translated = result as any;
            expect(translated.body.model).toBe('claude-sonnet-4-6');
            expect(translated.body.system).toBe('You are a helpful assistant.');
            // No system messages in the messages array
            const hasSystem = translated.body.messages.some((m: any) => m.role === 'system');
            expect(hasSystem).toBe(false);
            expect(translated.body.max_tokens).toBe(4096);
        });

        it('should translate Anthropic to Gemini: role mapping (assistant->model), systemInstruction populated', () => {
            const body = {
                model: 'claude-sonnet-4-6',
                system: 'You are a code reviewer.',
                messages: [
                    { role: 'user', content: 'Review this code' },
                    { role: 'assistant', content: 'Here are my findings' },
                ],
                max_tokens: 2048,
            };

            const result = translateRequest(body, 'anthropic', 'gemini', 'gemini-2.5-pro');
            expect('error' in result).toBe(false);

            const translated = result as any;
            expect(translated.body.systemInstruction).toBeDefined();
            expect(translated.body.systemInstruction.parts[0].text).toBe('You are a code reviewer.');
            // assistant should be mapped to model
            const modelMsg = translated.body.contents.find((c: any) => c.role === 'model');
            expect(modelMsg).toBeDefined();
            expect(translated.body.contents[0].role).toBe('user');
        });

        it('should translate OpenAI to Gemini: system message becomes systemInstruction', () => {
            const body = {
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: 'You are a translator.' },
                    { role: 'user', content: 'Translate this' },
                ],
            };

            const result = translateRequest(body, 'openai', 'gemini', 'gemini-2.5-pro');
            expect('error' in result).toBe(false);

            const translated = result as any;
            expect(translated.body.systemInstruction).toBeDefined();
            expect(translated.body.systemInstruction.parts[0].text).toBe('You are a translator.');
            // No system message in contents
            const hasSystem = translated.body.contents.some((c: any) => c.role === 'system');
            expect(hasSystem).toBe(false);
        });

        it('should translate Gemini to Anthropic: model->assistant role mapping, systemInstruction->system', () => {
            const body = {
                systemInstruction: { parts: [{ text: 'You are a summarizer.' }] },
                contents: [
                    { role: 'user', parts: [{ text: 'Summarize this document' }] },
                    { role: 'model', parts: [{ text: 'Here is the summary' }] },
                ],
            };

            const result = translateRequest(body, 'gemini', 'anthropic', 'claude-sonnet-4-6');
            expect('error' in result).toBe(false);

            const translated = result as any;
            expect(translated.body.system).toBe('You are a summarizer.');
            expect(translated.body.messages[0].role).toBe('user');
            const assistantMsg = translated.body.messages.find((m: any) => m.role === 'assistant');
            expect(assistantMsg).toBeDefined();
            expect(assistantMsg.content).toBe('Here is the summary');
        });

        it('should translate Gemini to OpenAI: systemInstruction becomes system message', () => {
            const body = {
                systemInstruction: { parts: [{ text: 'You are a math tutor.' }] },
                contents: [
                    { role: 'user', parts: [{ text: 'What is 2+2?' }] },
                    { role: 'model', parts: [{ text: '4' }] },
                ],
            };

            const result = translateRequest(body, 'gemini', 'openai', 'gpt-4o');
            expect('error' in result).toBe(false);

            const translated = result as any;
            expect(translated.body.messages[0].role).toBe('system');
            expect(translated.body.messages[0].content).toBe('You are a math tutor.');
            expect(translated.body.messages[1].role).toBe('user');
            // model -> assistant
            expect(translated.body.messages[2].role).toBe('assistant');
        });

        it('should reject requests with tool use content (error.reason === tool_use)', () => {
            const body = {
                messages: [
                    { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'read', input: {} }] },
                ],
            };

            const result = translateRequest(body, 'anthropic', 'openai', 'gpt-4o');
            expect('error' in result).toBe(true);
            expect((result as any).reason).toBe('tool_use');
        });

        it('should reject when no provider key available', () => {
            vi.mocked(getProviderKey).mockReturnValueOnce({ error: 'No key configured for provider' } as any);

            const body = {
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'Hello' }],
            };

            const result = translateRequest(body, 'openai', 'anthropic', 'claude-sonnet-4-6');
            expect('error' in result).toBe(true);
            expect((result as any).reason).toBe('no_key');
        });

        it('should reject when context is too large', () => {
            vi.mocked(getContextWindow).mockReturnValueOnce(100);

            const body = {
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: 'A'.repeat(1000) },
                    { role: 'user', content: 'B'.repeat(1000) },
                ],
            };

            const result = translateRequest(body, 'openai', 'anthropic', 'claude-sonnet-4-6');
            expect('error' in result).toBe(true);
            expect((result as any).reason).toBe('context_too_large');
        });

        it('should return correct URL and headers for anthropic target', () => {
            const body = {
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'Hello' }],
            };

            const result = translateRequest(body, 'openai', 'anthropic', 'claude-sonnet-4-6');
            expect('error' in result).toBe(false);

            const translated = result as any;
            expect(translated.url).toBe('https://api.anthropic.com/v1/messages');
            expect(translated.headers['anthropic-version']).toBe('2023-06-01');
            expect(translated.headers['content-type']).toBe('application/json');
        });

        it('should return correct URL for gemini target (includes model name and key)', () => {
            const body = {
                model: 'claude-sonnet-4-6',
                system: 'You are helpful.',
                messages: [{ role: 'user', content: 'Hello' }],
                max_tokens: 1024,
            };

            const result = translateRequest(body, 'anthropic', 'gemini', 'gemini-2.5-pro');
            expect('error' in result).toBe(false);

            const translated = result as any;
            expect(translated.url).toContain('gemini-2.5-pro');
            expect(translated.url).toContain('key=test-key-123');
            expect(translated.url).toContain('generativelanguage.googleapis.com');
        });

        it('should return correct headers for openai target', () => {
            const body = {
                system: 'You are helpful.',
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'claude-sonnet-4-6',
                max_tokens: 1024,
            };

            const result = translateRequest(body, 'anthropic', 'openai', 'gpt-4o');
            expect('error' in result).toBe(false);

            const translated = result as any;
            expect(translated.url).toBe('https://api.openai.com/v1/chat/completions');
            expect(translated.headers['authorization']).toBe('Bearer test-key-123');
            expect(translated.headers['content-type']).toBe('application/json');
        });
    });
});
