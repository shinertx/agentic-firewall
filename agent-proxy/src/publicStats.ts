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
}

export interface GlobalStatsLike {
    savedMoney: number;
    totalRequests: number;
    blockedLoops: number;
    timedRequests: number;
    totalTtftMs: number;
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
    smartRouteDowngrades: number;
    compressionCalls: number;
    compressedTokensSaved: number;
    avgEstimationErrorPct: number;
    estimationSamples: number;
    recentFeed: Array<{
        time: string;
        model: string;
        tokens: string;
        status: string;
        saved: string;
        ttftMs: number;
    }>;
}

export function buildPublicStats(
    aggregate: AggregateStatsLike,
    uniqueInstalls: number,
    npmWeeklyDownloads: number,
    globalStats: GlobalStatsLike,
): PublicStatsSnapshot {
    const estimatedUsers = Math.max(aggregate.totalUsers, uniqueInstalls + npmWeeklyDownloads) + HISTORICAL_INSTALL_BASELINE;
    const avgTtftMs = globalStats.timedRequests > 0
        ? Math.round(globalStats.totalTtftMs / globalStats.timedRequests)
        : 0;
    const avgEstimationErrorPct = globalStats.estimationSamples > 0
        ? Math.round((globalStats.estimationErrorSum / globalStats.estimationSamples) * 1000) / 10
        : 0;

    return {
        totalUsers: estimatedUsers,
        estimatedUsers,
        trackedUsers: aggregate.totalUsers,
        uniqueInstalls,
        npmWeeklyDownloads,
        totalSaved: globalStats.savedMoney,
        totalRequests: globalStats.totalRequests,
        blockedLoops: globalStats.blockedLoops,
        avgTtftMs,
        smartRouteDowngrades: globalStats.smartRouteDowngrades,
        compressionCalls: globalStats.compressionCalls,
        compressedTokensSaved: globalStats.compressedTokensSaved,
        avgEstimationErrorPct,
        estimationSamples: globalStats.estimationSamples,
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
