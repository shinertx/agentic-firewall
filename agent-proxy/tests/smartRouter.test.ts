import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyHeuristic, smartRoute } from '../src/smartRouter';

// Mock the ollamaClient module
vi.mock('../src/ollamaClient', () => ({
    isOllamaAvailable: vi.fn().mockResolvedValue(false),
    ollamaClassify: vi.fn().mockResolvedValue(''),
    ollamaGenerate: vi.fn().mockResolvedValue(''),
    resetHealthCache: vi.fn(),
}));

// Mock stats to avoid side effects
vi.mock('../src/stats', () => ({
    globalStats: {
        ollamaCalls: 0,
        smartRouteDowngrades: 0,
        smartRouteSavings: 0,
    },
}));

import { isOllamaAvailable, ollamaClassify } from '../src/ollamaClient';

beforeEach(() => {
    vi.mocked(isOllamaAvailable).mockResolvedValue(false);
    vi.mocked(ollamaClassify).mockResolvedValue('');
});

describe('Smart Router', () => {
    describe('classifyHeuristic — Anthropic/OpenAI format', () => {
        it('should classify short conversation with simple message as LOW', () => {
            const body = {
                model: 'claude-opus-4-6',
                messages: [
                    { role: 'user', content: 'Hello, how are you?' },
                ],
            };
            const result = classifyHeuristic(body, false);
            expect(result.complexity).toBe('LOW');
        });

        it('should classify conversation with tool_use as HIGH', () => {
            const body = {
                model: 'claude-opus-4-6',
                messages: [
                    { role: 'user', content: 'Read this file' },
                    { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'read', input: {} }] },
                    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'data' }] },
                ],
            };
            const result = classifyHeuristic(body, false);
            expect(result.complexity).toBe('HIGH');
        });

        it('should classify long conversation as HIGH', () => {
            const messages = Array.from({ length: 25 }, (_, i) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: `Message ${i}`,
            }));
            const body = { model: 'gpt-4o', messages };
            const result = classifyHeuristic(body, false);
            expect(result.complexity).toBe('HIGH');
        });

        it('should return null for ambiguous cases (MEDIUM)', () => {
            const messages = Array.from({ length: 10 }, (_, i) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'A medium-length discussion about software architecture and design patterns.',
            }));
            const body = { model: 'claude-opus-4-6', messages };
            const result = classifyHeuristic(body, false);
            expect(result.complexity).toBeNull();
        });

        it('should classify message with code blocks as not LOW', () => {
            const body = {
                model: 'claude-opus-4-6',
                messages: [
                    { role: 'user', content: 'Fix this:\n```\nfunction broken() {}\n```' },
                ],
            };
            const result = classifyHeuristic(body, false);
            // Should NOT be LOW because of code blocks
            expect(result.complexity).not.toBe('LOW');
        });

        it('should classify brief message with few messages as LOW', () => {
            const body = {
                model: 'gpt-4o',
                messages: [
                    { role: 'user', content: 'What time is it?' },
                    { role: 'assistant', content: 'I cannot tell time.' },
                    { role: 'user', content: 'Thanks' },
                ],
            };
            const result = classifyHeuristic(body, false);
            expect(result.complexity).toBe('LOW');
        });
    });

    describe('classifyHeuristic — Gemini format', () => {
        it('should classify simple Gemini request as LOW', () => {
            const body = {
                contents: [
                    { role: 'user', parts: [{ text: 'Hello' }] },
                ],
            };
            const result = classifyHeuristic(body, true);
            expect(result.complexity).toBe('LOW');
        });

        it('should classify Gemini request with functionCall as HIGH', () => {
            const body = {
                contents: [
                    { role: 'user', parts: [{ text: 'Search for files' }] },
                    { role: 'model', parts: [{ functionCall: { name: 'search', args: {} } }] },
                    { role: 'user', parts: [{ functionResponse: { name: 'search', response: {} } }] },
                ],
            };
            const result = classifyHeuristic(body, true);
            expect(result.complexity).toBe('HIGH');
        });
    });

    describe('classifyHeuristic — OpenAI tool_calls format', () => {
        it('should classify request with tool_calls as HIGH', () => {
            const body = {
                model: 'gpt-4o',
                messages: [
                    { role: 'user', content: 'Search for this' },
                    { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', function: { name: 'search', arguments: '{}' } }] },
                    { role: 'tool', tool_call_id: 'call_1', content: 'results' },
                ],
            };
            const result = classifyHeuristic(body, false);
            expect(result.complexity).toBe('HIGH');
        });
    });

    describe('smartRoute — downgrade rules', () => {
        it('should downgrade opus to haiku for LOW complexity', async () => {
            const body = {
                model: 'claude-opus-4-6',
                messages: [{ role: 'user', content: 'Hi' }],
            };
            const result = await smartRoute(body, false, false);
            expect(result.routed).toBe(true);
            expect(result.newModel).toBe('claude-haiku-4-5');
            expect(result.complexity).toBe('LOW');
        });

        it('should downgrade sonnet to haiku for LOW complexity', async () => {
            const body = {
                model: 'claude-sonnet-4-6',
                messages: [{ role: 'user', content: 'Hello' }],
            };
            const result = await smartRoute(body, false, false);
            expect(result.routed).toBe(true);
            expect(result.newModel).toBe('claude-haiku-4-5');
        });

        it('should downgrade gpt-4o to gpt-4o-mini for LOW complexity', async () => {
            const body = {
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'Hi' }],
            };
            const result = await smartRoute(body, false, true);
            expect(result.routed).toBe(true);
            expect(result.newModel).toBe('gpt-4o-mini');
        });

        it('should NOT downgrade haiku (already cheapest)', async () => {
            const body = {
                model: 'claude-haiku-4-5',
                messages: [{ role: 'user', content: 'Hi' }],
            };
            const result = await smartRoute(body, false, false);
            expect(result.routed).toBe(false);
            expect(result.newModel).toBe('claude-haiku-4-5');
        });

        it('should NOT downgrade gpt-4o-mini (already cheapest)', async () => {
            const body = {
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: 'Hi' }],
            };
            const result = await smartRoute(body, false, true);
            expect(result.routed).toBe(false);
            expect(result.newModel).toBe('gpt-4o-mini');
        });

        it('should NOT downgrade for HIGH complexity', async () => {
            const messages = Array.from({ length: 25 }, (_, i) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: `Detailed discussion message ${i}`,
            }));
            const body = { model: 'claude-opus-4-6', messages };
            const result = await smartRoute(body, false, false);
            expect(result.routed).toBe(false);
            expect(result.complexity).toBe('HIGH');
        });

        it('should NOT downgrade flash (Gemini cheap model)', async () => {
            const body = {
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
            };
            const result = await smartRoute(body, true, false);
            expect(result.routed).toBe(false);
        });
    });

    describe('smartRoute — Ollama tier 2 classification', () => {
        it('should use Ollama for MEDIUM (ambiguous) cases when available', async () => {
            vi.mocked(isOllamaAvailable).mockResolvedValue(true);
            vi.mocked(ollamaClassify).mockResolvedValue('LOW');

            const messages = Array.from({ length: 10 }, (_, i) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'Moderate discussion about architecture.',
            }));
            const body = { model: 'claude-opus-4-6', messages };
            const result = await smartRoute(body, false, false);
            // Ollama said LOW, so should downgrade
            expect(result.complexity).toBe('LOW');
            expect(result.routed).toBe(true);
        });

        it('should treat MEDIUM as HIGH when Ollama unavailable (conservative)', async () => {
            vi.mocked(isOllamaAvailable).mockResolvedValue(false);

            const messages = Array.from({ length: 10 }, (_, i) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'Moderate discussion about architecture.',
            }));
            const body = { model: 'claude-opus-4-6', messages };
            const result = await smartRoute(body, false, false);
            expect(result.complexity).toBe('HIGH');
            expect(result.routed).toBe(false);
        });
    });

    describe('smartRoute — edge cases', () => {
        it('should handle null body', async () => {
            const result = await smartRoute(null, false, false);
            expect(result.routed).toBe(false);
        });

        it('should handle body with no model', async () => {
            const result = await smartRoute({ messages: [] }, false, false);
            expect(result.routed).toBe(false);
        });

        it('should handle empty messages', async () => {
            const body = { model: 'claude-opus-4-6', messages: [] };
            const result = await smartRoute(body, false, false);
            // Empty messages + no tool use = LOW, should downgrade
            expect(result.complexity).toBe('LOW');
        });
    });

    describe('smartRoute — MEDIUM downgrade with Ollama', () => {
        it('should downgrade opus to sonnet for MEDIUM complexity', async () => {
            vi.mocked(isOllamaAvailable).mockResolvedValue(true);
            vi.mocked(ollamaClassify).mockResolvedValue('MEDIUM');

            const messages = Array.from({ length: 10 }, (_, i) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'Discussion about code.',
            }));
            const body = { model: 'claude-opus-4-6', messages };
            const result = await smartRoute(body, false, false);
            expect(result.complexity).toBe('MEDIUM');
            expect(result.routed).toBe(true);
            expect(result.newModel).toBe('claude-sonnet-4-6');
        });
    });
});
