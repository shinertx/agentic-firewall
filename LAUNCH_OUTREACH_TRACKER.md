# VibeBilling Launch Outreach Tracker

This tracker exists to turn VibeBilling from "live" into externally proven. Do not count an item as proof until a non-Benji human is asked, replies, runs `scan`, attempts `setup`, or reports a bug.

## Diagnostic

The current constraint is a validation gap: the product is live, but the next proof is external behavior, not more internal polish.

## Current Proof Target

- 10 external asks.
- 5 external `scan` runs.
- 3 replies or screenshots.
- 1 external `setup` attempt.

## Proof Command

Use the source that matches the channel:

```bash
npx @shinertx/vibebilling scan --source=<source>
```

Valid first-pass sources:

- `github`
- `reddit`
- `hn`
- `x`
- `linkedin`
- `direct`

## Ready Targets

| # | Target | Source | Why This Fits | First Move | Status |
|---|---|---|---|---|---|
| 1 | Hacker News Show HN | `hn` | CLI is live and runnable without signup. | Submit Show HN post from `LAUNCH_PROOF_SPRINT.md`. | ready |
| 2 | openai/codex issue: cache miss / high usage | `github` | Active user pain around cache misses and token usage. | Reply only if the issue allows relevant tooling suggestions. | ready |
| 3 | openai/codex issue: burning tokens very fast | `github` | Direct complaint about token burn and optimization. | Useful comment with read-only scan command. | ready |
| 4 | openai/codex issue: Plus users hitting usage limits quickly | `github` | Token-limit pain maps to scan/report wedge. | Useful comment with scan command and ask for miss cases. | ready |
| 5 | anthropics/claude-code issue: cache read quota / CLAUDE.md re-reads | `github` | Cache-read and repeated context pain is a core VibeBilling claim. | Comment only if maintainers permit external repro tooling. | ready |
| 6 | anthropics/claude-code issue: full cache miss on new sessions | `github` | Cache behavior failure maps to VibeBilling scan/proxy story. | Comment with read-only scan and feedback ask. | ready |
| 7 | r/ClaudeAI Showcase post | `reddit` | Users are already asking how to cut token usage, but top-level Showcase posts require minimum OP karma. | Top-level post was removed; fallback comment was posted in the moderator-directed Build with Claude megathread. | megathread posted |
| 8 | r/ClaudeAI: coding agent cost cap project | `reddit` | Thread is adjacent to budget caps and runaway agents. | Ask for comparison feedback, not promotion. | ready |
| 9 | r/ClaudeAI: Claude Code keeps looping on same fix | `reddit` | Loop detection is a core failure mode. | Offer scan as one way to expose repeated-loop waste. | ready |
| 10 | r/ClaudeAI: UltraCode token eater / degenerate loop | `reddit` | Exact pain: multi-agent loop without circuit breaker. | Reply only if rules allow project suggestions. | ready |
| 11 | r/ClaudeAI: 100M token tracking post | `reddit` | Heavy user with measured cost data. | Ask for one scan run against an agent-heavy repo. | ready |
| 12 | r/claude: 9.3B tokens / $6.8k usage | `reddit` | High-spend power user likely understands the pain. | Ask for feedback on what scan should catch. | ready |
| 13 | r/OpenSourceAI: multi-LLM agent framework cost discussion | `reddit` | Framework builders are likely buyers or validators. | Ask whether scan catches their real waste modes. | ready |
| 14 | flightlesstux/prompt-caching repo | `github` | Adjacent Claude Code cost-reduction tool. | Open a thoughtful issue/discussion asking about integration boundaries. | ready |
| 15 | GitHub Agentic Workflows cost/token tracking docs community | `github` | Enterprise workflow cost tracking validates the market. | Use as research/reference, not outreach unless a discussion is open. | research |
| 16 | Stack Overflow VS Code token usage question | `direct` | Evergreen developer confusion around token costs. | Do not post unless answer is directly useful and non-promotional. | low-priority |
| 17 | Product Hunt upcoming launch | `direct` | Useful after 3 external replies exist. | Prepare listing later. | later |
| 18 | X thread around Copilot metered billing | `x` | Current market pain around token bills. | Reply only from user's account with explicit approval. | gated |
| 19 | X / build-in-public AI devtool builders | `x` | Devtool builders can run CLI immediately. | DM 10 specific builders after user approval. | gated |
| 20 | LinkedIn engineering managers using AI coding agents | `linkedin` | Team spend and trust buyer. | Send direct message after user approval. | gated |
| 21 | Cursor-heavy indie hackers | `x` | Likely individual power users. | Ask for one scan screenshot. | gated |
| 22 | OpenClaw users/builders | `github` | OpenClaw routing is supported and agent-heavy. | Find issue/discussion with cost pain before posting. | ready |
| 23 | Claude Code plugin/skill authors | `github` | Local agent tooling authors can validate setup safety. | Ask for read-only scan feedback. | ready |
| 24 | AI coding newsletter writers | `direct` | Good amplification after proof exists. | Send only after one case study. | later |
| 25 | Internal founder/operator network | `direct` | Fastest path to a trusted first run. | Ask 5 known agent-heavy users for scan screenshot. | gated |

## First Message Variants

### GitHub

```text
This looks like the exact class of waste VibeBilling is meant to expose: repeated context reads, cache misses, loops, and token burn that is hard to see from normal agent output.

The read-only scan is:

npx @shinertx/vibebilling scan --source=github

It should not need provider keys or send prompt/log contents. I am collecting cases where it catches real waste and cases where it misses, so blunt feedback would be useful.
```

### Reddit

```text
This is the pain I built VibeBilling around: coding agents silently burning tokens through repeated context reads, retries, and loops.

If you are open to testing a read-only scan:

npx @shinertx/vibebilling scan --source=reddit

It should not need provider keys or upload prompts/log contents. I am mainly looking for whether it catches real waste or misses the important cases.
```

### Direct DM

```text
I shipped VibeBilling, a CLI for finding AI-agent spend waste before routing anything:

npx @shinertx/vibebilling scan --source=direct

Could you run it on one agent-heavy repo and send me either the output or the first place it feels wrong? I am trying to prove whether it catches real repeated context reads, retries, loops, and missed caching.
```

## Outcome Log

| Date | Target | Source | Action | Outcome | Notes |
|---|---|---|---|---|---|
| 2026-06-05 | Not sent yet | - | Tracker created | ready | Sending/posting requires user authority. |
| 2026-06-05 | r/ClaudeAI Showcase | reddit | Reddit launch packet created | ready-to-post | Exact title/body in `REDDIT_LAUNCH_PACKET.md`; posting still requires final approval. |
| 2026-06-05 | r/ClaudeAI Showcase | reddit | Posted | awaiting moderator approval | https://www.reddit.com/r/ClaudeAI/comments/1txmyw9/i_built_a_free_local_scan_for_claude_code/ |
| 2026-06-06 | r/ClaudeAI Showcase | reddit | Checked live post | removed by moderator | Removal reason: minimum OP karma for Showcase feed posts; mod bot says project qualifies for the Build with Claude Project Showcase Megathread. |
| 2026-06-06 | r/ClaudeAI Build with Claude megathread | reddit | Posted fallback comment | live | https://www.reddit.com/r/ClaudeAI/comments/1sly3jm/comment/oq7aj6j/ |

## Authority Gate

Posting, replying, DMing, or submitting publicly creates reputational exposure. Do not send from Benji's accounts without explicit approval for the exact channel.
