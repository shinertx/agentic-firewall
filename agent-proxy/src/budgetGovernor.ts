import crypto from 'crypto';
import { getInputCost } from './pricing';

/**
 * Budget Governor — per-user spend tracking and enforcement.
 *
 * Tracks cumulative spend per API key hash. When a user sends a
 * X-Budget-Limit header (dollar amount), requests are blocked
 * once their tracked spend exceeds the limit.
 *
 * Users are identified by a SHA-256 hash of their API key,
 * so we never store the key itself.
 */

interface UserBudget {
    userId: string;
    totalSpend: number;
    totalTokens: number;
    totalRequests: number;
    savedMoney: number;
    savedTokens: number;
    blockedLoops: number;
    firstSeen: string;
    lastSeen: string;
}

// In-memory per-user tracking — persisted via stats.ts
const userBudgets = new Map<string, UserBudget>();

/**
 * Generate a stable user ID from an API key.
 * Returns first 12 chars of SHA-256 hex hash.
 */
export function getUserId(apiKey: string): string {
    if (!apiKey || apiKey.length < 10) return 'anonymous';
    return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
}

/**
 * Get or create a user budget entry.
 */
export function getOrCreateUser(userId: string): UserBudget {
    if (!userBudgets.has(userId)) {
        userBudgets.set(userId, {
            userId,
            totalSpend: 0,
            totalTokens: 0,
            totalRequests: 0,
            savedMoney: 0,
            savedTokens: 0,
            blockedLoops: 0,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
        });
    }
    return userBudgets.get(userId)!;
}

/**
 * Check if user has exceeded their budget.
 * Returns { allowed: true } or { allowed: false, reason: string, spent: number, limit: number }.
 */
export function checkBudget(userId: string, budgetLimit: number | null): {
    allowed: boolean;
    reason?: string;
    spent?: number;
    limit?: number;
} {
    if (!budgetLimit || budgetLimit <= 0) return { allowed: true };

    const user = getOrCreateUser(userId);
    if (user.totalSpend >= budgetLimit) {
        return {
            allowed: false,
            reason: `Budget exceeded: spent $${user.totalSpend.toFixed(4)} of $${budgetLimit.toFixed(2)} limit. Reset by removing the X-Budget-Limit header or increasing the limit.`,
            spent: user.totalSpend,
            limit: budgetLimit,
        };
    }
    return { allowed: true };
}

/**
 * Record spend for a user.
 */
export function recordUserSpend(userId: string, model: string, estimatedTokens: number, isCDN: boolean) {
    const user = getOrCreateUser(userId);
    const inputCostPerM = getInputCost(model);
    const spend = (estimatedTokens / 1_000_000) * inputCostPerM;

    user.totalSpend += spend;
    user.totalTokens += estimatedTokens;
    user.totalRequests++;
    user.lastSeen = new Date().toISOString();

    if (isCDN) {
        const saved = spend * 0.9; // Cache saves ~90%
        user.savedMoney += saved;
        user.savedTokens += estimatedTokens * 0.9;
    }
}

/**
 * Record a blocked loop for a user.
 */
export function recordUserLoop(userId: string) {
    const user = getOrCreateUser(userId);
    user.blockedLoops++;
}

/**
 * Get per-user stats for the dashboard.
 */
export function getUserStats(userId: string): UserBudget | null {
    return userBudgets.get(userId) || null;
}

/**
 * Get aggregate stats across all users.
 */
export function getAggregateStats() {
    let totalUsers = userBudgets.size;
    let totalSaved = 0;
    let totalSpend = 0;
    let totalRequests = 0;
    let totalBlockedLoops = 0;

    for (const user of userBudgets.values()) {
        totalSaved += user.savedMoney;
        totalSpend += user.totalSpend;
        totalRequests += user.totalRequests;
        totalBlockedLoops += user.blockedLoops;
    }

    return { totalUsers, totalSaved, totalSpend, totalRequests, totalBlockedLoops };
}

/**
 * Export all user data for persistence.
 */
export function exportUserData(): Record<string, UserBudget> {
    const data: Record<string, UserBudget> = {};
    for (const [id, budget] of userBudgets) {
        data[id] = budget;
    }
    return data;
}

/**
 * Import user data from persistence.
 */
export function importUserData(data: Record<string, UserBudget>) {
    for (const [id, budget] of Object.entries(data)) {
        userBudgets.set(id, budget);
    }
}
