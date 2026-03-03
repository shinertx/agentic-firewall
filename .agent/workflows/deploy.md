---
description: Deploy changes to the production VM
---

# Deploy Workflow

// turbo-all

## Steps

1. Run tests locally:
```bash
npm test
```
**STOP if any tests fail.**

2. Commit and push:
```bash
git add -A && git commit -m "feat: update" && git push origin main
```

3. Deploy to VM:
```bash
REPO_NAME=$(basename $(git rev-parse --show-toplevel))
ssh meme-snipe-v19-vm "cd /home/benjijmac/$REPO_NAME && git pull origin main && npm install && pm2 restart $REPO_NAME"
```

4. Verify deployment:
```bash
ssh meme-snipe-v19-vm "pm2 list"
```

5. Check logs for errors:
```bash
REPO_NAME=$(basename $(git rev-parse --show-toplevel))
ssh meme-snipe-v19-vm "pm2 logs $REPO_NAME --lines 10 --nostream"
```
