"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const circuitBreaker_1 = require("../src/circuitBreaker");
(0, vitest_1.describe)('Circuit Breaker (Loop Detection)', () => {
    (0, vitest_1.it)('should not block on the first or second request', () => {
        const body = { model: 'test-model', messages: [{ role: 'user', content: 'cb_test_1' }] };
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.1', body).blocked).toBe(false);
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.1', body).blocked).toBe(false);
    });
    (0, vitest_1.it)('should block on the third identical request in a row', () => {
        const body = { model: 'claude-sonnet', messages: [{ role: 'user', content: 'stuck_in_loop_v2' }] };
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.2', body).blocked).toBe(false);
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.2', body).blocked).toBe(false);
        const result = (0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.2', body);
        (0, vitest_1.expect)(result.blocked).toBe(true);
        (0, vitest_1.expect)(result.reason).toContain('Loop detected');
    });
    (0, vitest_1.it)('should not block if the user message changes', () => {
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.3', { model: 'm', messages: [{ role: 'user', content: 'diff_1' }] }).blocked).toBe(false);
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.3', { model: 'm', messages: [{ role: 'user', content: 'diff_2' }] }).blocked).toBe(false);
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.3', { model: 'm', messages: [{ role: 'user', content: 'diff_3' }] }).blocked).toBe(false);
    });
    (0, vitest_1.it)('should not block if the model changes (even with same message)', () => {
        const msg = [{ role: 'user', content: 'same_msg_diff_model' }];
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.4', { model: 'gpt-4o', messages: msg }).blocked).toBe(false);
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.4', { model: 'gpt-4o-mini', messages: msg }).blocked).toBe(false);
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.4', { model: 'claude-sonnet', messages: msg }).blocked).toBe(false);
    });
    (0, vitest_1.it)('should key on API-key instead of IP when provided', () => {
        const body = { model: 'test', messages: [{ role: 'user', content: 'api_key_test' }] };
        const apiKey = 'sk-test-key-123';
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.5', body, apiKey).blocked).toBe(false);
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.5', body, apiKey).blocked).toBe(false);
        const result = (0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.5', body, apiKey);
        (0, vitest_1.expect)(result.blocked).toBe(true);
    });
    (0, vitest_1.it)('should safely ignore empty or malformed requests', () => {
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.6', {}).blocked).toBe(false);
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.6', { messages: [] }).blocked).toBe(false);
        (0, vitest_1.expect)((0, circuitBreaker_1.checkCircuitBreaker)('10.0.0.6', null).blocked).toBe(false);
    });
});
