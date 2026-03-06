#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIRROR_DIR="${VIBEBILLING_MIRROR_DIR:-$HOME/Documents/vibebilling/agent-marketing}"

echo "Validating canonical registry..."
python3 "$SOURCE_DIR/scripts/validate_registry.py"

echo "Syncing canonical repo into vibebilling mirror..."
mkdir -p "$MIRROR_DIR"
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
  "$SOURCE_DIR"/ "$MIRROR_DIR"/

echo "Mirror updated:"
echo "  source: $SOURCE_DIR"
echo "  mirror: $MIRROR_DIR"
