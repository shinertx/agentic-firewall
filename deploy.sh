#!/bin/bash
set -euo pipefail

# Configuration
SERVER="meme-snipe-v19-vm"
DEST_DIR="~/agentic-firewall"
PROFILE="${1:-}" # Pass "staging" to deploy staging too

echo "🚀 Deploying Agentic Firewall to $SERVER..."

# Step 1: Sync the codebase
echo "📦 Syncing files..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude '.env.staging' \
  --exclude 'agent-proxy/stats.json' \
  --exclude 'agent-proxy/users.json' \
  --exclude 'agent-proxy/installs.json' \
  ./ "$SERVER:$DEST_DIR"

# Step 2: Build and restart containers
echo "🐳 Building and starting Docker containers..."
if [ "$PROFILE" = "staging" ]; then
  ssh "$SERVER" "cd $DEST_DIR && docker compose --profile staging up -d --build"
else
  ssh "$SERVER" "cd $DEST_DIR && docker compose up -d --build"
fi

# Step 3: Wait for health checks
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
  STAGING_STATS=$(curl -sf https://staging.jockeyvc.com/api/stats 2>/dev/null) || {
    echo "⚠️  Staging health check failed (DNS might not be configured yet)"
  }
  [ -n "${STAGING_STATS:-}" ] && echo "Staging stats: $STAGING_STATS"
fi

echo ""
echo "🎉 Deployment complete!"
