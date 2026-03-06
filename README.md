# Vibe Billing

`Vibe Billing` is the product. `Agentic Firewall` is the proxy engine underneath it.

The job of this repo is simple: make autonomous agents cheaper, safer, and easier to run unattended by adding:

- spend caps
- loop blocking
- repeated-context caching
- cheaper/faster routing when safe
- receipts that show what was saved

## Core CLI

```bash
npx vibe-billing scan
npx vibe-billing setup
npx vibe-billing status
npx vibe-billing run <agent_cmd>
```

## Local Dev / Staging

This workspace is set up for local and staging-style development, not production rollout.

### 1. Proxy

```bash
cd /Users/benjij_ai/Documents/agentic-firewall/agent-proxy
npm install
cp .env.example .env
PUBLIC_MODE=false PORT=4000 BIND_HOST=127.0.0.1 npm start
```

### 2. Dashboard

```bash
cd /Users/benjij_ai/Documents/agentic-firewall/agent-dashboard
npm install
cp .env.example .env.local
npm run dev
```

### 3. CLI against local proxy

```bash
VIBE_BILLING_PROXY_URL=http://127.0.0.1:4000 npx vibe-billing scan
VIBE_BILLING_PROXY_URL=http://127.0.0.1:4000 npx vibe-billing status
```

## Repo Layout

```text
agent-cli/         npm CLI for scan/setup/status/run
agent-proxy/       Agentic Firewall engine (Express / TypeScript)
agent-dashboard/   React dashboard
agent-mcp/         MCP surface for firewall status
test-agent/        Local integration test agents
stress_tests/      Exhaustive SDK tests
```

## Current Positioning

- product: `Vibe Billing`
- engine: `Agentic Firewall`
- default dev mode: local-first
- production deploys: separate concern from this branch/workspace

## License

MIT
