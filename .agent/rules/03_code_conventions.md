# Code Conventions — VibeBilling

All agents writing code in this project must follow these conventions.

---

## TypeScript

- **Strict mode** is enabled via `tsconfig.json` — respect it.
- Run source via `tsx` in development, `ts-node` in production. **Do NOT compile `.ts` → `.js` and commit the output.**
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
