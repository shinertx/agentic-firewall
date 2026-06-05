# AGENTS.md - VibeBilling / Agentic Firewall

This file is the local operating contract for agents working in this repo. It is not the global source of truth and it is not a roadmap. Keep it short, current, and enforceable.

## Source Of Truth

- In Benji's local Codex workspace, read `~/WORKSPACE_INDEX.md` before broad repo, cleanup, routing, deploy, or project-canonicalization work.
- In that same local workspace, project routing lives in `~/workspace-audits/PROJECT_REGISTRY.json`; the readable map is `~/workspace-audits/PROJECT_CONVERSATION_MAP.md`.
- This repo's current canonical path is whatever the local project registry says. Do not hardcode local repo paths as active if the registry says the repo is quarantined or under review.
- This repo is code truth for Agentic Firewall behavior. Live service state is proved by the running endpoints, not by docs alone.
- If this file conflicts with `WORKSPACE_INDEX.md`, follow `WORKSPACE_INDEX.md` and update this file only as a local adapter.

## Project Identity

- Product: Agentic Firewall, also known as VibeBilling.
- Purpose: a reverse proxy that reduces agent waste by adding prompt caching support, loop/no-progress detection, budget controls, request shaping, queueing, failover, and observability between AI agents and LLM providers.
- Production: `https://api.jockeyvc.com`
- Staging: `https://staging.jockeyvc.com` only counts as usable when `/api/stats` returns `200`.
- Infrastructure: GCP VM `meme-snipe-v19-vm`, Docker Compose, Caddy/TLS, GitHub Actions deploys from `main`.
- GitHub repo: `shinertx/agentic-firewall`.

## First Moves

1. Check `git status --short --branch` and do not overwrite user or untracked work.
2. Fetch remote state before judging freshness, branching, or preparing a PR.
3. Read the smallest relevant docs: `README.md` for usage, `CLAUDE.md` / `Gemini.md` for routing behavior, package files for scripts, and `.github/workflows/` for CI/deploy truth.
4. Inspect source before trusting docs. If docs and code disagree, report the drift and update docs when the task changes behavior.
5. Do not rely on missing `.agent/rules/*` files. If local rules are needed, keep them in this `AGENTS.md` or add explicit docs that exist.

## Ownership

| Area | Paths | Owner Mode |
|---|---|---|
| Proxy runtime | `agent-proxy/` | Provider routing, caching, budgets, loop detection, queueing, telemetry, admin endpoints |
| Dashboard | `agent-dashboard/` | React/Vite UI, public stats, admin visibility, live traffic display |
| CLI and SDK | `agent-cli/`, `agentic-firewall-cli/`, `agent-mcp/` | npm CLI, installer behavior, OpenClaw/Claude routing, MCP status tools |
| QA and stress | `test-agent/`, `stress_tests/`, `agent-proxy/tests/` | smoke tests, SDK compatibility, stress and live-provider validation |
| Deploy | `deploy.sh`, `docker-compose.yml`, `.github/workflows/` | build, deploy, health checks, release gates |
| Shared docs | `README.md`, `CLAUDE.md`, `Gemini.md`, `Agentic_Firewall.md`, `AGENTS.md` | Must match current behavior and live operational reality |

Cross-area edits are allowed only when needed to finish the task cleanly. Call out the handoff in the final summary or PR description.

## Safety Rules

- Treat production as live. Do not run load, stress, destructive, or real-provider-cost tests against production unless the user explicitly asks.
- Never commit secrets, provider keys, `.env` files, shell profiles, local auth profiles, generated credentials, or copied request payloads containing user data.
- Do not print or paste secrets into reports. If a real secret is found, redact it and tell the user to rotate it.
- Runtime data is not source: `node_modules/`, `dist/`, logs, coverage, `agent-proxy/data/*.json`, `agent-proxy/*.json` runtime counters, local stats dumps, and machine-specific caches stay out of commits unless the task explicitly says otherwise.
- Do not change user shell files, VS Code settings, Claude/OpenClaw settings, LaunchAgents, Docker services, DNS, GitHub secrets, npm publishing, or VM state unless the request clearly requires it.
- Do not delete repo or workspace files during cleanup. Use the machine cleanup policy in `WORKSPACE_INDEX.md`.

