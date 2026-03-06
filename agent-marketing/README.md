# JockeyVC Studio Marketing Engine

This folder is the runtime execution layer for studio marketing.

## Model

- A `product` is the actual business or product line.
- A `surface` is a specific acquisition or conversion surface for that product.
- Example: `Vibe Billing` is the product; `Agentic Firewall`, `Waste Scanner`, and the `OpenClaw Scanner` are surfaces under it.
- Example: `JENNi` is the product; the Chrome extension, `jennipro.com`, and Shopify out-of-stock recovery are separate surfaces under it.

## Source Of Truth

- Founder-facing planning/docs: `/Users/benjijmac/Google Drive/My Drive/JockeyVC Studio/Marketing OS`
- Machine/runtime source: `/Users/benjijmac/Documents/vibebilling/agent-marketing/data/products.json`
- VM runtime copy: `/home/benjijmac/agentic-firewall/agent-marketing/data/products.json`

## Operating Rule

If the engine should actually use a registry change, it must exist in the repo runtime source and be committed.
Drive is where briefs and planning live.

## Operating Principles

- Product != surface. Do not flatten one product into one message if it has multiple entry points.
- One surface = one audience, one pain trigger, one CTA.
- Git is runtime truth. Drive is planning truth.
- Validate the registry before expecting unattended runs to use it.
- Prefer narrow pain keywords over broad brand terms, or the engine will generate irrelevant leads.

## Commands

Sync the Drive registry:

```bash
cd /Users/benjijmac/Documents/vibebilling
python3 agent-marketing/scripts/sync_drive_registry.py
```

Validate the runtime registry:

```bash
cd /Users/benjijmac/Documents/vibebilling
python3 agent-marketing/scripts/validate_registry.py
```

Then review, commit, and push the repo change before expecting unattended jobs or the VM to use it.

Run the studio marketing orchestrator once:

```bash
cd /Users/benjijmac/Documents/vibebilling/agent-marketing
python3 agents/orchestrator.py --single-cycle
```

Run the dashboard server locally:

```bash
cd /Users/benjijmac/Documents/vibebilling/agent-marketing
npm install
node dashboard-server.js
```

## Active Entry Points

- active orchestrator: `agent-marketing/agents/orchestrator.py`
- legacy wrapper: `agent-marketing/orchestrator.py`
- dashboard API/UI: `agent-marketing/dashboard-server.js` and `agent-marketing/dashboard.html`

## Why This Exists

The studio OS lives in `jockeyvc-studio`.
This folder exists so the repo and VM have one deterministic runtime artifact while founder-facing planning stays in Google Drive.
