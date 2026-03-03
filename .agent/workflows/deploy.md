---
description: How to deploy the Agentic Firewall proxy to production
---

# Deployment Workflow

Follow these steps exactly to deploy changes to production.

## Prerequisites
- SSH access to `meme-snipe-v19-vm`
- All tests passing locally

## Steps

### 1. Run the test suite locally
```bash
cd /Users/benjijmac/Documents/vibebilling/agent-proxy && npm test
```
**STOP if any tests fail.** Fix them before proceeding.

### 2. Commit your changes
```bash
git add -A
git commit -m "feat: <description of change>"
git push origin feature/<branch-name>
```

### 3. Create a Pull Request on GitHub
Open a PR from `feature/<branch-name>` → `main`. Wait for CI to pass.

### 4. Merge the PR
Once CI passes and the PR is approved, merge to `main`.

### 5. Deploy to the server
```bash
cd /Users/benjijmac/Documents/vibebilling
./deploy.sh
```
This runs `rsync` to copy files to the GCP VM (excludes `node_modules`, `.git`, `.env`).

### 6. Restart the proxy on the server
```bash
ssh meme-snipe-v19-vm "cd ~/agentic-firewall/agent-proxy && npm install --production && pm2 restart agentic-firewall-proxy"
```

### 7. Verify the deployment
```bash
curl -s https://api.jockeyvc.com/api/stats | python3 -m json.tool
```
Confirm the response shows valid stats. Check that `totalRequests` is incrementing if agents are running.

### 8. Check PM2 logs for errors
```bash
ssh meme-snipe-v19-vm "pm2 logs agentic-firewall-proxy --lines 20"
```
Look for any `[ERROR]` entries. If clean, deployment is complete.
