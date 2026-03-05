import { getUserStats, UserBudget } from '../budgetGovernor';
import { getUserSessions, SessionData } from '../sessionTracker';

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

/* Session history */
.sessions{margin-top:40px}
.sessions h2{font-size:1.1rem;font-weight:700;letter-spacing:-0.02em;color:var(--text);margin-bottom:16px}
.sessions-table{width:100%;border:1px solid var(--border);border-radius:12px;overflow:hidden;border-collapse:separate;border-spacing:0;font-size:0.82rem}
.sessions-table thead{background:var(--bg-secondary)}
.sessions-table th{padding:10px 14px;text-align:left;font-weight:600;color:var(--text-muted);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border)}
.sessions-table td{padding:10px 14px;border-bottom:1px solid var(--border);color:var(--text-secondary);font-variant-numeric:tabular-nums}
.sessions-table tr:last-child td{border-bottom:none}
.sessions-table tr:hover td{background:var(--bg-secondary)}
.sessions-table .s-id{font-family:'SF Mono','Fira Code',Consolas,monospace;font-size:0.75rem;color:var(--text-muted)}
.sessions-table .s-saved{color:#16a34a;font-weight:600}
.sessions-table .s-spend{color:var(--text);font-weight:600}
.s-status{display:inline-flex;padding:2px 8px;border-radius:100px;font-size:0.7rem;font-weight:600}
.s-status.active{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0}
.s-status.expired{background:var(--bg-secondary);color:var(--text-muted);border:1px solid var(--border)}
.sessions-empty{text-align:center;padding:32px 16px;color:var(--text-muted);font-size:0.85rem}
.s-models{font-size:0.72rem;color:var(--text-muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:480px){
  .grid{grid-template-columns:repeat(2,1fr)} .card:nth-child(3n){border-right:1px solid var(--border)} .card:nth-child(2n){border-right:none}
  .sessions-table{font-size:0.75rem}
  .sessions-table th:nth-child(n+5),.sessions-table td:nth-child(n+5){display:none}
}
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
  const sessions = getUserSessions(userId).sort((a, b) =>
    new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
  );

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
<p class="meta">First seen: ${stats.firstSeen}<br>Last active: ${stats.lastSeen}</p>
${renderSessions(sessions)}`;
}

function renderSessions(sessions: SessionData[]): string {
  if (sessions.length === 0) {
    return `<div class="sessions"><h2>Sessions</h2><div class="sessions-empty">No sessions recorded yet.</div></div>`;
  }

  const rows = sessions.map(s => {
    const models = Object.keys(s.models).join(', ') || '-';
    const created = new Date(s.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const statusCls = s.status === 'active' ? 'active' : 'expired';
    return `<tr>
      <td class="s-id">${s.sessionId.slice(0, 8)}</td>
      <td>${created}</td>
      <td class="s-spend">$${s.totalSpend.toFixed(2)}</td>
      <td class="s-saved">${s.savedMoney > 0 ? '-$' + s.savedMoney.toFixed(2) : '-'}</td>
      <td>${s.totalRequests}</td>
      <td class="s-models" title="${models}">${models}</td>
      <td><span class="s-status ${statusCls}">${s.status}</span></td>
    </tr>`;
  }).join('\n');

  return `
<div class="sessions">
  <h2>Sessions</h2>
  <table class="sessions-table">
    <thead><tr>
      <th>ID</th><th>Started</th><th>Spend</th><th>Saved</th><th>Reqs</th><th>Models</th><th>Status</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

function renderEmpty(): string {
  return `
<div class="none">
  <h2>No data yet</h2>
  <p>Route some traffic through the firewall to see your stats here.</p>
  <code>$ npx vibe-billing setup</code>
</div>`;
}
