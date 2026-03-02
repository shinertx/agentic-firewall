import { getUserStats, UserBudget } from '../budgetGovernor';

/**
 * Renders the per-user dashboard HTML.
 */
export function renderDashboard(userId: string): string {
    const stats = getUserStats(userId);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard — Agent Firewall</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,sans-serif;background:#0a0a0f;color:#e2e8f0;min-height:100vh;padding:40px 20px}
.container{max-width:700px;margin:0 auto}
h1{font-size:1.8rem;color:#818cf8;margin-bottom:8px}
.uid{color:#475569;font-size:0.85rem;margin-bottom:32px;font-family:'SF Mono',Consolas,monospace}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:24px 0}
.card{background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.15);border-radius:12px;padding:20px;transition:border-color 0.3s}
.card:hover{border-color:rgba(99,102,241,0.4)}
.card .val{font-size:2rem;font-weight:700;color:#a78bfa;font-variant-numeric:tabular-nums}
.card .lbl{color:#64748b;font-size:0.85rem;margin-top:4px}
.meta{color:#475569;font-size:0.85rem;margin-top:16px;line-height:1.6}
.none{color:#475569;text-align:center;padding:80px 20px}
.none h2{color:#818cf8;font-size:1.4rem;margin-bottom:12px}
.none code{color:#c4b5fd;background:#1e1b2e;padding:4px 12px;border-radius:6px;font-size:0.95rem}
.back{color:#818cf8;text-decoration:none;display:inline-block;margin-top:24px;transition:color 0.2s}
.back:hover{color:#a78bfa}
</style>
</head>
<body>
<div class="container">
${stats ? renderUserStats(userId, stats) : renderEmpty()}
<a href="/" class="back">← Back to Agent Firewall</a>
</div>
</body>
</html>`;
}

function renderUserStats(userId: string, stats: UserBudget): string {
    return `
<h1>🛡️ Your Dashboard</h1>
<p class="uid">${userId}</p>
<div class="grid">
  <div class="card"><div class="val">${stats.totalRequests}</div><div class="lbl">Requests</div></div>
  <div class="card"><div class="val">$${stats.totalSpend.toFixed(4)}</div><div class="lbl">Total Spend</div></div>
  <div class="card"><div class="val">$${stats.savedMoney.toFixed(4)}</div><div class="lbl">Money Saved</div></div>
  <div class="card"><div class="val">${stats.blockedLoops}</div><div class="lbl">Loops Blocked</div></div>
  <div class="card"><div class="val">${stats.totalTokens.toLocaleString()}</div><div class="lbl">Tokens Used</div></div>
  <div class="card"><div class="val">${Math.round(stats.savedTokens).toLocaleString()}</div><div class="lbl">Tokens Cached</div></div>
</div>
<p class="meta">First seen: ${stats.firstSeen}<br>Last seen: ${stats.lastSeen}</p>`;
}

function renderEmpty(): string {
    return `
<div class="none">
  <h2>No data yet</h2>
  <p style="margin-top:8px">Route some traffic through the firewall first.</p>
  <p style="margin-top:16px">Run: <code>npx agent-firewall setup</code></p>
</div>`;
}
