import { describe, expect, it } from 'vitest';
import { buildPublicStats, HISTORICAL_INSTALL_BASELINE } from '../src/publicStats';

describe('buildPublicStats', () => {
    it('uses the global savings counter as the public source of truth', () => {
        const stats = buildPublicStats(
            { totalUsers: 79 },
            35,
            3673,
            {
                savedMoney: 3801.9,
                totalRequests: 5195,
                blockedLoops: 35,
                timedRequests: 3779,
                totalTtftMs: 8604816,
                totalResponseMs: 19200000,
                smartRouteDowngrades: 0,
                compressionCalls: 0,
                compressedTokensSaved: 0,
                estimationErrorSum: 0.306,
                estimationSamples: 7,
                recentActivity: [],
            },
        );

        expect(stats.totalSaved).toBe(3801.9);
        expect(stats.totalRequests).toBe(5195);
        expect(stats.blockedLoops).toBe(35);
        expect(stats.avgResponseMs).toBe(5081);
        expect(stats.recentSpeedupPct).toBe(0);
        expect(stats.recentEstimatedTimeSavedMs).toBe(0);
        expect(stats.recentCacheHitCount).toBe(0);
    });

    it('preserves the estimated user metric while exposing tracked users separately', () => {
        const stats = buildPublicStats(
            { totalUsers: 79 },
            35,
            3673,
            {
                savedMoney: 200,
                totalRequests: 10,
                blockedLoops: 1,
                timedRequests: 4,
                totalTtftMs: 1000,
                totalResponseMs: 2800,
                smartRouteDowngrades: 2,
                compressionCalls: 3,
                compressedTokensSaved: 42000,
                estimationErrorSum: 0.25,
                estimationSamples: 2,
                recentActivity: [
                    { time: 'now', model: 'gpt-4o-mini', tokens: '8k', status: 'Pass-through', saved: '', ttftMs: 900, totalMs: 3000 },
                    { time: 'now', model: 'claude-opus-4-6', tokens: '70k', status: 'Context CDN Hit', saved: '0.94', ttftMs: 1200, totalMs: 2200 },
                ],
            },
        );

        expect(stats.trackedUsers).toBe(79);
        expect(stats.uniqueInstalls).toBe(35);
        expect(stats.npmWeeklyDownloads).toBe(3673);
        expect(stats.totalUsers).toBe(79);
        expect(stats.estimatedUsers).toBe(35 + 3673 + HISTORICAL_INSTALL_BASELINE);
        expect(stats.avgTtftMs).toBe(250);
        expect(stats.avgResponseMs).toBe(700);
        expect(stats.avgEstimationErrorPct).toBe(12.5);
        expect(stats.compressedTokensSaved).toBe(42000);
        expect(stats.recentLatencySampleSize).toBe(2);
        expect(stats.recentSpeedupPct).toBe(27);
        expect(stats.recentEstimatedTimeSavedMs).toBe(800);
        expect(stats.recentCacheHitCount).toBe(1);
        expect(stats.recentFeed).toHaveLength(2);
        expect(stats.recentFeed[1]?.saved).toBe('0.94');
    });
});
