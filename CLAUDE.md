# Agentic Firewall — Project Context for Claude Code

## What This Is

The **Agentic Firewall** is a reverse-proxy server that sits between autonomous AI agents (OpenClaw, Claude Code, AutoGPT) and LLM providers (Anthropic, OpenAI, Gemini, NVIDIA). It solves **"Vibe Billing"** — where runaway agents waste thousands of dollars on redundant multi-million-token codebase reads, infinite retry loops, and overkill model selection.

**Production URL:** `https://api.jockeyvc.com`  
**Deployed on:** GCP VM (`meme-snipe-v19-vm`), Docker Compose, TLS via Caddy

---

## Monorepo Architecture

```
vibebilling/
├── agent-proxy/          # Core proxy server (Express 5 / TypeScript)
│   ├── src/
│   │   ├── index.ts          # Express app, ZSTD middleware, timeout config
│   │   ├── proxyHandler.ts   # Provider routing, Context CDN, SSE streaming
│   │   ├── circuitBreaker.ts # SHA-256 loop detection (3 identical = kill)
│   │   ├── shadowRouter.ts   # 429 cheap-model failover paths
│   │   ├── pricing.ts        # Configurable model pricing tiers for savings math
│   │   └── stats.ts          # In-memory request/savings tracking
│   └── tests/                # Vitest unit tests
├── agent-dashboard/      # React 19 / Vite 7 / Tailwind 4 real-time UI
│   └── src/App.tsx           # Stats cards, live traffic feed table
├── agent-mcp/            # MCP server (stdio) — exposes get_firewall_status tool
├── agent-waste-scanner/  # CLI diagnostic — scans agent logs for waste patterns
├── test-agent/           # SDK stress tests (OpenAI, Anthropic, NVIDIA)
├── stress_tests/         # Exhaustive Node.js + Python test suites
├── Agentic_Firewall.md   # Product documentation
├── Gemini.md             # Universal agent compatibility guide
└── deploy.sh             # Syncs VM checkout to origin/main and starts Docker Compose
```

### Request Flow

```
Agent → HTTPS → Caddy (TLS) → Express :4000
  → ZSTD decompress (if Python SDK)
  → Circuit Breaker (loop check)
  → Context CDN (inject cache_control: ephemeral for Anthropic)
  → Route to correct provider (Anthropic / OpenAI / Gemini / NVIDIA)
  → SSE stream response back to agent
```

---

## Development Commands

### Proxy Server
```bash
cd agent-proxy
npm install
npm run dev          # tsx watch with hot reload on :4000
npm test             # Run unit tests (vitest)
```

### Dashboard
```bash
cd agent-dashboard
npm install
npm run dev          # Vite dev server on :5173
```

### MCP Server
```bash
cd agent-mcp
npm install
node index.js        # Starts stdio MCP server
```

### Deployment
```bash
./deploy.sh          # Sync origin/main on meme-snipe-v19-vm and restart Docker Compose
./deploy.sh staging  # Also starts the staging profile and requires staging health to pass
```

---

## Code Conventions

### Adding a New LLM Provider
1. Add the base URL constant in `proxyHandler.ts` (e.g., `const NEWPROVIDER_BASE_URL = '...'`)
2. Add detection logic in `handleProxyRequest()` — check URL patterns, headers, or model prefixes
3. Add Context CDN logic in `applyContextCDN()` if the provider supports server-side caching
4. Add a pricing tier in `pricing.ts` if tracking savings for this provider's models
5. Add test cases in `tests/proxyHandler.test.ts`

### Naming
- Log prefixes use `[PROXY]`, `[FIREWALL]`, `[SHADOW ROUTER]`, `[ZSTD DECOMPRESS ERROR]`
- Error responses follow the shape: `{ error: { message: string, type?: string } }`
- Dashboard status colors: `text-emerald-400` (CDN hit), `text-yellow-400` (failover), `text-red-400` (blocked/error), `text-gray-400` (pass-through)

### File Structure
- TypeScript source lives in `agent-proxy/src/`
- Compiled `.js` siblings should NOT be committed — run via `tsx` in dev, `ts-node` in production
- Tests use `vitest` and live in `agent-proxy/tests/`
- Dashboard is a single-page React app in `agent-dashboard/src/App.tsx`

---

## Critical Rules

### Security
- **ALWAYS** use `https://api.jockeyvc.com` as the proxy URL. **NEVER** use raw HTTP IPs like `http://34.55.255.155:4000` — this transmits API keys in plaintext
- Never commit `.env` files (already in `.gitignore`)
- Never hardcode API keys in source files — use `process.env`

### Agent Routing
- Agents are notorious for ignoring `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` env vars. See `Gemini.md` for the compatibility matrix on how to force each agent type through the proxy
- The proxy auto-detects the target provider by inspecting the request URL and headers — agents don't need to specify which provider they're targeting

### Performance
- The Express server has 30-minute timeouts (`keepAliveTimeout`, `headersTimeout`, `server.timeout`) to support long-running reasoning chains — do NOT reduce these
- JSON body limit is 50MB to accommodate massive agent context payloads
- SSE responses must have `Cache-Control: no-cache` and call `res.flushHeaders()` before streaming

