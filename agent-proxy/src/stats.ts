import fs from 'fs';
import path from 'path';
import { isRedisAvailable, getRedisClient } from './redis';

// File-based persistence fallback (local dev or Redis unavailable)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

const REDIS_STATS_KEY = 'firewall:stats';
const REDIS_ACTIVITY_KEY = 'firewall:activity';

// Persisted fields — recentActivity stays in-memory only (transient)
interface PersistedStats {
    savedTokens: number;
    savedMoney: number;
    blockedLoops: number;
    totalRequests: number;
    smartRouteDowngrades: number;
    smartRouteSavings: number;
    compressedTokensSaved: number;
    compressionCalls: number;
    crossProviderFailovers: number;
    crossProviderSavings: number;
    totalTtftMs: number;
    totalResponseMs: number;
    timedRequests: number;
}

function loadStats(): PersistedStats {
    try {
        if (fs.existsSync(STATS_FILE)) {
            const raw = fs.readFileSync(STATS_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            console.log(`[STATS] Loaded persisted stats: ${parsed.totalRequests} requests, $${parsed.savedMoney.toFixed(4)} saved`);
            return parsed;
        }
    } catch (err) {
        console.error('[STATS] Failed to load stats.json, starting fresh:', err);
    }
    return { savedTokens: 0, savedMoney: 0, blockedLoops: 0, totalRequests: 0, smartRouteDowngrades: 0, smartRouteSavings: 0, compressedTokensSaved: 0, compressionCalls: 0, crossProviderFailovers: 0, crossProviderSavings: 0, totalTtftMs: 0, totalResponseMs: 0, timedRequests: 0 };
}

async function loadStatsFromRedis(): Promise<PersistedStats | null> {
    const redis = getRedisClient();
    if (!redis) return null;
    try {
        const data = await redis.hgetall(REDIS_STATS_KEY);
        if (data && data.totalRequests) {
            const stats: PersistedStats = {
                savedTokens: parseFloat(data.savedTokens) || 0,
                savedMoney: parseFloat(data.savedMoney) || 0,
                blockedLoops: parseInt(data.blockedLoops) || 0,
                totalRequests: parseInt(data.totalRequests) || 0,
                smartRouteDowngrades: parseInt(data.smartRouteDowngrades) || 0,
                smartRouteSavings: parseFloat(data.smartRouteSavings) || 0,
                compressedTokensSaved: parseInt(data.compressedTokensSaved) || 0,
                compressionCalls: parseInt(data.compressionCalls) || 0,
                crossProviderFailovers: parseInt(data.crossProviderFailovers) || 0,
                crossProviderSavings: parseFloat(data.crossProviderSavings) || 0,
                totalTtftMs: parseFloat(data.totalTtftMs) || 0,
                totalResponseMs: parseFloat(data.totalResponseMs) || 0,
                timedRequests: parseInt(data.timedRequests) || 0,
            };
            console.log(`[STATS] Loaded from Redis: ${stats.totalRequests} requests, $${stats.savedMoney.toFixed(4)} saved`);
            return stats;
        }
    } catch (err) {
        console.error('[STATS] Failed to load from Redis:', err);
    }
    return null;
}

async function loadRecentActivityFromRedis(limit: number): Promise<any[]> {
    const redis = getRedisClient();
    if (!redis) return [];
    try {
        const rows = await redis.lrange(REDIS_ACTIVITY_KEY, 0, limit - 1);
        return rows
            .map((row) => {
                try {
                    return JSON.parse(row);
                } catch {
                    return null;
                }
            })
            .filter((row): row is Record<string, any> => row !== null);
    } catch (err) {
        console.error('[STATS] Failed to load recent activity from Redis:', err);
        return [];
    }
}

async function saveStatsToRedis(): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;
    try {
        await redis.hset(REDIS_STATS_KEY, {
            savedTokens: globalStats.savedTokens.toString(),
            savedMoney: globalStats.savedMoney.toString(),
            blockedLoops: globalStats.blockedLoops.toString(),
            totalRequests: globalStats.totalRequests.toString(),
            smartRouteDowngrades: globalStats.smartRouteDowngrades.toString(),
            smartRouteSavings: globalStats.smartRouteSavings.toString(),
            compressedTokensSaved: globalStats.compressedTokensSaved.toString(),
            compressionCalls: globalStats.compressionCalls.toString(),
            crossProviderFailovers: globalStats.crossProviderFailovers.toString(),
            crossProviderSavings: globalStats.crossProviderSavings.toString(),
            totalTtftMs: globalStats.totalTtftMs.toString(),
            totalResponseMs: globalStats.totalResponseMs.toString(),
            timedRequests: globalStats.timedRequests.toString(),
        });
    } catch (err) {
        console.error('[STATS] Failed to write to Redis:', err);
    }
}

