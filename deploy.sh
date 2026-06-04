#!/bin/bash
set -euo pipefail

# Configuration
SERVER="meme-snipe-v19-vm"
DEST_DIR="/home/benjijmac/agentic-firewall"
PROFILE="${1:-}" # Pass "staging" to deploy staging too

echo "🚀 Deploying origin/main on $SERVER..."

ssh "$SERVER" "PROFILE='$PROFILE' DEST_DIR='$DEST_DIR' bash -s" <<'DEPLOY'
set -euo pipefail

cd "$DEST_DIR"

echo "📦 Syncing VM checkout to origin/main..."
git fetch origin main
git reset --hard origin/main
echo "Deploying commit $(git rev-parse --short HEAD)"

REMAINING_DRIFT="$(git status --short)"
if [ -n "$REMAINING_DRIFT" ]; then
  echo "⚠️  Repo still has local drift after reset:"
  echo "$REMAINING_DRIFT"
fi

echo "🐳 Building and starting Docker containers..."
if [ "$PROFILE" = "staging" ]; then
  docker compose --profile staging up -d --build
else
  docker compose up -d --build
fi
DEPLOY

echo "⏳ Waiting for health checks..."
sleep 10

# Step 4: Verify deployment
echo "✅ Verifying deployment..."
STATS=$(curl -sf https://api.jockeyvc.com/api/stats 2>/dev/null) || {
  echo "❌ Production health check failed!"
  ssh "$SERVER" "cd $DEST_DIR && docker compose logs --tail=20 proxy"
  exit 1
}
echo "Production stats: $STATS"

if [ "$PROFILE" = "staging" ]; then
  STAGING_BODY="$(mktemp)"
  STAGING_STATUS=$(curl -sS -o "$STAGING_BODY" -w "%{http_code}" https://staging.jockeyvc.com/api/stats 2>/dev/null || true)
  if [ "$STAGING_STATUS" != "200" ]; then
    echo "❌ Staging health check failed with HTTP $STAGING_STATUS!"
    ssh "$SERVER" "cd $DEST_DIR && docker compose --profile staging logs --tail=20 proxy-staging"
    rm -f "$STAGING_BODY"
    exit 1
  fi
  STAGING_STATS="$(cat "$STAGING_BODY")"
  rm -f "$STAGING_BODY"
  [ -n "${STAGING_STATS:-}" ] && echo "Staging stats: $STAGING_STATS"
fi

echo ""
echo "🎉 Deployment complete!"
