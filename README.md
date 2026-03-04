# Agentic Firewall

A reverse-proxy that sits between AI agents and LLM providers to prevent **Vibe Billing** — where runaway autonomous agents waste thousands of dollars on redundant context reads and infinite retry loops.

**Production:** `https://api.jockeyvc.com`

## Features

| Feature | What It Does |
|---|---|
| **Context CDN** | Injects `cache_control: ephemeral` into Anthropic requests, triggering server-side prompt caching for up to 90% input cost reduction |
| **Multi-Provider Routing** | Auto-detects and routes to Anthropic, OpenAI, Gemini, or NVIDIA based on request structure |
| **Circuit Breaker** | SHA-256 hashes recent payloads per IP; blocks after 3 identical requests to stop infinite loops |
| **Shadow Router** | Automatic Sonnet → Haiku failover on 429 rate-limit responses |
| **ZSTD Decompression** | Handles Python SDK compressed payloads that crash standard proxies |
| **30-Min Timeouts** | Prevents premature disconnection during long reasoning chains |

## Use the CLI (NPM)

The easiest way to see your waste and setup your proxy connection is the `vibe-billing` CLI tool.

```bash
# See how much your agents are wasting
npx vibe-billing scan

# Route agents through the firewall to fix it
npx vibe-billing setup

# Wrap an agent to get a receipt of your savings
npx vibe-billing run <agent_cmd>
```

## Running the Proxy Locally

```bash
# Proxy server
cd agent-proxy && npm install && npm run dev

# Dashboard
cd agent-dashboard && npm install && npm run dev

# Tests
cd agent-proxy && npm test
```

## Monorepo Structure

```
agent-proxy/       Core proxy server (Express / TypeScript)
agent-dashboard/   React dashboard for live traffic monitoring
agent-mcp/         MCP server exposing firewall status tool
test-agent/        SDK integration tests
stress_tests/      Exhaustive Node.js + Python test suites
```

## Agent Routing

Point your agent's base URL to `https://api.jockeyvc.com` — see [Gemini.md](./Gemini.md) for the full routing guide.

## License

MIT