// Async version for periodic saves (non-blocking)
async function saveStatsAsync(): Promise<void> {
    if (isRedisAvailable()) {
        await saveStatsToRedis();
        return;
    }
    try {
        const persisted: PersistedStats = {
            savedTokens: globalStats.savedTokens,
            savedMoney: globalStats.savedMoney,
            blockedLoops: globalStats.blockedLoops,
            totalRequests: globalStats.totalRequests,
            smartRouteDowngrades: globalStats.smartRouteDowngrades,
            smartRouteSavings: globalStats.smartRouteSavings,
            compressedTokensSaved: globalStats.compressedTokensSaved,
            compressionCalls: globalStats.compressionCalls,
            crossProviderFailovers: globalStats.crossProviderFailovers,
            crossProviderSavings: globalStats.crossProviderSavings,
            totalTtftMs: globalStats.totalTtftMs,
            totalResponseMs: globalStats.totalResponseMs,
            timedRequests: globalStats.timedRequests,
        };
        await fs.promises.writeFile(STATS_FILE, JSON.stringify(persisted, null, 2));
    } catch (err) {
        console.error('[STATS] Failed to write stats.json:', err);
    }
}

// Sync version for signal handlers only (process exits immediately after)
function saveStatsSync(): void {
    try {
        const persisted: PersistedStats = {
            savedTokens: globalStats.savedTokens,
            savedMoney: globalStats.savedMoney,
            blockedLoops: globalStats.blockedLoops,
            totalRequests: globalStats.totalRequests,
            smartRouteDowngrades: globalStats.smartRouteDowngrades,
            smartRouteSavings: globalStats.smartRouteSavings,
            compressedTokensSaved: globalStats.compressedTokensSaved,
            compressionCalls: globalStats.compressionCalls,
            crossProviderFailovers: globalStats.crossProviderFailovers,
            crossProviderSavings: globalStats.crossProviderSavings,
            totalTtftMs: globalStats.totalTtftMs,
            totalResponseMs: globalStats.totalResponseMs,
            timedRequests: globalStats.timedRequests,
        };
        fs.writeFileSync(STATS_FILE, JSON.stringify(persisted, null, 2));
    } catch (err) {
        console.error('[STATS] Failed to write stats.json:', err);
    }
}

// Initialize from disk (Redis load happens async after startup)
const loaded = loadStats();

export const globalStats = {
    ...loaded,
    recentActivity: [] as any[],
    trimmedRequests: 0,
    trimmedTokensSaved: 0,
    smartRouteDowngrades: 0,
    smartRouteSavings: 0,
    ollamaCalls: 0,
    // Spec 1: Streaming Token Accounting
    realInputTokens: 0,
    realOutputTokens: 0,
    realCachedTokens: 0,
    realCacheCreationTokens: 0,
    realOutputSpend: 0,
    estimationErrorSum: 0,
    estimationSamples: 0,
    perModelEstimation: {} as Record<string, { errorSum: number; samples: number }>,
    // Spec 3: Response Caching
    responseCacheHits: 0,
    responseCacheMisses: 0,
    // Spec 4: Cross-Provider Failover
    crossProviderFailovers: 0,
    crossProviderSavings: 0,
    // Spec 5: Request Queue
    queuedRequests: 0,
    queueTimeouts: 0,
    queueFullRejections: 0,
    // Spec 6: Prompt Compression
    compressedTokensSaved: 0,
    compressionCalls: 0,
    compressionCacheHits: 0,
    // Tool Result Optimizer
    toolResultDeduped: 0,
    toolResultCompressed: 0,
    toolResultSavedChars: 0,
    // Response timing
    totalTtftMs: 0,
    totalResponseMs: 0,
    timedRequests: 0,
};

