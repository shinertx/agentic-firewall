/**
 * Install Tracker — persists CLI installation data with machine-level dedup.
 *
 * Follows the export/import pattern from budgetGovernor.ts and sessionTracker.ts:
 * - In-memory Map<machineId, InstallRecord>
 * - exportInstallData() / importInstallData() for JSON serialization
 * - Loaded on startup, persisted every 30s by index.ts
 */

import https from 'https';
import http from 'http';
import { isRedisAvailable, getRedisClient } from './redis';

export interface InstallRecord {
    machineId: string;
    installId: string;
    firstSeen: string;
    lastSeen: string;
    lastVersion: string;
    platform: string;
    arch: string;
    nodeVersion: string;
    commandCounts: {
        setup: number;
        scan: number;
        status: number;
        verify: number;
        run: number;
        replay: number;
        uninstall: number;
        other: number;
    };
    totalPings: number;
}

export interface TelemetryEvent {
    event: string;
    command: string;
    machineId: string;
    installId: string;
    version: string;
    platform: string;
    arch: string;
    node: string;
    isFirstRun: boolean;
    timestamp: string;
}

// Redis key patterns
const REDIS_INSTALL_PREFIX = 'firewall:install:';
const REDIS_INSTALL_IDS_KEY = 'firewall:install_ids';

const installs = new Map<string, InstallRecord>();

// npm download stats cache
interface NpmStats {
    weekly: number;
    monthly: number;
    fetchedAt: number;
}
let npmStatsCache: NpmStats | null = null;
const NPM_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const VALID_COMMANDS = ['setup', 'scan', 'status', 'verify', 'run', 'replay', 'uninstall'] as const;
type ValidCommand = typeof VALID_COMMANDS[number];

function isValidCommand(cmd: string): cmd is ValidCommand {
    return (VALID_COMMANDS as readonly string[]).includes(cmd);
}

/**
 * Record a telemetry event from the CLI.
 * Deduplicates by machineId — first ping creates, subsequent pings update.
 */
export function recordTelemetryEvent(event: TelemetryEvent): void {
    const existing = installs.get(event.machineId);

    if (existing) {
        existing.lastSeen = event.timestamp;
        existing.lastVersion = event.version;
        existing.totalPings++;
        if (isValidCommand(event.command)) {
            existing.commandCounts[event.command]++;
        } else {
            existing.commandCounts.other++;
        }
    } else {
        const commandCounts = {
            setup: 0, scan: 0, status: 0, verify: 0,
            run: 0, replay: 0, uninstall: 0, other: 0,
        };
        if (isValidCommand(event.command)) {
            commandCounts[event.command] = 1;
        } else {
            commandCounts.other = 1;
        }

        installs.set(event.machineId, {
            machineId: event.machineId,
            installId: event.installId,
            firstSeen: event.timestamp,
            lastSeen: event.timestamp,
            lastVersion: event.version,
            platform: event.platform,
            arch: event.arch,
            nodeVersion: event.node,
            commandCounts,
            totalPings: 1,
        });
    }

    // Sync to Redis
    const record = installs.get(event.machineId);
    if (record) syncInstallToRedis(event.machineId, record);

    forwardToAnalytics(event);
}

/**
 * Get full install statistics (admin endpoint).
 */
export function getInstallStats(): {
    totalInstalls: number;
    uniqueInstalls: number;
    installs: InstallRecord[];
    platformBreakdown: Record<string, number>;
    archBreakdown: Record<string, number>;
    versionBreakdown: Record<string, number>;
} {
    const records = Array.from(installs.values());
    const platformBreakdown: Record<string, number> = {};
    const archBreakdown: Record<string, number> = {};
    const versionBreakdown: Record<string, number> = {};

    for (const r of records) {
        platformBreakdown[r.platform] = (platformBreakdown[r.platform] || 0) + 1;
        archBreakdown[r.arch] = (archBreakdown[r.arch] || 0) + 1;
        versionBreakdown[r.lastVersion] = (versionBreakdown[r.lastVersion] || 0) + 1;
    }

    return {
        totalInstalls: records.reduce((sum, r) => sum + r.totalPings, 0),
        uniqueInstalls: records.length,
        installs: records,
        platformBreakdown,
        archBreakdown,
        versionBreakdown,
    };
}

/**
 * Get aggregated breakdown only (public endpoint — no individual records).
 */
export function getInstallBreakdown(): {
    uniqueInstalls: number;
    platformBreakdown: Record<string, number>;
    archBreakdown: Record<string, number>;
    versionBreakdown: Record<string, number>;
} {
    const { uniqueInstalls, platformBreakdown, archBreakdown, versionBreakdown } = getInstallStats();
    return { uniqueInstalls, platformBreakdown, archBreakdown, versionBreakdown };
}

/**
 * Lightweight unique install count for dashboard/aggregate consumption.
 */
export function getUniqueInstallCount(): number {
    return installs.size;
}

/**
 * Fetch npm download counts. Cached for 1 hour.
 */
