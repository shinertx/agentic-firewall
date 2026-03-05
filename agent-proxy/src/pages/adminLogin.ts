/**
 * Renders the admin login page.
 */
export function renderAdminLogin(error?: string): string {
    const errorHtml = error
        ? `<div class="error">${error}</div>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Login — Agent Firewall</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%234f46e5'/><text x='50' y='72' font-size='60' text-anchor='middle' fill='white' font-family='system-ui'>AF</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: 'Inter', system-ui, sans-serif;
    background: #f8fafc;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
}
.card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 40px;
    width: 100%;
    max-width: 400px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.logo {
    text-align: center;
    margin-bottom: 24px;
}
.logo-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    background: #4f46e5;
    border-radius: 12px;
    color: #fff;
    font-weight: 700;
    font-size: 18px;
    margin-bottom: 12px;
}
.logo h1 {
    font-size: 20px;
    font-weight: 600;
    color: #1e293b;
}
.logo p {
    font-size: 14px;
    color: #64748b;
    margin-top: 4px;
}
.error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #dc2626;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 14px;
    margin-bottom: 16px;
}
label {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: #374151;
    margin-bottom: 6px;
}
input[type="text"], input[type="password"] {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font-size: 14px;
    font-family: inherit;
    margin-bottom: 16px;
    transition: border-color 0.15s;
}
input:focus {
    outline: none;
    border-color: #4f46e5;
    box-shadow: 0 0 0 3px rgba(79,70,229,0.1);
}
button {
    width: 100%;
    padding: 10px;
    background: #4f46e5;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s;
}
button:hover { background: #4338ca; }
.back {
    display: block;
    text-align: center;
    margin-top: 16px;
    font-size: 13px;
    color: #64748b;
    text-decoration: none;
}
.back:hover { color: #4f46e5; }
</style>
</head>
<body>
<div class="card">
    <div class="logo">
        <div class="logo-icon">AF</div>
        <h1>Admin Login</h1>
        <p>Agent Firewall Dashboard</p>
    </div>
    ${errorHtml}
    <form method="POST" action="/admin/login">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" required autocomplete="username">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
        <button type="submit">Sign In</button>
    </form>
    <a href="/" class="back">Back to home</a>
</div>
</body>
</html>`;
}
