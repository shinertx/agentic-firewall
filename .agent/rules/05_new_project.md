# New Product Scaffold Protocol

When the founder says to build a new product, follow this sequence. Do NOT ask questions unless you hit a "Must Ask" situation.

## Phase 1: Scaffold (Autonomous)

1. Create project directory at `~/Documents/{product-slug}/`
2. Create subdirectories: `src/`, `landing/`, `.agent/rules/`, `.agent/workflows/`, `.github/workflows/`
3. Copy ALL rule files from `~/Documents/vibebilling/.agent/rules/` into the new project's `.agent/rules/`
4. Run `npm init -y` in the project root
5. Create `.gitignore` with: `node_modules/`, `.env`, `*.log`, `.DS_Store`, `dist/`
6. Create a `01_project_identity.md` in `.agent/rules/` specific to this product

## Phase 2: Build Core (Autonomous)

1. Write `src/index.js` with the core product logic
2. Add Express server with `GET /health` endpoint returning `{"status":"ok"}`
3. Use `process.env.PORT || {next-available-port}` for the port
4. Write basic unit tests
5. Create a `Dockerfile` — multi-stage, Node 22 Alpine, expose the port

## Phase 3: Landing Page (Autonomous)

Create `landing/index.html`:
- Dark premium design with a unique color palette (not the same as other products)
- Hero section with tagline and email capture CTA
- "How it works" — 3 steps
- SEO meta tags and Open Graph tags
- Mobile responsive

## Phase 4: GitHub & Deploy (Autonomous)

1. `git init && git add -A && git commit -m "feat: initial MVP"`
2. Create repo on GitHub under `shinertx` org (use the browser)
3. `git remote add origin https://github.com/shinertx/{slug}.git && git push -u origin main`
4. SSH to VM: `git clone`, `npm install`, `PORT={port} pm2 start src/index.js --name {slug}`, `pm2 save`
5. Add Caddy entry on VM for the subdomain
6. Tell the founder to add the DNS A record in Squarespace (agent CANNOT do this)

## Phase 5: Marketing Registration (Autonomous)

Add the product to `~/Documents/vibebilling/agent-marketing/data/products.json`:
```json
{
  "id": "{slug}",
  "name": "{Product Name}",
  "tagline": "{one-line value prop}",
  "url": "https://{subdomain}.jockeyvc.com",
  "keywords": ["{pain-keyword-1}", "{pain-keyword-2}"],
  "subreddits": ["{relevant-sub-1}", "{relevant-sub-2}"],
  "reply_style": "{style}",
  "reply_template": "I built {name} to solve this — {tagline} Check it out: {url}"
}
```

## Phase 6: Verify (Autonomous)

1. `curl https://{subdomain}.jockeyvc.com/health` — must return 200
2. `curl https://{subdomain}.jockeyvc.com` — landing page loads
3. `ssh meme-snipe-v19-vm "pm2 list"` — shows service online
4. Validate `products.json` is valid JSON

## When Done

Report to the founder:
1. What was built (files created/modified)
2. Where to verify (URL)
3. What the founder needs to do (DNS record)
4. What to watch for (risks)
