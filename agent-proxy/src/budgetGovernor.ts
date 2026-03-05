import crypto from 'crypto';
import { getInputCost } from './pricing';
import { isRedisAvailable, getRedisClient } from './redis';

/**
 * Budget Governor — per-user spend tracking and enforcement.
 *
 * In local-first mode, users are identified by a machine-based ID
 * (from keyVault.getLocalUserId) rather than an API key hash.
 *
 * When a user sends an X-Budget-Limit header (dollar amount),
 * requests are blocked once their tracked spend exceeds the limit.
 */

export interface UserBudget {
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

// Redis key patterns
const REDIS_USER_PREFIX = 'firewall:user:';
const REDIS_USER_IDS_KEY = 'firewall:user_ids';

// In-memory per-user tracking — synced to Redis when available
const userBudgets = new Map<string, UserBudget>();

/**
 * Generate a stable user ID from a string identifier.
 * In local-first mode, the caller passes the machine-based ID from keyVault.
 * Kept for backward compatibility with tests and any code that needs hashing.
 * Returns first 12 chars of SHA-256 hex hash.
 */
export function getUserId(identifier: string): string {
    if (!identifier || identifier.length < 3) return 'anonymous';
    return crypto.createHash('sha256').update(identifier).digest('hex').slice(0, 12);
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

    syncUserToRedis(userId, user);
}

/**
 * Record a blocked loop for a user.
 */
export function recordUserLoop(userId: string) {
    const user = getOrCreateUser(userId);
    user.blockedLoops++;
    syncUserToRedis(userId, user);
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
 * Reconcile user spend when real usage data arrives from the provider.
 * Adjusts the spend recorded by the heuristic estimate.
 */
export function reconcileUserSpend(
    userId: string,
    model: string,
    estimatedTokens: number,
    realInputTokens: number,
    realOutputTokens: number,
    isCDN: boolean
): void {
    const user = getOrCreateUser(userId);
    const inputCostPerM = getInputCost(model);

    const estimatedSpend = (estimatedTokens / 1_000_000) * inputCostPerM;
    const realSpend = (realInputTokens / 1_000_000) * inputCostPerM;
    const delta = realSpend - estimatedSpend;

    user.totalSpend += delta;
    user.totalTokens += (realInputTokens - estimatedTokens);

    if (isCDN) {
        const estimatedSaved = estimatedSpend * 0.9;
        const realSaved = realSpend * 0.9;
        user.savedMoney += (realSaved - estimatedSaved);
        user.savedTokens += (realInputTokens * 0.9) - (estimatedTokens * 0.9);
    }

    syncUserToRedis(userId, user);
}

// ─── Redis sync helpers ──────────────────────────────────

/** Sync a single user record to Redis (non-blocking, best-effort). */
function syncUserToRedis(userId: string, user: UserBudget): void {
    const redis = getRedisClient();
    if (!redis) return;
    redis.hset(REDIS_USER_PREFIX + userId, {
        userId: user.userId,
        totalSpend: user.totalSpend.toString(),
        totalTokens: user.totalTokens.toString(),
        totalRequests: user.totalRequests.toString(),
        savedMoney: user.savedMoney.toString(),
        savedTokens: user.savedTokens.toString(),
        blockedLoops: user.blockedLoops.toString(),
        firstSeen: user.firstSeen,
        lastSeen: user.lastSeen,
    }).then(() => redis.sadd(REDIS_USER_IDS_KEY, userId)).catch(() => {});
}

/** Load all user data from Redis into memory. */
export async function loadUsersFromRedis(): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;
    try {
        const userIds = await redis.smembers(REDIS_USER_IDS_KEY);
        if (!userIds.length) return false;
        let loaded = 0;
        for (const id of userIds) {
            const data = await redis.hgetall(REDIS_USER_PREFIX + id);
            if (data && data.userId) {
                userBudgets.set(id, {
                    userId: data.userId,
                    totalSpend: parseFloat(data.totalSpend) || 0,
                    totalTokens: parseFloat(data.totalTokens) || 0,
                    totalRequests: parseInt(data.totalRequests) || 0,
                    savedMoney: parseFloat(data.savedMoney) || 0,
                    savedTokens: parseFloat(data.savedTokens) || 0,
                    blockedLoops: parseInt(data.blockedLoops) || 0,
                    firstSeen: data.firstSeen || new Date().toISOString(),
                    lastSeen: data.lastSeen || new Date().toISOString(),
                });
                loaded++;
            }
        }
        if (loaded > 0) {
            console.log(`[USERS] Loaded ${loaded} users from Redis`);
        }
        return loaded > 0;
    } catch (err) {
        console.error('[USERS] Failed to load from Redis:', err);
        return false;
    }
}

/** Bulk sync all users to Redis. */
export async function saveUsersToRedis(): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;
    try {
        const pipeline = redis.pipeline();
        for (const [id, user] of userBudgets) {
            pipeline.hset(REDIS_USER_PREFIX + id, {
                userId: user.userId,
                totalSpend: user.totalSpend.toString(),
                totalTokens: user.totalTokens.toString(),
                totalRequests: user.totalRequests.toString(),
                savedMoney: user.savedMoney.toString(),
                savedTokens: user.savedTokens.toString(),
                blockedLoops: user.blockedLoops.toString(),
                firstSeen: user.firstSeen,
                lastSeen: user.lastSeen,
            });
            pipeline.sadd(REDIS_USER_IDS_KEY, id);
        }
        await pipeline.exec();
    } catch (err) {
        console.error('[USERS] Failed to save to Redis:', err);
    }
}

// ─── Persistence (export/import pattern — file fallback) ──

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
