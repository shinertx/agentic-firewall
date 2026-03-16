# AGENTS.md — VibeBilling Multi-Agent Coordination

This file is the **master org chart** for all AI agents working on this project. Every agent must read this file before doing any work.

---

## Project Identity

**Product:** Agentic Firewall — a reverse-proxy that prevents "Vibe Billing" by inserting prompt caching, loop detection, and failover between AI agents and LLM providers.

**Production URL:** `https://api.jockeyvc.com`
**Staging URL:** `https://staging.jockeyvc.com` (pending DNS)
**Infrastructure:** GCP VM (`meme-snipe-v19-vm`), Docker Compose, Caddy (TLS)
**CI/CD:** GitHub Actions → auto-deploy on merge to `main`
**Repo:** Monorepo at `/Users/benjijmac/Documents/vibebilling-clean`

---

## Agent Roles & Directory Ownership

| Role | Directories Owned | Responsibility |
|---|---|---|
| **Proxy Engineer** | `agent-proxy/` | Core firewall features, new LLM providers, Context CDN, Circuit Breaker, Shadow Router |
| **Dashboard Engineer** | `agent-dashboard/` | React monitoring UI, live traffic feed, stats cards, charts |
| **QA & Testing** | `stress_tests/`, `test-agent/`, `agent-proxy/tests/` | Unit tests, integration tests, stress tests, pre-deploy validation |
| **DevOps** | `deploy.sh`, PM2/Caddy config | Deployment, server management, uptime monitoring, CI/CD |
| **Marketing (External)** | `N/A in this repo` | Studio marketing automation lives in `shinertx/jenni-marketing-agents`. Product-facing landing pages may still live in product repos and require handoff when implemented outside `agent-proxy/`. |
| **CLI/SDK** | `agent-cli/`, `agentic-firewall-cli/`, `agent-mcp/` | npm package, CLI installer, MCP server integration |

### Ownership Rules

1. **Stay in your lane.** Only modify files inside the directories you own.
2. **Cross-boundary changes require handoff.** If a Proxy Engineer change requires a Dashboard update, document the API change and hand off to Dashboard Engineer.
3. **Shared files** (`README.md`, `CLAUDE.md`, `Gemini.md`, `Agentic_Firewall.md`, `AGENTS.md`) may be updated by any role, but only to reflect changes in their owned directories.

---

## Handoff Protocol

When one agent finishes work that impacts another agent's territory:

1. **Document the change** — Write a clear summary of what changed and why in the PR description or commit message.
2. **Flag the dependency** — If Dashboard needs to update because Proxy added a new endpoint, add a comment: `<!-- HANDOFF: Dashboard needs to add a card for /api/new-endpoint -->`.
3. **Never assume** — Don't modify another agent's code "while you're in there." Create a separate task.

---

## GitHub Engineering Practice

When working in this repo, use GitHub as the source of truth and keep the local checkout boring:

1. **Start from current `origin/main`.** Fetch first, branch from the latest remote main, and avoid stacking new work on stale local history.
2. **Push branches, not direct `main` edits.** Treat `main` as PR-only and keep changes reviewable in a scoped branch.
3. **Keep generated/runtime files out of commits.** Things like local stats dumps, cache files, or machine-specific artifacts must stay untracked unless the task explicitly requires them.
4. **Ship behavior changes with verification.** If CLI or proxy behavior changes, include the smallest useful test or scripted verification and note what was verified before pushing.
5. **Leave the repo in a clear state.** Before pushing, check `git status`, make sure only intentional files are included, and call out any known local-only leftovers.
6. **Match docs to reality.** If setup, deploy, or integration behavior changes, update the relevant docs in the same branch so GitHub reflects how the product actually behaves.

---

## Escalation Protocol

If an agent encounters a problem it cannot solve:

1. **Stop.** Do not guess or loop.
2. **Document the blocker** — Write exactly what failed, what was tried, and what information is missing.
3. **Report to the user** — Present the blocker clearly and ask for direction.

---

## Context Files (Read Order)

Every agent should read these files in this order before starting work:

1. `AGENTS.md` (this file) — Understand the team structure
2. `.agent/rules/01_project_identity.md` — Product context and tech stack
3. `.agent/rules/02_safety_boundaries.md` — Hard rules that cannot be violated
4. `.agent/rules/03_code_conventions.md` — How to write code in this project
5. Role-specific docs: `CLAUDE.md` or `Gemini.md` for agent routing details

---

## Roadmap (Current Milestones)

- **Milestone 1:** OpenAI `prompt_cache_key` injection + `/v1/messages/count_tokens` endpoint
- **Milestone 2:** Budget enforcement (max tokens, max dollars, max time per session)
- **Milestone 3:** Smart loop detection with tool-failure fingerprinting
- **Milestone 4:** Per-session cost tracking + dashboard enhancements
