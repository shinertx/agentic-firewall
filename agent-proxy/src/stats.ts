import fs from 'fs';
import path from 'path';

// Persistent storage — use /app/data/ inside Docker (volume-mounted),
// fall back to sibling stats.json for local dev
const DATA_DIR = fs.existsSync('/app/data') ? '/app/data' : path.join(__dirname, '..');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

// Persisted fields — recentActivity stays in-memory only (transient)
interface PersistedStats {
    savedTokens: number;
    savedMoney: number;
    blockedLoops: number;
    totalRequests: number;
}

function loadStats(): PersistedStats {
    try {
        if (fs.existsSync(STATS_FILE)) {
            const raw = fs.readFileSync(STATS_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            console.log(`[STATS] 📂 Loaded persisted stats: ${parsed.totalRequests} requests, $${parsed.savedMoney.toFixed(4)} saved`);
            return parsed;
        }
    } catch (err) {
        console.error('[STATS] ⚠️ Failed to load stats.json, starting fresh:', err);
    }
    return { savedTokens: 0, savedMoney: 0, blockedLoops: 0, totalRequests: 0 };
}

// Async version for periodic saves (non-blocking)
async function saveStatsAsync(): Promise<void> {
    try {
        const persisted: PersistedStats = {
            savedTokens: globalStats.savedTokens,
            savedMoney: globalStats.savedMoney,
            blockedLoops: globalStats.blockedLoops,
            totalRequests: globalStats.totalRequests,
        };
        await fs.promises.writeFile(STATS_FILE, JSON.stringify(persisted, null, 2));
    } catch (err) {
        console.error('[STATS] ⚠️ Failed to write stats.json:', err);
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
        };
        fs.writeFileSync(STATS_FILE, JSON.stringify(persisted, null, 2));
    } catch (err) {
        console.error('[STATS] ⚠️ Failed to write stats.json:', err);
    }
}

// Initialize from disk
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
    estimationErrorSum: 0,
    estimationSamples: 0,
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
};

// Circular buffer for O(1) insertion (replaces O(n) unshift)
const MAX_RECENT = 50;
const activityBuffer: any[] = new Array(MAX_RECENT).fill(null);
let activityWriteIndex = 0;
let activityCount = 0;

export function recordActivity(activity: { time: string, model: string, tokens: number | string, status: string, statusColor: string }) {
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
}

// Flush to disk every 30 seconds (non-blocking)
setInterval(saveStatsAsync, 30_000);

// Graceful shutdown — sync write to ensure data persists before exit
process.on('SIGTERM', () => { saveStatsSync(); process.exit(0); });
process.on('SIGINT', () => { saveStatsSync(); process.exit(0); });
