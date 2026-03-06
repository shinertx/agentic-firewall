#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIRROR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CANONICAL_DIR="${STUDIO_MARKETING_REPO_DIR:-$HOME/Documents/jockeyvc-marketing-engine}"

echo "Validating canonical registry..."
python3 "$CANONICAL_DIR/scripts/validate_registry.py"

echo "Syncing canonical repo into vibebilling mirror..."
rsync -a --delete \
  --exclude '.git/' \
  --exclude 'AGENTS.md' \
  --exclude 'README.md' \
  --exclude 'node_modules/' \
  --exclude 'logs/' \
  --exclude '__pycache__/' \
  --exclude '.env' \
  --exclude 'data/leads.json' \
  --exclude 'data/leads_youtube.json' \
  --exclude 'data/draft_replies.json' \
  "$CANONICAL_DIR"/ "$MIRROR_DIR"/

echo "Mirror updated:"
echo "  canonical: $CANONICAL_DIR"
echo "  mirror:    $MIRROR_DIR"
