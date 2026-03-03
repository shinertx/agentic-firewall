import { describe, it, expect, beforeEach } from 'vitest';
import { getUserId, checkBudget, recordUserSpend, getOrCreateUser, getAggregateStats, exportUserData, importUserData } from '../src/budgetGovernor';

describe('Budget Governor', () => {
    // Each test uses a unique fake key to avoid cross-contamination

    describe('getUserId', () => {
        it('should return a 12-char hex hash for valid identifiers', () => {
            const id = getUserId('sk-proj-testkey123456');
            expect(id).toHaveLength(12);
            expect(id).toMatch(/^[a-f0-9]+$/);
        });

        it('should return the same ID for the same input', () => {
            const a = getUserId('my-machine-id');
            const b = getUserId('my-machine-id');
            expect(a).toBe(b);
        });

        it('should return "anonymous" for short/missing identifiers', () => {
            expect(getUserId('')).toBe('anonymous');
            expect(getUserId('ab')).toBe('anonymous');
        });

        it('should return different IDs for different inputs', () => {
            const a = getUserId('machine-one');
            const b = getUserId('machine-two');
            expect(a).not.toBe(b);
        });
    });

    describe('checkBudget', () => {
        it('should allow when no budget limit is set', () => {
            const result = checkBudget('test-no-limit', null);
            expect(result.allowed).toBe(true);
        });

        it('should allow when spend is under limit', () => {
            const userId = 'test-under-limit';
            getOrCreateUser(userId);
            const result = checkBudget(userId, 10.0);
            expect(result.allowed).toBe(true);
        });

        it('should block when spend exceeds limit', () => {
            const userId = 'test-over-limit';
            const user = getOrCreateUser(userId);
            user.totalSpend = 15.0;
            const result = checkBudget(userId, 10.0);
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Budget exceeded');
            expect(result.spent).toBe(15.0);
            expect(result.limit).toBe(10.0);
        });
    });

    describe('recordUserSpend', () => {
        it('should increment user stats', () => {
            const userId = 'test-spend-track';
            recordUserSpend(userId, 'gpt-4o', 100_000, false);
            const user = getOrCreateUser(userId);
            expect(user.totalRequests).toBe(1);
            expect(user.totalTokens).toBe(100_000);
            expect(user.totalSpend).toBeGreaterThan(0);
        });

        it('should track savings for CDN hits', () => {
            const userId = 'test-cdn-savings';
            recordUserSpend(userId, 'gpt-4o', 100_000, true);
            const user = getOrCreateUser(userId);
            expect(user.savedMoney).toBeGreaterThan(0);
            expect(user.savedTokens).toBeGreaterThan(0);
        });
    });

    describe('getAggregateStats', () => {
        it('should return aggregate across all users', () => {
            const agg = getAggregateStats();
            expect(agg.totalUsers).toBeGreaterThan(0);
            expect(typeof agg.totalSaved).toBe('number');
            expect(typeof agg.totalRequests).toBe('number');
        });
    });

    describe('exportUserData / importUserData', () => {
        it('should round-trip user data', () => {
            const userId = 'test-roundtrip';
            recordUserSpend(userId, 'claude-sonnet-4', 50_000, true);
            const exported = exportUserData();
            expect(exported[userId]).toBeDefined();
            expect(exported[userId].totalRequests).toBe(1);

            // Import into fresh state — this adds to existing
            importUserData({ 'imported-user': { ...exported[userId], userId: 'imported-user' } });
            const agg = getAggregateStats();
            expect(agg.totalUsers).toBeGreaterThanOrEqual(2);
        });
    });
});
