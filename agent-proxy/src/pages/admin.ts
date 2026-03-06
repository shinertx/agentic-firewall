/**
 * Renders the admin dashboard page with install analytics.
 */

export interface AdminDashboardData {
    npmWeekly: number;
    npmMonthly: number;
    uniqueInstalls: number;
    totalPings: number;
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
}

function fmtNum(n: number): string {
    return n.toLocaleString('en-US');
}

function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function envColor(env: string): string {
    switch (env) {
        case 'user': return '#10b981';
        case 'ci': return '#f59e0b';
        case 'bot': return '#ef4444';
        default: return '#94a3b8';
    }
}

function envLabel(env: string): string {
    switch (env) {
        case 'user': return 'Real Users';
        case 'ci': return 'CI/CD';
        case 'bot': return 'Bots';
        default: return 'Unknown';
    }
}

export function renderAdminDashboard(data: AdminDashboardData): string {
    // Stats cards
    const totalEnv = Object.values(data.environmentBreakdown).reduce((a, b) => a + b, 0) || 1;
    const realUsers = data.environmentBreakdown['user'] || 0;

    // Environment bars
    const envBars = ['user', 'ci', 'bot', 'unknown']
        .filter(e => (data.environmentBreakdown[e] || 0) > 0)
        .map(e => {
            const count = data.environmentBreakdown[e] || 0;
            const pct = Math.round((count / totalEnv) * 100);
            return `<div class="env-row">
                <div class="env-label"><span class="env-dot" style="background:${envColor(e)}"></span>${envLabel(e)}</div>
                <div class="env-bar-wrap"><div class="env-bar" style="width:${pct}%;background:${envColor(e)}"></div></div>
                <div class="env-count">${fmtNum(count)} (${pct}%)</div>
            </div>`;
        }).join('\n');

    // Platform table
    const platformRows = Object.entries(data.platformBreakdown)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<tr><td>${escHtml(k)}</td><td>${fmtNum(v)}</td></tr>`)
        .join('');

    // Arch table
    const archRows = Object.entries(data.archBreakdown)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<tr><td>${escHtml(k)}</td><td>${fmtNum(v)}</td></tr>`)
        .join('');

    // Version table
    const versionRows = Object.entries(data.versionBreakdown)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([k, v]) => `<tr><td>${escHtml(k)}</td><td>${fmtNum(v)}</td></tr>`)
        .join('');

    // Timeline chart (CSS bars)
    const maxDay = Math.max(...data.dailyTimeline.map(d => d.count), 1);
    const timelineBars = data.dailyTimeline.map(d => {
        const h = Math.round((d.count / maxDay) * 100);
        const label = d.date.slice(5); // MM-DD
        return `<div class="tl-col" title="${d.date}: ${d.count} installs">
            <div class="tl-bar" style="height:${h}%"></div>
            <div class="tl-label">${d.count > 0 ? d.count : ''}</div>
        </div>`;
    }).join('');

    // Recent installs
    const recentRows = data.recentInstalls.map(r => {
        const mid = r.machineId.length > 12 ? r.machineId.slice(0, 12) + '...' : r.machineId;
        const envDot = `<span class="env-dot" style="background:${envColor(r.environment)}"></span>`;
        return `<tr>
            <td class="mono">${escHtml(mid)}</td>
            <td>${escHtml(r.platform)}</td>
            <td>${escHtml(r.arch)}</td>
            <td>${escHtml(r.lastVersion)}</td>
            <td>${envDot}${escHtml(r.environment)}</td>
            <td>${r.firstSeen.slice(0, 10)}</td>
            <td>${fmtNum(r.totalPings)}</td>
        </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Dashboard — Vibe Billing</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%230f8f6f'/><text x='50' y='70' font-size='52' text-anchor='middle' fill='white' font-family='system-ui'>VB</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: 'IBM Plex Sans', system-ui, sans-serif;
    background:
      radial-gradient(circle at top left, rgba(52,211,153,0.08), transparent 30%),
      radial-gradient(circle at top right, rgba(90,177,255,0.08), transparent 32%),
      linear-gradient(180deg, #06100f 0%, #081412 38%, #07110f 100%);
    color: #ecf4f1;
}
.topbar {
    background: rgba(10, 19, 17, 0.94);
    border-bottom: 1px solid rgba(157, 184, 173, 0.14);
    padding: 16px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 24px 70px rgba(0,0,0,0.18);
    backdrop-filter: blur(10px);
}
.topbar-left { display: flex; align-items: center; gap: 12px; }
.topbar-logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px; height: 36px;
    background: linear-gradient(135deg, rgba(52,211,153,0.22), rgba(90,177,255,0.18));
    border-radius: 12px;
    color: #fff;
    font-weight: 700;
    font-size: 13px;
    border: 1px solid rgba(90,177,255,0.22);
}
.topbar h1 {
    font-size: 20px;
    font-weight: 700;
    font-family: 'Space Grotesk', sans-serif;
    letter-spacing: -0.04em;
}
.topbar-right { display: flex; gap: 12px; align-items: center; }
.topbar a { color: #b5c8c1; text-decoration: none; font-size: 13px; }
.topbar a:hover { color: #ecf4f1; }
.logout-btn {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(157, 184, 173, 0.14);
    border-radius: 12px;
    padding: 8px 14px;
    font-size: 13px;
    font-family: inherit;
    color: #b5c8c1;
    cursor: pointer;
}
.logout-btn:hover { border-color: rgba(157, 184, 173, 0.26); color: #ecf4f1; }

.container { max-width: 1200px; margin: 0 auto; padding: 24px; }

.cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
}
.card {
    background: rgba(10, 19, 17, 0.94);
    border: 1px solid rgba(157, 184, 173, 0.14);
    border-radius: 20px;
    padding: 20px;
    box-shadow: 0 24px 70px rgba(0,0,0,0.18);
}
.card-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; color: #7f968f; margin-bottom: 8px; font-weight: 700; }
.card-value { font-size: 34px; font-weight: 700; color: #ecf4f1; font-family: 'Space Grotesk', sans-serif; letter-spacing: -0.05em; }
.card-value.green { color: #34d399; }

.section {
    background: rgba(10, 19, 17, 0.94);
    border: 1px solid rgba(157, 184, 173, 0.14);
    border-radius: 24px;
    padding: 20px;
    margin-bottom: 24px;
    box-shadow: 0 24px 70px rgba(0,0,0,0.18);
}
.section h2 { font-size: 24px; font-weight: 700; margin-bottom: 16px; color: #ecf4f1; font-family: 'Space Grotesk', sans-serif; letter-spacing: -0.04em; }

.env-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.env-label { width: 110px; font-size: 13px; display: flex; align-items: center; gap: 6px; color: #b5c8c1; }
.env-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.env-bar-wrap { flex: 1; height: 20px; background: rgba(255,255,255,0.04); border-radius: 999px; overflow: hidden; }
.env-bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
.env-count { width: 100px; text-align: right; font-size: 13px; color: #b5c8c1; }

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 10px 12px; border-bottom: 1px solid rgba(157,184,173,0.14); font-weight: 700; color: #7f968f; font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; }
td { padding: 10px 12px; border-bottom: 1px solid rgba(157,184,173,0.08); color: #b5c8c1; }
tr:hover td { background: rgba(255,255,255,0.02); }
.mono { font-family: 'IBM Plex Mono', monospace; font-size: 12px; }

.timeline {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 120px;
    padding-top: 10px;
}
.tl-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
.tl-bar { width: 100%; min-height: 2px; background: linear-gradient(180deg, #34d399, #5ab1ff); border-radius: 999px 999px 0 0; transition: height 0.3s; }
.tl-label { font-size: 10px; color: #7f968f; margin-top: 4px; min-height: 14px; }

.refresh-note { font-size: 12px; color: #7f968f; text-align: right; margin-bottom: 8px; }
</style>
</head>
<body>
<div class="topbar">
    <div class="topbar-left">
        <div class="topbar-logo">VB</div>
        <div>
            <div style="color:#7f968f;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:2px">Admin surface</div>
            <h1>Vibe Billing Admin</h1>
        </div>
    </div>
    <div class="topbar-right">
        <a href="/">Home</a>
        <form method="POST" action="/admin/logout" style="margin:0">
            <button type="submit" class="logout-btn">Logout</button>
        </form>
    </div>
</div>

<div class="container">
    <div class="refresh-note">Auto-refreshes every 5s</div>

    <div class="cards" id="stats-cards">
        <div class="card"><div class="card-label">npm Weekly</div><div class="card-value" id="npm-weekly">${fmtNum(data.npmWeekly)}</div></div>
        <div class="card"><div class="card-label">npm Monthly</div><div class="card-value" id="npm-monthly">${fmtNum(data.npmMonthly)}</div></div>
        <div class="card"><div class="card-label">Unique Installs</div><div class="card-value" id="unique-installs">${fmtNum(data.uniqueInstalls)}</div></div>
        <div class="card"><div class="card-label">Real Users</div><div class="card-value green" id="real-users">${fmtNum(realUsers)}</div></div>
        <div class="card"><div class="card-label">Total Pings</div><div class="card-value" id="total-pings">${fmtNum(data.totalPings)}</div></div>
    </div>

    <div class="section">
        <h2>Environment Breakdown</h2>
        <div id="env-bars">${envBars}</div>
    </div>

    <div class="section">
        <h2>Install Timeline (Last 30 Days)</h2>
        <div class="timeline" id="timeline">${timelineBars}</div>
    </div>

    <div class="grid-2">
        <div class="section">
            <h2>Platform Distribution</h2>
            <table id="platform-table">
                <thead><tr><th>Platform</th><th>Count</th></tr></thead>
                <tbody>${platformRows}</tbody>
            </table>
        </div>
        <div class="section">
            <h2>Architecture Distribution</h2>
            <table id="arch-table">
                <thead><tr><th>Arch</th><th>Count</th></tr></thead>
                <tbody>${archRows}</tbody>
            </table>
        </div>
    </div>

    <div class="section">
        <h2>Version Distribution</h2>
        <table id="version-table">
            <thead><tr><th>Version</th><th>Count</th></tr></thead>
            <tbody>${versionRows}</tbody>
        </table>
    </div>

    <div class="section">
        <h2>Recent Installs</h2>
        <table id="recent-table">
            <thead><tr><th>Machine ID</th><th>Platform</th><th>Arch</th><th>Version</th><th>Environment</th><th>First Seen</th><th>Pings</th></tr></thead>
            <tbody>${recentRows}</tbody>
        </table>
    </div>
</div>

<script>
function fmtNum(n) { return n.toLocaleString('en-US'); }
function envColor(e) {
    return e === 'user' ? '#10b981' : e === 'ci' ? '#f59e0b' : e === 'bot' ? '#ef4444' : '#94a3b8';
}
function envLabel(e) {
    return e === 'user' ? 'Real Users' : e === 'ci' ? 'CI/CD' : e === 'bot' ? 'Bots' : 'Unknown';
}
function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

async function poll() {
    try {
        const res = await fetch('/api/admin/stats');
        if (!res.ok) return;
        const d = await res.json();

        document.getElementById('npm-weekly').textContent = fmtNum(d.npmWeekly);
        document.getElementById('npm-monthly').textContent = fmtNum(d.npmMonthly);
        document.getElementById('unique-installs').textContent = fmtNum(d.uniqueInstalls);
        document.getElementById('real-users').textContent = fmtNum(d.environmentBreakdown.user || 0);
        document.getElementById('total-pings').textContent = fmtNum(d.totalPings);

        // Environment bars
        var totalEnv = Object.values(d.environmentBreakdown).reduce(function(a,b){return a+b;}, 0) || 1;
        var envHtml = ['user','ci','bot','unknown'].filter(function(e){ return (d.environmentBreakdown[e]||0) > 0; }).map(function(e) {
            var count = d.environmentBreakdown[e] || 0;
            var pct = Math.round((count / totalEnv) * 100);
            return '<div class="env-row"><div class="env-label"><span class="env-dot" style="background:'+envColor(e)+'"></span>'+envLabel(e)+'</div><div class="env-bar-wrap"><div class="env-bar" style="width:'+pct+'%;background:'+envColor(e)+'"></div></div><div class="env-count">'+fmtNum(count)+' ('+pct+'%)</div></div>';
        }).join('');
        document.getElementById('env-bars').innerHTML = envHtml;

        // Timeline
        var maxDay = Math.max.apply(null, d.dailyTimeline.map(function(x){return x.count;})) || 1;
        var tlHtml = d.dailyTimeline.map(function(x) {
            var h = Math.round((x.count / maxDay) * 100);
            return '<div class="tl-col" title="'+x.date+': '+x.count+' installs"><div class="tl-bar" style="height:'+h+'%"></div><div class="tl-label">'+(x.count > 0 ? x.count : '')+'</div></div>';
        }).join('');
        document.getElementById('timeline').innerHTML = tlHtml;

        // Recent installs
        var recentHtml = d.recentInstalls.map(function(r) {
            var mid = r.machineId.length > 12 ? r.machineId.slice(0,12)+'...' : r.machineId;
            return '<tr><td class="mono">'+esc(mid)+'</td><td>'+esc(r.platform)+'</td><td>'+esc(r.arch)+'</td><td>'+esc(r.lastVersion)+'</td><td><span class="env-dot" style="background:'+envColor(r.environment)+'"></span>'+esc(r.environment)+'</td><td>'+r.firstSeen.slice(0,10)+'</td><td>'+fmtNum(r.totalPings)+'</td></tr>';
        }).join('');
        document.querySelector('#recent-table tbody').innerHTML = recentHtml;
    } catch(e) {}
}
setInterval(poll, 5000);
</script>
</body>
</html>`;
}
