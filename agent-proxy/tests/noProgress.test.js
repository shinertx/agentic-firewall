"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const noProgress_1 = require("../src/noProgress");
(0, vitest_1.describe)('No-Progress Detection', () => {
    (0, vitest_1.beforeEach)(() => {
        // Reset state between tests
        (0, noProgress_1.resetNoProgress)('test-agent');
    });
    (0, vitest_1.describe)('checkNoProgress', () => {
        (0, vitest_1.it)('should return noProgress: false for normal requests', () => {
            const body = {
                messages: [
                    { role: 'user', content: 'Hello' },
                    { role: 'assistant', content: 'Hi there!' },
                ]
            };
            const result = (0, noProgress_1.checkNoProgress)('test-agent', body);
            (0, vitest_1.expect)(result.noProgress).toBe(false);
        });
        (0, vitest_1.it)('should return noProgress: false for requests without messages', () => {
            const result = (0, noProgress_1.checkNoProgress)('test-agent', { model: 'gpt-4o' });
            (0, vitest_1.expect)(result.noProgress).toBe(false);
        });
        (0, vitest_1.it)('should warn after 3 identical tool errors', () => {
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
            (0, noProgress_1.checkNoProgress)('test-agent', makeBody());
            (0, noProgress_1.checkNoProgress)('test-agent', makeBody());
            const result = (0, noProgress_1.checkNoProgress)('test-agent', makeBody());
            (0, vitest_1.expect)(result.noProgress).toBe(false);
            (0, vitest_1.expect)(result.warning).toContain('same tool error repeated 3 times');
        });
        (0, vitest_1.it)('should block after 5 identical tool errors', () => {
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
            for (let i = 0; i < 4; i++)
                (0, noProgress_1.checkNoProgress)('test-agent', makeBody());
            const result = (0, noProgress_1.checkNoProgress)('test-agent', makeBody());
            (0, vitest_1.expect)(result.noProgress).toBe(true);
            (0, vitest_1.expect)(result.reason).toContain('same tool error repeated 5 times');
        });
        (0, vitest_1.it)('should reset count when error changes', () => {
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
            (0, noProgress_1.checkNoProgress)('test-agent', body1);
            (0, noProgress_1.checkNoProgress)('test-agent', body1);
            const result = (0, noProgress_1.checkNoProgress)('test-agent', body2);
            // Count should reset — no warning
            (0, vitest_1.expect)(result.noProgress).toBe(false);
            (0, vitest_1.expect)(result.warning).toBeUndefined();
        });
        (0, vitest_1.it)('should detect spinning — 3 identical assistant messages', () => {
            const body = {
                messages: [
                    { role: 'assistant', content: 'I will try again' },
                    { role: 'assistant', content: 'I will try again' },
                    { role: 'assistant', content: 'I will try again' },
                ]
            };
            const result = (0, noProgress_1.checkNoProgress)('test-agent', body);
            (0, vitest_1.expect)(result.noProgress).toBe(true);
            (0, vitest_1.expect)(result.reason).toContain('spinning');
        });
        (0, vitest_1.it)('should not flag different assistant messages', () => {
            const body = {
                messages: [
                    { role: 'assistant', content: 'Step 1 done' },
                    { role: 'assistant', content: 'Step 2 done' },
                    { role: 'assistant', content: 'Step 3 done' },
                ]
            };
            const result = (0, noProgress_1.checkNoProgress)('test-agent', body);
            (0, vitest_1.expect)(result.noProgress).toBe(false);
        });
    });
    (0, vitest_1.describe)('getNoProgressStats', () => {
        (0, vitest_1.it)('should return stats', () => {
            const stats = (0, noProgress_1.getNoProgressStats)();
            (0, vitest_1.expect)(typeof stats.totalFailures).toBe('number');
            (0, vitest_1.expect)(typeof stats.activeIdentifiers).toBe('number');
        });
    });
});
