# vibe-billing

**Runtime control for autonomous agents** — show agent waste, stop loops, and cap spend.

## Install

```bash
npx vibe-billing setup
```

## Proof of Savings

Run `npx vibe-billing scan` to analyze your local agent logs and estimate avoidable spend.

```text
Estimated avoidable spend: $38.72

Breakdown
- Retry loops: $21.40
- Re-sent context: $12.30
- Overpowered models: $5.02

Fix this now:
npx vibe-billing setup
```

## Works With

100% invisible, native routing for the most popular SDKs:

- **OpenClaw** (`openclaw.json` / `.openclaw/.env`)
- **Claude Code** (`ANTHROPIC_BASE_URL` env var)
- **OpenAI SDK** (`OPENAI_BASE_URL` env var)
- **Anthropic SDK** (`ANTHROPIC_BASE_URL` env var)
- **Any framework** supporting standard `base_url` overrides.

## Uninstall

If you ever want to remove it, it restores your computer to exactly how it was:

```bash
npx vibe-billing uninstall
```

## How It Works

The Agentic Firewall engine sits locally on your machine at `localhost:4000`. Every API request from your agent passes through it before hitting Anthropic or OpenAI.

1. **Loop detection** — If an agent submits the exact same request 3 times in a row, the proxy hard-kills the connection before you are billed for infinite loops.
2. **Context caching** — The proxy auto-injects `ephemeral` caching headers into your payloads, yielding up to 80% cheaper system prompts on supported models.
3. **No Config Needed** — `setup` handles the environment variables and `openclaw.json` bindings automatically.

```text
Your Agent → Vibe Billing (Agentic Firewall) → AI Provider
```
