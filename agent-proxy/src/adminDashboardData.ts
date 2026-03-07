import type { InstallRecord } from './installTracker';
import { buildPublicStats, type AggregateStatsLike, type GlobalStatsLike } from './publicStats';

export interface InstallStatsLike {
    totalInstalls: number;
    uniqueInstalls: number;
    installs: InstallRecord[];
    environmentBreakdown: Record<string, number>;
    platformBreakdown: Record<string, number>;
    archBreakdown: Record<string, number>;
    versionBreakdown: Record<string, number>;
}

export interface QueueStatsLike {
    [provider: string]: {
        queued: number;
        active: number;
        rateLimit: number;
    };
}

export interface CacheStatsLike {
    entries: number;
    totalSize: number;
    totalHits: number;
    totalMisses: number;
}

export interface CompressionStatsLike {
    totalCompressed: number;
    tokensSaved: number;
    cacheHits: number;
    avgRatio: number;
}

export interface NpmStatsLike {
    weekly: number;
    monthly: number;
}

export interface NoProgressStatsLike {
    totalFailures: number;
    activeIdentifiers: number;
}

export interface AdminGlobalStatsLike extends GlobalStatsLike {
    queueTimeouts: number;
    queueFullRejections: number;
    crossProviderFailovers: number;
}

export interface AdminActivityItem {
    time: string;
    model: string;
    tokens: string;
    status: string;
    saved: string;
    ttftMs: number;
    totalMs: number;
    severity: 'ok' | 'warning' | 'error';
}

export interface AdminCommandMetric {
    key: string;
    label: string;
    count: number;
}

export interface AdminQueueMetric {
    provider: string;
    queued: number;
    active: number;
    rateLimit: number;
}

export interface AdminDashboardData {
    npmWeekly: number;
    npmMonthly: number;
    estimatedUsers: number;
    trackedUsers: number;
    uniqueInstalls: number;
    activeInstalls24h: number;
    activeInstalls7d: number;
    totalPings: number;
    totalSaved: number;
    totalRequests: number;
    blockedLoops: number;
    avgTtftMs: number;
    avgResponseMs: number;
    recentTtftP50Ms: number;
    recentTtftP95Ms: number;
    recentCacheHitAvgTtftMs: number;
    recentPassThroughAvgTtftMs: number;
    recentLatencySampleSize: number;
    queueTimeouts: number;
    queueFullRejections: number;
    queueIncidentCount: number;
    crossProviderFailovers: number;
    noProgressFailures: number;
    activeNoProgressIdentifiers: number;
    avgEstimationErrorPct: number;
    estimationSamples: number;
    responseCacheHits: number;
    responseCacheMisses: number;
    responseCacheEntries: number;
    responseCacheBytes: number;
    compressionCalls: number;
    compressionTokensSaved: number;
    compressionCacheHits: number;
    compressionAvgRatio: number;
    recentIssueCount: number;
    environmentBreakdown: Record<string, number>;
    platformBreakdown: Record<string, number>;
    archBreakdown: Record<string, number>;
    versionBreakdown: Record<string, number>;
    dailyTimeline: Array<{ date: string; count: number }>;
    recentInstalls: Array<{
        machineId: string;
        platform: string;
        arch: string;
        lastVersion: string;
        environment: string;
        firstSeen: string;
        lastSeen: string;
        totalPings: number;
    }>;
    commandTotals: AdminCommandMetric[];
    queueProviders: AdminQueueMetric[];
    recentIssues: AdminActivityItem[];
    recentActivity: AdminActivityItem[];
}

const COMMAND_DEFS = [
    ['setup', 'Setup'],
    ['scan', 'Scan'],
    ['status', 'Status'],
    ['verify', 'Verify'],
    ['run', 'Run'],
    ['replay', 'Replay'],
    ['uninstall', 'Uninstall'],
    ['other', 'Other'],
] as const;

const ISSUE_STATUS_PATTERN = /rate limited|upstream|timeout|queue|error|blocked|rejected|\b4\d\d\b|\b5\d\d\b/i;
const WARNING_STATUS_PATTERN = /rate limited|429|timeout|queue/i;
const CACHE_STATUS_PATTERN = /cdn|cache/i;

function getSeverity(status: string): 'ok' | 'warning' | 'error' {
    if (!ISSUE_STATUS_PATTERN.test(status)) return 'ok';
    if (WARNING_STATUS_PATTERN.test(status)) return 'warning';
    return 'error';
}

function avg(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: number[], pct: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (pct / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return Math.round(sorted[lower]);
    const weight = index - lower;
    return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * weight);
}

function toRecentInstall(record: InstallRecord) {
    return {
        machineId: record.machineId,
        platform: record.platform,
        arch: record.arch,
        lastVersion: record.lastVersion,
        environment: record.environment || 'unknown',
        firstSeen: record.firstSeen,
        lastSeen: record.lastSeen,
        totalPings: record.totalPings,
    };
}

function isActiveSince(timestamp: string, windowMs: number, nowMs: number): boolean {
    const seenMs = Date.parse(timestamp);
    return Number.isFinite(seenMs) && nowMs - seenMs <= windowMs;
}

