# Infrastructure Reference

This is auto-loaded context. Every agent in the venture studio needs this.

## VM Access

- **SSH alias:** `meme-snipe-v19-vm`
- **VM IP:** `34.55.255.155`
- **OS:** Debian/Ubuntu
- **Process Manager:** PM2
- **Reverse Proxy:** Caddy (auto Let's Encrypt)
- **Projects live at:** `/home/benjijmac/` on the VM

## GitHub

- **Org:** `shinertx`
- **Auth:** Pre-configured via credential helper
- **CI:** GitHub Actions on every push

## Domain & DNS

- **Domain:** `jockeyvc.com`
- **DNS Provider:** Squarespace Domains (NO API — DNS changes require the founder to do manually)
- **All subdomains point to:** `34.55.255.155`

## Port Allocation

| Port | Product |
|---|---|
| 4000 | Agentic Firewall (proxy) |
| 4001 | Agentic Firewall (dashboard) |
| 4005 | Staging |
| 4010 | Context Shredder |
| 4020 | Agentic CFO |
| 4030 | Resolution Arbitrator |
| 4040+ | Next available (increment by 10) |

## Active Subdomains

| Subdomain | Port |
|---|---|
| `api.jockeyvc.com` | 4000 |
| `ai.jockeyvc.com` | 4001 |
| `staging.jockeyvc.com` | 4005 |
| `shredder.jockeyvc.com` | 4010 |
| `cfo.jockeyvc.com` | 4020 |
| `resolve.jockeyvc.com` | 4030 |

## Adding a Subdomain to Caddy

```bash
ssh meme-snipe-v19-vm "sudo tee -a /etc/caddy/Caddyfile << 'EOF'

{subdomain}.jockeyvc.com {
  reverse_proxy localhost:{port}
}
EOF
sudo systemctl reload caddy"
```

> DNS A record must be added by the founder in Squarespace. Tell them: Host = `{subdomain}`, Type = `A`, Data = `34.55.255.155`
