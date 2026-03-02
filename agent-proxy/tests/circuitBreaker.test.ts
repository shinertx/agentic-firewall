import { describe, it, expect } from 'vitest';
import { checkCircuitBreaker } from '../src/circuitBreaker';

describe('Circuit Breaker (Loop Detection)', () => {

    it('should not block on the first or second request', () => {
        const body = { model: 'test-model', messages: [{ role: 'user', content: 'cb_test_1' }] };
        expect(checkCircuitBreaker('10.0.0.1', body).blocked).toBe(false);
        expect(checkCircuitBreaker('10.0.0.1', body).blocked).toBe(false);
    });

    it('should block on the third identical request in a row', () => {
        const body = { model: 'claude-sonnet', messages: [{ role: 'user', content: 'stuck_in_loop_v2' }] };
        expect(checkCircuitBreaker('10.0.0.2', body).blocked).toBe(false);
        expect(checkCircuitBreaker('10.0.0.2', body).blocked).toBe(false);

        const result = checkCircuitBreaker('10.0.0.2', body);
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('Loop detected');
    });

    it('should not block if the user message changes', () => {
        expect(checkCircuitBreaker('10.0.0.3', { model: 'm', messages: [{ role: 'user', content: 'diff_1' }] }).blocked).toBe(false);
        expect(checkCircuitBreaker('10.0.0.3', { model: 'm', messages: [{ role: 'user', content: 'diff_2' }] }).blocked).toBe(false);
        expect(checkCircuitBreaker('10.0.0.3', { model: 'm', messages: [{ role: 'user', content: 'diff_3' }] }).blocked).toBe(false);
    });

    it('should not block if the model changes (even with same message)', () => {
        const msg = [{ role: 'user', content: 'same_msg_diff_model' }];
        expect(checkCircuitBreaker('10.0.0.4', { model: 'gpt-4o', messages: msg }).blocked).toBe(false);
        expect(checkCircuitBreaker('10.0.0.4', { model: 'gpt-4o-mini', messages: msg }).blocked).toBe(false);
        expect(checkCircuitBreaker('10.0.0.4', { model: 'claude-sonnet', messages: msg }).blocked).toBe(false);
    });

    it('should key on API-key instead of IP when provided', () => {
        const body = { model: 'test', messages: [{ role: 'user', content: 'api_key_test' }] };
        const apiKey = 'sk-test-key-123';
        expect(checkCircuitBreaker('10.0.0.5', body, apiKey).blocked).toBe(false);
        expect(checkCircuitBreaker('10.0.0.5', body, apiKey).blocked).toBe(false);

        const result = checkCircuitBreaker('10.0.0.5', body, apiKey);
        expect(result.blocked).toBe(true);
    });

    it('should safely ignore empty or malformed requests', () => {
        expect(checkCircuitBreaker('10.0.0.6', {}).blocked).toBe(false);
        expect(checkCircuitBreaker('10.0.0.6', { messages: [] }).blocked).toBe(false);
        expect(checkCircuitBreaker('10.0.0.6', null).blocked).toBe(false);
    });
});
