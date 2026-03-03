import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/pricing', () => ({
    getInputCost: vi.fn().mockReturnValue(3.0),
}));

import {
    resolveSessionId,
    getOrCreateSession,
    recordSessionSpend,
    recordSessionLoop,
    reconcileSessionSpend,
    getUserSessions,
    getAllSessions,
    expireStaleSessions,
    exportSessionData,
    importSessionData,
} from '../src/sessionTracker';

const mockReq = (headers: Record<string, string>, body?: any) => ({
    headers,
    ip: '127.0.0.1',
    body,
} as any);

describe('Session Tracker', () => {
    // Since there is no exported clearSessions, we use unique session IDs
    // per test to avoid cross-contamination.

    describe('resolveSessionId', () => {
        it('should return X-Session-ID header value if present', () => {
            const req = mockReq({ 'x-session-id': 'my-explicit-session' });
            expect(resolveSessionId(req)).toBe('my-explicit-session');
        });

        it('should generate a deterministic ID without header (same body -> same ID)', () => {
            const body = { model: 'claude-sonnet-4', messages: [{ role: 'user', content: 'hello' }] };
            const req1 = mockReq({}, body);
            const req2 = mockReq({}, body);

            const id1 = resolveSessionId(req1);
            const id2 = resolveSessionId(req2);

            expect(id1).toBe(id2);
            expect(id1).toHaveLength(16);
            expect(id1).toMatch(/^[a-f0-9]+$/);
        });

        it('should generate different IDs for different bodies', () => {
            const req1 = mockReq({}, { model: 'gpt-4o', messages: [] });
            const req2 = mockReq({}, { model: 'claude-sonnet-4', messages: [] });

            expect(resolveSessionId(req1)).not.toBe(resolveSessionId(req2));
        });
    });

    describe('getOrCreateSession', () => {
        it('should create a new session with correct defaults', () => {
            const session = getOrCreateSession('test-new-session-1', 'user-1');

            expect(session.sessionId).toBe('test-new-session-1');
            expect(session.userId).toBe('user-1');
            expect(session.totalSpend).toBe(0);
            expect(session.totalTokens).toBe(0);
            expect(session.totalRequests).toBe(0);
            expect(session.savedMoney).toBe(0);
            expect(session.savedTokens).toBe(0);
            expect(session.blockedLoops).toBe(0);
            expect(session.models).toEqual({});
            expect(session.status).toBe('active');
            expect(session.createdAt).toBeDefined();
            expect(session.lastActivityAt).toBeDefined();
        });

        it('should return existing session and update lastActivityAt', async () => {
            const session1 = getOrCreateSession('test-existing-session-2', 'user-2');
            const originalActivity = session1.lastActivityAt;

            // Small delay to ensure timestamp differs
            await new Promise((r) => setTimeout(r, 15));

            const session2 = getOrCreateSession('test-existing-session-2', 'user-2');

            expect(session2).toBe(session1); // Same object reference
            expect(session2.lastActivityAt).not.toBe(originalActivity);
            expect(session2.status).toBe('active');
        });
    });

    describe('recordSessionSpend', () => {
        it('should increment totalSpend and totalTokens', () => {
            const sessionId = 'test-spend-session-3';
            getOrCreateSession(sessionId, 'user-3');

            recordSessionSpend(sessionId, 'claude-sonnet-4', 1000, false);

            const session = getOrCreateSession(sessionId, 'user-3');
            expect(session.totalTokens).toBe(1000);
            expect(session.totalRequests).toBe(1);
            expect(session.totalSpend).toBeGreaterThan(0);
            expect(session.models['claude-sonnet-4']).toBe(1);
        });

        it('should track savings when isCDN is true', () => {
            const sessionId = 'test-cdn-session-4';
            getOrCreateSession(sessionId, 'user-4');

            recordSessionSpend(sessionId, 'claude-sonnet-4', 1000, true);

            const session = getOrCreateSession(sessionId, 'user-4');
            expect(session.savedMoney).toBeGreaterThan(0);
            expect(session.savedTokens).toBeGreaterThan(0);
        });
    });

    describe('recordSessionLoop', () => {
        it('should increment blockedLoops', () => {
            const sessionId = 'test-loop-session-5';
            getOrCreateSession(sessionId, 'user-5');

            recordSessionLoop(sessionId);
            recordSessionLoop(sessionId);

            const session = getOrCreateSession(sessionId, 'user-5');
            expect(session.blockedLoops).toBe(2);
        });
    });

    describe('reconcileSessionSpend', () => {
        it('should adjust spend by delta between real and estimated tokens', () => {
            const sessionId = 'test-reconcile-session-6';
            getOrCreateSession(sessionId, 'user-6');

            // First record an estimated spend
            recordSessionSpend(sessionId, 'claude-sonnet-4', 1000, false);
            const session = getOrCreateSession(sessionId, 'user-6');
            const spendBefore = session.totalSpend;
            const tokensBefore = session.totalTokens;

            // Reconcile: real usage was 800 input + 300 output = 1100 total, estimated was 1000
            reconcileSessionSpend(sessionId, 'claude-sonnet-4', 1000, 800, 300, false);

            expect(session.totalTokens).toBe(tokensBefore + 100); // delta = 1100 - 1000 = 100
            expect(session.totalSpend).toBeGreaterThan(spendBefore);
        });
    });

    describe('getUserSessions', () => {
        it('should filter sessions by userId', () => {
            getOrCreateSession('test-user-filter-7a', 'user-7');
            getOrCreateSession('test-user-filter-7b', 'user-7');
            getOrCreateSession('test-user-filter-7c', 'user-other');

            const sessions = getUserSessions('user-7');
            expect(sessions.length).toBeGreaterThanOrEqual(2);
            sessions.forEach((s) => expect(s.userId).toBe('user-7'));
        });
    });

    describe('getAllSessions', () => {
        it('should return all sessions', () => {
            // We've created several sessions in earlier tests, so there should be some
            const all = getAllSessions();
            expect(Array.isArray(all)).toBe(true);
            expect(all.length).toBeGreaterThan(0);
        });
    });

    describe('expireStaleSessions', () => {
        it('should mark inactive sessions as expired', () => {
            const sessionId = 'test-expire-session-8';
            const session = getOrCreateSession(sessionId, 'user-8');

            // Manually set lastActivityAt to 31 minutes ago to exceed TTL
            const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
            session.lastActivityAt = staleTime;

            const expiredCount = expireStaleSessions();

            expect(expiredCount).toBeGreaterThanOrEqual(1);
            expect(session.status).toBe('expired');
        });
    });

    describe('exportSessionData / importSessionData', () => {
        it('should round-trip session data', () => {
            const sessionId = 'test-roundtrip-session-9';
            getOrCreateSession(sessionId, 'user-9');
            recordSessionSpend(sessionId, 'claude-sonnet-4', 500, false);

            const exported = exportSessionData();
            expect(exported[sessionId]).toBeDefined();
            expect(exported[sessionId].totalRequests).toBe(1);
            expect(exported[sessionId].totalTokens).toBe(500);

            // Import a cloned session under a new key
            const cloned = { ...exported[sessionId], sessionId: 'imported-session-9' };
            importSessionData({ 'imported-session-9': cloned });

            const all = getAllSessions();
            const imported = all.find((s) => s.sessionId === 'imported-session-9');
            expect(imported).toBeDefined();
            expect(imported!.totalTokens).toBe(500);
        });
    });
});
