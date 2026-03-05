import { describe, it, expect, beforeEach } from 'vitest';
import { checkNoProgress, resetNoProgress, getNoProgressStats } from '../src/noProgress';

// ─── Helpers ─────────────────────────────────────────────

/** Build an Anthropic-format turn: assistant calls a tool, user returns result */
function anthropicTurn(toolName: string, toolInput: any, resultContent: string, isError = false) {
    return [
        {
            role: 'assistant',
            content: [{ type: 'tool_use', id: `tu_${Date.now()}`, name: toolName, input: toolInput }],
        },
        {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: `tu_${Date.now()}`, content: resultContent, is_error: isError }],
        },
    ];
}

/** Build a full message history with multiple turns */
function buildHistory(...turns: any[][]) {
    return { messages: turns.flat() };
}

/** Build an OpenAI-format turn */
function openAITurn(toolName: string, toolArgs: string, resultContent: string) {
    return [
        {
            role: 'assistant',
            tool_calls: [{ id: `call_${Date.now()}`, function: { name: toolName, arguments: toolArgs } }],
        },
        {
            role: 'tool',
            tool_call_id: `call_${Date.now()}`,
            content: resultContent,
        },
    ];
}

describe('Smart No-Progress Detection', () => {
    beforeEach(() => {
        resetNoProgress('test-agent');
    });

    // ─── Basic Behavior ──────────────────────────────────

    describe('basic behavior', () => {
        it('should return noProgress: false for normal requests without tools', () => {
            const body = {
                messages: [
                    { role: 'user', content: 'Hello' },
                    { role: 'assistant', content: 'Hi there!' },
                ],
            };
            const result = checkNoProgress('test-agent', body);
            expect(result.noProgress).toBe(false);
        });

        it('should return noProgress: false for requests without messages', () => {
            expect(checkNoProgress('test-agent', { model: 'gpt-4o' }).noProgress).toBe(false);
        });

        it('should return noProgress: false for null/undefined body', () => {
            expect(checkNoProgress('test-agent', null).noProgress).toBe(false);
            expect(checkNoProgress('test-agent', undefined).noProgress).toBe(false);
        });
    });

    // ─── Progress Signal: Success ────────────────────────

    describe('progress signal: success', () => {
        it('should never block when tool calls succeed', () => {
            // 10 identical successful calls — should never trigger
            for (let i = 0; i < 10; i++) {
                const body = buildHistory(
                    anthropicTurn('Read', { path: '/same/file.ts' }, 'file contents here', false),
                );
                const result = checkNoProgress('test-agent', body);
                expect(result.noProgress).toBe(false);
            }
        });

        it('should reset error tracking when a tool call succeeds after failures', () => {
            // 4 identical errors, then a success
            for (let i = 0; i < 4; i++) {
                checkNoProgress('test-agent', buildHistory(
                    anthropicTurn('Read', { path: '/missing.ts' }, 'Error: file not found', true),
                ));
            }
            // Success should reset — not block
            const result = checkNoProgress('test-agent', buildHistory(
                anthropicTurn('Read', { path: '/found.ts' }, 'file contents', false),
            ));
            expect(result.noProgress).toBe(false);
        });
    });

    // ─── Progress Signal: Tool Diversity ─────────────────

    describe('progress signal: tool diversity', () => {
        it('should detect progress when agent switches tools', () => {
            // Error with Read tool
            checkNoProgress('test-agent', buildHistory(
                anthropicTurn('Read', { path: '/a.ts' }, 'Error: not found', true),
            ));
            // Error with Grep tool — different tool = progress
            const result = checkNoProgress('test-agent', buildHistory(
                anthropicTurn('Grep', { pattern: 'foo' }, 'Error: no matches', true),
            ));
            expect(result.noProgress).toBe(false);
            expect(result.progressSignals).toBeDefined();
            expect(result.progressSignals!.some(s => s.type === 'new_tool')).toBe(true);
        });
    });

    // ─── Progress Signal: Argument Variation ─────────────

    describe('progress signal: argument variation', () => {
        it('should detect progress when same tool is called with different args', () => {
            checkNoProgress('test-agent', buildHistory(
                anthropicTurn('Read', { path: '/src/a.ts' }, 'Error: not found', true),
            ));
            // Same tool, different path = progress
            const result = checkNoProgress('test-agent', buildHistory(
                anthropicTurn('Read', { path: '/src/b.ts' }, 'Error: not found', true),
            ));
            expect(result.noProgress).toBe(false);
            expect(result.progressSignals!.some(s => s.type === 'new_args')).toBe(true);
        });

        it('should NOT show new_args progress when tool and args are identical', () => {
            checkNoProgress('test-agent', buildHistory(
                anthropicTurn('Read', { path: '/src/a.ts' }, 'Error: not found', true),
            ));
            const result = checkNoProgress('test-agent', buildHistory(
                anthropicTurn('Read', { path: '/src/a.ts' }, 'Error: not found', true),
            ));
            // Should not have new_args signal (but may have other signals like new_output)
            expect(result.progressSignals?.some(s => s.type === 'new_args')).toBeFalsy();
        });
    });

    // ─── Progress Signal: Error Evolution ────────────────

    describe('progress signal: error evolution', () => {
        it('should detect progress when the error message changes', () => {
            checkNoProgress('test-agent', buildHistory(
                anthropicTurn('Bash', { command: 'npm test' }, 'Error: file not found', true),
            ));
            // Different error = agent hit a new problem = progress
            const result = checkNoProgress('test-agent', buildHistory(
                anthropicTurn('Bash', { command: 'npm test' }, 'Error: syntax error on line 42', true),
            ));
            expect(result.noProgress).toBe(false);
            expect(result.progressSignals!.some(s => s.type === 'error_evolved')).toBe(true);
        });
    });

    // ─── Progress Signal: Output Diversity ───────────────

    describe('progress signal: output diversity', () => {
        it('should detect progress when assistant produces new content', () => {
            checkNoProgress('test-agent', buildHistory(
                [{ role: 'assistant', content: [{ type: 'text', text: 'Let me try approach A' }, { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/a.ts' } }] }],
                [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Error: not found', is_error: true }] }],
            ));
            const result = checkNoProgress('test-agent', buildHistory(
                [{ role: 'assistant', content: [{ type: 'text', text: 'Let me try approach B instead' }, { type: 'tool_use', id: 't2', name: 'Read', input: { path: '/a.ts' } }] }],
                [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'Error: not found', is_error: true }] }],
            ));
            expect(result.noProgress).toBe(false);
            expect(result.progressSignals!.some(s => s.type === 'new_output')).toBe(true);
        });
    });

    // ─── Blocking: Zero Progress ─────────────────────────

    describe('blocking on zero progress', () => {
        it('should warn after NP_WARN_AT turns with zero progress', () => {
            // Make identical tool calls with identical errors, identical assistant content
            const makeBody = () => buildHistory(
                [{ role: 'assistant', content: [{ type: 'tool_use', id: 'same', name: 'Read', input: { path: '/same.ts' } }] }],
                [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'same', content: 'Error: not found', is_error: true }] }],
            );

            // First call has progress signals (new tool, new args, new output)
            checkNoProgress('test-agent', makeBody());
            // Second call: no new signals (everything identical)
            checkNoProgress('test-agent', makeBody());
            // Third call: no new signals
            checkNoProgress('test-agent', makeBody());
            // Fourth call: turnsSinceProgress = 3 = NP_WARN_AT
            const result = checkNoProgress('test-agent', makeBody());
            expect(result.warning).toBeDefined();
            expect(result.noProgress).toBe(false);
        });

        it('should block after NP_BLOCK_AT turns with zero progress', () => {
            const makeBody = () => buildHistory(
                [{ role: 'assistant', content: [{ type: 'tool_use', id: 'same', name: 'Read', input: { path: '/same.ts' } }] }],
                [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'same', content: 'Error: not found', is_error: true }] }],
            );

            // First call has progress (new to the window) — turnsSinceProgress stays 0
            checkNoProgress('test-agent', makeBody());
            // Subsequent calls: zero progress each time
            for (let i = 0; i < 5; i++) {
                checkNoProgress('test-agent', makeBody());
            }
            const result = checkNoProgress('test-agent', makeBody());
            expect(result.noProgress).toBe(true);
            expect(result.reason).toContain('zero progress signals');
        });

        it('should NOT block if the agent keeps trying different things', () => {
            // Each turn tries a different file — new_args signal keeps resetting patience
            const files = ['/a.ts', '/b.ts', '/c.ts', '/d.ts', '/e.ts', '/f.ts', '/g.ts', '/h.ts'];
            for (const file of files) {
                const result = checkNoProgress('test-agent', buildHistory(
                    anthropicTurn('Read', { path: file }, 'Error: not found', true),
                ));
                expect(result.noProgress).toBe(false);
            }
        });

        it('should NOT block if errors keep changing', () => {
            const errors = [
                'TypeError: x is not a function',
                'ReferenceError: y is not defined',
                'SyntaxError: unexpected token',
                'Error: module not found',
                'Error: ENOENT no such file',
                'Error: EACCES permission denied',
                'Error: timeout exceeded',
            ];
            for (const err of errors) {
                const result = checkNoProgress('test-agent', buildHistory(
                    anthropicTurn('Bash', { command: 'npm test' }, err, true),
                ));
                expect(result.noProgress).toBe(false);
            }
        });
    });

    // ─── Spinning Detection ──────────────────────────────

    describe('spinning detection', () => {
        it('should detect spinning — 3 identical assistant messages', () => {
            const body = {
                messages: [
                    { role: 'assistant', content: 'I will try again' },
                    { role: 'user', content: 'ok' },
                    { role: 'assistant', content: 'I will try again' },
                    { role: 'user', content: 'ok' },
                    { role: 'assistant', content: 'I will try again' },
                ],
            };
            const result = checkNoProgress('test-agent', body);
            expect(result.noProgress).toBe(true);
            expect(result.reason).toContain('spinning');
        });

        it('should not flag different assistant messages as spinning', () => {
            const body = {
                messages: [
                    { role: 'assistant', content: 'Step 1 done' },
                    { role: 'user', content: 'ok' },
                    { role: 'assistant', content: 'Step 2 done' },
                    { role: 'user', content: 'ok' },
                    { role: 'assistant', content: 'Step 3 done' },
                ],
            };
            const result = checkNoProgress('test-agent', body);
            expect(result.noProgress).toBe(false);
        });
    });

    // ─── OpenAI Format ───────────────────────────────────

    describe('OpenAI format', () => {
        it('should extract tool calls from OpenAI format', () => {
            const body = buildHistory(
                openAITurn('get_weather', '{"city":"SF"}', '{"temp":72}'),
            );
            const result = checkNoProgress('test-agent', body);
            expect(result.noProgress).toBe(false);
        });

        it('should track OpenAI tool diversity', () => {
            checkNoProgress('test-agent', buildHistory(
                openAITurn('search', '{"q":"foo"}', 'no results'),
            ));
            const result = checkNoProgress('test-agent', buildHistory(
                openAITurn('read_file', '{"path":"/a.ts"}', 'contents'),
            ));
            expect(result.noProgress).toBe(false);
            expect(result.progressSignals!.some(s => s.type === 'new_tool')).toBe(true);
        });
    });

    // ─── Edge Cases ──────────────────────────────────────

    describe('edge cases', () => {
        it('should handle mixed success and error results in one turn', () => {
            const body = {
                messages: [
                    {
                        role: 'assistant',
                        content: [
                            { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/a.ts' } },
                            { type: 'tool_use', id: 't2', name: 'Read', input: { path: '/b.ts' } },
                        ],
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'tool_result', tool_use_id: 't1', content: 'file contents', is_error: false },
                            { type: 'tool_result', tool_use_id: 't2', content: 'Error: not found', is_error: true },
                        ],
                    },
                ],
            };
            // Has a success — should count as progress
            const result = checkNoProgress('test-agent', body);
            expect(result.noProgress).toBe(false);
            expect(result.progressSignals!.some(s => s.type === 'success')).toBe(true);
        });

        it('should handle empty content arrays gracefully', () => {
            const body = {
                messages: [
                    { role: 'assistant', content: [] },
                    { role: 'user', content: [] },
                ],
            };
            const result = checkNoProgress('test-agent', body);
            expect(result.noProgress).toBe(false);
        });

        it('should handle text-only user messages (no tool_result)', () => {
            const body = {
                messages: [
                    { role: 'assistant', content: 'What would you like?' },
                    { role: 'user', content: 'Fix the bug in auth.ts' },
                ],
            };
            const result = checkNoProgress('test-agent', body);
            expect(result.noProgress).toBe(false);
        });

        it('should isolate different identifiers', () => {
            const makeBody = () => buildHistory(
                [{ role: 'assistant', content: [{ type: 'tool_use', id: 's', name: 'Read', input: { path: '/x.ts' } }] }],
                [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 's', content: 'Error', is_error: true }] }],
            );

            // Exhaust patience for agent-1
            for (let i = 0; i < 8; i++) checkNoProgress('agent-1', makeBody());
            const r1 = checkNoProgress('agent-1', makeBody());
            expect(r1.noProgress).toBe(true);

            // agent-2 should be unaffected
            const r2 = checkNoProgress('agent-2', makeBody());
            expect(r2.noProgress).toBe(false);
        });
    });

    // ─── Backward Compatibility ──────────────────────────

    describe('backward compatibility', () => {
        it('should still warn after repeated identical tool errors (legacy pattern)', () => {
            const makeBody = () => ({
                messages: [{
                    role: 'user',
                    content: [{ type: 'tool_result', is_error: true, content: 'Error: file not found' }],
                }],
            });

            // Need enough turns with zero progress to hit NP_WARN_AT
            // First call always has progress (new to the window)
            checkNoProgress('test-agent', makeBody());
            checkNoProgress('test-agent', makeBody());
            checkNoProgress('test-agent', makeBody());
            const result = checkNoProgress('test-agent', makeBody());
            expect(result.warning).toBeDefined();
        });

        it('should still block after many identical tool errors (legacy pattern)', () => {
            const makeBody = () => ({
                messages: [{
                    role: 'user',
                    content: [{ type: 'tool_result', is_error: true, content: 'Error: permission denied' }],
                }],
            });

            for (let i = 0; i < 6; i++) checkNoProgress('test-agent', makeBody());
            const result = checkNoProgress('test-agent', makeBody());
            expect(result.noProgress).toBe(true);
        });

        it('should reset count when error changes (legacy pattern)', () => {
            const body1 = { messages: [{ role: 'user', content: [{ type: 'tool_result', is_error: true, content: 'Error A' }] }] };
            const body2 = { messages: [{ role: 'user', content: [{ type: 'tool_result', is_error: true, content: 'Error B' }] }] };

            checkNoProgress('test-agent', body1);
            checkNoProgress('test-agent', body1);
            checkNoProgress('test-agent', body1);
            // Error changes — error_evolved signal = progress
            const result = checkNoProgress('test-agent', body2);
            expect(result.noProgress).toBe(false);
            expect(result.warning).toBeUndefined();
        });
    });

    // ─── Stats ───────────────────────────────────────────

    describe('getNoProgressStats', () => {
        it('should return stats', () => {
            const stats = getNoProgressStats();
            expect(typeof stats.totalFailures).toBe('number');
            expect(typeof stats.activeIdentifiers).toBe('number');
        });

        it('should track total failures across identifiers', () => {
            const errorBody = buildHistory(
                anthropicTurn('Read', { path: '/x.ts' }, 'Error', true),
            );
            checkNoProgress('agent-a', errorBody);
            checkNoProgress('agent-b', errorBody);
            const stats = getNoProgressStats();
            expect(stats.totalFailures).toBeGreaterThanOrEqual(2);
            expect(stats.activeIdentifiers).toBeGreaterThanOrEqual(2);
        });
    });
});
