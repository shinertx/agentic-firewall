import { getUserStats, UserBudget } from '../budgetGovernor';

/**
 * Renders the per-user dashboard HTML.
 * Design: Light mode — matches landing page.
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
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #ffffff;
  --bg-secondary: #fafafa;
  --border: #e5e7eb;
  --border-hover: #d1d5db;
  --text: #111827;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  --accent: #4f46e5;
}

*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}
.container{max-width:600px;margin:0 auto;padding:48px 24px}
h1{font-size:1.4rem;font-weight:700;color:var(--text);letter-spacing:-0.02em;margin-bottom:4px}
.uid{color:var(--text-muted);font-size:0.75rem;margin-bottom:32px;font-family:'SF Mono','Fira Code',Consolas,monospace}
.grid{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin:24px 0}
.card{padding:24px 16px;text-align:center;border-right:1px solid var(--border);border-bottom:1px solid var(--border);transition:background 0.2s}
.card:nth-child(3n){border-right:none}
.card:nth-child(n+4){border-bottom:none}
.card:hover{background:var(--bg-secondary)}
.card .val{font-size:1.5rem;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;letter-spacing:-0.02em}
.card .lbl{color:var(--text-muted);font-size:0.65rem;margin-top:4px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600}
.meta{color:var(--text-muted);font-size:0.8rem;margin-top:16px;line-height:1.6}
.none{text-align:center;padding:100px 20px}
.none h2{color:var(--text);font-size:1.4rem;font-weight:700;letter-spacing:-0.02em;margin-bottom:12px}
.none p{color:var(--text-secondary);margin-top:8px;font-size:0.95rem}
.none code{color:var(--text);background:var(--bg-secondary);border:1px solid var(--border);padding:6px 16px;border-radius:6px;font-size:0.85rem;font-family:'SF Mono','Fira Code',Consolas,monospace;display:inline-block;margin-top:16px}
.back{color:var(--text-secondary);text-decoration:none;display:inline-flex;align-items:center;gap:6px;margin-top:32px;font-size:0.85rem;font-weight:500;transition:color 0.2s}
.back:hover{color:var(--accent)}
@media(max-width:480px){.grid{grid-template-columns:repeat(2,1fr)} .card:nth-child(3n){border-right:1px solid var(--border)} .card:nth-child(2n){border-right:none}}
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
<h1>Your Dashboard</h1>
<p class="uid">${userId}</p>
<div class="grid">
  <div class="card"><div class="val">${stats.totalRequests}</div><div class="lbl">Requests</div></div>
  <div class="card"><div class="val">$${stats.totalSpend.toFixed(2)}</div><div class="lbl">Spend</div></div>
  <div class="card"><div class="val">$${stats.savedMoney.toFixed(2)}</div><div class="lbl">Saved</div></div>
  <div class="card"><div class="val">${stats.blockedLoops}</div><div class="lbl">Loops Blocked</div></div>
  <div class="card"><div class="val">${stats.totalTokens.toLocaleString()}</div><div class="lbl">Tokens</div></div>
  <div class="card"><div class="val">${Math.round(stats.savedTokens).toLocaleString()}</div><div class="lbl">Cached</div></div>
</div>
<p class="meta">First seen: ${stats.firstSeen}<br>Last active: ${stats.lastSeen}</p>`;
}

function renderEmpty(): string {
  return `
<div class="none">
  <h2>No data yet</h2>
  <p>Route some traffic through the firewall to see your stats here.</p>
  <code>$ npx vibe-billing setup</code>
</div>`;
}
