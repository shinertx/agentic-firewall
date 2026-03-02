import { describe, it, expect, beforeEach } from 'vitest';
import { checkNoProgress, resetNoProgress, getNoProgressStats } from '../src/noProgress';

describe('No-Progress Detection', () => {
    beforeEach(() => {
        // Reset state between tests
        resetNoProgress('test-agent');
    });

    describe('checkNoProgress', () => {
        it('should return noProgress: false for normal requests', () => {
            const body = {
                messages: [
                    { role: 'user', content: 'Hello' },
                    { role: 'assistant', content: 'Hi there!' },
                ]
            };
            const result = checkNoProgress('test-agent', body);
            expect(result.noProgress).toBe(false);
        });

        it('should return noProgress: false for requests without messages', () => {
            const result = checkNoProgress('test-agent', { model: 'gpt-4o' });
            expect(result.noProgress).toBe(false);
        });

        it('should warn after 3 identical tool errors', () => {
            const makeBody = () => ({
                messages: [
                    {
                        role: 'user',
                        content: [{
                            type: 'tool_result',
                            is_error: true,
                            content: 'Error: file not found /src/missing.ts'
                        }]
                    }
                ]
            });

            checkNoProgress('test-agent', makeBody());
            checkNoProgress('test-agent', makeBody());
            const result = checkNoProgress('test-agent', makeBody());
            expect(result.noProgress).toBe(false);
            expect(result.warning).toContain('same tool error repeated 3 times');
        });

        it('should block after 5 identical tool errors', () => {
            const makeBody = () => ({
                messages: [
                    {
                        role: 'user',
                        content: [{
                            type: 'tool_result',
                            is_error: true,
                            content: 'Error: permission denied /etc/passwd'
                        }]
                    }
                ]
            });

            for (let i = 0; i < 4; i++) checkNoProgress('test-agent', makeBody());
            const result = checkNoProgress('test-agent', makeBody());
            expect(result.noProgress).toBe(true);
            expect(result.reason).toContain('same tool error repeated 5 times');
        });

        it('should reset count when error changes', () => {
            const body1 = {
                messages: [{
                    role: 'user',
                    content: [{ type: 'tool_result', is_error: true, content: 'Error A' }]
                }]
            };
            const body2 = {
                messages: [{
                    role: 'user',
                    content: [{ type: 'tool_result', is_error: true, content: 'Error B' }]
                }]
            };

            checkNoProgress('test-agent', body1);
            checkNoProgress('test-agent', body1);
            const result = checkNoProgress('test-agent', body2);
            // Count should reset — no warning
            expect(result.noProgress).toBe(false);
            expect(result.warning).toBeUndefined();
        });

        it('should detect spinning — 3 identical assistant messages', () => {
            const body = {
                messages: [
                    { role: 'assistant', content: 'I will try again' },
                    { role: 'assistant', content: 'I will try again' },
                    { role: 'assistant', content: 'I will try again' },
                ]
            };
            const result = checkNoProgress('test-agent', body);
            expect(result.noProgress).toBe(true);
            expect(result.reason).toContain('spinning');
        });

        it('should not flag different assistant messages', () => {
            const body = {
                messages: [
                    { role: 'assistant', content: 'Step 1 done' },
                    { role: 'assistant', content: 'Step 2 done' },
                    { role: 'assistant', content: 'Step 3 done' },
                ]
            };
            const result = checkNoProgress('test-agent', body);
            expect(result.noProgress).toBe(false);
        });
    });

    describe('getNoProgressStats', () => {
        it('should return stats', () => {
            const stats = getNoProgressStats();
            expect(typeof stats.totalFailures).toBe('number');
            expect(typeof stats.activeIdentifiers).toBe('number');
        });
    });
});
