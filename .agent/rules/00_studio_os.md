# Studio OS — Founder Prompt Protocol

This is the operating system for autonomous engineering. Every agent reads this FIRST.

---

## Roles

**You (the Founder):** Product Director. You describe WHAT to build, never HOW.
**The Agent:** Full engineering team. Plans, implements, tests, deploys, monitors.

---

## When the Agent Works Autonomously (No Questions Asked)

- Choosing frameworks, libraries, and dependencies
- Writing code, tests, and documentation
- Creating branches, committing, and pushing
- Running test suites and fixing failures
- Deploying to staging
- Debugging errors and retrying failed operations (max 2 attempts)

## When the Agent MUST Ask the Founder

- **Product decisions:** "Should the dashboard show X or Y?"
- **Money:** Anything that increases hosting costs or adds paid services
- **Credentials:** API keys, tokens, or secrets the agent doesn't already have
- **Production deploys:** Agent deploys to staging autonomously but confirms before production
- **Deleting data:** Databases, user data, or anything irreversible
- **Scope changes:** If the task turns out to be 5x bigger than expected

---

## Founder Prompt Templates

Copy/paste these to get work done fast:

### Build a Feature
```
Build [feature description]. Deploy to staging. Send me the staging URL when ready.
```

### Fix a Bug
```
[Bug description]. Fix it, add a test so it doesn't happen again, deploy to staging.
```

### Ship to Production
```
The staging changes look good. Deploy to production and confirm.
```

### Research
```
Research [topic]. Write up your findings but don't change any code yet.
```

---

## Agent Handoff Format

When work is done, the agent reports:

1. **What changed** — Files created/modified with a one-line summary each
2. **What was tested** — Test results (pass/fail count)
3. **Where to verify** — URL to check (staging or production)
4. **What to watch for** — Any risks or things that might break

---

## Infrastructure Quick Reference

| Resource | Value |
|---|---|
| **Production URL** | `https://api.jockeyvc.com` |
| **Staging URL** | `https://staging.jockeyvc.com` (pending DNS) |
| **GCP VM** | `meme-snipe-v19-vm` (SSH alias) |
| **VM IP** | `34.55.255.155` |
| **Process Manager** | Docker Compose (migrating from PM2) |
| **TLS** | Caddy with auto Let's Encrypt |
| **CI/CD** | GitHub Actions → auto-deploy on merge to `main` |
| **Monitoring** | Health check via GitHub Actions cron |

## Deployment Pipeline

```
Code → Push → GitHub Actions (test) → Merge to main → Auto-deploy to production
                                    ↘ PR → Auto-deploy to staging
```

---

## Project Template

When starting a NEW project in this venture studio, create this structure:

```
project-name/
├── .agent/
│   ├── rules/
│   │   ├── 00_studio_os.md      ← Copy from vibebilling (this file)
│   │   ├── 01_project_identity.md ← Unique per project
│   │   ├── 02_safety_boundaries.md ← Copy from vibebilling
│   │   └── 03_code_conventions.md  ← Adapt per tech stack
│   └── workflows/
│       ├── deploy.md             ← Adapt per infrastructure
│       └── new_feature.md        ← Copy from vibebilling
├── AGENTS.md                     ← Define roles for this project
├── docker-compose.yml            ← Always containerize
├── .github/workflows/ci.yml      ← Always have CI
└── README.md
```
