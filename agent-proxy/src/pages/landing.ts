import type { PublicStatsSnapshot } from '../publicStats';

/**
 * Renders the public landing page HTML with live aggregate stats.
 * Design: Light mode — Stripe/Linear-inspired. White bg, clean borders,
 * Inter font, one accent color (indigo-600), generous whitespace.
 */
function ssrStatusClass(s: string): string {
  if (s.includes('Compressed') && s.includes('CDN')) return 'cdn';
  if (s.includes('CDN')) return 'cdn';
  if (s.includes('Compressed')) return 'compressed';
  if (s.includes('Upstream') || ((/\b(?:4\d\d|5\d\d)\b/).test(s) && !s.includes('429'))) return 'blocked';
  if (s.includes('Blocked') || s.includes('Loop') || s.includes('Budget') || s.includes('No Progress')) return 'blocked';
  if (s.includes('Failover') || s.includes('Shadow') || s.includes('429')) return 'failover';
  return 'pass';
}

function ssrStatusLabel(s: string): string {
  if (s.includes('Compressed') && s.includes('CDN')) return 'Cached + Compressed';
  if (s.includes('CDN')) return 'Cache Hit';
  if (s.includes('Compressed')) return 'Compressed';
  if (s.includes('Upstream') || ((/\b(?:4\d\d|5\d\d)\b/).test(s) && !s.includes('429'))) return s;
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

export function renderLandingPage(publicStats: PublicStatsSnapshot): string {
  // Pre-render a generous batch so JS can trim to fit the viewport on load
  const MAX_SSR_ROWS = 14;
  const feedItems = publicStats.recentFeed.slice(0, MAX_SSR_ROWS);
  const ssrFeedRows = feedItems.map((a: any) => {
    const saved = a.saved ? `<div class="feed-saved">$${a.saved}</div>` : '<div class="feed-saved"></div>';
    const ttft = a.ttftMs ? `<div class="feed-ttft">${a.ttftMs < 1000 ? a.ttftMs + 'ms' : (a.ttftMs / 1000).toFixed(1) + 's'}</div>` : '<div class="feed-ttft"></div>';
    const sc = ssrStatusClass(a.status);
    const sl = ssrStatusLabel(a.status);
    return `<div class="feed-row"><div class="feed-model">${a.model}</div><div class="feed-tokens">${a.tokens} tokens</div>${ttft}${saved}<span class="feed-status ${sc}">${sl}</span></div>`;
  }).join('\n      ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Firewall — See Agent Waste Before It Hits Your Bill</title>
<meta name="description" content="Scan agent logs for wasted spend, then route traffic through Agent Firewall for loop detection, caching, and budget enforcement.">

<!-- Social / Open Graph -->
<meta property="og:type" content="website">
<meta property="og:title" content="Agent Firewall — See Agent Waste Before It Hits Your Bill">
<meta property="og:description" content="Scan agent logs for wasted spend, then route traffic through Agent Firewall for loop detection, caching, and budget enforcement.">
<meta property="og:url" content="https://api.jockeyvc.com">
<meta property="og:site_name" content="Agent Firewall">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Agent Firewall — See Agent Waste Before It Hits Your Bill">
<meta name="twitter:description" content="Scan agent logs for wasted spend, then route traffic through Agent Firewall for loop detection, caching, and budget enforcement.">

<!-- Favicon (inline SVG data URI — no external file needed) -->
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%234f46e5'/><text x='50' y='72' font-size='60' text-anchor='middle' fill='white' font-family='system-ui'>AF</text></svg>">

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
  --green: #16a34a;
  --green-bg: #f0fdf4;
  --green-border: #bbf7d0;
  --red: #dc2626;
  --red-bg: #fef2f2;
  --amber: #d97706;
  --amber-bg: #fffbeb;
}

*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}

/* Nav */
.nav{display:flex;justify-content:space-between;align-items:center;padding:16px 32px;border-bottom:1px solid var(--border);max-width:1120px;margin:0 auto}
.nav .logo{font-weight:700;font-size:1rem;color:var(--text);display:flex;align-items:center;gap:8px}
.nav .logo span{font-size:1.1rem}
.nav-links{display:flex;gap:20px}
.nav a{color:var(--text-secondary);text-decoration:none;font-size:0.9rem;font-weight:500;transition:color 0.2s}
.nav a:hover{color:var(--text)}

/* Hero */
.hero{padding:72px 24px 56px;max-width:1120px;margin:0 auto;position:relative}
.hero::before{content:'';position:absolute;top:-80px;left:50%;transform:translateX(-50%);width:800px;height:500px;background:radial-gradient(ellipse at center,rgba(79,70,229,0.12) 0%,rgba(79,70,229,0.06) 35%,rgba(79,70,229,0.02) 55%,transparent 75%);pointer-events:none;z-index:0}
.hero>*{position:relative;z-index:1}
.hero-copy{max-width:680px;margin:0 auto;text-align:center}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
.hero h1{font-size:clamp(2.4rem,4.8vw,3.6rem);font-weight:800;letter-spacing:-0.04em;line-height:1.08;margin-bottom:16px;color:var(--text)}
.hero .sub{color:var(--text-secondary);font-size:1.05rem;max-width:560px;margin:0 auto 30px;line-height:1.6}

/* Proof row */
.proof-row{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:10px;margin:0 auto 28px;color:var(--text-secondary);font-size:0.95rem;line-height:1.5}
.proof-row strong{color:var(--text);font-weight:700;font-variant-numeric:tabular-nums}
.proof-sep{color:var(--text-muted)}

/* CTA area */
.actions{display:flex;flex-direction:column;align-items:center;gap:12px}
.action-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:center}
.code{background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;padding:12px 20px;font-family:'SF Mono','Fira Code',Consolas,monospace;font-size:0.88rem;color:var(--text);display:inline-flex;align-items:center;gap:8px;user-select:all;transition:border-color 0.2s,box-shadow 0.2s;position:relative}
.code:hover{border-color:var(--border-hover)}
.code.primary{border-color:rgba(79,70,229,0.25);box-shadow:0 10px 30px rgba(79,70,229,0.08)}
.code .prefix{color:var(--text-muted)}
.copy-btn{all:unset;cursor:pointer;padding:4px 8px;border-radius:6px;color:var(--text-muted);transition:all 0.2s;user-select:none;display:inline-flex;align-items:center;gap:4px;font-size:0.75rem;font-family:'Inter',-apple-system,sans-serif;font-weight:500;border:1px solid transparent}
.copy-btn:hover{color:var(--text);background:var(--bg);border-color:var(--border)}
.copy-btn.copied{color:var(--green)}
.secondary-cta{display:inline-block;background:#fff;color:var(--text-secondary);padding:11px 18px;border-radius:8px;font-size:0.85rem;font-weight:600;text-decoration:none;transition:all 0.2s;letter-spacing:-0.01em;border:1px solid var(--border)}
.secondary-cta:hover{color:var(--text);border-color:var(--border-hover);transform:translateY(-1px)}
.cta-note{font-size:0.82rem;color:var(--text-muted);line-height:1.5}

/* Scan example */
.scan-section{border-top:1px solid var(--border);padding:80px 24px;background:var(--bg)}
.scan-wrap{max-width:780px;margin:0 auto}
.scan-header{text-align:center;margin-bottom:32px}
.scan-header h2{font-size:1.5rem;font-weight:700;letter-spacing:-0.02em;color:var(--text)}
.scan-header p{color:var(--text-secondary);margin-top:8px;font-size:0.95rem}
.terminal{background:#0f172a;border:1px solid #1e293b;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(15,23,42,0.18)}
.terminal-bar{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #1e293b;background:#111827}
.terminal-dots{display:flex;gap:6px}
.terminal-dots span{width:9px;height:9px;border-radius:50%;display:block}
.terminal-dots span:nth-child(1){background:#f87171}
.terminal-dots span:nth-child(2){background:#fbbf24}
.terminal-dots span:nth-child(3){background:#34d399}
.terminal-label{font-size:0.76rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#94a3b8}
.terminal-body{padding:18px 18px 16px;font-family:'SF Mono','Fira Code',Consolas,monospace;font-size:0.82rem;line-height:1.65;color:#e5e7eb}
.terminal-line{display:flex;align-items:baseline;justify-content:space-between;gap:16px;white-space:pre-wrap}
.terminal-line + .terminal-line{margin-top:4px}
.terminal-line.dim{color:#94a3b8}
.terminal-line.gap{height:10px}
.terminal-line.heading{color:#f8fafc;font-weight:700}
.terminal-line.highlight{color:#86efac;font-weight:700}
.terminal-line.fix{color:#c7d2fe}
.terminal-prompt{color:#818cf8}
.terminal-key{color:#cbd5e1}
.terminal-value{color:#f8fafc;font-weight:600}
.terminal-foot{margin-top:14px;padding-top:12px;border-top:1px solid #1e293b;font-size:0.75rem;color:#94a3b8;line-height:1.5}

/* ─── Live Activity Feed ─── */
.feed-section{border-top:1px solid var(--border);padding:64px 24px;background:var(--bg)}
.feed-container{max-width:780px;margin:0 auto}
.feed-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
.feed-header-left{display:flex;align-items:center;gap:10px}
.feed-header h2{font-size:1.1rem;font-weight:700;letter-spacing:-0.02em;color:var(--text)}
.feed-live-dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;flex-shrink:0}
.feed-savings-total{display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:100px;background:var(--green-bg);border:1px solid var(--green-border);font-size:0.82rem;font-weight:600;color:var(--green)}

/* 14 rows * 45px + 13 * 1px gap = 643px */
.feed-list{display:flex;flex-direction:column;gap:1px;background:var(--border);border:1px solid var(--border);border-radius:12px;overflow:hidden;height:643px}
.feed-empty{padding:80px 24px;text-align:center;color:var(--text-muted);font-size:0.9rem;background:var(--bg)}

/* Individual feed row */
.feed-row{display:grid;grid-template-columns:1fr auto auto auto auto;align-items:center;gap:16px;padding:12px 20px;background:var(--bg);transition:background 0.15s}
.feed-row:hover{background:var(--bg-secondary)}

.feed-model{font-weight:600;font-size:0.85rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.feed-tokens{font-size:0.8rem;color:var(--text-secondary);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}

.feed-saved{font-size:0.8rem;font-weight:600;color:var(--green);text-align:right;white-space:nowrap;min-width:64px}
.feed-saved:empty{min-width:64px}

.feed-ttft{font-size:0.8rem;color:var(--text-muted);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;min-width:48px}
.feed-ttft:empty{min-width:48px}

.feed-status{display:inline-flex;align-items:center;padding:3px 10px;border-radius:100px;font-size:0.72rem;font-weight:600;white-space:nowrap;letter-spacing:0.01em}
.feed-status.cdn{background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)}
.feed-status.pass{background:var(--bg-secondary);color:var(--text-muted);border:1px solid var(--border)}
.feed-status.blocked{background:var(--red-bg);color:var(--red);border:1px solid #fecaca}
.feed-status.failover{background:var(--amber-bg);color:var(--amber);border:1px solid #fde68a}
.feed-status.compressed{background:#f0f9ff;color:#0284c7;border:1px solid #bae6fd}

/* Row enter animation — slides in and flashes green then fades to white */
.feed-row.entering{animation:rowEnter 0.5s ease-out forwards,rowFlash 1.2s ease-out forwards}
@keyframes rowEnter{
  from{opacity:0;transform:translateY(-10px)}
  to{opacity:1;transform:translateY(0)}
}
@keyframes rowFlash{
  0%{background:var(--green-bg)}
  60%{background:var(--green-bg)}
  100%{background:var(--bg)}
}
/* Row exit animation */
.feed-row.exiting{animation:rowExit 0.3s ease-in forwards}
@keyframes rowExit{
  from{opacity:1;max-height:48px}
  to{opacity:0;max-height:0;padding-top:0;padding-bottom:0;margin:0}
}

/* ─── How It Works ─── */
.how-section{border-top:1px solid var(--border);padding:80px 24px;background:var(--bg)}
.how{max-width:780px;margin:0 auto}
.how-header{text-align:center;margin-bottom:48px}
.how-header h2{font-size:1.5rem;font-weight:700;letter-spacing:-0.02em;color:var(--text)}
.how-header p{color:var(--text-secondary);margin-top:8px;font-size:0.95rem}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;position:relative}
.step{text-align:center;position:relative}
.step-num{width:40px;height:40px;border-radius:50%;background:var(--accent-light);color:var(--accent);font-weight:700;font-size:1rem;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;border:2px solid var(--accent)}
.step h3{font-size:0.95rem;font-weight:600;color:var(--text);margin-bottom:6px}
.step p{color:var(--text-secondary);font-size:0.82rem;line-height:1.55}
.step-code{display:inline-block;margin-top:10px;padding:6px 12px;border-radius:6px;background:var(--bg-secondary);border:1px solid var(--border);font-family:'SF Mono','Fira Code',Consolas,monospace;font-size:0.75rem;color:var(--text-secondary)}
/* Connector lines between steps */
.steps::before,.steps::after{content:'';position:absolute;top:20px;height:2px;background:var(--border);width:calc(33.33% - 40px)}
.steps::before{left:calc(16.67% + 20px)}
.steps::after{left:calc(50% + 20px)}

/* ─── Before / After ─── */
.compare-section{border-top:1px solid var(--border);padding:80px 24px;background:var(--bg-secondary)}
.compare{max-width:780px;margin:0 auto}
.compare-header{text-align:center;margin-bottom:40px}
.compare-header h2{font-size:1.5rem;font-weight:700;letter-spacing:-0.02em;color:var(--text)}
.compare-header p{color:var(--text-secondary);margin-top:8px;font-size:0.95rem}
.compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.compare-card{padding:28px 24px;border-radius:12px;border:1px solid var(--border)}
.compare-card.before{background:#fff;border-color:#fecaca}
.compare-card.after{background:#fff;border-color:var(--green-border)}
.compare-card-header{display:flex;align-items:center;gap:8px;margin-bottom:20px}
.compare-card-label{font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;padding:3px 10px;border-radius:100px}
.compare-card.before .compare-card-label{background:var(--red-bg);color:var(--red)}
.compare-card.after .compare-card-label{background:var(--green-bg);color:var(--green)}
.compare-card-title{font-size:0.9rem;font-weight:600;color:var(--text)}
.compare-lines{display:flex;flex-direction:column;gap:10px;margin-bottom:20px}
.compare-line{display:flex;justify-content:space-between;align-items:center;font-size:0.82rem}
.compare-line .cl-label{color:var(--text-secondary)}
.compare-line .cl-value{font-weight:600;font-variant-numeric:tabular-nums}
.compare-card.before .cl-value{color:var(--red)}
.compare-card.after .cl-value{color:var(--text)}
.compare-total{display:flex;justify-content:space-between;align-items:center;padding-top:16px;border-top:1px solid var(--border);font-size:1rem;font-weight:700}
.compare-card.before .compare-total .ct-value{color:var(--red);font-size:1.4rem}
.compare-card.after .compare-total .ct-value{color:var(--green);font-size:1.4rem}
.compare-savings{text-align:center;margin-top:24px;padding:16px;background:var(--green-bg);border:1px solid var(--green-border);border-radius:10px}
.compare-savings .big{font-size:1.6rem;font-weight:800;color:var(--green);letter-spacing:-0.02em}
.compare-savings .desc{color:var(--text-secondary);font-size:0.85rem;margin-top:4px}

/* Footer */
.footer{text-align:center;padding:40px 24px;color:var(--text-muted);font-size:0.8rem;border-top:1px solid var(--border)}

/* Responsive */
@media(max-width:640px){
  .hero{padding:48px 20px 40px}
  .nav{padding:12px 20px}
  .feed-row{grid-template-columns:1fr auto auto;gap:10px;padding:10px 14px}
  .feed-saved{display:none}
  .feed-ttft{display:none}
  .feed-list{height:559px}
  .feed-header{flex-direction:column;gap:12px;align-items:flex-start}
  .steps{grid-template-columns:1fr;gap:32px}
  .steps::before,.steps::after{display:none}
  .compare-grid{grid-template-columns:1fr}
  .action-row{justify-content:center}
  .proof-sep{display:none}
}
@media(max-width:900px){
  .hero{padding:56px 24px 44px}
}
</style>
</head>
<body>

<nav class="nav">
  <div class="logo"><span>🛡️</span> Agent Firewall</div>
  <div class="nav-links">
    <a href="#how">How It Works</a>
    <a href="#activity">Live Feed</a>
  </div>
</nav>

<div class="hero">
  <div class="hero-copy">
    <h1>Stop wasting money on agent runs</h1>
    <p class="sub">Vibe Billing scans Claude Code, OpenClaw, and OpenAI-compatible agent logs, shows exactly where money is being burned, then fixes it in one command.</p>

    <div class="proof-row">
      <span><strong id="users">${fmtNum(publicStats.totalUsers)}</strong> developers</span>
      <span class="proof-sep">·</span>
      <span><strong id="saved">${fmtMoney(publicStats.totalSaved)}</strong> saved</span>
      <span class="proof-sep">·</span>
      <span><strong id="loops">${fmtNum(publicStats.blockedLoops)}</strong> loops killed</span>
    </div>

    <div class="actions">
      <div class="action-row">
        <div class="code primary"><span class="prefix">$</span> npx vibe-billing scan <button class="copy-btn" id="copyBtn" onclick="copyCmd()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span id="copyLabel">Copy</span></button></div>
        <a href="https://github.com/shinertx/agentic-firewall" target="_blank" class="secondary-cta">View on GitHub</a>
      </div>
      <div class="cta-note">Find wasted spend in under 30 seconds. No signup.</div>
    </div>
  </div>
</div>

<div class="feed-section" id="activity">
  <div class="feed-container">
    <div class="feed-header">
      <div class="feed-header-left">
        <span class="feed-live-dot"></span>
        <h2>Live Activity</h2>
      </div>
      <div class="feed-savings-total" id="feedSavings">${fmtMoney(publicStats.totalSaved)} saved</div>
    </div>
    <div class="feed-list" id="feedList">
      ${ssrFeedRows || '<div class="feed-empty" style="color:var(--text-muted);font-size:0.82rem;padding:32px 20px;background:var(--bg);text-align:center;opacity:0.6">Listening for traffic...</div>'}
    </div>
  </div>
</div>

<div class="how-section" id="how">
  <div class="how">
    <div class="how-header">
      <h2>From scan to safe mode in 60 seconds</h2>
      <p>Find the waste first. Route traffic second. Keep the agent under control after that.</p>
    </div>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <h3>Scan</h3>
        <p>Analyze local transcripts and see retry loops, context re-sends, and overkill model usage before you install anything.</p>
        <div class="step-code">npx vibe-billing scan</div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <h3>Setup</h3>
        <p>Run one command to patch configs, verify the connection, and route agent traffic through the firewall.</p>
        <div class="step-code">npx vibe-billing setup</div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <h3>Stay in control</h3>
        <p>Prompt caching, loop detection, budget caps, and smarter routing kick in once traffic is flowing.</p>
        <div class="step-code">Agent &rarr; Firewall &rarr; LLM</div>
      </div>
    </div>
  </div>
</div>

<div class="scan-section">
  <div class="scan-wrap">
    <div class="scan-header">
      <h2>Example Scan Output</h2>
      <p>Run the scan first. If the waste is real, route traffic through the firewall after that.</p>
    </div>
    <div class="terminal">
      <div class="terminal-bar">
        <div class="terminal-dots"><span></span><span></span><span></span></div>
        <div class="terminal-label">Example Scan Output</div>
      </div>
      <div class="terminal-body">
        <div class="terminal-line"><span><span class="terminal-prompt">$</span> npx vibe-billing scan</span></div>
        <div class="terminal-line dim"><span>Analyzing your agent usage for waste patterns and savings opportunities...</span></div>
        <div class="terminal-line gap"></div>
        <div class="terminal-line heading"><span>Agent Waste Report</span></div>
        <div class="terminal-line"><span class="terminal-key">Runs analyzed:</span><span class="terminal-value">184</span></div>
        <div class="terminal-line"><span class="terminal-key">Retry loops:</span><span class="terminal-value">6</span></div>
        <div class="terminal-line"><span class="terminal-key">Context re-sends:</span><span class="terminal-value">34</span></div>
        <div class="terminal-line"><span class="terminal-key">Overkill model usage:</span><span class="terminal-value">51</span></div>
        <div class="terminal-line gap"></div>
        <div class="terminal-line"><span class="terminal-key">Total agent spend:</span><span class="terminal-value">$381.42</span></div>
        <div class="terminal-line highlight"><span class="terminal-key">Estimated wasted spend:</span><span class="terminal-value">$312.76</span></div>
        <div class="terminal-line gap"></div>
        <div class="terminal-line fix"><span class="terminal-key">Fix with:</span></div>
        <div class="terminal-line"><span><span class="terminal-prompt">$</span> npx vibe-billing setup</span></div>
        <div class="terminal-foot">Reads local Claude Code and OpenClaw logs first. No signup required to see the waste.</div>
      </div>
    </div>
  </div>
</div>

<div class="compare-section">
  <div class="compare">
    <div class="compare-header">
      <h2>What a 2-hour Claude Code session actually costs</h2>
      <p>Real numbers from a production coding session with Opus.</p>
    </div>
    <div class="compare-grid">
      <div class="compare-card before">
        <div class="compare-card-header">
          <span class="compare-card-label">Without Firewall</span>
        </div>
        <div class="compare-lines">
          <div class="compare-line"><span class="cl-label">Prompt tokens (repeated context)</span><span class="cl-value">2.4M</span></div>
          <div class="compare-line"><span class="cl-label">Duplicate full-codebase reads</span><span class="cl-value">12x</span></div>
          <div class="compare-line"><span class="cl-label">Stuck retry loops</span><span class="cl-value">3 loops</span></div>
          <div class="compare-line"><span class="cl-label">Cache hit rate</span><span class="cl-value">0%</span></div>
        </div>
        <div class="compare-total">
          <span>Total cost</span>
          <span class="ct-value">$47.20</span>
        </div>
      </div>
      <div class="compare-card after">
        <div class="compare-card-header">
          <span class="compare-card-label">With Firewall</span>
        </div>
        <div class="compare-lines">
          <div class="compare-line"><span class="cl-label">Prompt tokens (cached)</span><span class="cl-value">2.4M</span></div>
          <div class="compare-line"><span class="cl-label">Cache hit rate (auto-injected)</span><span class="cl-value">90%</span></div>
          <div class="compare-line"><span class="cl-label">Loops killed before waste</span><span class="cl-value">3 killed</span></div>
          <div class="compare-line"><span class="cl-label">Effective cost after caching</span><span class="cl-value">$7.80</span></div>
        </div>
        <div class="compare-total">
          <span>Total cost</span>
          <span class="ct-value">$7.80</span>
        </div>
      </div>
    </div>
    <div class="compare-savings">
      <div class="big">$39.40 saved per session</div>
      <div class="desc">That's $591 / month for a developer running 3 sessions per day.</div>
    </div>
  </div>
</div>

<div class="footer">
  <p>Agent Firewall — Agent Runtime Control</p>
  <p style="margin-top:8px;font-size:0.75rem"><a href="https://github.com/shinertx/agentic-firewall" target="_blank" style="color:var(--text-secondary);text-decoration:none;margin:0 8px">GitHub</a> · <a href="https://www.npmjs.com/package/vibe-billing" target="_blank" style="color:var(--text-secondary);text-decoration:none;margin:0 8px">npm</a></p>
</div>

<script>
function fmtM(v) {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtN(v) {
  return Math.round(v).toLocaleString('en-US');
}
function copyCmd() {
  navigator.clipboard.writeText('npx vibe-billing scan').then(function() {
    var btn = document.getElementById('copyBtn');
    var label = document.getElementById('copyLabel');
    btn.classList.add('copied');
    label.textContent = 'Copied!';
    setTimeout(function() { btn.classList.remove('copied'); label.textContent = 'Copy'; }, 2000);
  });
}

var MAX_ROWS = 14;
var lastFeedJSON = '';

function animateValue(el, start, end, duration, format) {
  if (start === end) return;
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
  users: ${publicStats.totalUsers},
  saved: ${publicStats.totalSaved},
  loops: ${publicStats.blockedLoops}
};

function statusClass(s) {
  if (s.includes('Compressed') && s.includes('CDN')) return 'cdn';
  if (s.includes('CDN')) return 'cdn';
  if (s.includes('Compressed')) return 'compressed';
  if (s.includes('Upstream') || ((/\b(?:4\d\d|5\d\d)\b/).test(s) && !s.includes('429'))) return 'blocked';
  if (s.includes('Blocked') || s.includes('Loop') || s.includes('Budget') || s.includes('No Progress')) return 'blocked';
  if (s.includes('Failover') || s.includes('Shadow') || s.includes('429')) return 'failover';
  return 'pass';
}

function statusLabel(s) {
  if (s.includes('Compressed') && s.includes('CDN')) return 'Cached + Compressed';
  if (s.includes('CDN')) return 'Cache Hit';
  if (s.includes('Compressed')) return 'Compressed';
  if (s.includes('Upstream') || ((/\b(?:4\d\d|5\d\d)\b/).test(s) && !s.includes('429'))) return s;
  if (s.includes('Loop')) return 'Loop Killed';
  if (s.includes('Budget')) return 'Budget Block';
  if (s.includes('No Progress')) return 'Stopped';
  if (s.includes('Blocked')) return 'Blocked';
  if (s.includes('Failover') || s.includes('Shadow')) return 'Failover';
  if (s.includes('429')) return 'Rate Limited';
  return 'Proxied';
}

function rowHTML(item) {
  var savedHTML = item.saved
    ? '<div class="feed-saved">$' + item.saved + '</div>'
    : '<div class="feed-saved"></div>';
  var ttftHTML = item.ttftMs
    ? '<div class="feed-ttft">' + (item.ttftMs < 1000 ? item.ttftMs + 'ms' : (item.ttftMs / 1000).toFixed(1) + 's') + '</div>'
    : '<div class="feed-ttft"></div>';
  var sc = statusClass(item.status);
  var sl = statusLabel(item.status);
  return '<div class="feed-model">' + item.model + '</div>' +
    '<div class="feed-tokens">' + item.tokens + ' tokens</div>' +
    ttftHTML +
    savedHTML +
    '<span class="feed-status ' + sc + '">' + sl + '</span>';
}

function renderFeed(feed) {
  var list = document.getElementById('feedList');
  if (!list || !feed || feed.length === 0) return;

  var feedJSON = JSON.stringify(feed);
  var isFirst = lastFeedJSON === '';

  if (isFirst) {
    // SSR already rendered rows — just record the feed state and move on
    var empty = list.querySelector('.feed-empty');
    if (empty) empty.remove();
    // If no SSR rows, render initial batch instantly
    if (!list.querySelector('.feed-row')) {
      var initial = feed.slice(0, MAX_ROWS);
      initial.forEach(function(item) {
        var row = document.createElement('div');
        row.className = 'feed-row';
        row.innerHTML = rowHTML(item);
        list.appendChild(row);
      });
    }
    lastFeedJSON = feedJSON;
    return;
  }

  if (feedJSON === lastFeedJSON) return;

  // Find new items not in previous feed
  var prevSet = new Set(JSON.parse(lastFeedJSON).map(function(i) { return i.model + i.tokens + i.status + i.time; }));
  var newItems = [];
  for (var idx = feed.length - 1; idx >= 0; idx--) {
    var key = feed[idx].model + feed[idx].tokens + feed[idx].status + feed[idx].time;
    if (!prevSet.has(key)) newItems.push(feed[idx]);
  }
  lastFeedJSON = feedJSON;
  if (newItems.length === 0) return;

  newItems.forEach(function(item, i) {
    setTimeout(function() { addRow(list, item); }, i * 300);
  });
}

function addRow(list, item) {
  // Remove oldest row if at capacity
  var rows = list.querySelectorAll('.feed-row:not(.exiting)');
  if (rows.length >= MAX_ROWS) {
    var oldest = rows[rows.length - 1];
    oldest.classList.add('exiting');
    oldest.addEventListener('animationend', function() { oldest.remove(); }, { once: true });
  }

  // Insert new row at the top with enter animation
  var row = document.createElement('div');
  row.className = 'feed-row entering';
  row.innerHTML = rowHTML(item);
  list.insertBefore(row, list.firstChild);
  row.addEventListener('animationend', function() { row.classList.remove('entering'); }, { once: true });
}

var STATS_URL = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? 'https://api.jockeyvc.com/api/public-stats'
  : '/api/public-stats';

async function pollStats() {
  try {
    var r = await fetch(STATS_URL);
    if (!r.ok) return;
    var d = await r.json();
    animateValue(document.getElementById('users'), prev.users, d.totalUsers, 1500, fmtN);
    animateValue(document.getElementById('saved'), prev.saved, d.totalSaved, 2000, fmtM);
    animateValue(document.getElementById('loops'), prev.loops, d.blockedLoops, 1500, fmtN);

    // Update savings badge
    var badge = document.getElementById('feedSavings');
    if (badge) badge.textContent = fmtM(d.totalSaved) + ' saved';

    prev = { users: d.totalUsers, saved: d.totalSaved, loops: d.blockedLoops };
    if (d.recentFeed) renderFeed(d.recentFeed);
  } catch(e) {}
}

pollStats();
setInterval(pollStats, 5000);
</script>

</body>
</html>`;
}
