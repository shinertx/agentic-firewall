"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const budgetGovernor_1 = require("../src/budgetGovernor");
(0, vitest_1.describe)('Budget Governor', () => {
    // Each test uses a unique fake key to avoid cross-contamination
    (0, vitest_1.describe)('getUserId', () => {
        (0, vitest_1.it)('should return a 12-char hex hash for valid API keys', () => {
            const id = (0, budgetGovernor_1.getUserId)('sk-proj-testkey123456');
            (0, vitest_1.expect)(id).toHaveLength(12);
            (0, vitest_1.expect)(id).toMatch(/^[a-f0-9]+$/);
        });
        (0, vitest_1.it)('should return the same ID for the same key', () => {
            const a = (0, budgetGovernor_1.getUserId)('sk-proj-stablekey999');
            const b = (0, budgetGovernor_1.getUserId)('sk-proj-stablekey999');
            (0, vitest_1.expect)(a).toBe(b);
        });
        (0, vitest_1.it)('should return "anonymous" for short/missing keys', () => {
            (0, vitest_1.expect)((0, budgetGovernor_1.getUserId)('')).toBe('anonymous');
            (0, vitest_1.expect)((0, budgetGovernor_1.getUserId)('short')).toBe('anonymous');
        });
        (0, vitest_1.it)('should return different IDs for different keys', () => {
            const a = (0, budgetGovernor_1.getUserId)('sk-proj-firstkey12345');
            const b = (0, budgetGovernor_1.getUserId)('sk-proj-secondkey6789');
            (0, vitest_1.expect)(a).not.toBe(b);
        });
    });
    (0, vitest_1.describe)('checkBudget', () => {
        (0, vitest_1.it)('should allow when no budget limit is set', () => {
            const result = (0, budgetGovernor_1.checkBudget)('test-no-limit', null);
            (0, vitest_1.expect)(result.allowed).toBe(true);
        });
        (0, vitest_1.it)('should allow when spend is under limit', () => {
            const userId = 'test-under-limit';
            (0, budgetGovernor_1.getOrCreateUser)(userId);
            const result = (0, budgetGovernor_1.checkBudget)(userId, 10.0);
            (0, vitest_1.expect)(result.allowed).toBe(true);
        });
        (0, vitest_1.it)('should block when spend exceeds limit', () => {
            const userId = 'test-over-limit';
            const user = (0, budgetGovernor_1.getOrCreateUser)(userId);
            user.totalSpend = 15.0;
            const result = (0, budgetGovernor_1.checkBudget)(userId, 10.0);
            (0, vitest_1.expect)(result.allowed).toBe(false);
            (0, vitest_1.expect)(result.reason).toContain('Budget exceeded');
            (0, vitest_1.expect)(result.spent).toBe(15.0);
            (0, vitest_1.expect)(result.limit).toBe(10.0);
        });
    });
    (0, vitest_1.describe)('recordUserSpend', () => {
        (0, vitest_1.it)('should increment user stats', () => {
            const userId = 'test-spend-track';
            (0, budgetGovernor_1.recordUserSpend)(userId, 'gpt-4o', 100_000, false);
            const user = (0, budgetGovernor_1.getOrCreateUser)(userId);
            (0, vitest_1.expect)(user.totalRequests).toBe(1);
            (0, vitest_1.expect)(user.totalTokens).toBe(100_000);
            (0, vitest_1.expect)(user.totalSpend).toBeGreaterThan(0);
        });
        (0, vitest_1.it)('should track savings for CDN hits', () => {
            const userId = 'test-cdn-savings';
            (0, budgetGovernor_1.recordUserSpend)(userId, 'gpt-4o', 100_000, true);
            const user = (0, budgetGovernor_1.getOrCreateUser)(userId);
            (0, vitest_1.expect)(user.savedMoney).toBeGreaterThan(0);
            (0, vitest_1.expect)(user.savedTokens).toBeGreaterThan(0);
        });
    });
    (0, vitest_1.describe)('getAggregateStats', () => {
        (0, vitest_1.it)('should return aggregate across all users', () => {
            const agg = (0, budgetGovernor_1.getAggregateStats)();
            (0, vitest_1.expect)(agg.totalUsers).toBeGreaterThan(0);
            (0, vitest_1.expect)(typeof agg.totalSaved).toBe('number');
            (0, vitest_1.expect)(typeof agg.totalRequests).toBe('number');
        });
    });
    (0, vitest_1.describe)('exportUserData / importUserData', () => {
        (0, vitest_1.it)('should round-trip user data', () => {
            const userId = 'test-roundtrip';
            (0, budgetGovernor_1.recordUserSpend)(userId, 'claude-sonnet-4', 50_000, true);
            const exported = (0, budgetGovernor_1.exportUserData)();
            (0, vitest_1.expect)(exported[userId]).toBeDefined();
            (0, vitest_1.expect)(exported[userId].totalRequests).toBe(1);
            // Import into fresh state — this adds to existing
            (0, budgetGovernor_1.importUserData)({ 'imported-user': { ...exported[userId], userId: 'imported-user' } });
            const agg = (0, budgetGovernor_1.getAggregateStats)();
            (0, vitest_1.expect)(agg.totalUsers).toBeGreaterThanOrEqual(2);
        });
    });
});
