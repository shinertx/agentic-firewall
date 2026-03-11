# vibe-billing

**Agent Runtime Control** — Stop AI agents from getting stuck in loops and burning your money.

## Install

```bash
npx vibe-billing setup
```

## Proof of Savings

Run `npx vibe-billing scan` to analyze your local agent logs and instantly see exactly how much money you've lost to API hallucinations. 

```text
Agent Waste Report

Runs analyzed: 142
Retry loops: 18
Context re-sends: 32
Overkill model usage: 56

Total agent spend: $124.50
Estimated wasted spend: $102.09

Fix with:
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

The firewall sits locally on your machine at `localhost:4000`. Every API request from your agent passes through it before hitting Anthropic or OpenAI.

1. **Loop detection** — If an agent submits the exact same request 3 times in a row, the proxy hard-kills the connection before you are billed for infinite loops.
2. **Context caching** — The proxy auto-injects `ephemeral` caching headers into your payloads, yielding up to 80% cheaper system prompts on supported models.
3. **No Config Needed** — `setup` handles the environment variables and `openclaw.json` bindings automatically.

```text
Your Agent → Agent Firewall (localhost) → AI Provider
```