export function buildAdminDashboardData(input: {
    installStats: InstallStatsLike;
    npmStats: NpmStatsLike;
    dailyTimeline: Array<{ date: string; count: number }>;
    aggregate: AggregateStatsLike;
    globalStats: AdminGlobalStatsLike;
    noProgress: NoProgressStatsLike;
    queueStats: QueueStatsLike;
    cacheStats: CacheStatsLike;
    compressionStats: CompressionStatsLike;
    now?: Date;
}): AdminDashboardData {
    const {
        installStats,
        npmStats,
        dailyTimeline,
        aggregate,
        globalStats,
        noProgress,
        queueStats,
        cacheStats,
        compressionStats,
    } = input;
    const nowMs = (input.now ?? new Date()).getTime();
    const publicStats = buildPublicStats(aggregate, installStats.uniqueInstalls, npmStats.weekly, globalStats);

    const activeInstalls24h = installStats.installs.filter((record) => isActiveSince(record.lastSeen, 24 * 60 * 60 * 1000, nowMs)).length;
    const activeInstalls7d = installStats.installs.filter((record) => isActiveSince(record.lastSeen, 7 * 24 * 60 * 60 * 1000, nowMs)).length;

    const commandTotals = COMMAND_DEFS.map(([key, label]) => ({
        key,
        label,
        count: installStats.installs.reduce((sum, record) => sum + (record.commandCounts[key] || 0), 0),
    }));

    const recentActivity = globalStats.recentActivity
        .slice(0, 12)
        .map((activity) => ({
            time: activity.time,
            model: activity.model,
            tokens: activity.tokens,
            status: activity.status,
            saved: activity.saved || '',
            ttftMs: activity.ttftMs || 0,
            totalMs: activity.totalMs || 0,
            severity: getSeverity(activity.status),
        }));

    const recentIssues = recentActivity.filter((activity) => activity.severity !== 'ok').slice(0, 8);

    const latencySamples = globalStats.recentActivity
        .map((activity) => ({
            status: activity.status,
            ttftMs: activity.ttftMs || 0,
            totalMs: activity.totalMs || 0,
        }))
        .filter((activity) => activity.ttftMs > 0 || activity.totalMs > 0);

    const ttftSamples = latencySamples.map((activity) => activity.ttftMs).filter((value) => value > 0);
    const cacheHitTtfts = latencySamples
        .filter((activity) => CACHE_STATUS_PATTERN.test(activity.status) && activity.ttftMs > 0)
        .map((activity) => activity.ttftMs);
    const passThroughTtfts = latencySamples
        .filter((activity) => activity.status === 'Pass-through' && activity.ttftMs > 0)
        .map((activity) => activity.ttftMs);
    const avgResponseMs = globalStats.timedRequests > 0
        ? Math.round(globalStats.totalResponseMs / globalStats.timedRequests)
        : 0;

    const recentInstalls = [...installStats.installs]
        .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
        .slice(0, 20)
        .map(toRecentInstall);

    const queueProviders = Object.entries(queueStats)
        .map(([provider, stats]) => ({
            provider,
            queued: stats.queued,
            active: stats.active,
            rateLimit: stats.rateLimit,
        }))
        .sort((a, b) => a.provider.localeCompare(b.provider));

    return {
        npmWeekly: npmStats.weekly,
        npmMonthly: npmStats.monthly,
        estimatedUsers: publicStats.estimatedUsers,
        trackedUsers: publicStats.trackedUsers,
        uniqueInstalls: installStats.uniqueInstalls,
        activeInstalls24h,
        activeInstalls7d,
        totalPings: installStats.totalInstalls,
        totalSaved: publicStats.totalSaved,
        totalRequests: publicStats.totalRequests,
        blockedLoops: publicStats.blockedLoops,
        avgTtftMs: publicStats.avgTtftMs,
        avgResponseMs,
        recentTtftP50Ms: percentile(ttftSamples, 50),
        recentTtftP95Ms: percentile(ttftSamples, 95),
        recentCacheHitAvgTtftMs: avg(cacheHitTtfts),
        recentPassThroughAvgTtftMs: avg(passThroughTtfts),
        recentLatencySampleSize: latencySamples.length,
        queueTimeouts: globalStats.queueTimeouts,
        queueFullRejections: globalStats.queueFullRejections,
        queueIncidentCount: globalStats.queueTimeouts + globalStats.queueFullRejections,
        crossProviderFailovers: globalStats.crossProviderFailovers,
        noProgressFailures: noProgress.totalFailures,
        activeNoProgressIdentifiers: noProgress.activeIdentifiers,
        avgEstimationErrorPct: publicStats.avgEstimationErrorPct,
        estimationSamples: publicStats.estimationSamples,
        responseCacheHits: cacheStats.totalHits,
        responseCacheMisses: cacheStats.totalMisses,
        responseCacheEntries: cacheStats.entries,
        responseCacheBytes: cacheStats.totalSize,
        compressionCalls: compressionStats.totalCompressed,
        compressionTokensSaved: compressionStats.tokensSaved,
        compressionCacheHits: compressionStats.cacheHits,
        compressionAvgRatio: compressionStats.avgRatio,
        recentIssueCount: recentIssues.length,
        environmentBreakdown: installStats.environmentBreakdown,
        platformBreakdown: installStats.platformBreakdown,
        archBreakdown: installStats.archBreakdown,
        versionBreakdown: installStats.versionBreakdown,
        dailyTimeline,
        recentInstalls,
        commandTotals,
        queueProviders,
        recentIssues,
        recentActivity,
    };
}
