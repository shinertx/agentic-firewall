import { getUserStats, UserBudget } from '../budgetGovernor';
import { getUserSessions, SessionData } from '../sessionTracker';

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function renderDashboard(userId: string): string {
  const stats = getUserStats(userId);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard — Vibe Billing</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%230f8f6f'/><text x='50' y='70' font-size='52' text-anchor='middle' fill='white' font-family='system-ui'>VB</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #07110f;
  --panel: rgba(10, 19, 17, 0.94);
  --panel-soft: rgba(255, 255, 255, 0.03);
  --border: rgba(157, 184, 173, 0.14);
  --border-strong: rgba(157, 184, 173, 0.24);
  --text: #ecf4f1;
  --text-soft: #b5c8c1;
  --text-muted: #7f968f;
  --signal: #34d399;
  --signal-soft: rgba(52, 211, 153, 0.12);
  --blue: #5ab1ff;
  --blue-soft: rgba(90, 177, 255, 0.12);
  --ember: #ff875b;
  --ember-soft: rgba(255, 135, 91, 0.12);
  --danger: #ff7d89;
  --danger-soft: rgba(255, 125, 137, 0.12);
}
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:'IBM Plex Sans',system-ui,sans-serif;
  background:
    radial-gradient(circle at top left, rgba(52,211,153,0.08), transparent 30%),
    radial-gradient(circle at top right, rgba(90,177,255,0.08), transparent 32%),
    linear-gradient(180deg, #06100f 0%, #081412 38%, #07110f 100%);
  color:var(--text);
  min-height:100vh;
}
.container{max-width:1120px;margin:0 auto;padding:28px 18px 48px}
.panel{background:var(--panel);border:1px solid var(--border);box-shadow:0 24px 70px rgba(0,0,0,0.32);backdrop-filter:blur(10px)}
.hero{border-radius:28px;padding:28px}
.hero-top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;flex-wrap:wrap}
.brand-chip{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;border:1px solid rgba(52,211,153,0.22);background:var(--signal-soft);color:var(--signal);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.2em;margin-bottom:14px}
.hero h1{font-family:'Space Grotesk',sans-serif;font-size:clamp(2rem,4vw,3rem);letter-spacing:-0.06em;margin-bottom:6px}
.uid{color:var(--text-muted);font-size:0.82rem;font-family:'IBM Plex Mono',monospace;word-break:break-all}
.hero-sub{margin-top:14px;max-width:70ch;color:var(--text-soft);font-size:0.98rem;line-height:1.7}
.back{display:inline-flex;align-items:center;gap:8px;color:var(--text-soft);text-decoration:none;font-size:0.9rem;font-weight:600;padding:12px 14px;border-radius:14px;border:1px solid var(--border);background:var(--panel-soft)}
.back:hover{border-color:var(--border-strong);color:var(--text)}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:22px}
.card{padding:20px;border-radius:22px;background:var(--panel-soft);border:1px solid rgba(157,184,173,0.1)}
.card .val{font-size:2rem;font-family:'Space Grotesk',sans-serif;font-weight:700;letter-spacing:-0.05em;color:var(--text)}
.card .lbl{color:var(--text-muted);font-size:0.72rem;margin-top:6px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700}
.meta{color:var(--text-soft);font-size:0.9rem;margin-top:16px;line-height:1.7}
.none{text-align:center;padding:100px 20px;border-radius:28px}
.none h2{font-family:'Space Grotesk',sans-serif;color:var(--text);font-size:2rem;letter-spacing:-0.05em;margin-bottom:12px}
.none p{color:var(--text-soft);margin-top:8px;font-size:0.98rem;line-height:1.7}
.none code{color:var(--text);background:#061211;border:1px solid var(--border);padding:10px 16px;border-radius:14px;font-size:0.9rem;font-family:'IBM Plex Mono',monospace;display:inline-block;margin-top:18px}
.sessions{margin-top:18px;border-radius:28px;padding:24px}
.sessions-head{display:flex;justify-content:space-between;gap:16px;align-items:end;margin-bottom:16px;flex-wrap:wrap}
.sessions h2{font-family:'Space Grotesk',sans-serif;font-size:1.4rem;letter-spacing:-0.04em;color:var(--text)}
.sessions p{color:var(--text-soft);font-size:0.92rem;line-height:1.65}
.sessions-table{width:100%;border:1px solid var(--border);border-radius:20px;overflow:hidden;border-collapse:separate;border-spacing:0;font-size:0.84rem;background:#061211}
.sessions-table thead{background:rgba(255,255,255,0.02)}
.sessions-table th{padding:12px 14px;text-align:left;font-weight:700;color:var(--text-muted);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.12em;border-bottom:1px solid var(--border)}
.sessions-table td{padding:12px 14px;border-bottom:1px solid rgba(157,184,173,0.08);color:var(--text-soft);font-variant-numeric:tabular-nums}
.sessions-table tr:last-child td{border-bottom:none}
.sessions-table tr:hover td{background:rgba(255,255,255,0.02)}
.sessions-table .s-id{font-family:'IBM Plex Mono',monospace;font-size:0.76rem;color:var(--text-muted)}
.sessions-table .s-saved{color:var(--signal);font-weight:700}
.sessions-table .s-spend{color:var(--text);font-weight:700}
.s-status{display:inline-flex;padding:4px 10px;border-radius:999px;font-size:0.7rem;font-weight:700;border:1px solid transparent}
.s-status.active{background:var(--signal-soft);color:var(--signal);border-color:rgba(52,211,153,0.22)}
.s-status.expired{background:var(--blue-soft);color:var(--blue);border-color:rgba(90,177,255,0.18)}
.sessions-empty{text-align:center;padding:32px 16px;color:var(--text-muted);font-size:0.9rem}
.s-models{font-size:0.76rem;color:var(--text-muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:860px){
  .grid{grid-template-columns:repeat(2,1fr)}
}
@media(max-width:560px){
  .container{padding:18px 14px 32px}
  .hero,.sessions{padding:20px}
  .grid{grid-template-columns:1fr}
  .sessions-table{font-size:0.76rem}
  .sessions-table th:nth-child(n+5),.sessions-table td:nth-child(n+5){display:none}
}
</style>
</head>
<body>
<div class="container">
${stats ? renderUserStats(userId, stats) : renderEmpty()}
</div>
<script>
var DASH_USER = '${userId}';
var DASH_URL = '/api/dashboard/' + DASH_USER;

function statusCls(s) { return s === 'active' ? 'active' : 'expired'; }
function fmtM(v) { return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function pollDashboard() {
  try {
    var r = await fetch(DASH_URL);
    if (!r.ok) return;
    var d = await r.json();
    if (!d.stats) return;
    var s = d.stats;
    var el = function(id) { return document.getElementById(id); };
    el('d-reqs').textContent = s.totalRequests;
    el('d-spend').textContent = fmtM(s.totalSpend);
    el('d-saved').textContent = fmtM(s.savedMoney);
    el('d-loops').textContent = s.blockedLoops;
    el('d-tokens').textContent = s.totalTokens.toLocaleString();
    el('d-cached').textContent = Math.round(s.savedTokens).toLocaleString();
    el('d-meta').innerHTML = 'First seen: ' + s.firstSeen + '<br>Last active: ' + s.lastSeen;

    var tbody = el('d-sessions');
    if (tbody && d.sessions && d.sessions.length > 0) {
      tbody.innerHTML = d.sessions.map(function(sess) {
        var models = Object.keys(sess.models || {}).join(', ') || '-';
        var dt = new Date(sess.createdAt);
        var created = dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        var sc = statusCls(sess.status);
        return '<tr>' +
          '<td class="s-id">' + sess.sessionId.slice(0, 8) + '</td>' +
          '<td>' + created + '</td>' +
          '<td class="s-spend">' + fmtM(sess.totalSpend) + '</td>' +
          '<td class="s-saved">' + (sess.savedMoney > 0 ? '-' + fmtM(sess.savedMoney) : '-') + '</td>' +
          '<td>' + sess.totalRequests + '</td>' +
          '<td class="s-models" title="' + models + '">' + models + '</td>' +
          '<td><span class="s-status ' + sc + '">' + sess.status + '</span></td>' +
          '</tr>';
      }).join('');
    }
  } catch (e) {}
}

setInterval(pollDashboard, 5000);
</script>
</body>
</html>`;
}

function renderUserStats(userId: string, stats: UserBudget): string {
  const sessions = getUserSessions(userId).sort((a, b) =>
    new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
  );

  return `
<div class="panel hero">
  <div class="hero-top">
    <div>
      <div class="brand-chip">Personal proof</div>
      <h1>Your Vibe Billing dashboard</h1>
      <p class="uid">${userId}</p>
      <p class="hero-sub">This page is the receipt layer for one operator. It shows protected requests, savings, blocked loops, and session history without mixing your stats into the public marketing story.</p>
    </div>
    <a href="/" class="back">← Back to Vibe Billing</a>
  </div>
  <div class="grid">
    <div class="card"><div class="val" id="d-reqs">${stats.totalRequests}</div><div class="lbl">Requests</div></div>
    <div class="card"><div class="val" id="d-spend">${fmtMoney(stats.totalSpend)}</div><div class="lbl">Spend</div></div>
    <div class="card"><div class="val" id="d-saved">${fmtMoney(stats.savedMoney)}</div><div class="lbl">Saved</div></div>
    <div class="card"><div class="val" id="d-loops">${stats.blockedLoops}</div><div class="lbl">Loops Blocked</div></div>
    <div class="card"><div class="val" id="d-tokens">${stats.totalTokens.toLocaleString()}</div><div class="lbl">Tokens</div></div>
    <div class="card"><div class="val" id="d-cached">${Math.round(stats.savedTokens).toLocaleString()}</div><div class="lbl">Cached</div></div>
  </div>
  <p class="meta" id="d-meta">First seen: ${stats.firstSeen}<br>Last active: ${stats.lastSeen}</p>
</div>
${renderSessions(sessions)}`;
}

function renderSessions(sessions: SessionData[]): string {
  if (sessions.length === 0) {
    return `<div class="panel sessions"><div class="sessions-head"><div><h2>Sessions</h2><p>No sessions recorded yet.</p></div></div><div class="sessions-empty">Route some traffic through the proxy to populate this receipt layer.</div></div>`;
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
<div class="panel sessions">
  <div class="sessions-head">
    <div>
      <h2>Session history</h2>
      <p>Recent runs tied to this user. Savings and spend remain attributable at the session level.</p>
    </div>
  </div>
  <table class="sessions-table">
    <thead><tr>
      <th>ID</th><th>Started</th><th>Spend</th><th>Saved</th><th>Reqs</th><th>Models</th><th>Status</th>
    </tr></thead>
    <tbody id="d-sessions">${rows}</tbody>
  </table>
</div>`;
}

function renderEmpty(): string {
  return `
<div class="panel none">
  <h2>No data yet</h2>
  <p>Route some traffic through the control layer and this dashboard will start rendering your receipt history.</p>
  <code>$ npx vibe-billing setup</code>
</div>`;
}
