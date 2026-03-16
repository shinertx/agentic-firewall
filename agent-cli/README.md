# vibe-billing

`vibe-billing` is a trust-first CLI for scanning agent waste and routing supported agent traffic through the Vibe Billing firewall.

## Install / Setup

```bash
npx vibe-billing setup
```

`setup` does three things:

1. Detects supported local agent installs such as OpenClaw and Claude Code.
2. Writes managed `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` routing blocks into your shell config and, when OpenClaw is present, `~/.openclaw/.env`.
3. Verifies the firewall can be reached. If OpenClaw is detected, it only reports full success after a real OpenClaw request is verified through the proxy.

## Scan First

Run `npx vibe-billing scan` to inspect local Claude Code and OpenClaw logs before changing anything.

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

## Validate Your Setup

Use these commands after install:

```bash
npx vibe-billing verify
npx vibe-billing doctor
```

- `verify` runs the end-to-end validation flow.
- `doctor` runs the same checks and exits nonzero when a required check fails.

When OpenClaw is installed, validation checks:

- proxy reachability
- shell env state
- the managed `~/.openclaw/.env` routing block
- supported API-key auth for Anthropic or OpenAI
- a real OpenClaw smoke request through the firewall

## Supported Integrations

Current integration targets are:

- **OpenClaw** via `~/.openclaw/.env` plus standard provider env vars
- **Claude Code** via `ANTHROPIC_BASE_URL`
- **OpenAI SDK / OpenAI-compatible tools** via `OPENAI_BASE_URL`
- **Anthropic SDK** via `ANTHROPIC_BASE_URL`

Current support boundary:

- OpenClaw **API-key / BYOK flows** for Anthropic and OpenAI are the intended support path. Run `npx vibe-billing doctor` to confirm your local agent actually routes through the firewall.
- OpenClaw **OAuth/account-linked flows are not verified yet**.
- `vibe-billing` does **not** patch `openclaw.json`.

## How Routing Works

Vibe Billing routes traffic to the managed firewall endpoint:

```text
Your Agent -> Vibe Billing firewall -> AI provider
```

The CLI uses managed env blocks instead of deep app mutation:

- shell config gets `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL`
- OpenClaw gets the same routing values in `~/.openclaw/.env`

## Uninstall

To remove the managed routing blocks:

```bash
npx vibe-billing uninstall
```

`uninstall` removes only the managed shell and OpenClaw env blocks added by the CLI.

If OpenClaw still has custom `baseURL` entries inside `auth-profiles.json`, `uninstall` will warn about them instead of silently changing them. Remove those overrides yourself if you want a fully direct, no-proxy OpenClaw setup.
