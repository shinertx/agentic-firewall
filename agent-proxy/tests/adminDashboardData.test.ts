import { describe, expect, it } from 'vitest';
import { HISTORICAL_INSTALL_BASELINE } from '../src/publicStats';
import { buildAdminDashboardData } from '../src/adminDashboardData';

describe('buildAdminDashboardData', () => {
    it('separates estimated vs tracked usage and surfaces issue signals', () => {
        const data = buildAdminDashboardData({
            installStats: {
                totalInstalls: 7,
                uniqueInstalls: 2,
                environmentBreakdown: { user: 1, bot: 1 },
                platformBreakdown: { darwin: 1, linux: 1 },
                archBreakdown: { arm64: 2 },
                versionBreakdown: { '0.6.0': 2 },
                installs: [
                    {
                        machineId: 'machine-a',
                        installId: 'install-a',
                        firstSeen: '2026-03-01T00:00:00.000Z',
                        lastSeen: '2026-03-06T11:00:00.000Z',
                        lastVersion: '0.6.0',
                        platform: 'darwin',
                        arch: 'arm64',
                        nodeVersion: '22.0.0',
                        commandCounts: { setup: 1, scan: 0, status: 2, verify: 0, run: 0, replay: 0, uninstall: 0, other: 0 },
                        totalPings: 3,
                        environment: 'user',
                    },
                    {
                        machineId: 'machine-b',
                        installId: 'install-b',
                        firstSeen: '2026-02-20T00:00:00.000Z',
                        lastSeen: '2026-03-03T10:00:00.000Z',
                        lastVersion: '0.6.0',
                        platform: 'linux',
                        arch: 'arm64',
                        nodeVersion: '22.0.0',
                        commandCounts: { setup: 0, scan: 1, status: 0, verify: 1, run: 0, replay: 0, uninstall: 1, other: 1 },
                        totalPings: 4,
                        environment: 'bot',
                    },
                ],
            },
            npmStats: { weekly: 10, monthly: 42 },
            dailyTimeline: [
                { date: '2026-03-05', count: 1 },
                { date: '2026-03-06', count: 1 },
            ],
            aggregate: { totalUsers: 5 },
            globalStats: {
                savedMoney: 3813.61,
                totalRequests: 5268,
                blockedLoops: 35,
                timedRequests: 4,
                totalTtftMs: 2000,
                totalResponseMs: 7600,
                smartRouteDowngrades: 0,
                compressionCalls: 0,
                compressedTokensSaved: 0,
                estimationErrorSum: 0.956,
                estimationSamples: 2,
                queueTimeouts: 1,
                queueFullRejections: 2,
                crossProviderFailovers: 3,
                recentActivity: [
                    { time: '6:48 PM', model: 'gpt-4o-mini', tokens: '2k', status: 'Pass-through', saved: '', ttftMs: 820, totalMs: 1300 },
                    { time: '6:47 PM', model: 'claude-opus-4-6', tokens: '193k', status: '429 Rate Limited', saved: '', ttftMs: 1174, totalMs: 1520 },
                    { time: '6:41 PM', model: 'claude-haiku-4-5-20251001', tokens: '1k', status: 'Upstream 400', saved: '', ttftMs: 100, totalMs: 140 },
                    { time: '6:40 PM', model: 'claude-opus-4-6', tokens: '80k', status: 'Context CDN Hit', saved: '1.08', ttftMs: 3359, totalMs: 4200 },
                ],
            },
            noProgress: { totalFailures: 4, activeIdentifiers: 2 },
            queueStats: {
                openai: { queued: 1, active: 2, rateLimit: 60 },
                anthropic: { queued: 0, active: 1, rateLimit: 40 },
            },
            cacheStats: { entries: 5, totalSize: 4096, totalHits: 7, totalMisses: 2 },
            compressionStats: { totalCompressed: 3, tokensSaved: 4200, cacheHits: 1, avgRatio: 0.44 },
            now: new Date('2026-03-06T12:00:00.000Z'),
        });

        expect(data.totalSaved).toBe(3813.61);
        expect(data.totalRequests).toBe(5268);
        expect(data.blockedLoops).toBe(35);
        expect(data.trackedUsers).toBe(5);
        expect(data.estimatedUsers).toBe(10 + 2 + HISTORICAL_INSTALL_BASELINE);
        expect(data.activeInstalls24h).toBe(1);
        expect(data.activeInstalls7d).toBe(2);
        expect(data.commandTotals.find((metric) => metric.key === 'status')?.count).toBe(2);
        expect(data.commandTotals.find((metric) => metric.key === 'scan')?.count).toBe(1);
        expect(data.queueProviders.map((provider) => provider.provider)).toEqual(['anthropic', 'openai']);
        expect(data.recentIssueCount).toBe(2);
        expect(data.recentIssues[0]?.severity).toBe('warning');
        expect(data.recentIssues[1]?.severity).toBe('error');
        expect(data.avgEstimationErrorPct).toBe(47.8);
        expect(data.avgResponseMs).toBe(1900);
        expect(data.recentLatencySampleSize).toBe(4);
        expect(data.recentTtftP50Ms).toBe(997);
        expect(data.recentTtftP95Ms).toBe(3031);
        expect(data.recentCacheHitAvgTtftMs).toBe(3359);
        expect(data.recentPassThroughAvgTtftMs).toBe(820);
        expect(data.queueIncidentCount).toBe(3);
        expect(data.responseCacheHits).toBe(7);
        expect(data.compressionAvgRatio).toBe(0.44);
    });

    it('keeps empty issue tables clean when runtime feed is healthy', () => {
        const data = buildAdminDashboardData({
            installStats: {
                totalInstalls: 1,
                uniqueInstalls: 1,
                environmentBreakdown: { user: 1 },
                platformBreakdown: { darwin: 1 },
                archBreakdown: { arm64: 1 },
                versionBreakdown: { '0.6.0': 1 },
                installs: [
                    {
                        machineId: 'machine-a',
                        installId: 'install-a',
                        firstSeen: '2026-03-06T00:00:00.000Z',
                        lastSeen: '2026-03-06T11:00:00.000Z',
                        lastVersion: '0.6.0',
                        platform: 'darwin',
                        arch: 'arm64',
                        nodeVersion: '22.0.0',
                        commandCounts: { setup: 1, scan: 0, status: 0, verify: 0, run: 0, replay: 0, uninstall: 0, other: 0 },
                        totalPings: 1,
                        environment: 'user',
                    },
                ],
            },
            npmStats: { weekly: 0, monthly: 0 },
            dailyTimeline: [{ date: '2026-03-06', count: 1 }],
            aggregate: { totalUsers: 1 },
            globalStats: {
                savedMoney: 10,
                totalRequests: 5,
                blockedLoops: 0,
                timedRequests: 1,
                totalTtftMs: 250,
                totalResponseMs: 800,
                smartRouteDowngrades: 0,
                compressionCalls: 0,
                compressedTokensSaved: 0,
                estimationErrorSum: 0,
                estimationSamples: 0,
                queueTimeouts: 0,
                queueFullRejections: 0,
                crossProviderFailovers: 0,
                recentActivity: [
                    { time: '6:40 PM', model: 'claude-opus-4-6', tokens: '80k', status: 'Context CDN Hit', saved: '1.08', ttftMs: 3359, totalMs: 5100 },
                ],
            },
            noProgress: { totalFailures: 0, activeIdentifiers: 0 },
            queueStats: {},
            cacheStats: { entries: 0, totalSize: 0, totalHits: 0, totalMisses: 0 },
            compressionStats: { totalCompressed: 0, tokensSaved: 0, cacheHits: 0, avgRatio: 0 },
            now: new Date('2026-03-06T12:00:00.000Z'),
        });

        expect(data.recentIssueCount).toBe(0);
        expect(data.recentIssues).toEqual([]);
        expect(data.recentActivity).toHaveLength(1);
        expect(data.recentActivity[0]?.severity).toBe('ok');
        expect(data.avgResponseMs).toBe(800);
        expect(data.recentLatencySampleSize).toBe(1);
        expect(data.recentTtftP50Ms).toBe(3359);
        expect(data.recentTtftP95Ms).toBe(3359);
        expect(data.recentCacheHitAvgTtftMs).toBe(3359);
        expect(data.recentPassThroughAvgTtftMs).toBe(0);
        expect(data.queueIncidentCount).toBe(0);
    });
});
