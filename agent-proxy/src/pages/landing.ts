import { getAggregateStats } from '../budgetGovernor';
import { globalStats } from '../stats';

/**
 * Renders the public landing page HTML with live aggregate stats.
 * Design: Light mode — Stripe/Notion-inspired. White bg, clean borders,
 * Inter font, one accent color (indigo-600), generous whitespace.
 */
export function renderLandingPage(): string {
  const agg = getAggregateStats();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Firewall — Agent Runtime Control</title>
<meta name="description" content="Keep autonomous AI agents under control. Loop detection, prompt caching, budget enforcement for Claude Code, OpenClaw, and any LLM agent.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
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
  --accent-light: #eef2ff;
  --accent-hover: #4338ca;
}

*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}

/* Nav */
.nav{display:flex;justify-content:space-between;align-items:center;padding:16px 32px;border-bottom:1px solid var(--border);max-width:1100px;margin:0 auto}
.nav .logo{font-weight:700;font-size:1rem;color:var(--text);display:flex;align-items:center;gap:8px}
.nav .logo span{font-size:1.1rem}
.nav a{color:var(--text-secondary);text-decoration:none;font-size:0.9rem;font-weight:500;transition:color 0.2s}
.nav a:hover{color:var(--text)}

/* Hero */
.hero{text-align:center;padding:80px 24px 64px;max-width:680px;margin:0 auto}
.badge{display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:100px;border:1px solid var(--border);font-size:0.8rem;color:var(--text-secondary);margin-bottom:24px;font-weight:500}
.badge .dot{width:6px;height:6px;border-radius:50%;background:#22c55e}
.hero h1{font-size:clamp(2.2rem,4.5vw,3.2rem);font-weight:800;letter-spacing:-0.035em;line-height:1.15;margin-bottom:16px;color:var(--text)}
.hero .sub{color:var(--text-secondary);font-size:1.1rem;max-width:480px;margin:0 auto 40px;line-height:1.6}

/* Stats Grid */
.stats{display:grid;grid-template-columns:repeat(4,1fr);max-width:560px;margin:0 auto 40px;border:1px solid var(--border);border-radius:12px;overflow:hidden}
.stat{padding:24px 16px;text-align:center;border-right:1px solid var(--border);transition:background 0.2s}
.stat:last-child{border-right:none}
.stat:hover{background:var(--bg-secondary)}
.stat .num{font-size:1.8rem;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;letter-spacing:-0.02em}
.stat .label{color:var(--text-muted);font-size:0.7rem;margin-top:4px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600}

/* CTA area */
.actions{display:flex;flex-direction:column;align-items:center;gap:12px}
.code{background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:10px 20px;font-family:'SF Mono','Fira Code',Consolas,monospace;font-size:0.85rem;color:var(--text);display:inline-flex;align-items:center;gap:8px;user-select:all;transition:border-color 0.2s}
.code:hover{border-color:var(--border-hover)}
.code .prefix{color:var(--text-muted)}
.cta{display:inline-block;background:var(--accent);color:#fff;padding:12px 28px;border-radius:8px;font-size:0.9rem;font-weight:600;text-decoration:none;transition:all 0.2s;letter-spacing:-0.01em}
.cta:hover{background:var(--accent-hover);transform:translateY(-1px);box-shadow:0 4px 12px rgba(79,70,229,0.25)}

/* Features */
.features-section{background:var(--bg-secondary);border-top:1px solid var(--border);padding:80px 24px}
.features{max-width:720px;margin:0 auto}
.features-header{text-align:center;margin-bottom:48px}
.features-header h2{font-size:1.5rem;font-weight:700;letter-spacing:-0.02em;color:var(--text)}
.features-header p{color:var(--text-secondary);margin-top:8px;font-size:0.95rem}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.feature{background:var(--bg);padding:24px;border-radius:12px;border:1px solid var(--border);transition:border-color 0.2s,box-shadow 0.2s}
.feature:hover{border-color:var(--border-hover);box-shadow:0 2px 8px rgba(0,0,0,0.04)}
.feature .icon{font-size:1.2rem;margin-bottom:10px}
.feature h3{color:var(--text);font-size:0.9rem;font-weight:600;margin-bottom:4px;letter-spacing:-0.01em}
.feature p{color:var(--text-secondary);font-size:0.8rem;line-height:1.55}

/* Terminal Section */
.terminal-section{background:#0d1117;min-height:50vh;display:flex;flex-direction:column}
.terminal{flex:1;display:flex;flex-direction:column;max-width:900px;width:100%;margin:0 auto}
.terminal-bar{display:flex;align-items:center;gap:8px;padding:12px 20px;background:#161b22;border-bottom:1px solid #30363d}
.terminal-dots{display:flex;gap:6px}
.terminal-dots span{width:10px;height:10px;border-radius:50%}
.terminal-dots span:nth-child(1){background:#ff5f57}
.terminal-dots span:nth-child(2){background:#febc2e}
.terminal-dots span:nth-child(3){background:#28c840}
.terminal-title{color:#8b949e;font-size:0.75rem;font-family:'SF Mono','Fira Code',Consolas,monospace;margin-left:10px;display:flex;align-items:center;gap:8px}
.terminal-title .pulse{width:6px;height:6px;border-radius:50%;background:#3fb950;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
.terminal-body{flex:1;padding:16px 0;font-family:'SF Mono','Fira Code',Consolas,monospace;font-size:0.82rem;line-height:1;overflow:hidden;position:relative;display:flex;flex-direction:column;justify-content:flex-end}
.terminal-line{display:flex;align-items:center;padding:5px 20px;height:30px;white-space:nowrap;opacity:0;transform:translateY(30px);animation:none}
.terminal-line.enter{animation:lineEnter 0.35s ease-out forwards}
.terminal-line.shift{animation:lineShift 0.35s ease-out forwards}
.terminal-line.exit{animation:lineExit 0.35s ease-out forwards}
@keyframes lineEnter{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
@keyframes lineShift{from{transform:translateY(30px)}to{transform:translateY(0)}}
@keyframes lineExit{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-30px)}}
.t-prompt{color:#8b949e;margin-right:10px;flex-shrink:0}
.t-model{color:#d2a8ff;flex-shrink:0}
.t-sep{color:#30363d;margin:0 10px;flex-shrink:0}
.t-tokens{color:#79c0ff;flex-shrink:0;min-width:64px;text-align:right}
.t-saved{color:#3fb950;margin-left:12px;flex-shrink:0;font-size:0.75rem;opacity:0.8}
.t-status{margin-left:auto;padding-left:16px;font-weight:500;flex-shrink:0}
.t-status.cdn{color:#3fb950}
.t-status.pass{color:#8b949e}
.t-status.blocked{color:#f85149}
.t-status.failover{color:#d29922}

/* Footer */
.footer{text-align:center;padding:40px 24px;color:var(--text-muted);font-size:0.8rem;border-top:1px solid var(--border)}

/* Responsive */
@media(max-width:640px){
  .stats{grid-template-columns:repeat(2,1fr)}
  .stat{border-bottom:1px solid var(--border)}
  .grid{grid-template-columns:1fr}
  .hero{padding:48px 20px 40px}
  .nav{padding:12px 20px}
}
</style>
</head>
<body>

<nav class="nav">
  <div class="logo"><span>🛡️</span> Agent Firewall</div>
  <a href="#features">Features</a>
</nav>

<div class="hero">
  <div class="badge"><span class="dot"></span>Live — proxying agent traffic now</div>
  <h1>Stop agents from burning your money</h1>
  <p class="sub">One command to add loop detection, prompt caching, shadow routing, and budget enforcement to any AI agent.</p>

  <div class="stats">
    <div class="stat"><div class="num" id="users">${agg.totalUsers}</div><div class="label">Users</div></div>
    <div class="stat"><div class="num" id="saved">$${agg.totalSaved.toFixed(2)}</div><div class="label">Saved</div></div>
    <div class="stat"><div class="num" id="reqs">${globalStats.totalRequests.toLocaleString()}</div><div class="label">Requests</div></div>
    <div class="stat"><div class="num" id="loops">${globalStats.blockedLoops}</div><div class="label">Loops Killed</div></div>
  </div>

  <div class="actions">
    <div class="code"><span class="prefix">$</span> npx vibe-billing setup</div>
    <a href="https://github.com/shinertx/agentic-firewall" target="_blank" class="cta">View on GitHub →</a>
  </div>
</div>

<div class="terminal-section">
  <div class="terminal">
    <div class="terminal-bar">
      <div class="terminal-dots"><span></span><span></span><span></span></div>
      <div class="terminal-title"><span class="pulse"></span> live traffic — agent-firewall</div>
    </div>
    <div class="terminal-body" id="termBody"></div>
  </div>
</div>

<div class="features-section" id="features">
  <div class="features">
    <div class="features-header">
      <h2>Everything you need to control agents</h2>
      <p>Works with Claude Code, OpenClaw, and any LLM-powered agent. <strong>Open-Source (MIT)</strong>.</p>
    </div>
    <div class="grid">
      <div class="feature"><div class="icon">🔍</div><h3>Waste Scanner</h3><p>Reads your agent logs. Shows exactly how much you're burning on retries, re-sends, and stuck loops.</p></div>
      <div class="feature"><div class="icon">🔄</div><h3>Loop Detection</h3><p>Circuit breaker kills stuck agents after repeated identical requests. No more overnight surprise bills.</p></div>
      <div class="feature"><div class="icon">💰</div><h3>Prompt Caching</h3><p>Auto-injects cache headers for Anthropic, OpenAI, Gemini, and NVIDIA. Saves up to 90% on repeated context.</p></div>
      <div class="feature"><div class="icon">⚡️</div><h3>Shadow Routing (Failover)</h3><p>Detects 429 Rate Limits and auto-downgrades models instantly (e.g. from Opus to Haiku, or across providers) to keep agents moving.</p></div>
      <div class="feature"><div class="icon">🚫</div><h3>Budget Governor</h3><p>Set per-session spend caps. Agents get a 402 when they hit the limit — hard kill, not a suggestion.</p></div>
      <div class="feature"><div class="icon">🧠</div><h3>No-Progress Detection</h3><p>Fingerprints tool failures. Same error 5 times? Stopped automatically.</p></div>
      <div class="feature"><div class="icon">📊</div><h3>Per-User Dashboard</h3><p>Every user gets a personal savings dashboard with spend tracking and loop history.</p></div>
      <div class="feature"><div class="icon">🔐</div><h3>Bring Your Own Keys</h3><p>Your API keys pass directly to the LLM. Never logged, never stored. Fully transparent operation.</p></div>
    </div>
  </div>
</div>

<div class="footer">
  <p>Agent Firewall — Agent Runtime Control</p>
  <p style="margin-top:8px;font-size:0.75rem"><a href="https://github.com/shinertx/agentic-firewall" target="_blank" style="color:var(--text-secondary);text-decoration:none;margin:0 8px">GitHub</a> • <a href="https://www.npmjs.com/package/vibe-billing" target="_blank" style="color:var(--text-secondary);text-decoration:none;margin:0 8px">npm</a></p>
</div>
<script>
// Animate a number from current to target over duration ms
function animateValue(el, start, end, duration, format) {
  if (start === end) return;
  const range = end - start;
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out cubic for a satisfying deceleration
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + range * eased;
    el.textContent = format(current);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Track previous values for smooth transitions
let prev = {
  users: ${agg.totalUsers},
  saved: ${agg.totalSaved},
  reqs: ${globalStats.totalRequests},
  loops: ${globalStats.blockedLoops}
};

// Terminal feed state
const MAX_LINES = 14;
let termLines = [];
let lastFeedJSON = '';

function statusClass(s) {
  if (s.includes('CDN')) return 'cdn';
  if (s.includes('Blocked') || s.includes('Loop') || s.includes('Budget') || s.includes('No Progress')) return 'blocked';
  if (s.includes('Failover') || s.includes('Shadow') || s.includes('429')) return 'failover';
  return 'pass';
}

function makeLine(item) {
  var saved = item.saved ? '<span class="t-saved">-$' + item.saved + '</span>' : '';
  return '<div class="terminal-line">' +
    '<span class="t-prompt">$</span>' +
    '<span class="t-model">' + item.model + '</span>' +
    '<span class="t-sep">|</span>' +
    '<span class="t-tokens">' + item.tokens + '</span>' +
    saved +
    '<span class="t-status ' + statusClass(item.status) + '">' + item.status + '</span>' +
  '</div>';
}

function renderFeed(feed) {
  const body = document.getElementById('termBody');
  if (!body || !feed || feed.length === 0) return;

  const feedJSON = JSON.stringify(feed);
  const isFirstRender = lastFeedJSON === '';

  // Detect new items by comparing to previous feed
  let newItems = [];
  if (isFirstRender) {
    // First load: show all items, animate them in staggered
    newItems = feed.slice().reverse(); // oldest first
  } else if (feedJSON !== lastFeedJSON) {
    // Find items not in previous feed (compare by model+tokens+status+time)
    const prevSet = new Set(JSON.parse(lastFeedJSON).map(i => i.model + i.tokens + i.status + i.time));
    for (let i = feed.length - 1; i >= 0; i--) {
      const key = feed[i].model + feed[i].tokens + feed[i].status + feed[i].time;
      if (!prevSet.has(key)) newItems.push(feed[i]);
    }
  }
  lastFeedJSON = feedJSON;
  if (newItems.length === 0) return;

  if (isFirstRender) {
    // Stagger all lines in on first load
    body.innerHTML = '';
    newItems.forEach((item, i) => {
      setTimeout(() => {
        pushLine(body, item);
      }, i * 120);
    });
  } else {
    // Push new lines one by one with small delay between
    newItems.forEach((item, i) => {
      setTimeout(() => pushLine(body, item), i * 400);
    });
  }
}

function pushLine(body, item) {
  const lines = body.querySelectorAll('.terminal-line');

  // If at capacity, animate the top line out
  if (lines.length >= MAX_LINES) {
    const top = lines[0];
    top.classList.remove('enter', 'shift');
    top.classList.add('exit');
    top.addEventListener('animationend', () => top.remove(), { once: true });
  }

  // Shift existing lines up (re-trigger shift animation)
  body.querySelectorAll('.terminal-line:not(.exit)').forEach(el => {
    el.classList.remove('enter', 'shift');
    void el.offsetWidth; // force reflow
    el.classList.add('shift');
  });

  // Add new line at the bottom with enter animation
  const div = document.createElement('div');
  div.innerHTML = makeLine(item);
  const newLine = div.firstChild;
  body.appendChild(newLine);
  requestAnimationFrame(() => newLine.classList.add('enter'));
}

async function pollStats() {
  try {
    const r = await fetch('/api/public-stats');
    if (!r.ok) return;
    const d = await r.json();
    animateValue(document.getElementById('users'), prev.users, d.totalUsers, 1500, v => Math.round(v));
    animateValue(document.getElementById('saved'), prev.saved, d.totalSaved, 2000, v => '$' + v.toFixed(2));
    animateValue(document.getElementById('reqs'), prev.reqs, d.totalRequests, 1500, v => Math.round(v).toLocaleString());
    animateValue(document.getElementById('loops'), prev.loops, d.blockedLoops, 1500, v => Math.round(v));
    prev = { users: d.totalUsers, saved: d.totalSaved, reqs: d.totalRequests, loops: d.blockedLoops };
    if (d.recentFeed) renderFeed(d.recentFeed);
  } catch {}
}

pollStats();
setInterval(pollStats, 5000);
</script>

</body>
</html>`;
}
