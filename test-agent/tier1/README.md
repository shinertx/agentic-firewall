## Tier 1 Smoke Matrix

This directory holds the repeatable compatibility checks for the Tier 1 surfaces:

- Anthropic SDK through the firewall
- OpenAI SDK chat completions through the firewall
- OpenAI SDK responses API through the firewall
- OpenClaw local Anthropic agent through the firewall
- OpenClaw local OpenAI agent through the firewall

### Assumptions

- The proxy is already running locally on `http://127.0.0.1:4000`
- The proxy is in public/pass-through mode for SDK testing
- Provider keys are supplied via environment variables, never committed

### Run

```bash
cd test-agent
ANTHROPIC_API_KEY=... OPENAI_API_KEY=... npm run tier1:smoke
```

### Optional OpenClaw controls

```bash
OPENCLAW_ANTHROPIC_AGENT=main
OPENCLAW_OPENAI_AGENT=openai-smoke
OPENCLAW_BIN=/absolute/path/to/openclaw/or/dist/index.js
```

`OPENCLAW_OPENAI_AGENT` defaults to `openai-smoke`. If that agent does not exist, the OpenClaw OpenAI check is skipped.

### Why this exists

Tier 1 support should be proven the way infrastructure is proven:

- one command
- explicit pass/fail output
- real provider traffic
- no reliance on hand-edited local state

This harness is the baseline for future compatibility work on Claude Code, Cursor, and other endpoint-configurable agents.
