# JockeyVC Studio Handbook

The Complete Operating Manual for Autonomous Product Development.
Every agent reads this FIRST. This is your source of truth.

---

## Table of Contents

1. [Studio Identity](#1-studio-identity)
2. [Architecture](#2-architecture)
3. [Starting a New Product](#3-starting-a-new-product)
4. [Agent Roles & Routing](#4-agent-roles--routing)
5. [Infrastructure Quick Reference](#5-infrastructure-quick-reference)
6. [Deployment Pipeline](#6-deployment-pipeline)
7. [Marketing Engine](#7-marketing-engine)
8. [Memory & Context Management](#8-memory--context-management)
9. [Escalation Protocol (RALPH)](#9-escalation-protocol-ralph)
10. [Gate Validation](#10-gate-validation)
11. [Founder Prompt Templates](#11-founder-prompt-templates)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Studio Identity

**Who we are:** JockeyVC is a venture studio building AI infrastructure products. We ship MVPs fast, validate with real users, and kill what doesn't work.

**The Founder** (Benji) describes WHAT to build. Never HOW.

**The Agent** is the full engineering team. Plans, implements, tests, deploys, markets, monitors. The agent works autonomously and only comes back to the founder when blocked on a decision, credentials, or money.

**Philosophy:**
- Working code beats perfect code
- Ship to staging autonomously, confirm before production
- Automate what's repeated; never automate what's complex and rare
- If you're unsure, ask — don't assume and proceed
- Log everything that matters; log nothing that doesn't

---

## 2. Architecture

```
Founder (Benji)
     │
     ├── Antigravity Agent Manager
     │        │
     │   ┌────┼────────────┬──────────────┬──────────────┐
     │   │    │            │              │              │
     │   │ Product A    Product B     Product C     Marketing
     │   │  Agent        Agent         Agent         Agent
     │   │    │            │              │              │
     │   │    └── VM ──────┴──────────────┘              │
     │   │       (meme-snipe-v19-vm)                     │
     │   │       Caddy → PM2 → Services                 │
     │   │                                               │
     │   └── GitHub (shinertx org) ──────────────────────┘
     │
     └── Product Registry (products.json)
          └── Marketing Swarm reads this
```

**Each product = one Antigravity conversation = one autonomous agent.**

Agents share:
- **Studio OS rules** (`.agent/rules/00_studio_os.md`) — copied into every project
- **Infrastructure** — same VM, same Caddy, same GitHub org
- **Marketing engine** — central `products.json` drives all promotion
- **This handbook** — the single source of truth

---

## 3. Starting a New Product

When the founder gives you a new product idea, follow this sequence exactly. Do NOT ask questions unless you hit a blocker in the "Must Ask" list below.

### Phase 1: Scaffold (Autonomous — No Questions Asked)

```bash
# 1. Create project directory
mkdir -p ~/Documents/{product-slug}/src
mkdir -p ~/Documents/{product-slug}/.agent/rules
mkdir -p ~/Documents/{product-slug}/.agent/workflows
mkdir -p ~/Documents/{product-slug}/landing
mkdir -p ~/Documents/{product-slug}/.github/workflows

# 2. Copy Studio OS rules
cp ~/Documents/vibebilling/.agent/rules/00_studio_os.md ~/Documents/{product-slug}/.agent/rules/
cp ~/Documents/vibebilling/.agent/rules/02_safety_boundaries.md ~/Documents/{product-slug}/.agent/rules/
cp ~/Documents/vibebilling/.agent/rules/03_marketing.md ~/Documents/{product-slug}/.agent/rules/

# 3. Copy this handbook
cp ~/Documents/vibebilling/.agent/handbook.md ~/Documents/{product-slug}/.agent/

# 4. Initialize npm
cd ~/Documents/{product-slug}
npm init -y

# 5. Initialize git
git init
echo "node_modules/\n.env\n*.log\n.DS_Store\ndist/" > .gitignore
```

### Phase 2: Build Core (Autonomous)

1. Write `src/index.js` with the core product logic
2. Write a health check endpoint at `GET /health`
3. Write unit tests in `src/__tests__/`
4. Create a `Dockerfile` (multi-stage, Node 22 Alpine)
5. Create `.github/workflows/ci.yml` for GitHub Actions

### Phase 3: Landing Page (Autonomous)

Create `landing/index.html` with:
- Dark premium design (not generic — each product gets a unique color palette)
- Hero section with tagline and CTA
- "How it works" section with 3 steps
- Live demo or interactive preview if possible
- Email capture form
- SEO meta tags, Open Graph tags

### Phase 4: Distribution (Autonomous)

1. Create GitHub repo under `shinertx` org
2. Push code
3. Add DNS A record for the subdomain → `34.55.255.155`  
   - If Squarespace blocks you (it will), tell the founder to add it manually
4. Add Caddy reverse proxy entry on the VM
5. Deploy to VM with PM2
6. Register in `products.json` for marketing

### Phase 5: Verify (Autonomous)

1. `curl https://{subdomain}.jockeyvc.com/health` — must return 200
2. `curl https://{subdomain}.jockeyvc.com` — landing page loads
3. Run the test suite
4. Check PM2 status shows `online`

### What You Do Autonomously (No Questions)

- Choosing frameworks, libraries, dependencies
- Writing code, tests, docs
- Creating branches, committing, pushing
- Running tests and fixing failures
- Deploying to staging
- Creating landing pages
- Registering with the marketing engine
- Debugging errors (max 2 retries)

### What You MUST Ask the Founder

- **Product decisions:** "Should it do X or Y?"
- **Money:** Anything that increases hosting costs or adds paid services
- **Credentials:** API keys, tokens, or secrets you don't have
- **Production deploys:** Confirm before going live (staging is autonomous)
- **Deleting data:** Anything irreversible
- **Scope changes:** If the task is 5x bigger than estimated

---

## 4. Agent Roles & Routing

### The Founder (Router)
- Describes what to build
- Reviews staging deployments
- Makes product decisions
- Provides credentials when needed

### Product Agent (One Per Product)
Each product gets its own Antigravity conversation. The agent:
- Reads `.agent/handbook.md` and `.agent/rules/` on session start
- Owns one product end-to-end: code, tests, deploy, landing page
- Deploys via SSH to the shared VM
- Reports back only when done or blocked

### Marketing Agent
- Lives in the `vibebilling/agent-marketing/` directory
- Runs the swarm: Scout → Engager → Poster
- Reads `products.json` to know what to promote
- Product agents register new products by adding to `products.json`

### How to Start a Product Agent Conversation

Paste this as your first message in a new Antigravity conversation:

```
Your workspace is ~/Documents/{product-slug}.
Read .agent/handbook.md and .agent/rules/ first — they contain everything 
you need to work autonomously.

This product is: {one-line description}.

Build the MVP following the handbook's "Starting a New Product" sequence. 
Deploy to {subdomain}.jockeyvc.com. Come back to me only when:
1. Everything is deployed and verified, OR
2. You need a decision, credentials, or money.
```

That's it. The agent handles everything else.

---

## 5. Infrastructure Quick Reference

| Resource | Value |
|---|---|
| **VM** | `meme-snipe-v19-vm` (SSH alias) |
| **VM IP** | `34.55.255.155` |
| **DNS** | Squarespace Domains → jockeyvc.com |
| **Reverse Proxy** | Caddy with auto Let's Encrypt |
| **Process Manager** | PM2 |
| **CI/CD** | GitHub Actions |
| **GitHub Org** | `shinertx` |
| **Domain** | `jockeyvc.com` |

### Current Subdomains

| Subdomain | Product | Port |
|---|---|---|
| `api.jockeyvc.com` | Agentic Firewall (proxy) | 4000 |
| `ai.jockeyvc.com` | Agentic Firewall (dashboard) | 4001 |
| `staging.jockeyvc.com` | Staging environment | 4005 |
| `shredder.jockeyvc.com` | Context Shredder | 4010 |
| `cfo.jockeyvc.com` | Agentic CFO | 4020 |
| `resolve.jockeyvc.com` | Resolution Arbitrator | 4030 |

### Port Allocation

New products get the next available port in the 4000 range:
- `40XX` where XX increments by 10

### Adding a New Subdomain

1. Ask the founder to add an A record in Squarespace (can't be automated — bot protection)
2. Add to Caddy on the VM:
```bash
ssh meme-snipe-v19-vm "sudo tee -a /etc/caddy/Caddyfile << 'EOF'

{subdomain}.jockeyvc.com {
  reverse_proxy localhost:{port}
}
EOF
sudo systemctl reload caddy"
```

---

## 6. Deployment Pipeline

### First Deploy (New Product)

```bash
# On VM
ssh meme-snipe-v19-vm
cd /home/benjijmac
git clone https://github.com/shinertx/{repo}.git
cd {repo}
npm install
PORT={port} pm2 start src/index.js --name {product-name}
pm2 save
```

### Subsequent Deploys

```bash
ssh meme-snipe-v19-vm "cd /home/benjijmac/{repo} && git pull && npm install && pm2 restart {product-name}"
```

### CI/CD (GitHub Actions)

Every project should have `.github/workflows/ci.yml`:
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm test
```

---

## 7. Marketing Engine

### How It Works

```
products.json (central registry)
     ↓
Scout → scans 15+ subreddits for pain-keyword matches
     ↓
Engager → generates product-specific replies using the right tone
     ↓
Poster → auto-posts to Reddit via PRAW
```

### Registering a New Product

Add one entry to `~/Documents/vibebilling/agent-marketing/data/products.json`:

```json
{
  "id": "your-product-slug",
  "name": "Product Name",
  "tagline": "One-line value proposition.",
  "url": "https://subdomain.jockeyvc.com",
  "keywords": ["pain keyword 1", "pain keyword 2"],
  "subreddits": ["RelevantSub1", "RelevantSub2"],
  "reply_style": "empathetic-technical",
  "reply_template": "I built {name} to solve this — {tagline} Try it: {url}"
}
```

**Reply styles available:** `empathetic-technical`, `helpful-free-tool`, `technical-benchmark`, `business-focused`, `pain-aware`, `helpful-fellow-seller`

The marketing swarm picks up new products automatically on its next 5-minute cycle. No code changes needed.

---

## 8. Memory & Context Management

### Project Context

Every product maintains a `CONTEXT.md` in its root:

```markdown
# {Product Name} — Context

## What This Is
{one-paragraph description}

## Current State
Phase: {scaffolding | building | testing | deployed | live}
Last updated: {date}

## Key Decisions
- {date}: {decision and why}

## Known Issues
- {issue description}

## Open Questions
- {question — escalated to founder?}
```

### When Context Runs Out

If a conversation gets too long:
1. Write current state to `CONTEXT.md`
2. Start a fresh conversation
3. First message: "Read `.agent/handbook.md` and `CONTEXT.md` for background. Continue from where the last agent left off."

### Cross-Product Memory

The shared VM has a studio-level log:
```
/home/benjijmac/studio-log.md
```
Product agents append significant events here so other agents can see what's happening across the studio.

---

## 9. Escalation Protocol (RALPH)

**R**etry **A**nd **L**earn **P**rotocol — **H**alt when stuck.

### Rules

1. Any failure → retry once with a different approach
2. Same failure twice → escalate to founder (don't waste a 3rd attempt)
3. Three failures on any task → mandatory escalation
4. Unrecoverable blocks (missing credentials, permissions) → immediate escalation

### Escalation Format

When you must ask the founder:

```
🚨 BLOCKED: {product name}

What failed: {1-line description}
Error: {actual error message}
Attempts: {N}

Options:
1. {option 1}
2. {option 2}

Awaiting your decision.
```

### What To Do While Waiting

- Don't stop all work
- Continue on unrelated tasks
- Document what you learned from the failure

---

## 10. Gate Validation

Before marking any phase complete, verify:

### Build Gate
- [ ] `npm test` passes
- [ ] Health endpoint returns 200
- [ ] No hardcoded secrets in code

### Deploy Gate
- [ ] Service running on VM (`pm2 list` shows online)
- [ ] Public URL responds (`curl https://{subdomain}.jockeyvc.com/health`)
- [ ] Landing page loads
- [ ] SSL certificate active (no browser warnings)

### Marketing Gate
- [ ] Product registered in `products.json`
- [ ] Keywords are pain-focused (not generic)
- [ ] Reply template reads like a human, not a bot

---

## 11. Founder Prompt Templates

The founder can use these to get work done fast:

### New Product
```
Build {product description}. Follow the handbook. Deploy to {subdomain}.jockeyvc.com. 
Come back when it's live or you're blocked.
```

### New Feature
```
Add {feature} to {product}. Deploy to staging. Send me the URL when ready.
```

### Fix a Bug
```
{Bug description}. Fix it, add a test, deploy to staging.
```

### Ship to Production
```
Staging looks good. Deploy to production and confirm.
```

### Research
```
Research {topic}. Write findings but don't change code yet.
```

---

## 12. Troubleshooting

### PM2 Service Won't Start
```bash
pm2 logs {name} --lines 20 --nostream
# Common: Express v5 wildcard routes — use ':path' not '*'
# Common: Port already in use — check with `lsof -i :{port}`
```

### SSH Hangs
The VM sometimes drops SSH. Just retry:
```bash
ssh meme-snipe-v19-vm "echo ok"
```

### DNS Not Resolving
```bash
dig +short {subdomain}.jockeyvc.com
# Should return 34.55.255.155
# If empty, the Squarespace record hasn't propagated (or wasn't added)
```

### Caddy Returns 502
Service isn't running on the expected port:
```bash
ssh meme-snipe-v19-vm "pm2 list"
# Check the service is online and on the right port
```

### Git Push Rejected
Another agent pushed to the same repo:
```bash
git fetch origin && git rebase origin/main && git push
```

### Squarespace DNS Blocks Automation
This is a known issue. Squarespace requires email verification for every DNS change. The agent cannot automate this. **Tell the founder to add the record manually.**

---

## Appendix: Current Product Portfolio

| Product | Repo | Subdomain | Port | Status |
|---|---|---|---|---|
| Agentic Firewall | `agentic-firewall` | api.jockeyvc.com | 4000 | ✅ Live |
| Waste Scanner | `waste-scanner` | — (CLI only) | — | ✅ Built |
| Context Shredder | `context-shredder` | shredder.jockeyvc.com | 4010 | ✅ Deployed |
| Agentic CFO | `agentic-cfo` | cfo.jockeyvc.com | 4020 | ✅ Deployed |
| Resolution Arbitrator | `resolution-arbitrator` | resolve.jockeyvc.com | 4030 | ✅ Deployed |
| JENNi | — | jenni.jockeyvc.com | — | Running |