export async function getNpmStats(): Promise<NpmStats> {
    if (npmStatsCache && (Date.now() - npmStatsCache.fetchedAt) < NPM_CACHE_TTL_MS) {
        return npmStatsCache;
    }

    const fetchCount = (period: string): Promise<number> => {
        return new Promise((resolve) => {
            const url = `https://api.npmjs.org/downloads/point/${period}/vibe-billing`;
            https.get(url, (res) => {
                let data = '';
                res.on('data', (chunk: Buffer) => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed.downloads || 0);
                    } catch {
                        resolve(0);
                    }
                });
            }).on('error', () => resolve(0));
        });
    };

    const [weekly, monthly] = await Promise.all([
        fetchCount('last-week'),
        fetchCount('last-month'),
    ]);

    npmStatsCache = { weekly, monthly, fetchedAt: Date.now() };
    return npmStatsCache;
}

// ─── Analytics Webhook ──────────────────────────────────

/**
 * Forward telemetry events to an external analytics service.
 * Configured via ANALYTICS_WEBHOOK_URL env var. Skips silently if not set.
 */
function forwardToAnalytics(event: TelemetryEvent): void {
    const webhookUrl = process.env.ANALYTICS_WEBHOOK_URL;
    if (!webhookUrl) return;

    try {
        const url = new URL(webhookUrl);
        const payload = JSON.stringify({
            event: event.event,
            properties: {
                machineId: event.machineId,
                installId: event.installId,
                platform: event.platform,
                arch: event.arch,
                version: event.version,
                command: event.command,
                isFirstRun: event.isFirstRun,
                nodeVersion: event.node,
            },
            timestamp: event.timestamp,
        });

        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
            timeout: 5000,
        });
        req.on('error', () => {}); // silent failure
        req.write(payload);
        req.end();
    } catch { /* never block proxy operation for analytics */ }
}

// ─── Redis sync helpers ──────────────────────────────────

/** Sync a single install record to Redis (non-blocking). */
function syncInstallToRedis(machineId: string, record: InstallRecord): void {
    const redis = getRedisClient();
    if (!redis) return;
    redis.hset(REDIS_INSTALL_PREFIX + machineId, {
        machineId: record.machineId,
        installId: record.installId,
        firstSeen: record.firstSeen,
        lastSeen: record.lastSeen,
        lastVersion: record.lastVersion,
        platform: record.platform,
        arch: record.arch,
        nodeVersion: record.nodeVersion,
        commandCounts: JSON.stringify(record.commandCounts),
        totalPings: record.totalPings.toString(),
    }).then(() => redis.sadd(REDIS_INSTALL_IDS_KEY, machineId)).catch(() => {});
}

/** Load all install data from Redis into memory. */
export async function loadInstallsFromRedis(): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;
    try {
        const machineIds = await redis.smembers(REDIS_INSTALL_IDS_KEY);
        if (!machineIds.length) return false;
        let loaded = 0;
        for (const id of machineIds) {
            const data = await redis.hgetall(REDIS_INSTALL_PREFIX + id);
            if (data && data.machineId) {
                installs.set(id, {
                    machineId: data.machineId,
                    installId: data.installId,
                    firstSeen: data.firstSeen,
                    lastSeen: data.lastSeen,
                    lastVersion: data.lastVersion,
                    platform: data.platform,
                    arch: data.arch,
                    nodeVersion: data.nodeVersion,
                    commandCounts: data.commandCounts ? JSON.parse(data.commandCounts) : {
                        setup: 0, scan: 0, status: 0, verify: 0,
                        run: 0, replay: 0, uninstall: 0, other: 0,
                    },
                    totalPings: parseInt(data.totalPings) || 0,
                });
                loaded++;
            }
        }
        if (loaded > 0) {
            console.log(`[INSTALLS] Loaded ${loaded} install records from Redis`);
        }
        return loaded > 0;
    } catch (err) {
        console.error('[INSTALLS] Failed to load from Redis:', err);
        return false;
    }
}

/** Bulk sync all installs to Redis. */
export async function saveInstallsToRedis(): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;
    try {
        const pipeline = redis.pipeline();
        for (const [id, record] of installs) {
            pipeline.hset(REDIS_INSTALL_PREFIX + id, {
                machineId: record.machineId,
                installId: record.installId,
                firstSeen: record.firstSeen,
                lastSeen: record.lastSeen,
                lastVersion: record.lastVersion,
                platform: record.platform,
                arch: record.arch,
                nodeVersion: record.nodeVersion,
                commandCounts: JSON.stringify(record.commandCounts),
                totalPings: record.totalPings.toString(),
            });
            pipeline.sadd(REDIS_INSTALL_IDS_KEY, id);
        }
        await pipeline.exec();
    } catch (err) {
        console.error('[INSTALLS] Failed to save to Redis:', err);
    }
}

// ─── Persistence (export/import pattern) ─────────────────

export function exportInstallData(): Record<string, InstallRecord> {
    const data: Record<string, InstallRecord> = {};
    for (const [id, record] of installs) {
        data[id] = record;
    }
    return data;
}

export function importInstallData(data: Record<string, InstallRecord>): void {
    for (const [id, record] of Object.entries(data)) {
        installs.set(id, record);
    }
}

/** Clear all install data (for testing). */
export function clearInstalls(): void {
    installs.clear();
}
