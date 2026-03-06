/**
 * Renders the admin login page.
 */
export function renderAdminLogin(error?: string): string {
    const errorHtml = error ? `<div class="error">${error}</div>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Login — Vibe Billing</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%230f8f6f'/><text x='50' y='70' font-size='52' text-anchor='middle' fill='white' font-family='system-ui'>VB</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
<style>
:root {
    --bg: #07110f;
    --panel: rgba(10, 19, 17, 0.94);
    --panel-soft: rgba(255,255,255,0.03);
    --border: rgba(157, 184, 173, 0.14);
    --border-strong: rgba(157, 184, 173, 0.26);
    --text: #ecf4f1;
    --text-soft: #b5c8c1;
    --text-muted: #7f968f;
    --signal: #34d399;
    --signal-soft: rgba(52, 211, 153, 0.12);
    --danger: #ff7d89;
    --danger-soft: rgba(255, 125, 137, 0.12);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: 'IBM Plex Sans', system-ui, sans-serif;
    background:
      radial-gradient(circle at top left, rgba(52,211,153,0.08), transparent 30%),
      radial-gradient(circle at top right, rgba(90,177,255,0.08), transparent 32%),
      linear-gradient(180deg, #06100f 0%, #081412 38%, #07110f 100%);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text);
    padding: 24px;
}
.card {
    width: 100%;
    max-width: 440px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 28px;
    padding: 32px;
    box-shadow: 0 24px 70px rgba(0,0,0,0.32);
    backdrop-filter: blur(10px);
}
.logo {
    margin-bottom: 24px;
}
.logo-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 999px;
    border: 1px solid rgba(52, 211, 153, 0.22);
    background: var(--signal-soft);
    color: var(--signal);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    margin-bottom: 16px;
}
.logo-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    background: linear-gradient(135deg, rgba(52,211,153,0.22), rgba(90,177,255,0.18));
    border-radius: 16px;
    color: #fff;
    font-weight: 700;
    font-size: 18px;
    margin-bottom: 14px;
    border: 1px solid rgba(90,177,255,0.22);
}
.logo h1 {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 30px;
    letter-spacing: -0.05em;
    margin-bottom: 4px;
}
.logo p {
    font-size: 15px;
    color: var(--text-soft);
    line-height: 1.6;
}
.error {
    background: var(--danger-soft);
    border: 1px solid rgba(255,125,137,0.18);
    color: var(--danger);
    padding: 12px 14px;
    border-radius: 14px;
    font-size: 14px;
    margin-bottom: 18px;
}
label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--text-muted);
    margin-bottom: 8px;
}
input[type="text"], input[type="password"] {
    width: 100%;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 16px;
    font-size: 15px;
    font-family: inherit;
    margin-bottom: 18px;
    transition: border-color 0.15s, background 0.15s;
    background: var(--panel-soft);
    color: var(--text);
}
input:focus {
    outline: none;
    border-color: rgba(52, 211, 153, 0.3);
    background: rgba(255,255,255,0.04);
}
button {
    width: 100%;
    padding: 14px 16px;
    background: linear-gradient(135deg, #22c58b, #14946d);
    color: #04100e;
    border: none;
    border-radius: 16px;
    font-size: 15px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    transition: transform 0.15s ease, filter 0.15s ease;
}
button:hover {
    transform: translateY(-1px);
    filter: brightness(1.04);
}
.back {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 18px;
    font-size: 14px;
    color: var(--text-soft);
    text-decoration: none;
}
.back:hover { color: var(--text); }
.helper {
    margin-top: 20px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.6;
}
</style>
</head>
<body>
<div class="card">
    <div class="logo">
        <div class="logo-chip">Admin surface</div>
        <div class="logo-mark">VB</div>
        <h1>Vibe Billing Admin</h1>
        <p>Review install telemetry and runtime proof without changing the public counters or live proxy state.</p>
    </div>
    ${errorHtml}
    <form method="POST" action="/admin/login">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" required autocomplete="username">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
        <button type="submit">Sign In</button>
    </form>
    <a href="/" class="back">← Back to home</a>
    <div class="helper">This is the staging/admin visual refresh only. It does not change the production telemetry substrate.</div>
</div>
</body>
</html>`;
}
