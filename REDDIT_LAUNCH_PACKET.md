# Reddit Launch Packet

Use this packet for the first Reddit proof attempt. The goal is not traffic. The goal is to get real Claude Code / coding-agent users to run the read-only scan and tell us whether it catches real waste.

## Channel Decision

Primary first post: `r/ClaudeAI`

Why:

- Current discussions show direct pain around Claude Code token burn, loops, cache misses, and cost visibility.
- r/ClaudeAI's current Showcase moderation pattern allows free-to-try projects when the post says what was built, how Claude/Claude Code relates, how to try it, and avoids promotional language.
- A top-level transparent feedback post is cleaner than replying to competing tools or old threads.

Avoid for first post:

- `r/LocalLLaMA`: stricter self-promotion culture and less directly Claude Code/coding-agent focused.
- Replying to another builder's fresh launch thread: useful for research, but too easy to read as hijacking.
- Broad copy-paste comments across many threads: high spam risk and weak proof quality.

## Reddit Source Code

```bash
npx @shinertx/vibebilling scan --source=reddit
```

## Post Title

```text
I built a free local scan for Claude Code / coding-agent token waste. Looking for blunt feedback.
```

## Post Body

```text
I built VibeBilling after running into the same Claude Code / coding-agent problem I keep seeing discussed here: agents re-read context, retry the same broken approach, miss caching opportunities, and you only understand the waste after the bill or usage limit hits.

What it does right now:

- scans local agent history for repeated context reads, retry loops, missed caching, and setup gaps
- gives a plain report before asking you to route anything through a proxy
- can optionally set up a reverse proxy later for caching, budget controls, loop detection, failover, and receipts

The first step is read-only:

npx @shinertx/vibebilling scan --source=reddit

It should not need provider keys. It should not upload prompts, code, log contents, or request payloads. The telemetry it sends is limited to install metadata, command name, package version, platform, environment class, and the source tag so I can tell whether Reddit testers actually tried it.

Built for Claude Code / coding-agent workflows, and built with agent-heavy coding workflows. It is free to try:

https://www.npmjs.com/package/@shinertx/vibebilling
https://github.com/shinertx/agentic-firewall

What I am trying to learn:

1. Does the scan find real waste on your machine?
2. Is anything in the output confusing or wrong?
3. What would make setup feel safe enough to leave running?

I am not looking for upvotes. I am looking for failure cases.
```

## First Comment If Needed

Use this only if someone asks what is sent off-machine:

```text
The scan should not send prompts, code, log contents, provider keys, or request payloads.

The launch telemetry is intentionally narrow: install id, command name, version, platform/arch, node version, first-run flag, environment class, and source tag. The reason for the source tag is just to separate Reddit proof from HN/GitHub/direct outreach.
```

## Reply Template For Skepticism

```text
That is fair. The trust boundary is the hard part.

The intended flow is scan first, proxy later. If the read-only scan feels too broad or writes state where it should not, that is exactly the kind of failure I want to fix before asking anyone to route traffic through it.
```

## Reply Template For "How Is This Different From Cost Dashboards?"

```text
The difference I am testing is whether it can move from after-the-fact reporting toward prevention: repeated-read detection, no-progress loops, setup gaps, and eventually proxy-side caching/budget controls.

But the first proof is simpler: does the scan catch a real waste pattern on actual Claude Code / coding-agent history?
```

## Outcome Tracking

After posting, update `LAUNCH_OUTREACH_TRACKER.md` with:

- post URL
- time posted
- first 24h installs/scans from `source=reddit`
- replies/screenshots
- bugs or trust objections

## Authority Gate

This post is ready, but posting it from Benji's Reddit account is a public external action. It requires explicit approval after reviewing the exact title/body above.