// Circular buffer for O(1) insertion (replaces O(n) unshift)
const MAX_RECENT = 50;
const activityBuffer: any[] = new Array(MAX_RECENT).fill(null);
let activityWriteIndex = 0;
let activityCount = 0;

function hydrateRecentActivity(activities: any[]): void {
    const trimmed = activities.slice(0, MAX_RECENT);
    activityBuffer.fill(null);
    trimmed
        .slice()
        .reverse()
        .forEach((activity, index) => {
            activityBuffer[index] = activity;
        });
    activityCount = trimmed.length;
    activityWriteIndex = trimmed.length % MAX_RECENT;
    globalStats.recentActivity = trimmed;
}

// Try loading from Redis once connected (overrides file-based stats if Redis has data)
setTimeout(async () => {
    const redisStats = await loadStatsFromRedis();
    if (redisStats) {
        globalStats.savedTokens = redisStats.savedTokens;
        globalStats.savedMoney = redisStats.savedMoney;
        globalStats.blockedLoops = redisStats.blockedLoops;
        globalStats.totalRequests = redisStats.totalRequests;
        globalStats.smartRouteDowngrades = redisStats.smartRouteDowngrades;
        globalStats.smartRouteSavings = redisStats.smartRouteSavings;
        globalStats.compressedTokensSaved = redisStats.compressedTokensSaved;
        globalStats.compressionCalls = redisStats.compressionCalls;
        globalStats.crossProviderFailovers = redisStats.crossProviderFailovers;
        globalStats.crossProviderSavings = redisStats.crossProviderSavings;
        globalStats.totalTtftMs = redisStats.totalTtftMs;
        globalStats.totalResponseMs = redisStats.totalResponseMs;
        globalStats.timedRequests = redisStats.timedRequests;
    }

    const recentActivity = await loadRecentActivityFromRedis(MAX_RECENT);
    if (recentActivity.length > 0) {
        hydrateRecentActivity(recentActivity);
        console.log(`[STATS] Restored ${recentActivity.length} recent activity rows from Redis`);
    }
}, 1000);

export function recordActivity(activity: { time: string, model: string, tokens: number | string, status: string, statusColor: string, saved?: string, ttftMs?: number, totalMs?: number }) {
    activityBuffer[activityWriteIndex] = activity;
    activityWriteIndex = (activityWriteIndex + 1) % MAX_RECENT;
    activityCount = Math.min(activityCount + 1, MAX_RECENT);

    // Rebuild the external-facing array (most recent first) for /api/stats
    const result = [];
    for (let i = 0; i < activityCount; i++) {
        const idx = (activityWriteIndex - 1 - i + MAX_RECENT) % MAX_RECENT;
        result.push(activityBuffer[idx]);
    }
    globalStats.recentActivity = result;

    // Also push to Redis activity list (non-blocking, best-effort)
    const redis = getRedisClient();
    if (redis) {
        redis.lpush(REDIS_ACTIVITY_KEY, JSON.stringify(activity))
            .then(() => redis.ltrim(REDIS_ACTIVITY_KEY, 0, MAX_RECENT - 1))
            .catch(() => {});
    }
}

// Flush to disk every 30 seconds (non-blocking)
setInterval(saveStatsAsync, 30_000);

// Graceful shutdown — sync write to ensure data persists before exit
process.on('SIGTERM', () => { saveStatsSync(); process.exit(0); });
process.on('SIGINT', () => { saveStatsSync(); process.exit(0); });