### Context CDN
- **Anthropic:** Real savings — injects `cache_control: { type: 'ephemeral' }` which triggers server-side prompt caching. Requires `anthropic-beta: prompt-caching-2024-07-31` header
- **OpenAI:** Real savings — reorders messages to put system content first for automatic prefix caching (≥1024 tokens). OpenAI auto-caches matching prefixes with no headers needed
- **Gemini:** Real savings — leverages Gemini's implicit caching by ensuring `systemInstruction` is prefix-stable and reordering contents for maximum cache hits (≥1024 tokens)
- Cache injection only triggers on content blocks > 500 chars (Anthropic) or ≥1024 tokens (OpenAI/Gemini)

### Auth Middleware
- Rejects POST requests without `x-api-key` or `Authorization` header (401)
- Allowlists `/api/stats` endpoint and GET/HEAD/OPTIONS methods

### Circuit Breaker
- SHA-256 hashes the full payload (model + system + all messages) per API-key (falls back to IP)
- Keeps a sliding window of 5 recent hashes with 5-minute TTL
- If the last 3 are identical → returns 400 with `agentic_firewall_blocked` type
- Increments `blockedLoops` counter in globalStats

## Engineering Ownership

This project is engineered as a production system, not a prototype. All development follows GitHub best practices:

- **Branch strategy:** `main` (protected, CI required) with `feature/*` branches merged via PR
- **Commit convention:** `feat:`, `fix:`, `test:`, `docs:` prefixes
- **CI:** GitHub Actions runs Vitest on Node 20 + 22 for every push/PR
- **Deployment:** merge to `main` → GitHub Actions → Docker Compose on GCP VM; `deploy.sh` is the manual equivalent

---

## Current Capability Notes

- **Single-node runtime:** the service runs as one Docker Compose deployment on the GCP VM. Redis-backed user/session/install sync exists when Redis is available, but do not claim horizontally scaled production until multiple running instances are proved.
- **Budget enforcement:** supported through the `x-budget-limit` request header and tracked per local user/machine identity.
- **Per-session tracking:** supported through explicit `x-session-id` when provided, with user-level session summaries available behind admin auth.
- **Claude count tokens:** `/v1/messages/count_tokens` is passed through for Claude Code preflight estimation.
- **OpenAI prompt caching:** large OpenAI requests are reordered for prefix stability and receive a deterministic `prompt_cache_key` when a stable system prefix is present.
- **Shadow Router:** same-provider failover covers Anthropic, OpenAI, and Gemini cheap-model fallback paths; cross-provider failover depends on the caller having a usable key for the target provider.

## Roadmap

- Prove multi-instance runtime behavior before marketing horizontal scaling.
- Expand live provider canaries for budget, session, count-token, and cross-provider failover paths.
- Improve dashboard visibility for per-session cost, queue pressure, and no-progress incidents.
- Keep installer and routing support current for Claude Code, OpenClaw, OpenAI-compatible agents, Gemini, and NVIDIA.

## Deploy Configuration (configured by /setup-deploy)
- Platform: GitHub Actions deploying Docker Compose to custom GCP VM `meme-snipe-v19-vm`
- Production URL: `https://api.jockeyvc.com`
- Deploy workflow: `.github/workflows/ci.yml` deploy job runs on push to `main`
- Deploy status command: `gh run list --workflow "CI / CD" --branch main --limit 5`
- Production health check: `https://api.jockeyvc.com/api/stats`
- Staging URL: `https://staging.jockeyvc.com`
- Staging health check: `https://staging.jockeyvc.com/api/stats` currently must return `200` before staging is called ready
- Manual deploy command: `./deploy.sh`
- Manual staging deploy command: `./deploy.sh staging` (Caddy routes staging to the Docker staging proxy on VM port `4001`)
- Runtime target on VM: `/home/benjijmac/agentic-firewall`

### Custom deploy hooks
- Before deploy: run the relevant verification gates from `AGENTS.md` for changed areas.
- After deploy: verify `https://api.jockeyvc.com/api/stats` returns `200`.
- Canary: monitor production stats, dashboard load, and recent error/loop activity after deploy.

## Local gstack skill routing

When working inside Benji's Codex workspace, the following gstack skills may be available locally. These are operator workflow hints, not npm scripts or repo-provided commands. When the user's request matches an available local skill, invoke it; otherwise use the matching repo commands above.

Key routing rules:
- Product ideas/brainstorming -> invoke /office-hours
- Strategy/scope -> invoke /plan-ceo-review
- Architecture -> invoke /plan-eng-review
- Design system/plan review -> invoke /design-consultation or /plan-design-review
- Full review pipeline -> invoke /autoplan
- Bugs/errors -> invoke /investigate
- QA/testing site behavior -> invoke /qa or /qa-only
- Code review/diff check -> invoke /review
- Visual polish -> invoke /design-review
- Ship/deploy/PR -> invoke /ship or /land-and-deploy
- Save progress -> invoke /context-save
- Resume context -> invoke /context-restore
