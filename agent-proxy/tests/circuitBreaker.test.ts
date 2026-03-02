import { describe, it, expect } from 'vitest';
import { checkCircuitBreaker } from '../src/circuitBreaker';

describe('Circuit Breaker (Loop Detection)', () => {

    const ip = '192.168.1.1';

    it('should not block on the first or second request', () => {
        const body = { messages: [{ role: 'user', content: 'hello' }] };
        expect(checkCircuitBreaker(ip, body).blocked).toBe(false);
        expect(checkCircuitBreaker(ip, body).blocked).toBe(false);
    });

    it('should block on the third identical request in a row', () => {
        const body = { messages: [{ role: 'user', content: 'stuck_in_loop' }] };
        expect(checkCircuitBreaker(ip, body).blocked).toBe(false);
        expect(checkCircuitBreaker(ip, body).blocked).toBe(false);

        const result = checkCircuitBreaker(ip, body);
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('Loop detected');
    });

    it('should not block if the user message changes', () => {
        expect(checkCircuitBreaker(ip, { messages: [{ role: 'user', content: 'attempt 1' }] }).blocked).toBe(false);
        expect(checkCircuitBreaker(ip, { messages: [{ role: 'user', content: 'attempt 2' }] }).blocked).toBe(false);
        expect(checkCircuitBreaker(ip, { messages: [{ role: 'user', content: 'attempt 3' }] }).blocked).toBe(false);
    });

    it('should safely ignore empty or malformed requests', () => {
        expect(checkCircuitBreaker(ip, {}).blocked).toBe(false);
        expect(checkCircuitBreaker(ip, { messages: [] }).blocked).toBe(false);
        expect(checkCircuitBreaker(ip, null).blocked).toBe(false);
    });
});
