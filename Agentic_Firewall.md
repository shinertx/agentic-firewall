# Agentic Firewall: Vibe Billing Engine

The **Agentic Firewall** is the proxy engine behind **Vibe Billing**. It sits between autonomous AI agents (OpenClaw, Claude Code, AutoGPT) and LLM providers (Anthropic, OpenAI, Google Gemini, NVIDIA NIM) to intercept, analyze, and optimize outbound agent traffic.

**Production URL:** `https://api.jockeyvc.com`

---

## Core Features

### 1. Context CDN (Cost Optimization)
Modern agents repeatedly send the entire contents of a multi-million token codebase to the LLM on every single step of a reasoning process. The Firewall's **Context CDN** automatically intercepts these massive JSON payloads and injects `cache_control: { type: 'ephemeral' }` metadata into Anthropic requests. This triggers server-side prompt caching, resulting in up to **90% input cost reduction** on subsequent agent reasoning steps.

> **Note:** Context CDN currently provides real server-side caching for Anthropic only. OpenAI and Gemini support is placeholder — their providers do not yet offer block-level server-side caching via request headers.

### 2. Multi-Provider Universal Routing
The proxy functions as a drop-in universal backend. It auto-detects the target provider by inspecting request structure and routes accordingly:

| Provider | Upstream URL | Detection |
|---|---|---|
| **Anthropic** | `https://api.anthropic.com` | Default (no other markers) |
| **OpenAI** | `https://api.openai.com` | URL contains `/v1/chat/completions` or `/v1/models` |
| **Google Gemini** | `https://generativelanguage.googleapis.com` | URL contains `/v1beta/models` or `x-goog-api-key` header |
| **NVIDIA NIM** | `https://integrate.api.nvidia.com` | Model starts with `meta/` or `nvidia/` |

### 3. Circuit Breaker (Safety & Governance)
Autonomous agents frequently get stuck in infinite loops — attempting to rewrite a read-only file hundreds of times, costing dollars per second. The Firewall maintains an in-memory SHA-256 hash map of recent request signatures per IP. If 3 consecutive identical payloads are detected, it returns `400 Bad Request` with type `agentic_firewall_blocked`, physically forcing the agent to stop.

### 4. Shadow Router (Automatic Failover)
When Anthropic returns a `429` rate-limit response on a Sonnet model request, the proxy automatically retries the request with Haiku, preventing agent stalls during high-traffic periods.

### 5. Edge Case Hardening (Production Resilience)
- **ZSTD Decompression:** Natively decompresses `zstd`-encoded payloads from the Python Anthropic SDK
- **30-Minute Timeouts:** Bypasses Node.js's default 120-second timeout to support long reasoning chains
- **SSE Stream Flushing:** Enforces `Cache-Control: no-cache` with `flushHeaders()` for real-time token streaming
- **50MB Body Limit:** Accommodates massive agent context payloads

### 6. Management Dashboard
A React/Vite web application that displays live intercepted traffic, model utilization, blocked loops, and calculates the exact dollar amount saved by the Context CDN in real-time.

---

## Deployment

- **Infrastructure:** GCP VM (`meme-snipe-v19-vm`)
- **Process Manager:** PM2
- **TLS:** Caddy with automated Let's Encrypt certificates
- **Proxy Port:** 4000 (behind Caddy on 443)

### Connecting Your Agents

Agents must be configured to route through `https://api.jockeyvc.com` instead of directly to LLM providers. See **[Gemini.md](./Gemini.md)** for the complete routing guide covering:
- Persistent environment variables (Claude Code, OpenClaw)
- Custom/Local model endpoints (Kimmy, Continue.dev, Cursor)
- Direct SDK configuration (Node.js, Python)
- OS-level proxy override (closed-source agents)
