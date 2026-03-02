import { getAggregateStats } from '../budgetGovernor';
import { globalStats } from '../stats';

/**
 * Renders the public landing page HTML with live aggregate stats.
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
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0f;color:#e2e8f0;min-height:100vh}

/* Hero */
.hero{text-align:center;padding:80px 20px 60px;background:linear-gradient(180deg,#1a103a 0%,#0a0a0f 100%)}
.hero h1{font-size:3rem;font-weight:800;background:linear-gradient(135deg,#a78bfa,#818cf8,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:12px}
.hero .sub{color:#94a3b8;font-size:1.2rem;max-width:600px;margin:0 auto 40px}

/* Stats Grid */
.stats{display:flex;justify-content:center;gap:40px;flex-wrap:wrap;margin:40px 0}
.stat{text-align:center;padding:24px 32px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:16px;min-width:180px;transition:border-color 0.3s}
.stat:hover{border-color:rgba(99,102,241,0.5)}
.stat .num{font-size:2.5rem;font-weight:800;color:#818cf8;font-variant-numeric:tabular-nums}
.stat .label{color:#94a3b8;font-size:0.9rem;margin-top:4px}

/* CTA */
.cta{display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:16px 40px;border-radius:12px;font-size:1.1rem;font-weight:600;text-decoration:none;margin:20px 0;transition:transform 0.2s,box-shadow 0.2s}
.cta:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(99,102,241,0.3)}
.code{background:#1e1b2e;border:1px solid #2d2b3e;border-radius:10px;padding:16px 24px;font-family:'SF Mono',Consolas,monospace;font-size:1rem;color:#c4b5fd;display:inline-block;margin:16px 0;user-select:all}

/* Features */
.features{max-width:800px;margin:60px auto;padding:0 20px}
.feature{display:flex;gap:16px;margin:24px 0;padding:20px;background:rgba(255,255,255,0.02);border-radius:12px;border:1px solid rgba(255,255,255,0.06);transition:border-color 0.3s,background 0.3s}
.feature:hover{border-color:rgba(99,102,241,0.2);background:rgba(99,102,241,0.04)}
.feature .icon{font-size:1.5rem;min-width:40px;text-align:center}
.feature h3{color:#e2e8f0;font-size:1rem;margin-bottom:4px}
.feature p{color:#64748b;font-size:0.9rem;line-height:1.5}

/* Footer */
.footer{text-align:center;padding:40px;color:#475569;font-size:0.85rem;border-top:1px solid rgba(255,255,255,0.04)}

/* Responsive */
@media(max-width:600px){
  .hero h1{font-size:2rem}
  .stats{gap:16px}
  .stat{min-width:140px;padding:16px 20px}
  .stat .num{font-size:1.8rem}
}
</style>
</head>
<body>

<div class="hero">
  <h1>🛡️ Agent Firewall</h1>
  <p class="sub">Keep autonomous AI agents under control. Loop detection, prompt caching, budget enforcement — one command to protect your wallet.</p>

  <div class="stats">
    <div class="stat"><div class="num" id="users">${agg.totalUsers}</div><div class="label">Users Protected</div></div>
    <div class="stat"><div class="num" id="saved">$${agg.totalSaved.toFixed(2)}</div><div class="label">Money Saved</div></div>
    <div class="stat"><div class="num" id="reqs">${globalStats.totalRequests.toLocaleString()}</div><div class="label">Requests Proxied</div></div>
    <div class="stat"><div class="num" id="loops">${globalStats.blockedLoops}</div><div class="label">Loops Killed</div></div>
  </div>

  <div class="code">npx agent-firewall scan</div>
  <br>
  <a href="#start" class="cta">Get Started →</a>
</div>

<div class="features" id="start">
  <div class="feature"><div class="icon">🔍</div><div><h3>Waste Scanner</h3><p>Reads your Claude Code and OpenClaw logs. Shows exactly how much money you're burning on retries, re-sends, and loops.</p></div></div>
  <div class="feature"><div class="icon">🔄</div><div><h3>Loop Detection</h3><p>Circuit breaker kills stuck agents after repeated identical requests. No more $200 overnight bills from a spinning agent.</p></div></div>
  <div class="feature"><div class="icon">💰</div><div><h3>Prompt Caching</h3><p>Auto-injects cache headers for Anthropic and OpenAI. Saves up to 90% on repeated context.</p></div></div>
  <div class="feature"><div class="icon">🚫</div><div><h3>Budget Governor</h3><p>Set per-session spend caps with X-Budget-Limit header. Agents get a 402 when they hit the limit.</p></div></div>
  <div class="feature"><div class="icon">🧠</div><div><h3>No-Progress Detection</h3><p>Fingerprints tool failures. If an agent hits the same error 5 times, it gets stopped before wasting more tokens.</p></div></div>
  <div class="feature"><div class="icon">📊</div><div><h3>Per-User Dashboard</h3><p>Every user gets a personal savings dashboard with spend tracking, cache hit rates, and loop history.</p></div></div>
</div>

<div class="footer">Agent Firewall — Agent Runtime Control for AI Developers</div>

<script>
setInterval(async () => {
  try {
    const r = await fetch('/api/aggregate');
    const d = await r.json();
    document.getElementById('users').textContent = d.totalUsers;
    document.getElementById('saved').textContent = '$' + d.totalSaved.toFixed(2);
    document.getElementById('reqs').textContent = d.totalRequests.toLocaleString();
    document.getElementById('loops').textContent = d.blockedLoops;
  } catch {}
}, 5000);
</script>

</body>
</html>`;
}
