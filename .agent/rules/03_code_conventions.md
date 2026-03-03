# Code Conventions — VibeBilling

All agents writing code in this project must follow these conventions.

---

## TypeScript

- **Strict mode** is enabled via `tsconfig.json` — respect it.
- The production server runs **compiled `.js` files**, not `.ts` directly. When editing `.ts`, you MUST also update the corresponding `.js` file and deploy it. PM2 on the server loads `.js` only.
- Use `const` by default. Use `let` only when mutation is required. Never use `var`.

## File Structure

- Source code lives in `agent-proxy/src/`.
- Tests live in `agent-proxy/tests/` and use **Vitest**.
- Dashboard source is `agent-dashboard/src/App.tsx` (single-page React app).

## Naming

### Log Prefixes
Use established prefixes for consistency in `console.log`:
- `[PROXY]` — General proxy operations
- `[FIREWALL]` — Circuit breaker and security events
- `[SHADOW ROUTER]` — Failover events
- `[ZSTD DECOMPRESS ERROR]` — Decompression failures
- `[CONTEXT CDN]` — Cache injection events

### Error Responses
All error responses follow this shape:
```json
{
  "error": {
    "message": "Human-readable error description",
    "type": "error_type_slug"
  }
}
```

### Dashboard Status Colors
- `text-emerald-400` — CDN hit / success
- `text-yellow-400` — Failover / warning
- `text-red-400` — Blocked / error
- `text-gray-400` — Pass-through / neutral

## Git & Source Control

### Branch Strategy
- `main` is **protected**. CI must pass before merge.
- Feature work goes on `feature/*` branches.
- Merged via Pull Request only.

### Commit Messages
Use conventional commit prefixes:
- `feat:` — New feature
- `fix:` — Bug fix
- `test:` — Test additions or changes
- `docs:` — Documentation updates
- `refactor:` — Code restructuring (no behavior change)
- `chore:` — Build/tooling changes

### Examples
```
feat: add Gemini provider routing to proxyHandler
fix: correct ZSTD decompression for empty payloads
test: add circuit breaker edge case for expired TTL
docs: update AGENTS.md with new Marketing role
```

## Adding a New LLM Provider

Follow this exact sequence:
1. Add the base URL constant in `proxyHandler.ts`
2. Add detection logic in `handleProxyRequest()`
3. Add Context CDN logic in `applyContextCDN()` if the provider supports caching
4. Add a pricing tier in `pricing.ts`
5. Add test cases in `tests/proxyHandler.test.ts`
6. Update `Gemini.md` with routing instructions for the new provider

## Production Deployment Checklist

These rules exist because we learned them the hard way.

### Dual-File Deployment (TS + JS)
- The proxy runs **compiled `.js`** on the GCP server via PM2. When you edit any `.ts` file in `agent-proxy/src/`, you **MUST also update the corresponding `.js` file** and rsync it to the server.
- After rsync, **always restart PM2**: `ssh meme-snipe-v19-vm "pm2 restart agentic-firewall-proxy"`

### Stats Pollution Prevention
- The stats engine must **NEVER count GET requests** (bots, crawlers, health checks). Only POST requests with a non-empty body should increment `totalRequests` or `savedMoney`.
- Web crawlers will constantly hit `/favicon.ico`, `/robots.txt`, `/.env`, `/health` — these are not LLM traffic.

### Auth Middleware Allowlisting
- When adding a new **public API endpoint** (like `/api/register`), you **MUST add it to `OPEN_ROUTES` in `authMiddleware.js`**. Otherwise the auth middleware will reject unauthenticated requests to that endpoint.

### Persistent State (stats.json)
- `stats.json` and `users.json` are persisted to disk every 30 seconds. After a PM2 restart, the proxy reloads these files. To get a truly clean slate, **delete these files BEFORE restarting PM2**: `rm -f stats.json users.json && pm2 restart agentic-firewall-proxy`

### CLI (agent-cli) Publishing
- After modifying `agent-cli/bin/cli.js`, bump the version with `npm version patch`, update the `VERSION` constant in `cli.js` to match, then `npm publish`.
- The CLI must **never require users to manually `source` shell configs**. Always set `process.env` immediately so agents work in the current terminal session.

### npm Version Sync
- The `VERSION` constant in `cli.js` and the `version` in `package.json` must always match. Bump both when publishing.
