# AGENTS.md — VibeBilling Multi-Agent Coordination

This file is the **master org chart** for all AI agents working on this project. Every agent must read this file before doing any work.

---

## Project Identity

**Product:** Agentic Firewall — a reverse-proxy that prevents "Vibe Billing" by inserting prompt caching, loop detection, and failover between AI agents and LLM providers.

**Production URL:** `https://api.jockeyvc.com`
**Staging URL:** `https://staging.jockeyvc.com` (pending DNS)
**Infrastructure:** GCP VM (`meme-snipe-v19-vm`), Docker Compose, Caddy (TLS)
**CI/CD:** GitHub Actions → auto-deploy on merge to `main`
**Repo:** Monorepo at `/Users/benjijmac/Documents/vibebilling`

---

## Agent Roles & Directory Ownership

| Role | Directories Owned | Responsibility |
|---|---|---|
| **Proxy Engineer** | `agent-proxy/` | Core firewall features, new LLM providers, Context CDN, Circuit Breaker, Shadow Router |
| **Dashboard Engineer** | `agent-dashboard/` | React monitoring UI, live traffic feed, stats cards, charts |
| **QA & Testing** | `stress_tests/`, `test-agent/`, `agent-proxy/tests/` | Unit tests, integration tests, stress tests, pre-deploy validation |
| **DevOps** | `deploy.sh`, PM2/Caddy config | Deployment, server management, uptime monitoring, CI/CD |
| **Marketing** | `agent-marketing/` | Deployment mirror for the studio marketing engine. Canonical marketing engine repo lives at `~/Documents/jockeyvc-marketing-engine`. Public landing pages may live in product repos and require handoff when implemented outside `agent-marketing/`. |
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
