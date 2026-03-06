# Vibe Billing / Agentic Firewall: Universal Agent Routing Guide

This document is the canonical reference for routing any autonomous AI agent through the Vibe Billing runtime layer and its Agentic Firewall proxy engine. It covers every supported agent architecture, all four LLM providers, and verification steps to confirm traffic is flowing correctly.

> [!CAUTION]
> If your agent bypasses this proxy, you pay full price on every API call, the Context CDN provides zero savings, and the Circuit Breaker cannot protect you from runaway loops. Verify your routing with the steps in Section 5.

---

## 1. The Problem: Agent Drift

Modern AI agents use internal configuration files, hardcoded base URLs, or SDK defaults to connect directly to LLM vendors. Standard CLI environment variables like `OPENAI_BASE_URL` are frequently ignored because:

- The agent's SDK resolves its own base URL before checking `process.env`
- The agent's config file (e.g., `~/.openclaw/openclaw.json`) takes precedence over shell variables
- Some agents have no configuration mechanism at all — the URL is compiled in

When this happens, agent traffic bypasses the proxy entirely. The dashboard shows zero requests, the Context CDN never fires, and you absorb the full cost of every redundant context read.

---

## 2. Security: TLS-Only Routing

**All agent traffic must use the HTTPS endpoint:**

```
https://api.jockeyvc.com
```

The proxy is deployed behind Caddy with automated Let's Encrypt certificate provisioning, providing TLS 1.3 encryption between the agent and the firewall.

> [!WARNING]
> Never route agent traffic to a raw HTTP IP address. The `Authorization` header — which carries your Anthropic/OpenAI API key — would be transmitted in plaintext, exposing it to network-level interception.

---

## 3. Supported Providers

The proxy auto-detects the target provider from the request structure. No configuration is needed from the agent side — just point the base URL and the firewall handles routing.

| Provider | Upstream URL | Detection Method |
|---|---|---|
| **Anthropic** | `https://api.anthropic.com` | Default (no OpenAI/Gemini/NVIDIA markers) |
| **OpenAI** | `https://api.openai.com` | URL contains `/v1/chat/completions` or `/v1/models` |
| **Google Gemini** | `https://generativelanguage.googleapis.com` | URL contains `/v1beta/models` or `x-goog-api-key` header |
| **NVIDIA NIM** | `https://integrate.api.nvidia.com` | Model starts with `meta/` or `nvidia/` |

---

## 4. Routing Methods (Choose One)

### Method A: Persistent Environment Variables

**Best for:** Claude Code, OpenClaw, terminal-launched agents

Add to your `~/.zshrc` or `~/.bashrc`:

```bash
export ANTHROPIC_BASE_URL="https://api.jockeyvc.com"
export OPENAI_BASE_URL="https://api.jockeyvc.com/v1"
```

Then reload your shell: `source ~/.zshrc`

**For macOS LaunchAgents** (background services), inject these into the `EnvironmentVariables` dictionary of your `.plist` file.

**Why `/v1` for OpenAI but not Anthropic?** The OpenAI SDK appends its path to the base URL (e.g., `baseURL + /chat/completions`), so it expects the `/v1` prefix. The Anthropic SDK does not — it constructs the full path internally.

---

### Method B: Custom/Local Model Endpoint

**Best for:** GUI-based agents with provider selection (Kimmy, Continue.dev, Cursor, etc.)

1. Select **"Local"**, **"Custom"**, or **"OpenAI-Compatible"** as the provider
2. Set the base URL to `https://api.jockeyvc.com/v1`
3. Enter your real API key (Anthropic or OpenAI) as the token

The proxy transparently inspects the request body and routes to the correct upstream provider, regardless of what the agent thinks it's connecting to.

---

### Method C: Direct SDK Configuration

**Best for:** Custom scripts, internal tools, programmatic SDK usage

**Node.js (Anthropic):**
```javascript
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'https://api.jockeyvc.com'
});
```

**Node.js (OpenAI):**
```javascript
import OpenAI from 'openai';
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://api.jockeyvc.com/v1'
});
```

**Python (Anthropic):**
```python
import anthropic
client = anthropic.Anthropic(
    api_key=os.environ["ANTHROPIC_API_KEY"],
    base_url="https://api.jockeyvc.com"
)
```

**Python (OpenAI):**
```python
from openai import OpenAI
client = OpenAI(
    api_key=os.environ["OPENAI_API_KEY"],
    base_url="https://api.jockeyvc.com/v1"
)
```

---

### Method D: OS-Level Proxy Override (Last Resort)

**Best for:** Closed-source agents with no configuration options

> [!CAUTION]
> This method disables TLS certificate verification. Only use this on a trusted network or over an SSH tunnel.

```bash
HTTPS_PROXY="https://api.jockeyvc.com" NODE_TLS_REJECT_UNAUTHORIZED=0 <agent_command>
```

This forces the underlying Node.js/Python HTTP adapters to redirect all outbound HTTPS traffic through the proxy. It is inherently less secure — use Methods A–C if at all possible.

---

## 5. Verifying Your Routing

After configuring your agent, confirm that traffic is actually flowing through the proxy:

### Quick Check: Stats API
```bash
curl -s https://api.jockeyvc.com/api/stats | python3 -m json.tool
```

You should see `totalRequests` incrementing as your agent runs. If it stays at 0, the agent is bypassing the proxy.

### Dashboard
Open the management dashboard to see live traffic, savings, and blocked loops in real-time.

### PM2 Logs (Server-Side)
```bash
ssh meme-snipe-v19-vm "pm2 logs agentic-firewall-proxy --lines 20"
```

Look for `[PROXY] =>` entries showing the method and upstream URL. Each proxied request generates exactly one log line.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard shows 0 requests | Agent is bypassing the proxy | Verify `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` are set in the shell where the agent launches |
| `ECONNREFUSED` on port 4000 | Proxy is not running | SSH into the VM and run `pm2 restart agentic-firewall-proxy` |
| `400 Bad Request` from Anthropic | Missing `anthropic-beta` header | The proxy injects this automatically — if you see this error, the agent may be connecting directly |
| Agent hangs for >2 minutes | Default Node.js timeout | The proxy extends timeouts to 30 minutes — this only happens if the agent bypasses it |
| `Loop detected` / 400 response | Circuit Breaker triggered | The agent sent 3+ identical payloads. Change the user message content to clear the breaker |

---

## 6. Architecture Notes

- **Context CDN** injects `cache_control: { type: 'ephemeral' }` into Anthropic payloads >500 characters, triggering server-side prompt caching for up to 90% input cost reduction
- **Circuit Breaker** hashes the last user message per IP and blocks after 3 identical requests in a sliding window of 5
- **Shadow Router** automatically fails over from Sonnet → Haiku on 429 rate-limit responses
- **ZSTD Decompression** handles Python SDK compressed payloads that would crash standard proxies
- **30-minute timeouts** prevent premature disconnection during long reasoning chains
