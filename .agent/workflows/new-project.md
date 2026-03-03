---
description: Scaffold, build, and deploy a new venture studio product end-to-end
---

# New Project Workflow

// turbo-all

## Steps

1. Create the project directory structure:
```bash
PROJECT_SLUG="REPLACE_WITH_SLUG"
mkdir -p ~/Documents/$PROJECT_SLUG/{src,landing,.agent/rules,.agent/workflows,.github/workflows}
```

2. Copy all Studio OS rules into the new project:
```bash
cp ~/Documents/vibebilling/.agent/rules/*.md ~/Documents/$PROJECT_SLUG/.agent/rules/
```

3. Initialize npm:
```bash
cd ~/Documents/$PROJECT_SLUG && npm init -y
```

4. Create .gitignore:
```bash
cat > ~/Documents/$PROJECT_SLUG/.gitignore << 'EOF'
node_modules/
.env
*.log
.DS_Store
dist/
EOF
```

5. Initialize git:
```bash
cd ~/Documents/$PROJECT_SLUG && git init && git add -A && git commit -m "feat: initial scaffold"
```

6. Now build the core product logic in `src/index.js` based on the founder's description. Include a health endpoint at `GET /health`.

7. Create a landing page at `landing/index.html` with dark premium design.

8. Create the GitHub repo (use the browser tool to go to https://github.com/new).

9. Push to GitHub:
```bash
cd ~/Documents/$PROJECT_SLUG && git remote add origin "https://github.com/shinertx/$PROJECT_SLUG.git" && git push -u origin main
```

10. Deploy to VM:
```bash
ssh meme-snipe-v19-vm "cd /home/benjijmac && git clone https://github.com/shinertx/$PROJECT_SLUG.git && cd $PROJECT_SLUG && npm install && PORT=REPLACE_WITH_PORT pm2 start src/index.js --name $PROJECT_SLUG && pm2 save"
```

11. Add Caddy entry:
```bash
ssh meme-snipe-v19-vm "sudo tee -a /etc/caddy/Caddyfile << 'EOF'

REPLACE_WITH_SUBDOMAIN.jockeyvc.com {
  reverse_proxy localhost:REPLACE_WITH_PORT
}
EOF
sudo systemctl reload caddy"
```

12. Register with the marketing engine by adding an entry to `~/Documents/vibebilling/agent-marketing/data/products.json`.

13. Tell the founder to add the DNS A record in Squarespace (the agent cannot do this).

14. Verify deployment:
```bash
curl -s https://REPLACE_WITH_SUBDOMAIN.jockeyvc.com/health
```
