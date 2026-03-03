---
description: How to register a new product with the studio marketing engine
---

# Add Product to Marketing Engine

// turbo-all

## Steps

1. Open the product registry:
```bash
cat ~/Documents/vibebilling/agent-marketing/data/products.json
```

2. Add a new entry to the `products` array with this structure:
```json
{
  "id": "your-product-slug",
  "name": "Your Product Name",
  "tagline": "One-line value proposition.",
  "url": "https://subdomain.jockeyvc.com",
  "keywords": ["pain keyword 1", "pain keyword 2", "..."],
  "subreddits": ["RelevantSub1", "RelevantSub2"],
  "reply_style": "empathetic-technical",
  "reply_template": "I built {name} to solve exactly this — {tagline} Check it out: {url}"
}
```

3. Validate the JSON is valid:
```bash
python3 -c "import json; json.load(open(os.path.expanduser('~/Documents/vibebilling/agent-marketing/data/products.json')))" && echo "✅ Valid JSON"
```

4. Copy the marketing rule into the new project:
```bash
cp ~/Documents/vibebilling/.agent/rules/03_marketing.md ~/Documents/YOUR_PROJECT/.agent/rules/03_marketing.md
```

5. The marketing swarm will automatically pick up the new product on its next 5-minute cycle. No restart needed.

## Notes

- Available `reply_style` values: `empathetic-technical`, `helpful-free-tool`, `technical-benchmark`, `business-focused`, `pain-aware`, `helpful-fellow-seller`
- The `{name}`, `{tagline}`, `{url}`, `{landing}`, `{npm}` placeholders are auto-filled from the product entry
- Keywords should be lowercase phrases that appear in Reddit posts from people with the pain your product solves
