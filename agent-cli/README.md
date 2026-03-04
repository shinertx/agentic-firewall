# vibe-billing

**Agent Runtime Control** — Stop AI agents from burning your money.

Loop detection, prompt caching, budget enforcement, and waste scanning for autonomous AI agents.

## Quick Start

```bash
# See how much your agents are wasting
npx vibe-billing scan

# Route agents through the firewall to fix it
npx vibe-billing setup
```

## Commands

| Command | What it does |
|---|---|
| `npx vibe-billing scan` | Scan agent logs for waste — loops, retries, missed caching |
| `npx vibe-billing setup` | Auto-configure agents to route through the firewall |
| `npx vibe-billing run <agent_cmd>` | Wrap an agent to get a receipt of your savings |
| `npx vibe-billing replay <1\|2>` | Re-run your last wrapped agent with cheaper routing |
| `npx vibe-billing status` | Check live proxy stats — requests, savings, blocked loops |
| `npx vibe-billing verify` | Test that routing is working |
| `npx vibe-billing uninstall` | Undo everything — restore original configs |

## What It Solves

Autonomous agents fail **behaviorally** — they get stuck in loops, retry the same broken tool call, and re-send massive contexts without caching. This costs real money.

| Problem | How Agent Firewall Fixes It |
|---|---|
| **Agent stuck in loops** | Circuit breaker kills after 3+ identical requests |
| **Same error over and over** | No-progress detection stops after 5 identical tool failures |
| **Runaway overnight costs** | Budget governor caps spend per session |
| **Re-sending the same context** | Auto-injects prompt caching headers — up to 90% savings |
| **Rate limits (429 errors)** | Shadow Routing auto-downgrades to faster models instantly |
| **No visibility into waste** | Scanner analyzes your logs and shows exactly what you're wasting |

## How It Works

```
Your Agent → Agent Firewall (proxy) → OpenAI / Anthropic / Gemini / NVIDIA
```

The firewall sits between your agent and the LLM provider. Every request passes through it:

- **Prompt caching** — injects `cache_control` headers automatically
- **Loop detection** — hashes recent requests, blocks repeats
- **Shadow Routing** — immediately fails over to lighter models on 429 rate limits
- **Budget caps** — set a $ limit per session, get a hard 402 when hit
- **No-progress detection** — fingerprints tool errors, stops spinning agents
- **Your keys pass through** — never stored, never logged

## Works With

| Agent / SDK | How it connects |
|---|---|
| OpenClaw | `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` env vars |
| Claude Code | `ANTHROPIC_BASE_URL` env var |
| OpenAI SDK | `OPENAI_BASE_URL` env var |
| Anthropic SDK | `ANTHROPIC_BASE_URL` env var |
| Any OpenAI-compatible | `base_url` parameter |

## Cross-Platform

Works on **macOS**, **Linux**, and **Windows** (PowerShell + cmd.exe).

- Auto-detects your shell config (`.zshrc`, `.bashrc`, `.bash_profile`, PowerShell `$PROFILE`)
- Asks before modifying any files
- Clean uninstall with `npx vibe-billing uninstall`

## Trust & Transparency

This is **open source**. You can read every line of code:

- **Source code**: [github.com/shinertx/agentic-firewall](https://github.com/shinertx/agentic-firewall)
- **License**: MIT — use it however you want
- **Your API keys**: Pass through to your provider. Never stored. Never logged. Hashed for anonymous usage stats only.
- **Dashboard**: Every user gets a personal dashboard at `https://api.jockeyvc.com/dashboard/<your-id>`

## License

MIT — [github.com/shinertx/agentic-firewall](https://github.com/shinertx/agentic-firewall)
