# Project Identity — Agentic Firewall

## What This Is

The **Agentic Firewall** (product name: **VibeBilling**) is a reverse-proxy server that sits between autonomous AI agents and LLM providers. It solves "Vibe Billing" — where runaway agents waste thousands of dollars on redundant multi-million-token codebase reads, infinite retry loops, and overkill model selection.

## Tech Stack

| Layer | Technology |
|---|---|
| **Proxy Server** | Express 5, TypeScript, Node.js 20+ |
| **Dashboard** | React 19, Vite 7, Tailwind CSS 4 |
| **MCP Server** | Node.js, stdio protocol |
| **Testing** | Vitest (unit), custom Node.js + Python stress tests |
| **CI/CD** | GitHub Actions (Node 20 + 22), `deploy.sh` rsync |
| **Infrastructure** | GCP VM, PM2, Caddy (TLS/HTTPS) |

## Production Details

- **URL:** `https://api.jockeyvc.com`
- **Server:** `meme-snipe-v19-vm` (GCP)
- **Proxy Port:** 4000 (behind Caddy on 443)
- **Process Manager:** PM2

## Monorepo Layout

```
vibebilling/
├── agent-proxy/           # Core proxy server
├── agent-dashboard/       # React monitoring UI
├── agent-mcp/             # MCP server (firewall status tool)
├── agent-waste-scanner/   # CLI diagnostic tool
├── agent-marketing/       # Marketing automation
├── agent-cli/             # npm CLI package
├── agentic-firewall-cli/  # CLI installer
├── stress_tests/          # Test suites
├── test-agent/            # SDK integration tests
├── AGENTS.md              # Multi-agent coordination (READ THIS)
├── CLAUDE.md              # Claude Code-specific rules
├── Gemini.md              # Universal routing guide
└── Agentic_Firewall.md    # Product documentation
```

## Core Features

1. **Context CDN** — Injects `cache_control: ephemeral` for Anthropic prompt caching (up to 90% input cost reduction)
2. **Multi-Provider Routing** — Auto-detects Anthropic, OpenAI, Gemini, NVIDIA from request structure
3. **Circuit Breaker** — SHA-256 hashes payloads; blocks after 3 identical requests
4. **Shadow Router** — Automatic Sonnet → Haiku failover on 429 rate-limits
5. **ZSTD Decompression** — Handles Python SDK compressed payloads
6. **30-Minute Timeouts** — Prevents premature disconnection during long reasoning chains

## Request Flow

```
Agent → HTTPS → Caddy (TLS) → Express :4000
  → ZSTD decompress (if needed)
  → Circuit Breaker (loop check)
  → Context CDN (inject caching headers)
  → Route to correct provider
  → SSE stream response back to agent
```
