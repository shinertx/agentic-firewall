import { describe, it, expect } from 'vitest';
import { checkCircuitBreaker } from '../src/circuitBreaker';

describe('Circuit Breaker (Loop Detection)', () => {

    it('should not block on the first, second, or third request', () => {
        const body = { model: 'test-model', messages: [{ role: 'user', content: 'cb_test_1' }] };
        const r1 = checkCircuitBreaker('10.0.0.1', body);
        expect(r1.blocked).toBe(false);
        expect(r1.hash).toBeTruthy();
        expect(r1.identicalCount).toBe(1);

        const r2 = checkCircuitBreaker('10.0.0.1', body);
        expect(r2.blocked).toBe(false);
        expect(r2.hash).toBe(r1.hash);
        expect(r2.identicalCount).toBe(2);

        const r3 = checkCircuitBreaker('10.0.0.1', body);
        expect(r3.blocked).toBe(false);
        expect(r3.identicalCount).toBe(3);
    });

    it('should block on the fourth identical request in a row', () => {
        const body = { model: 'claude-sonnet', messages: [{ role: 'user', content: 'stuck_in_loop_v2' }] };
        expect(checkCircuitBreaker('10.0.0.2', body).blocked).toBe(false);
        expect(checkCircuitBreaker('10.0.0.2', body).blocked).toBe(false);
        expect(checkCircuitBreaker('10.0.0.2', body).blocked).toBe(false);

        const result = checkCircuitBreaker('10.0.0.2', body);
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('Loop detected');
        expect(result.hash).toBeTruthy();
        expect(result.identicalCount).toBe(4);
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
        expect(checkCircuitBreaker('10.0.0.5', body, apiKey).blocked).toBe(false);

        const result = checkCircuitBreaker('10.0.0.5', body, apiKey);
        expect(result.blocked).toBe(true);
    });

    it('should safely ignore empty or malformed requests', () => {
        const r1 = checkCircuitBreaker('10.0.0.6', {});
        expect(r1.blocked).toBe(false);
        expect(r1.hash).toBe('');
        expect(r1.identicalCount).toBe(0);

        // { messages: [] } passes the guard ([] is truthy and Array.isArray), so it hashes normally
        const r2 = checkCircuitBreaker('10.0.0.6', { messages: [] });
        expect(r2.blocked).toBe(false);
        expect(r2.hash).toBeTruthy();
        expect(r2.identicalCount).toBe(1);

        const r3 = checkCircuitBreaker('10.0.0.6', null);
        expect(r3.blocked).toBe(false);
        expect(r3.hash).toBe('');
        expect(r3.identicalCount).toBe(0);
    });

    it('should key on sessionId when provided, ignoring IP and apiKey', () => {
        const body = { model: 'test', messages: [{ role: 'user', content: 'session_id_test' }] };
        const sessionId = 'session-abc-123';
        // Use different IPs and apiKeys but same sessionId — should still accumulate
        expect(checkCircuitBreaker('10.0.0.7', body, 'sk-key-a', sessionId).blocked).toBe(false);
        expect(checkCircuitBreaker('10.0.0.8', body, 'sk-key-b', sessionId).blocked).toBe(false);
        expect(checkCircuitBreaker('10.0.0.9', body, 'sk-key-c', sessionId).blocked).toBe(false);

        const result = checkCircuitBreaker('10.0.0.10', body, 'sk-key-d', sessionId);
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('Loop detected');
    });

    it('should increment identicalCount correctly across calls', () => {
        const body = { model: 'counter-model', messages: [{ role: 'user', content: 'count_test' }] };
        const r1 = checkCircuitBreaker('10.0.0.11', body);
        expect(r1.identicalCount).toBe(1);

        const r2 = checkCircuitBreaker('10.0.0.11', body);
        expect(r2.identicalCount).toBe(2);

        const r3 = checkCircuitBreaker('10.0.0.11', body);
        expect(r3.identicalCount).toBe(3);

        // 4th call triggers the block, identicalCount should be 4
        const r4 = checkCircuitBreaker('10.0.0.11', body);
        expect(r4.identicalCount).toBe(4);
        expect(r4.blocked).toBe(true);
    });
});
