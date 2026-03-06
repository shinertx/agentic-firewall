# JockeyVC Studio Marketing Engine Mirror

This folder is the deployment mirror of the canonical studio marketing repo.

## Canonical Home

- Canonical repo: `/Users/benjijmac/Documents/jockeyvc-marketing-engine`
- Founder planning/docs: `/Users/benjijmac/Google Drive/My Drive/JockeyVC Studio/Marketing OS`
- VM runtime copy: `/home/benjijmac/agentic-firewall/agent-marketing`

## Why This Mirror Exists

The current GitHub Actions deploy and the VM cron still run from the `vibebilling` repo.
That means this folder must remain in place until infrastructure is migrated.

## Safe Rule

Do not treat this folder as the long-term source of truth.
Edit the canonical repo first, then sync this mirror before deploy.

## Sync From Canonical Repo

```bash
cd /Users/benjijmac/Documents/vibebilling/agent-marketing
bash scripts/pull_from_canonical_repo.sh
```

## Validate The Mirror

```bash
cd /Users/benjijmac/Documents/vibebilling/agent-marketing
python3 scripts/validate_registry.py
```

## Current Runtime Path

- GitHub Actions cron: `.github/workflows/marketing-cron.yml`
- VM execution directory: `/home/benjijmac/agentic-firewall/agent-marketing`

## Model

- A `product` is the actual business or product line.
- A `surface` is a specific acquisition or conversion surface for that product.
- `Vibe Billing` is one product, not the umbrella for all studio marketing.
- `JENNi` is a separate product with multiple surfaces under one product record.
