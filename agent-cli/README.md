# agent-firewall

**Agent Runtime Control** — Keep autonomous AI agents under control.

Loop detection, prompt caching, budget enforcement, and waste scanning for AI agents.

## Quick Start

```bash
npx agent-firewall setup
```

This will:
1. Detect your installed agents (OpenClaw, Claude Code, etc.)
2. Patch their configs to route through the governance proxy
3. Set up environment variables for any OpenAI/Anthropic SDK
4. Verify the connection is working

## Commands

```bash
npx agent-firewall setup    # Auto-configure everything
npx agent-firewall scan     # Scan agent logs for waste patterns
npx agent-firewall status   # Check live savings and blocked loops
npx agent-firewall verify   # Test that routing is working
```

## What It Solves

Autonomous agents fail **behaviorally** — they get stuck in loops, retry the same broken tool call, and re-send massive contexts. This costs real money and wastes time.

| Problem | Solution |
|---|---|
| **Agent stuck in loops** | Circuit breaker kills after repeated identical requests |
| **No-progress detection** | Tool-failure fingerprinting catches stuck retry cycles |
| **Runaway overnight costs** | Budget governor caps spend per session |
| **Repeated context re-reads** | Prompt caching reduces cost up to 90% |
| **Hidden waste** | Scanner finds waste patterns in agent logs |

## How It Works

```
Agent → Agentic Firewall Proxy → OpenAI / Anthropic / Gemini / NVIDIA
```

The firewall sits between your agent and the LLM provider. It intercepts every request and:
- Injects prompt caching headers for automatic cost reduction
- Detects loops and kills stuck agents
- Tracks costs and savings in real-time
- Your API keys pass through transparently — never stored

## Supported Agents

| Agent | Setup Method |
|---|---|
| OpenClaw | Config file patch (auto-detected) |
| Claude Code | LLM gateway URL |
| OpenAI SDK | `OPENAI_BASE_URL` env var |
| Anthropic SDK | `ANTHROPIC_BASE_URL` env var |
| Any OpenAI-compatible | `base_url` parameter |

## License

MIT
