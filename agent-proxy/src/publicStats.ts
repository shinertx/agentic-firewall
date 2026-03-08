export const HISTORICAL_INSTALL_BASELINE = 612;

export interface AggregateStatsLike {
    totalUsers: number;
}

export interface ActivityLike {
    time: string;
    model: string;
    tokens: string;
    status: string;
    saved?: string;
    ttftMs?: number;
    totalMs?: number;
}

export interface GlobalStatsLike {
    savedMoney: number;
    totalRequests: number;
    blockedLoops: number;
    timedRequests: number;
    totalTtftMs: number;
    totalResponseMs: number;
    smartRouteDowngrades: number;
    compressionCalls: number;
    compressedTokensSaved: number;
    estimationErrorSum: number;
    estimationSamples: number;
    recentActivity: ActivityLike[];
}

export interface PublicStatsSnapshot {
    totalUsers: number;
    estimatedUsers: number;
    trackedUsers: number;
    uniqueInstalls: number;
    npmWeeklyDownloads: number;
    totalSaved: number;
    totalRequests: number;
    blockedLoops: number;
    avgTtftMs: number;
    avgResponseMs: number;
    smartRouteDowngrades: number;
    compressionCalls: number;
    compressedTokensSaved: number;
    avgEstimationErrorPct: number;
    estimationSamples: number;
    recentLatencySampleSize: number;
    recentSpeedupPct: number;
    recentEstimatedTimeSavedMs: number;
    recentCacheHitCount: number;
    recentFeed: Array<{
        time: string;
        model: string;
        tokens: string;
        status: string;
        saved: string;
        ttftMs: number;
    }>;
}

export interface LatencySummary {
    avgTtftMs: number;
    avgResponseMs: number;
    recentLatencySampleSize: number;
    recentTtftP50Ms: number;
    recentTtftP95Ms: number;
    recentCacheHitAvgTtftMs: number;
    recentPassThroughAvgTtftMs: number;
    recentCacheHitAvgResponseMs: number;
    recentPassThroughAvgResponseMs: number;
    recentCacheHitCount: number;
    recentPassThroughCount: number;
    recentSpeedupPct: number;
    recentEstimatedTimeSavedMs: number;
}

const CACHE_STATUS_PATTERN = /cdn|cache/i;

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

export function buildLatencySummary(globalStats: GlobalStatsLike): LatencySummary {
    const avgTtftMs = globalStats.timedRequests > 0
        ? Math.round(globalStats.totalTtftMs / globalStats.timedRequests)
        : 0;
    const avgResponseMs = globalStats.timedRequests > 0
        ? Math.round(globalStats.totalResponseMs / globalStats.timedRequests)
        : 0;

    const latencySamples = globalStats.recentActivity
        .map((activity) => ({
            status: activity.status,
            ttftMs: activity.ttftMs || 0,
            totalMs: activity.totalMs || 0,
        }))
        .filter((activity) => activity.ttftMs > 0 || activity.totalMs > 0);

    const ttftSamples = latencySamples.map((activity) => activity.ttftMs).filter((value) => value > 0);
    const cacheHits = latencySamples.filter((activity) => CACHE_STATUS_PATTERN.test(activity.status));
    const passThroughs = latencySamples.filter((activity) => activity.status === 'Pass-through');
    const cacheHitTtfts = cacheHits.map((activity) => activity.ttftMs).filter((value) => value > 0);
    const passThroughTtfts = passThroughs.map((activity) => activity.ttftMs).filter((value) => value > 0);
    const cacheHitResponses = cacheHits.map((activity) => activity.totalMs).filter((value) => value > 0);
    const passThroughResponses = passThroughs.map((activity) => activity.totalMs).filter((value) => value > 0);

    const recentCacheHitAvgResponseMs = avg(cacheHitResponses);
    const recentPassThroughAvgResponseMs = avg(passThroughResponses);
    const savedPerCacheHitMs = Math.max(0, recentPassThroughAvgResponseMs - recentCacheHitAvgResponseMs);

    return {
        avgTtftMs,
        avgResponseMs,
        recentLatencySampleSize: latencySamples.length,
        recentTtftP50Ms: percentile(ttftSamples, 50),
        recentTtftP95Ms: percentile(ttftSamples, 95),
        recentCacheHitAvgTtftMs: avg(cacheHitTtfts),
        recentPassThroughAvgTtftMs: avg(passThroughTtfts),
        recentCacheHitAvgResponseMs,
        recentPassThroughAvgResponseMs,
        recentCacheHitCount: cacheHits.length,
        recentPassThroughCount: passThroughs.length,
        recentSpeedupPct: recentPassThroughAvgResponseMs > 0 && savedPerCacheHitMs > 0
            ? Math.round((savedPerCacheHitMs / recentPassThroughAvgResponseMs) * 100)
            : 0,
        recentEstimatedTimeSavedMs: cacheHits.length * savedPerCacheHitMs,
    };
}

export function buildPublicStats(
    aggregate: AggregateStatsLike,
    uniqueInstalls: number,
    npmWeeklyDownloads: number,
    globalStats: GlobalStatsLike,
): PublicStatsSnapshot {
    const estimatedUsers = Math.max(aggregate.totalUsers, uniqueInstalls + npmWeeklyDownloads) + HISTORICAL_INSTALL_BASELINE;
    const latencySummary = buildLatencySummary(globalStats);
    const avgEstimationErrorPct = globalStats.estimationSamples > 0
        ? Math.round((globalStats.estimationErrorSum / globalStats.estimationSamples) * 1000) / 10
        : 0;

    return {
        // Public-facing "developers" should reflect observed usage, not modeled reach.
        totalUsers: aggregate.totalUsers,
        estimatedUsers,
        trackedUsers: aggregate.totalUsers,
        uniqueInstalls,
        npmWeeklyDownloads,
        totalSaved: globalStats.savedMoney,
        totalRequests: globalStats.totalRequests,
        blockedLoops: globalStats.blockedLoops,
        avgTtftMs: latencySummary.avgTtftMs,
        avgResponseMs: latencySummary.avgResponseMs,
        smartRouteDowngrades: globalStats.smartRouteDowngrades,
        compressionCalls: globalStats.compressionCalls,
        compressedTokensSaved: globalStats.compressedTokensSaved,
        avgEstimationErrorPct,
        estimationSamples: globalStats.estimationSamples,
        recentLatencySampleSize: latencySummary.recentLatencySampleSize,
        recentSpeedupPct: latencySummary.recentSpeedupPct,
        recentEstimatedTimeSavedMs: latencySummary.recentEstimatedTimeSavedMs,
        recentCacheHitCount: latencySummary.recentCacheHitCount,
        recentFeed: globalStats.recentActivity.slice(0, 14).map((activity) => ({
            time: activity.time,
            model: activity.model,
            tokens: activity.tokens,
            status: activity.status,
            saved: activity.saved || '',
            ttftMs: activity.ttftMs || 0,
        })),
    };
}
