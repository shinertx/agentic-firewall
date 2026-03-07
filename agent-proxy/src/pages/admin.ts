import type { AdminActivityItem, AdminCommandMetric, AdminDashboardData, AdminQueueMetric } from '../adminDashboardData';

function fmtNum(n: number): string {
    return n.toLocaleString('en-US');
}

function fmtMoney(n: number): string {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
    return `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
}

function fmtMs(n: number): string {
    return `${fmtNum(n)} ms`;
}

function fmtDuration(n: number): string {
    if (n <= 0) return '0s';
    if (n >= 60_000) {
        const minutes = n / 60_000;
        return `${minutes.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} min`;
    }
    return `${(n / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

function fmtBytes(n: number): string {
    if (n <= 0) return '0 B';
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${fmtNum(n)} B`;
}

function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function envColor(env: string): string {
    switch (env) {
        case 'user': return '#0f766e';
        case 'ci': return '#d97706';
        case 'bot': return '#dc2626';
        default: return '#64748b';
    }
}

function envLabel(env: string): string {
    switch (env) {
        case 'user': return 'Real users';
        case 'ci': return 'CI/CD';
        case 'bot': return 'Bots';
        default: return 'Unknown';
    }
}

function severityClass(severity: AdminActivityItem['severity']): string {
    switch (severity) {
        case 'warning': return 'badge warning';
        case 'error': return 'badge error';
        default: return 'badge ok';
    }
}

function renderMetricCards(items: Array<{ label: string; value: string; hint?: string; tone?: 'green' | 'amber' | 'red' }>): string {
    return items.map((item) => `
        <div class="card">
            <div class="card-label">${escHtml(item.label)}</div>
            <div class="card-value${item.tone ? ` ${item.tone}` : ''}">${escHtml(item.value)}</div>
            ${item.hint ? `<div class="card-hint">${escHtml(item.hint)}</div>` : ''}
        </div>
    `).join('\n');
}

function renderEnvironmentBars(breakdown: Record<string, number>): string {
    const total = Object.values(breakdown).reduce((sum, count) => sum + count, 0) || 1;
    const rows = ['user', 'ci', 'bot', 'unknown']
        .filter((key) => (breakdown[key] || 0) > 0)
        .map((key) => {
            const count = breakdown[key] || 0;
            const pct = Math.round((count / total) * 100);
            return `<div class="env-row">
                <div class="env-label"><span class="env-dot" style="background:${envColor(key)}"></span>${envLabel(key)}</div>
                <div class="env-bar-wrap"><div class="env-bar" style="width:${pct}%;background:${envColor(key)}"></div></div>
                <div class="env-count">${fmtNum(count)} (${pct}%)</div>
            </div>`;
        })
        .join('\n');

    return rows || '<div class="empty-state">No install telemetry yet.</div>';
}

function renderTimelineBars(points: Array<{ date: string; count: number }>): string {
    const maxDay = Math.max(...points.map((point) => point.count), 1);
    return points.map((point) => {
        const height = Math.round((point.count / maxDay) * 100);
        return `<div class="tl-col" title="${point.date}: ${point.count} installs">
            <div class="tl-bar" style="height:${height}%"></div>
            <div class="tl-label">${point.count > 0 ? point.count : ''}</div>
        </div>`;
    }).join('');
}

function renderBreakdownRows(breakdown: Record<string, number>, limit: number = 999): string {
    const rows = Object.entries(breakdown)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, count]) => `<tr><td>${escHtml(key)}</td><td>${fmtNum(count)}</td></tr>`)
        .join('');

    return rows || '<tr><td colspan="2" class="empty-cell">No data yet.</td></tr>';
}

function renderCommandRows(commandTotals: AdminCommandMetric[]): string {
    const total = commandTotals.reduce((sum, command) => sum + command.count, 0) || 1;
    const rows = commandTotals
        .filter((command) => command.count > 0)
        .map((command) => `<tr>
            <td>${escHtml(command.label)}</td>
            <td>${fmtNum(command.count)}</td>
            <td>${fmtPct((command.count / total) * 100)}</td>
        </tr>`)
        .join('');

    return rows || '<tr><td colspan="3" class="empty-cell">No command telemetry yet.</td></tr>';
}

function renderQueueRows(queueProviders: AdminQueueMetric[]): string {
    const rows = queueProviders
        .map((provider) => `<tr>
            <td>${escHtml(provider.provider)}</td>
            <td>${fmtNum(provider.active)}</td>
            <td>${fmtNum(provider.queued)}</td>
            <td>${fmtNum(provider.rateLimit)}/min</td>
        </tr>`)
        .join('');

    return rows || '<tr><td colspan="4" class="empty-cell">No queue activity yet.</td></tr>';
}

function renderActivityRows(rows: AdminActivityItem[], emptyMessage: string): string {
    if (rows.length === 0) {
        return `<tr><td colspan="7" class="empty-cell">${escHtml(emptyMessage)}</td></tr>`;
    }

    return rows.map((row) => `<tr>
        <td class="mono">${escHtml(row.time)}</td>
        <td><span class="${severityClass(row.severity)}">${escHtml(row.status)}</span></td>
        <td>${escHtml(row.model)}</td>
        <td>${escHtml(row.tokens)}</td>
        <td>${row.saved ? fmtMoney(parseFloat(row.saved) || 0) : '-'}</td>
        <td>${row.ttftMs > 0 ? fmtMs(row.ttftMs) : '-'}</td>
        <td>${row.totalMs > 0 ? fmtMs(row.totalMs) : '-'}</td>
    </tr>`).join('\n');
}

function renderRecentInstalls(rows: AdminDashboardData['recentInstalls']): string {
    if (rows.length === 0) {
        return '<tr><td colspan="8" class="empty-cell">No installs recorded yet.</td></tr>';
    }

    return rows.map((row) => {
        const shortId = row.machineId.length > 14 ? `${row.machineId.slice(0, 14)}...` : row.machineId;
        return `<tr>
            <td class="mono">${escHtml(shortId)}</td>
            <td>${escHtml(row.platform)}</td>
            <td>${escHtml(row.arch)}</td>
            <td>${escHtml(row.lastVersion)}</td>
            <td><span class="env-dot" style="background:${envColor(row.environment)}"></span>${escHtml(envLabel(row.environment))}</td>
            <td>${escHtml(row.firstSeen.slice(0, 10))}</td>
            <td>${escHtml(row.lastSeen.slice(0, 10))}</td>
            <td>${fmtNum(row.totalPings)}</td>
        </tr>`;
    }).join('\n');
}

export function renderAdminDashboard(data: AdminDashboardData): string {
    const overviewCards = [
        { label: 'Estimated Users', value: fmtNum(data.estimatedUsers), hint: 'Public-facing reach number' },
        { label: 'Tracked Users', value: fmtNum(data.trackedUsers), hint: 'Observed in runtime telemetry', tone: 'green' as const },
        { label: 'Unique Installs', value: fmtNum(data.uniqueInstalls), hint: `${fmtNum(data.activeInstalls7d)} active in 7d` },
        { label: 'Active Installs (24h)', value: fmtNum(data.activeInstalls24h), hint: `${fmtNum(data.totalPings)} total pings` },
        { label: 'Saved', value: fmtMoney(data.totalSaved), hint: 'Global runtime counter', tone: 'green' as const },
        { label: 'Requests', value: fmtNum(data.totalRequests), hint: 'Proxy requests observed' },
        { label: 'Loops Blocked', value: fmtNum(data.blockedLoops), hint: 'Guardrail events blocked', tone: data.blockedLoops > 0 ? 'amber' as const : undefined },
    ];

    const speedCards = [
        { label: 'Recent Time Saved', value: data.recentEstimatedTimeSavedMs > 0 ? fmtDuration(data.recentEstimatedTimeSavedMs) : '-', hint: data.recentCacheHitCount > 0 ? `${fmtNum(data.recentCacheHitCount)} recent cache-hit requests` : 'Collecting optimized traffic', tone: data.recentEstimatedTimeSavedMs > 0 ? 'green' as const : undefined },
        { label: 'Cache Speedup', value: data.recentSpeedupPct > 0 ? fmtPct(data.recentSpeedupPct) : '-', hint: data.recentCacheHitAvgResponseMs > 0 && data.recentPassThroughAvgResponseMs > 0 ? `${fmtMs(data.recentCacheHitAvgResponseMs)} vs ${fmtMs(data.recentPassThroughAvgResponseMs)}` : 'Waiting for pass-through and cache samples', tone: data.recentSpeedupPct > 0 ? 'green' as const : undefined },
        { label: 'Avg TTFT', value: fmtMs(data.avgTtftMs), hint: 'Across all timed requests' },
        { label: 'TTFT P50', value: data.recentLatencySampleSize > 0 ? fmtMs(data.recentTtftP50Ms) : '-', hint: `${fmtNum(data.recentLatencySampleSize)} recent samples` },
        { label: 'TTFT P95', value: data.recentLatencySampleSize > 0 ? fmtMs(data.recentTtftP95Ms) : '-', hint: 'Recent runtime tail latency', tone: data.recentTtftP95Ms > data.recentTtftP50Ms * 2 && data.recentTtftP95Ms > 0 ? 'amber' as const : undefined },
        { label: 'Avg Response', value: fmtMs(data.avgResponseMs), hint: 'Full request time' },
        { label: 'Cache Hit TTFT', value: data.recentCacheHitAvgTtftMs > 0 ? fmtMs(data.recentCacheHitAvgTtftMs) : '-', hint: 'Recent cache-hit average', tone: data.recentCacheHitAvgTtftMs > 0 ? 'green' as const : undefined },
        { label: 'Pass-through TTFT', value: data.recentPassThroughAvgTtftMs > 0 ? fmtMs(data.recentPassThroughAvgTtftMs) : '-', hint: 'Recent direct proxy average' },
        { label: 'Failover Rescues', value: fmtNum(data.crossProviderFailovers), hint: '429 recoveries', tone: data.crossProviderFailovers > 0 ? 'amber' as const : undefined },
        { label: 'Queue Incidents', value: fmtNum(data.queueIncidentCount), hint: `${fmtNum(data.queueTimeouts)} timeouts, ${fmtNum(data.queueFullRejections)} rejects`, tone: data.queueIncidentCount > 0 ? 'red' as const : 'green' as const },
    ];

    const issueCards = [
        { label: 'Recent Issues', value: fmtNum(data.recentIssueCount), hint: 'From latest runtime feed', tone: data.recentIssueCount > 0 ? 'amber' as const : 'green' as const },
        { label: 'Queue Timeouts', value: fmtNum(data.queueTimeouts), hint: 'Dropped waiting requests', tone: data.queueTimeouts > 0 ? 'red' as const : 'green' as const },
        { label: 'Queue Rejections', value: fmtNum(data.queueFullRejections), hint: 'Queue full rejects', tone: data.queueFullRejections > 0 ? 'red' as const : 'green' as const },
        { label: 'No-Progress Failures', value: fmtNum(data.noProgressFailures), hint: `${fmtNum(data.activeNoProgressIdentifiers)} active identifiers`, tone: data.noProgressFailures > 0 ? 'amber' as const : 'green' as const },
        { label: 'Cross-Provider Failovers', value: fmtNum(data.crossProviderFailovers), hint: 'Provider escape hatches used', tone: data.crossProviderFailovers > 0 ? 'amber' as const : undefined },
        { label: 'Estimation Error', value: fmtPct(data.avgEstimationErrorPct), hint: `${fmtNum(data.estimationSamples)} samples`, tone: data.avgEstimationErrorPct >= 25 ? 'amber' as const : 'green' as const },
    ];

    const efficiencyCards = [
        { label: 'Response Cache Hits', value: fmtNum(data.responseCacheHits), hint: `${fmtNum(data.responseCacheEntries)} entries live`, tone: data.responseCacheHits > 0 ? 'green' as const : undefined },
        { label: 'Response Cache Misses', value: fmtNum(data.responseCacheMisses), hint: fmtBytes(data.responseCacheBytes) },
        { label: 'Compression Calls', value: fmtNum(data.compressionCalls), hint: `${fmtNum(data.compressionCacheHits)} cache hits` },
        { label: 'Tokens Saved', value: fmtNum(Math.round(data.compressionTokensSaved)), hint: 'Prompt compression only', tone: data.compressionTokensSaved > 0 ? 'green' as const : undefined },
        { label: 'Compression Avg Ratio', value: data.compressionCalls > 0 ? fmtPct(data.compressionAvgRatio * 100) : '0%', hint: 'Compressed/original tokens' },
        { label: 'npm Weekly', value: fmtNum(data.npmWeekly), hint: `${fmtNum(data.npmMonthly)} monthly` },
    ];

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Internal Telemetry — Agent Firewall</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%230f172a'/><text x='50' y='72' font-size='60' text-anchor='middle' fill='white' font-family='system-ui'>AF</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', system-ui, sans-serif; background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%); color: #0f172a; }
.topbar {
    background: rgba(255, 255, 255, 0.92);
    border-bottom: 1px solid #e2e8f0;
    padding: 14px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    backdrop-filter: blur(10px);
    z-index: 10;
}
.topbar-left { display: flex; align-items: center; gap: 12px; }
.topbar-logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    background: linear-gradient(135deg, #0f172a, #312e81);
    border-radius: 10px;
    color: #fff;
    font-weight: 700;
    font-size: 13px;
}
.topbar-title { display: flex; flex-direction: column; gap: 2px; }
.topbar-title h1 { font-size: 15px; font-weight: 700; }
.topbar-title p { font-size: 12px; color: #64748b; }
.topbar-right { display: flex; gap: 12px; align-items: center; }
.topbar a { color: #475569; text-decoration: none; font-size: 13px; font-weight: 500; }
.topbar a:hover { color: #312e81; }
.topbar-badge {
    border: 1px solid #cbd5e1;
    background: #fff;
    color: #334155;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    padding: 6px 10px;
}
.logout-btn {
    background: #fff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 7px 14px;
    font-size: 13px;
    font-family: inherit;
    color: #475569;
    cursor: pointer;
}
.logout-btn:hover { border-color: #94a3b8; color: #0f172a; }
.container { max-width: 1380px; margin: 0 auto; padding: 28px 24px 40px; }
.hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 20px;
}
.hero-copy h2 { font-size: 28px; line-height: 1.05; letter-spacing: -0.03em; margin-bottom: 8px; }
.hero-copy p { color: #475569; max-width: 760px; line-height: 1.6; }
.refresh-note { font-size: 12px; color: #64748b; white-space: nowrap; }
.section {
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    padding: 22px;
    margin-bottom: 22px;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
}
.section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 16px;
}
.section-head h3 { font-size: 15px; font-weight: 700; }
.section-head p { color: #64748b; font-size: 13px; }
.cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 14px;
}
.card {
    background: linear-gradient(180deg, #fff 0%, #f8fafc 100%);
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 18px;
}
.card-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #64748b;
    margin-bottom: 8px;
}
.card-value {
    font-size: 28px;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: -0.03em;
}
.card-value.green { color: #0f766e; }
.card-value.amber { color: #b45309; }
.card-value.red { color: #b91c1c; }
.card-hint { margin-top: 6px; font-size: 12px; color: #64748b; line-height: 1.5; }
.grid-2, .grid-3 {
    display: grid;
    gap: 22px;
}
.grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.env-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.env-label { width: 120px; font-size: 13px; display: flex; align-items: center; gap: 7px; color: #334155; }
.env-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.env-bar-wrap { flex: 1; height: 18px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
.env-bar { height: 100%; border-radius: 999px; }
.env-count { width: 110px; text-align: right; font-size: 13px; color: #64748b; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 1px solid #cbd5e1;
    font-weight: 600;
    color: #64748b;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
td { padding: 10px 12px; border-bottom: 1px solid #edf2f7; color: #1e293b; vertical-align: top; }
tr:hover td { background: #f8fafc; }
.mono { font-family: 'SF Mono', Monaco, monospace; font-size: 12px; }
.empty-cell, .empty-state { color: #64748b; font-size: 13px; padding: 18px 0; }
.timeline {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 140px;
    padding-top: 8px;
}
.tl-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
.tl-bar {
    width: 100%;
    min-height: 2px;
    background: linear-gradient(180deg, #4f46e5, #0f766e);
    border-radius: 4px 4px 0 0;
}
.tl-label { font-size: 10px; color: #94a3b8; margin-top: 6px; min-height: 14px; }
.badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 3px 9px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
}
.badge.ok { background: #dcfce7; color: #166534; }
.badge.warning { background: #fef3c7; color: #92400e; }
.badge.error { background: #fee2e2; color: #991b1b; }
@media (max-width: 1024px) {
    .grid-2, .grid-3 { grid-template-columns: 1fr; }
    .hero { flex-direction: column; align-items: flex-start; }
}
@media (max-width: 640px) {
    .container { padding: 20px 16px 32px; }
    .topbar { padding: 12px 16px; }
    .topbar-right { gap: 8px; }
    .topbar-badge { display: none; }
}
</style>
</head>
<body>
<div class="topbar">
    <div class="topbar-left">
        <div class="topbar-logo">AF</div>
        <div class="topbar-title">
            <h1>Internal Telemetry</h1>
            <p>Adoption, runtime, and issue visibility</p>
        </div>
    </div>
    <div class="topbar-right">
        <span class="topbar-badge">Internal only</span>
        <a href="/">Public Site</a>
        <form method="POST" action="/admin/logout" style="margin:0">
            <button type="submit" class="logout-btn">Logout</button>
        </form>
    </div>
</div>

<div class="container">
    <div class="hero">
        <div class="hero-copy">
            <h2>Keep the homepage simple. Use this for the truth.</h2>
            <p>The public site should tell the story. This dashboard is the operating view: installs, tracked users, request volume, savings, live issue signals, and queue health.</p>
        </div>
        <div class="refresh-note">Auto-refreshes every 15s</div>
    </div>

    <div class="section">
        <div class="section-head">
            <h3>Overview</h3>
            <p>Public proof vs internal truth in one place.</p>
        </div>
        <div class="cards">${renderMetricCards(overviewCards)}</div>
    </div>

    <div class="section">
        <div class="section-head">
            <h3>Issue Snapshot</h3>
            <p>What is breaking, backing up, or drifting right now.</p>
        </div>
        <div class="cards">${renderMetricCards(issueCards)}</div>
    </div>

    <div class="section">
        <div class="section-head">
            <h3>Speed</h3>
            <p>Latency signals for whether the firewall is making agents feel faster or slower.</p>
        </div>
        <div class="cards">${renderMetricCards(speedCards)}</div>
    </div>

    <div class="grid-2">
        <div class="section">
            <div class="section-head">
                <h3>Environment Breakdown</h3>
                <p>Install telemetry classification.</p>
            </div>
            ${renderEnvironmentBars(data.environmentBreakdown)}
        </div>
        <div class="section">
            <div class="section-head">
                <h3>Command Usage</h3>
                <p>What people actually did after install.</p>
            </div>
            <table>
                <thead><tr><th>Command</th><th>Count</th><th>Share</th></tr></thead>
                <tbody>${renderCommandRows(data.commandTotals)}</tbody>
            </table>
        </div>
    </div>

    <div class="grid-2">
        <div class="section">
            <div class="section-head">
                <h3>Install Timeline</h3>
                <p>Last 30 days.</p>
            </div>
            <div class="timeline">${renderTimelineBars(data.dailyTimeline)}</div>
        </div>
        <div class="section">
            <div class="section-head">
                <h3>Provider Queue</h3>
                <p>Current per-provider pressure.</p>
            </div>
            <table>
                <thead><tr><th>Provider</th><th>Active</th><th>Queued</th><th>Limit</th></tr></thead>
                <tbody>${renderQueueRows(data.queueProviders)}</tbody>
            </table>
        </div>
    </div>

    <div class="grid-3">
        <div class="section">
            <div class="section-head">
                <h3>Platform Distribution</h3>
                <p>Install base by OS.</p>
            </div>
            <table>
                <thead><tr><th>Platform</th><th>Count</th></tr></thead>
                <tbody>${renderBreakdownRows(data.platformBreakdown)}</tbody>
            </table>
        </div>
        <div class="section">
            <div class="section-head">
                <h3>Architecture Distribution</h3>
                <p>Install base by architecture.</p>
            </div>
            <table>
                <thead><tr><th>Arch</th><th>Count</th></tr></thead>
                <tbody>${renderBreakdownRows(data.archBreakdown)}</tbody>
            </table>
        </div>
        <div class="section">
            <div class="section-head">
                <h3>Version Distribution</h3>
                <p>Most common deployed versions.</p>
            </div>
            <table>
                <thead><tr><th>Version</th><th>Count</th></tr></thead>
                <tbody>${renderBreakdownRows(data.versionBreakdown, 12)}</tbody>
            </table>
        </div>
    </div>

    <div class="section">
        <div class="section-head">
            <h3>Efficiency</h3>
            <p>Caching and compression signals that explain savings and speed.</p>
        </div>
        <div class="cards">${renderMetricCards(efficiencyCards)}</div>
    </div>

    <div class="grid-2">
        <div class="section">
            <div class="section-head">
                <h3>Recent Issues</h3>
                <p>Only warning/error statuses from the latest runtime feed.</p>
            </div>
            <table>
                <thead><tr><th>Time</th><th>Status</th><th>Model</th><th>Tokens</th><th>Saved</th><th>TTFT</th><th>Total</th></tr></thead>
                <tbody>${renderActivityRows(data.recentIssues, 'No recent issue events.')}</tbody>
            </table>
        </div>
        <div class="section">
            <div class="section-head">
                <h3>Recent Activity</h3>
                <p>The latest runtime events, good and bad.</p>
            </div>
            <table>
                <thead><tr><th>Time</th><th>Status</th><th>Model</th><th>Tokens</th><th>Saved</th><th>TTFT</th><th>Total</th></tr></thead>
                <tbody>${renderActivityRows(data.recentActivity, 'No runtime activity yet.')}</tbody>
            </table>
        </div>
    </div>

    <div class="section">
        <div class="section-head">
            <h3>Recent Installs</h3>
            <p>The latest machines that phoned home.</p>
        </div>
        <table>
            <thead><tr><th>Machine ID</th><th>Platform</th><th>Arch</th><th>Version</th><th>Environment</th><th>First Seen</th><th>Last Seen</th><th>Pings</th></tr></thead>
            <tbody>${renderRecentInstalls(data.recentInstalls)}</tbody>
        </table>
    </div>
</div>

<script>
const refreshMs = 15000;
const scrollKey = 'agent-firewall-admin-scroll';
const savedScroll = sessionStorage.getItem(scrollKey);
if (savedScroll) window.scrollTo(0, parseInt(savedScroll, 10) || 0);
window.addEventListener('beforeunload', function () {
    sessionStorage.setItem(scrollKey, String(window.scrollY));
});
setTimeout(function () {
    window.location.reload();
}, refreshMs);
</script>
</body>
</html>`;
}
