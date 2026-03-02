import fs from 'fs';
import path from 'path';

// Persistent storage file path (relative to where the server runs)
const STATS_FILE = path.join(__dirname, '..', 'stats.json');

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

function saveStats() {
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
    recentActivity: [] as any[]
};

export function recordActivity(activity: { time: string, model: string, tokens: number | string, status: string, statusColor: string }) {
    globalStats.recentActivity.unshift(activity);
    if (globalStats.recentActivity.length > 50) {
        globalStats.recentActivity.pop();
    }
}

// Flush to disk every 30 seconds
setInterval(saveStats, 30_000);

// Graceful shutdown — persist before exit
process.on('SIGTERM', () => { saveStats(); process.exit(0); });
process.on('SIGINT', () => { saveStats(); process.exit(0); });