## Engineering Practice

- Start behavior work from current `origin/main` unless the user intentionally points at a feature branch.
- Use branches and PRs for reviewable work. Do not commit directly to `main`.
- Keep changes scoped. Avoid opportunistic refactors across proxy, dashboard, CLI, and deploy code in one patch.
- Prefer typed, tested TypeScript in `agent-proxy` and `agent-dashboard`.
- Preserve compatibility for Anthropic, OpenAI, Gemini, NVIDIA, OpenClaw, Claude Code, and common SDK clients when touching request routing.
- When touching request mutation, streaming, compression, provider headers, auth, queueing, or budget logic, add or update focused tests.
- When touching installer or CLI behavior, test in a temp home/profile when possible. Do not mutate the user's real home config during tests.
- When touching docs, remove stale claims instead of layering new contradictory notes on top.

## Adversarial Execution Standard

For non-trivial engineering changes, treat the first approach as a hypothesis until verified.

Before editing:

- Identify the main failure modes that matter for this change, especially state corruption, async races, network failures, bad inputs, security boundaries, and deploy/runtime drift.
- Choose the smallest proof that would falsify or validate the approach.

During implementation:

- Add focused tests, assertions, error handling, or telemetry where they expose real failure states.
- Do not add noisy instrumentation to simple or low-risk changes.

Before completion:

- Run the relevant local tests or sandbox proof.
- Report the exact verification commands and results.
- If verification fails, investigate root cause and fix forward unless the user explicitly asks for rollback.
- Never run destructive git rollback commands without explicit user approval.

## Verification Gates

Use the smallest verification set that matches the change:

- Proxy changes: `cd agent-proxy && npm test`
- Dashboard changes: `cd agent-dashboard && npm run build && npm run lint`
- CLI routing changes: run relevant `node --test` tests under `agent-cli/tests/`
- Dependency changes: run `npm audit --omit=dev` in affected packages and report remaining production vulnerabilities.
- Docker/deploy changes: build affected Docker image or compose stack locally where practical, then verify the health endpoint.
- Production verification: `https://api.jockeyvc.com/api/stats` must return `200` before claiming production is healthy.
- Staging verification: `https://staging.jockeyvc.com/api/stats` must return `200` before claiming staging is healthy.

If a package has only a placeholder `npm test`, say that plainly and either add a real test script or run a direct command.

## CI And Release Expectations

- CI should cover proxy tests, dashboard build/lint, CLI tests, and any package whose behavior is changed.
- A PR that changes deployed behavior should include the verification commands and results.
- Do not publish npm packages, push tags, merge PRs, or deploy unless explicitly asked.
- If GitHub Actions deploy behavior changes, update `.github/workflows/ci.yml`, `deploy.sh`, and docs together.
- If release behavior changes, confirm package names, versions, and npm provenance before publishing.

## Operational Truth

- Production health is live endpoint proof, not an assumption.
- Staging marked "pending" is not healthy until its endpoint proves it.
- Dashboard metrics are observability signals; inspect proxy code and persisted runtime data before treating metrics as accounting truth.
- Budget, session, cache, queue, failover, and no-progress features must be verified in code/tests before docs claim them as shipped.
- If local checkout is quarantined or marked `QUARANTINE_REVIEW`, do not present it as the active development home without checking the project registry.

## Handoff Format

When finishing work, report:

- What changed.
- What was verified.
- What remains risky or unverified.
- Any cross-area dependency, for example: `HANDOFF: dashboard needs a card for the new proxy field`.

## Escalation

Stop and ask the user when:

- The desired source of truth is unclear after checking the registry and repo.
- A task requires real money, provider tokens, production traffic, DNS, GitHub secrets, npm publishing, or VM mutation and permission is not explicit.
- A change would overwrite user work or untracked files that appear intentional.
- Live service behavior contradicts repo expectations and the next step would be deploy or rollback.
