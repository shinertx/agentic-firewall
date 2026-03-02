export const globalStats = {
    savedTokens: 0,
    savedMoney: 0,
    blockedLoops: 0,
    totalRequests: 0,
    recentActivity: [] as any[]
};

export function recordActivity(activity: { time: string, model: string, tokens: number | string, status: string, statusColor: string }) {
    globalStats.recentActivity.unshift(activity);
    if (globalStats.recentActivity.length > 20) {
        globalStats.recentActivity.pop();
    }
}
