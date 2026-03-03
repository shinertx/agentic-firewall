# Deployment Protocol

## First Deploy (New Product)

```bash
ssh meme-snipe-v19-vm "cd /home/benjijmac && git clone https://github.com/shinertx/{repo}.git && cd {repo} && npm install && PORT={port} pm2 start src/index.js --name {name} && pm2 save"
```

## Update Deploy (Existing Product)

```bash
ssh meme-snipe-v19-vm "cd /home/benjijmac/{repo} && git pull origin main && npm install && pm2 restart {name}"
```

## Verify After Deploy

```bash
# Check PM2 status
ssh meme-snipe-v19-vm "pm2 list"

# Check health endpoint
curl -s https://{subdomain}.jockeyvc.com/health

# Check logs for errors
ssh meme-snipe-v19-vm "pm2 logs {name} --lines 10 --nostream"
```

## Express v5 Gotcha

Express v5 does NOT support `app.all('/v1/*')` wildcard syntax. Use `app.all('/v1/:path')` instead. This is the #1 cause of PM2 services erroring on startup.

## Port Already In Use

```bash
ssh meme-snipe-v19-vm "lsof -i :{port}"
```
Kill the conflicting process or pick the next available port.

## Caddy Returns 502

Service isn't running on the expected port. Check `pm2 list` and verify the service is online.
