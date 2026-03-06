import { getAggregateStats } from '../budgetGovernor';
import { globalStats } from '../stats';

function statusClass(s: string): string {
  if (s.includes('Compressed') && s.includes('CDN')) return 'cached';
  if (s.includes('CDN')) return 'cached';
  if (s.includes('Compressed')) return 'compressed';
  if (s.includes('Blocked') || s.includes('Loop') || s.includes('Budget') || s.includes('No Progress')) return 'blocked';
  if (s.includes('Failover') || s.includes('Shadow') || s.includes('429')) return 'rerouted';
  return 'pass';
}

function statusLabel(s: string): string {
  if (s.includes('Compressed') && s.includes('CDN')) return 'Cached + Compressed';
  if (s.includes('CDN')) return 'Cache Hit';
  if (s.includes('Compressed')) return 'Compressed';
  if (s.includes('Loop')) return 'Loop Killed';
  if (s.includes('Budget')) return 'Budget Block';
  if (s.includes('No Progress')) return 'Stopped';
  if (s.includes('Blocked')) return 'Blocked';
  if (s.includes('Failover') || s.includes('Shadow')) return 'Failover';
  if (s.includes('429')) return 'Rate Limited';
  return 'Proxied';
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function renderLandingPage(): string {
  const agg = getAggregateStats();
  const recentFeed = globalStats.recentActivity.slice(0, 10).map((a: any) => {
    const ttft = a.ttftMs ? `${a.ttftMs < 1000 ? a.ttftMs + 'ms' : (a.ttftMs / 1000).toFixed(1) + 's'}` : '-';
    const saved = a.saved ? `-$${a.saved}` : '-';
    return `<tr>
      <td class="mono">${a.time}</td>
      <td>${a.model}</td>
      <td class="mono">${a.tokens}</td>
      <td class="mono">${ttft}</td>
      <td class="mono saved">${saved}</td>
      <td><span class="status ${statusClass(a.status)}">${statusLabel(a.status)}</span></td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vibe Billing</title>
<meta name="description" content="Developer-native runtime control for autonomous agents.">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%23121a16'/><text x='50' y='70' font-size='52' text-anchor='middle' fill='white' font-family='system-ui'>VB</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
<style>
:root {
  --paper: #f4efe6;
  --paper-2: #ebe4d8;
  --ink: #111512;
  --ink-soft: #4f5b54;
  --ink-muted: #7a867f;
  --line: rgba(17, 21, 18, 0.12);
  --line-strong: rgba(17, 21, 18, 0.22);
  --panel: rgba(255, 252, 247, 0.82);
  --terminal: #121916;
  --terminal-soft: #1a231f;
  --terminal-line: rgba(200, 230, 215, 0.1);
  --green: #177a52;
  --green-soft: rgba(23, 122, 82, 0.12);
  --blue: #2c66d0;
  --blue-soft: rgba(44, 102, 208, 0.12);
  --amber: #9a5b14;
  --amber-soft: rgba(154, 91, 20, 0.12);
  --rose: #a33a49;
  --rose-soft: rgba(163, 58, 73, 0.12);
  --shadow: 0 18px 60px rgba(42, 41, 36, 0.08);
}
*{box-sizing:border-box;margin:0;padding:0}
body {
  font-family:'IBM Plex Sans',system-ui,sans-serif;
  color:var(--ink);
  background:
    radial-gradient(circle at top left, rgba(23,122,82,0.08), transparent 28%),
    radial-gradient(circle at top right, rgba(44,102,208,0.08), transparent 32%),
    linear-gradient(180deg, #f7f3ea 0%, var(--paper) 50%, #f2ecdf 100%);
}
a{color:inherit}
.shell{max-width:1240px;margin:0 auto;padding:24px 20px 48px}
.header,.panel,.terminal,.table-card,.proof-card,.mini-card,.compat-card,.footer{
  border:1px solid var(--line);
  box-shadow:var(--shadow);
}
.header{
  display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;
  padding:16px 18px;border-radius:22px;background:rgba(255,252,247,0.76);backdrop-filter:blur(10px);
}
.brand{display:flex;align-items:center;gap:12px}
.mark{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;background:var(--terminal);color:#f6f1e8;font:700 0.95rem 'Space Grotesk',sans-serif}
.brand strong{display:block;font:700 1.18rem 'Space Grotesk',sans-serif;letter-spacing:-0.04em}
.brand span{display:block;color:var(--ink-muted);font-size:0.8rem;margin-top:2px}
.nav{display:flex;gap:10px;flex-wrap:wrap}
.nav a{text-decoration:none;padding:9px 12px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,0.55);font-size:0.84rem;color:var(--ink-soft)}
.nav a:hover{border-color:var(--line-strong);color:var(--ink)}
.hero{display:grid;grid-template-columns:1.15fr 0.85fr;gap:18px;margin-top:18px}
.panel{border-radius:28px;background:var(--panel);backdrop-filter:blur(10px)}
.hero-copy{padding:30px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;background:#fff;border:1px solid var(--line);font-size:0.75rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--ink-muted)}
.eyebrow .dot{width:8px;height:8px;border-radius:50%;background:var(--green)}
.hero h1{margin-top:18px;font:700 clamp(3.4rem,7vw,5.9rem) 'Space Grotesk',sans-serif;line-height:0.92;letter-spacing:-0.08em;max-width:9ch}
.hero p{margin-top:18px;max-width:58ch;font-size:1.04rem;line-height:1.7;color:var(--ink-soft)}
.hero-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}
.button{display:inline-flex;align-items:center;gap:10px;padding:13px 18px;border-radius:14px;text-decoration:none;font-weight:700;font-size:0.9rem;border:1px solid var(--line-strong)}
.button.primary{background:var(--terminal);color:#f7f3ea;border-color:var(--terminal)}
.button.secondary{background:#fff;color:var(--ink)}
.callout{margin-top:24px;padding:18px 20px;border-radius:18px;background:#fff;border:1px solid var(--line)}
.callout strong{display:block;font-size:0.9rem;margin-bottom:8px}
.callout p{margin-top:0;font-size:0.92rem;color:var(--ink-soft);line-height:1.6}
.hero-side{display:grid;gap:18px}
.terminal{padding:18px;border-radius:28px;background:linear-gradient(180deg, var(--terminal) 0%, #161e1a 100%);color:#d7eadf;border-color:var(--terminal-line)}
.term-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}
.term-head h2{font:700 1rem 'Space Grotesk',sans-serif;letter-spacing:-0.03em;color:#eef6f1}
.term-pill{padding:6px 10px;border-radius:999px;border:1px solid rgba(215,234,223,0.12);color:#9cb6aa;font-size:0.72rem}
.term-block{padding:14px;border-radius:18px;background:rgba(255,255,255,0.03);border:1px solid var(--terminal-line);margin-bottom:12px}
.term-label{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px;font-size:0.76rem;color:#9cb6aa;text-transform:uppercase;letter-spacing:0.12em}
.term-code{display:block;padding:12px 14px;border-radius:14px;background:#0d1311;border:1px solid rgba(215,234,223,0.08);font:500 0.84rem 'IBM Plex Mono',monospace;color:#f2f7f4}
.term-output{margin-top:14px;padding:16px;border-radius:16px;background:#0d1311;border:1px solid rgba(215,234,223,0.08);font:500 0.8rem 'IBM Plex Mono',monospace;line-height:1.7}
.term-output .good{color:#5de0a2}
.term-output .warn{color:#f2bf74}
.term-note{margin-top:12px;font-size:0.78rem;line-height:1.6;color:#9cb6aa}
.proof-card{padding:18px;border-radius:28px;background:#fffaf3}
.proof-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}
.proof-title h2{font:700 1rem 'Space Grotesk',sans-serif;letter-spacing:-0.03em}
.proof-title p{max-width:32ch;color:var(--ink-muted);font-size:0.82rem;line-height:1.55}
.proof-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.mini-card{padding:14px;border-radius:18px;background:#fff;border:1px solid var(--line)}
.mini-card .k{font-size:0.68rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--ink-muted)}
.mini-card .v{margin-top:8px;font:700 1.55rem 'Space Grotesk',sans-serif;letter-spacing:-0.05em}
.mini-card .s{margin-top:6px;font-size:0.8rem;color:var(--ink-soft);line-height:1.5}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:18px}
.metric{padding:18px;border-radius:20px;background:#fff;border:1px solid var(--line)}
.metric .k{font-size:0.68rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--ink-muted)}
.metric .v{margin-top:10px;font:700 1.9rem 'Space Grotesk',sans-serif;letter-spacing:-0.05em}
.metric .s{margin-top:6px;font-size:0.8rem;color:var(--ink-soft)}
.sections{display:grid;grid-template-columns:1.2fr 0.8fr;gap:18px;margin-top:18px}
.table-card{padding:20px;border-radius:28px;background:rgba(255,252,247,0.78);backdrop-filter:blur(10px)}
.section-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;margin-bottom:14px;flex-wrap:wrap}
.section-head h2{font:700 1.18rem 'Space Grotesk',sans-serif;letter-spacing:-0.04em}
.section-head p{max-width:46ch;color:var(--ink-muted);font-size:0.84rem;line-height:1.55}
.section-pill{padding:7px 10px;border-radius:999px;background:#fff;border:1px solid var(--line);font-size:0.76rem;font-weight:700;color:var(--ink-soft)}
.table-wrap{overflow:auto;border-radius:18px;border:1px solid var(--line)}
table{width:100%;border-collapse:collapse;background:#fff}
th,td{padding:11px 12px;border-bottom:1px solid var(--line);text-align:left;font-size:0.82rem}
th{font-size:0.68rem;text-transform:uppercase;letter-spacing:0.14em;color:var(--ink-muted);font-weight:700;background:#faf6ee}
tr:last-child td{border-bottom:none}
tr:hover td{background:#fbf8f2}
.mono{font-family:'IBM Plex Mono',monospace}
.saved{color:var(--green);font-weight:600}
.status{display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;border:1px solid transparent;font-size:0.7rem;font-weight:700}
.status.pass{background:#f3f0ea;color:var(--ink-soft);border-color:var(--line)}
.status.cached{background:var(--green-soft);color:var(--green);border-color:rgba(23,122,82,0.16)}
.status.compressed{background:var(--blue-soft);color:var(--blue);border-color:rgba(44,102,208,0.16)}
.status.rerouted{background:var(--amber-soft);color:var(--amber);border-color:rgba(154,91,20,0.16)}
.status.blocked{background:var(--rose-soft);color:var(--rose);border-color:rgba(163,58,73,0.16)}
.side-stack{display:grid;gap:18px}
.compat-card,.notes-card{padding:20px;border-radius:28px;background:rgba(255,252,247,0.78);backdrop-filter:blur(10px)}
.list{display:grid;gap:12px}
.list-row{padding:14px 16px;border-radius:16px;background:#fff;border:1px solid var(--line)}
.list-row strong{display:block;font-size:0.9rem;margin-bottom:6px}
.list-row p{font-size:0.82rem;line-height:1.55;color:var(--ink-soft)}
.list-row code{font-family:'IBM Plex Mono',monospace;font-size:0.76rem;color:var(--ink)}
.footer{margin-top:18px;padding:16px 18px;border-radius:20px;background:rgba(255,252,247,0.76);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:0.78rem;color:var(--ink-muted)}
@media (max-width: 1080px) {
  .hero,.sections{grid-template-columns:1fr}
  .metrics{grid-template-columns:repeat(2,1fr)}
}
@media (max-width: 700px) {
  .shell{padding:16px 14px 32px}
  .hero-copy,.terminal,.proof-card,.table-card,.compat-card,.notes-card{padding:18px}
  .metrics,.proof-grid{grid-template-columns:1fr}
  th:nth-child(4),td:nth-child(4),th:nth-child(5),td:nth-child(5){display:none}
}
</style>
</head>
<body>
<div class="shell">
  <div class="header">
    <div class="brand">
      <div class="mark">VB</div>
      <div>
        <strong>Vibe Billing</strong>
        <span>Runtime control for autonomous agents</span>
      </div>
    </div>
    <div class="nav">
      <a href="#flow">Workflow</a>
      <a href="#proof">Live Proof</a>
      <a href="/admin">Admin</a>
      <a href="https://github.com/shinertx/agentic-firewall" target="_blank">GitHub</a>
    </div>
  </div>

  <section class="hero">
    <div class="panel hero-copy">
      <div class="eyebrow"><span class="dot"></span><span>Scan -> Setup -> Receipt</span></div>
      <h1>Show the waste. Install the fix. Prove the savings.</h1>
      <p>Find wasted spend in agent runs, route traffic through the proxy, and verify the result with receipts and request history.</p>
      <div class="hero-actions">
        <a class="button primary" href="#flow">See the flow</a>
        <a class="button secondary" href="https://www.npmjs.com/package/vibe-billing" target="_blank">View npm</a>
      </div>
      <div class="callout">
        <strong>What it does</strong>
        <p>Loop detection, spend caps, context caching, routing, and receipts for agent traffic.</p>
      </div>
    </div>

    <div class="hero-side">
      <div class="terminal">
        <div class="term-head">
          <h2>Core workflow</h2>
          <div class="term-pill">Staging only</div>
        </div>
        <div class="term-block">
          <div class="term-label"><span>1. Scan local waste</span><span>First value</span></div>
          <code class="term-code">$ npx vibe-billing scan</code>
        </div>
        <div class="term-block">
          <div class="term-label"><span>2. Install protection</span><span>One command</span></div>
          <code class="term-code">$ npx vibe-billing setup</code>
        </div>
        <div class="term-block" style="margin-bottom:0">
          <div class="term-label"><span>3. Print the receipt</span><span>After the run</span></div>
          <code class="term-code">$ npx vibe-billing receipt</code>
        </div>
        <div class="term-output">
          &gt; Estimated avoidable spend: <span class="good">$38.72</span><br>
          &gt; Retry loops: <span class="warn">$21.40</span><br>
          &gt; Re-sent context: <span class="warn">$12.30</span><br>
          &gt; Overpowered models: <span class="warn">$5.02</span><br>
          &gt; Next step: <span class="good">npx vibe-billing setup</span>
        </div>
        <div class="term-note">Example output for <code>scan</code>. Live counters below come from the current backend.</div>
      </div>

      <div class="proof-card">
        <div class="proof-title">
          <div>
            <h2>Proof substrate</h2>
          </div>
          <p>Current npm, install, savings, and intervention counters.</p>
        </div>
        <div class="proof-grid">
          <div class="mini-card"><div class="k">npm weekly</div><div class="v" id="npmWeekly">0</div><div class="s">Existing package continuity</div></div>
          <div class="mini-card"><div class="k">unique installs</div><div class="v" id="installs">0</div><div class="s">CLI telemetry path preserved</div></div>
          <div class="mini-card"><div class="k">community saved</div><div class="v" id="communitySaved">$0</div><div class="s">Public backend counter</div></div>
          <div class="mini-card"><div class="k">blocked loops</div><div class="v" id="communityLoops">0</div><div class="s">Intervention count intact</div></div>
        </div>
      </div>
    </div>
  </section>

  <section class="metrics" id="flow">
    <div class="metric"><div class="k">Operators</div><div class="v" id="users">${fmtNum(agg.totalUsers)}</div><div class="s">Aggregate observed by the system</div></div>
    <div class="metric"><div class="k">Saved</div><div class="v" id="saved">${fmtMoney(agg.totalSaved)}</div><div class="s">Current public savings counter</div></div>
    <div class="metric"><div class="k">Requests</div><div class="v" id="reqs">${fmtNum(globalStats.totalRequests)}</div><div class="s">Protected requests observed</div></div>
    <div class="metric"><div class="k">Loops stopped</div><div class="v" id="loops">${fmtNum(globalStats.blockedLoops)}</div><div class="s">Hard interventions issued</div></div>
  </section>

  <section class="sections">
    <div class="table-card" id="proof">
      <div class="section-head">
        <div>
          <h2>Live proof</h2>
          <p>Recent protected traffic, intervention events, and savings.</p>
        </div>
        <div class="section-pill" id="feedSavings">${fmtMoney(agg.totalSaved)} saved</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Model / Action</th>
              <th>Tokens</th>
              <th>TTFT</th>
              <th>Saved</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="feedBody">
            ${recentFeed || '<tr><td colspan="6" style="padding:30px 12px;text-align:center;color:var(--ink-muted)">Listening for traffic...</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="side-stack">
      <div class="compat-card">
        <div class="section-head">
          <div>
            <h2>Core controls</h2>
            <p>Parts that matter during real runs.</p>
          </div>
        </div>
        <div class="list">
          <div class="list-row"><strong>Spend caps</strong><p>Stop sessions when they cross a defined budget.</p></div>
          <div class="list-row"><strong>Loop detection</strong><p>Block repeated no-progress requests before they spiral.</p></div>
          <div class="list-row"><strong>Receipts</strong><p>Show savings, cached context, and interventions after the run.</p></div>
        </div>
      </div>

      <div class="notes-card">
        <div class="section-head">
          <div>
            <h2>Compatibility</h2>
            <p>Common integration targets.</p>
          </div>
        </div>
        <div class="list">
          <div class="list-row"><strong>Claude Code / CLI agents</strong><p>Base-URL compatible agent runtimes.</p></div>
          <div class="list-row"><strong>OpenAI Agents SDK</strong><p>Routing and receipts around SDK-managed requests.</p></div>
          <div class="list-row"><strong>MCP-era agent stacks</strong><p>Control layer around tool-using workflows.</p></div>
        </div>
      </div>
    </div>
  </section>

  <div class="footer">
    <div>Vibe Billing</div>
    <div>Staging</div>
  </div>
</div>

<script>
function fmtN(v) { return Math.round(v).toLocaleString('en-US'); }
function fmtM(v) { return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function statusClass(s) {
  if (s.includes('Compressed') && s.includes('CDN')) return 'cached';
  if (s.includes('CDN')) return 'cached';
  if (s.includes('Compressed')) return 'compressed';
  if (s.includes('Blocked') || s.includes('Loop') || s.includes('Budget') || s.includes('No Progress')) return 'blocked';
  if (s.includes('Failover') || s.includes('Shadow') || s.includes('429')) return 'rerouted';
  return 'pass';
}
function statusLabel(s) {
  if (s.includes('Compressed') && s.includes('CDN')) return 'Cached + Compressed';
  if (s.includes('CDN')) return 'Cache Hit';
  if (s.includes('Compressed')) return 'Compressed';
  if (s.includes('Loop')) return 'Loop Killed';
  if (s.includes('Budget')) return 'Budget Block';
  if (s.includes('No Progress')) return 'Stopped';
  if (s.includes('Blocked')) return 'Blocked';
  if (s.includes('Failover') || s.includes('Shadow')) return 'Failover';
  if (s.includes('429')) return 'Rate Limited';
  return 'Proxied';
}
function rowHTML(item) {
  var ttft = item.ttftMs ? (item.ttftMs < 1000 ? item.ttftMs + 'ms' : (item.ttftMs / 1000).toFixed(1) + 's') : '-';
  var saved = item.saved ? '-$' + item.saved : '-';
  return '<tr>' +
    '<td class="mono">' + item.time + '</td>' +
    '<td>' + item.model + '</td>' +
    '<td class="mono">' + item.tokens + '</td>' +
    '<td class="mono">' + ttft + '</td>' +
    '<td class="mono saved">' + saved + '</td>' +
    '<td><span class="status ' + statusClass(item.status) + '">' + statusLabel(item.status) + '</span></td>' +
    '</tr>';
}
function animateValue(el, start, end, duration, format) {
  if (!el || start === end) { if (el) el.textContent = format(end); return; }
  var range = end - start;
  var startTime = performance.now();
  function step(now) {
    var elapsed = now - startTime;
    var progress = Math.min(elapsed / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = format(start + range * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
var prev = {
  users: ${agg.totalUsers},
  saved: ${agg.totalSaved},
  reqs: ${globalStats.totalRequests},
  loops: ${globalStats.blockedLoops}
};
async function pollPublicStats() {
  try {
    var r = await fetch('/api/public-stats');
    if (!r.ok) return;
    var d = await r.json();
    animateValue(document.getElementById('users'), prev.users, d.totalUsers, 900, fmtN);
    animateValue(document.getElementById('saved'), prev.saved, d.totalSaved, 900, fmtM);
    animateValue(document.getElementById('reqs'), prev.reqs, d.totalRequests, 900, fmtN);
    animateValue(document.getElementById('loops'), prev.loops, d.blockedLoops, 900, fmtN);
    prev = { users: d.totalUsers, saved: d.totalSaved, reqs: d.totalRequests, loops: d.blockedLoops };
    document.getElementById('feedSavings').textContent = fmtM(d.totalSaved) + ' saved';
    var body = document.getElementById('feedBody');
    if (body && d.recentFeed && d.recentFeed.length) {
      body.innerHTML = d.recentFeed.map(rowHTML).join('');
    }
  } catch (e) {}
}
async function pollInstallStats() {
  try {
    var installs = await fetch('/api/install-breakdown');
    if (installs.ok) {
      var installData = await installs.json();
      document.getElementById('installs').textContent = fmtN(installData.uniqueInstalls || 0);
    }
  } catch (e) {}
  try {
    var npm = await fetch('/api/npm-stats');
    if (npm.ok) {
      var npmData = await npm.json();
      document.getElementById('npmWeekly').textContent = fmtN(npmData.weekly || 0);
    }
  } catch (e) {}
  try {
    var stats = await fetch('/api/stats');
    if (stats.ok) {
      var s = await stats.json();
      document.getElementById('communitySaved').textContent = fmtM(s.savedMoney || 0);
      document.getElementById('communityLoops').textContent = fmtN(s.blockedLoops || 0);
    }
  } catch (e) {}
}
pollPublicStats();
pollInstallStats();
setInterval(pollPublicStats, 5000);
setInterval(pollInstallStats, 30000);
</script>
</body>
</html>`;
}
