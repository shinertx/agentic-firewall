# Marketing Protocol

## Product Registry

All venture studio products are registered in a central file:

```
vibebilling/agent-marketing/data/products.json
```

This is the **single source of truth** for what products the marketing engine promotes. Every marketing agent (Scout, Engager, Poster) reads from this file.

## When You Ship a Feature

After deploying a significant feature to any product:

1. Do NOT update the marketing engine code
2. The existing keywords and templates in `products.json` handle ongoing promotion
3. If the feature changes the product's value prop, update the `tagline` and `reply_template` in `products.json`

## Adding a New Product

To register a new product with the marketing engine:

1. Add one entry to `products.json` with: `id`, `name`, `tagline`, `url`, `keywords`, `subreddits`, `reply_style`, `reply_template`
2. The marketing swarm automatically picks it up on its next cycle (every 5 minutes)
3. No code changes needed

## Reply Styles

Each product has a `reply_style` that controls the tone of generated replies:

- `empathetic-technical` — for developer pain (loops, bugs, costs)
- `helpful-free-tool` — for free/open-source products  
- `technical-benchmark` — for performance-oriented products
- `business-focused` — for business/finance products
- `pain-aware` — for products that fix broken workflows
- `helpful-fellow-seller` — for marketplace/e-commerce products

## Safety

- Never hardcode product-specific keywords or templates in agent code
- All product-specific data lives in `products.json`
- The marketing engine is product-agnostic — it works for 1 product or 100
