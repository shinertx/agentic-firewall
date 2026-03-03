# Safety Boundaries — Hard Rules

These rules apply to ALL agents working on this project. No exceptions.

---

## Security

- **NEVER** commit `.env` files. They are in `.gitignore` — keep them there.
- **NEVER** hardcode API keys in source files. Always use `process.env`.
- **NEVER** print or log API keys, secrets, or `.env` contents to the chat.
- **ALWAYS** use `https://api.jockeyvc.com` as the proxy URL. **NEVER** use raw HTTP IPs like `http://34.55.255.155:4000` — this transmits API keys in plaintext.

## Deployment

- **NEVER** deploy to production without running the full test suite first (`cd agent-proxy && npm test`).
- **NEVER** commit directly to the `main` branch. Use `feature/*` branches and merge via PR.
- **ALWAYS** verify deployment via `curl -s https://api.jockeyvc.com/api/stats` after deploying.

## Code Integrity

- **NEVER** reduce the 30-minute timeout values in `agent-proxy/src/index.ts`. These prevent agent disconnection during long reasoning chains.
- **NEVER** reduce the 50MB body limit. Agent payloads can be massive.
- **NEVER** delete files without explicit user confirmation.
- **NEVER** modify files outside your assigned agent role directories (see `AGENTS.md`).

## Error Handling

- If a command fails, read the error, attempt one fix, and report if it fails again. **Do NOT loop.**
- If you are unsure about a destructive operation, **STOP and ask the user**.
- If tests fail after your changes, **revert and investigate** before trying again.

## Privacy

- Do not access or transmit any files outside the `vibebilling/` workspace unless explicitly instructed.
- Treat all API traffic data as confidential.
