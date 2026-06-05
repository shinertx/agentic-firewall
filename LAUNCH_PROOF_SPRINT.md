# VibeBilling Launch Proof Sprint

This is the launch loop for proving VibeBilling is not just published, but getting tried by real builders.

## Goal

By the end of the first proof sprint, get:

- 10 real-user CLI installs.
- 5 `scan` runs from external users.
- 3 direct feedback replies or screenshots.
- 1 external `setup` run.

Count proof in the admin dashboard, npm download stats, GitHub replies, and direct user messages. Do not count local CI, bots, or Benji-only tests as launch proof.

## Tracking

Use source-tagged commands when sending people a direct link or message:

```bash
npx @shinertx/vibebilling scan --source=hn
npx @shinertx/vibebilling scan --source=reddit
npx @shinertx/vibebilling scan --source=x
npx @shinertx/vibebilling scan --source=github
npx @shinertx/vibebilling scan --source=linkedin
```

The CLI only sends install metadata, command name, platform, version, environment class, and the source tag. It does not send prompts, code, log contents, provider keys, or request payloads.

Check proof in:

- `https://api.jockeyvc.com/admin` for real-user installs, launch sources, scans, setups, and scan-to-setup conversion.
- `https://api.jockeyvc.com/api/npm-stats` for public npm downloads.
- `https://api.jockeyvc.com/api/stats` for public runtime health.

## Launch Targets

Prioritize places where builders can run a CLI immediately:

| Priority | Channel | Source Code | Offer |
|---|---|---|---|
| 1 | Hacker News Show HN | `hn` | "Run one command and see if your coding agents are wasting tokens." |
| 1 | GitHub issues/discussions on agent tooling repos where waste is already being discussed | `github` | Useful answer first, CLI second. |
| 1 | Direct DMs to AI-tool builders and agent-heavy dev shops | `linkedin` or `x` | Ask for one `scan` result screenshot. |
| 2 | X build-in-public / AI devtool thread | `x` | Short demo output plus one command. |
| 2 | Reddit communities that explicitly allow project feedback or show-and-tell | `reddit` | Feedback request, not a broad ad. |
| 3 | Product Hunt / directory listings | `direct` | Only after direct proof exists. |

Before posting to a community, re-check its current rules. Hacker News Show HN is appropriate only because the CLI can be tried without signup. Do not ask friends to upvote or manufacture comments.

Reference links:

- Hacker News Show HN rules: https://news.ycombinator.com/showhn.html
- npm package: https://www.npmjs.com/package/@shinertx/vibebilling
- GitHub repo: https://github.com/shinertx/agentic-firewall

## Copy

### Show HN

Title:

```text
Show HN: VibeBilling - a firewall for runaway AI agent spend
```

Comment:

```text
I built VibeBilling after seeing coding agents burn money on repeated context reads, retries, and loops.

It is a reverse proxy plus CLI. The fastest way to try it is:

npx @shinertx/vibebilling scan --source=hn

The scan looks for common waste patterns locally. Setup can route supported agents through the firewall for caching, budget controls, loop detection, failover, and basic receipts.

I am looking for blunt feedback from people running Claude Code, OpenClaw, Cursor-like agent flows, or homegrown coding agents: does the scan find real waste, and where does setup feel too risky?
```

### Direct DM

```text
I shipped a small CLI for AI-agent spend waste: npx @shinertx/vibebilling scan --source=linkedin

It checks for repeated context reads, retry loops, missed caching, and setup gaps before asking you to route traffic. Could you run the scan on one agent-heavy project and send me the output or the first place it feels wrong?
```

### GitHub Reply

```text
This sounds like the same waste pattern VibeBilling is trying to catch: repeated context reads, retry loops, and missed prompt caching.

If useful, the read-only scan is:

npx @shinertx/vibebilling scan --source=github

It should not need provider keys or send prompt/log contents. I am trying to collect cases where it catches real waste and cases where it misses.
```

### X / Build In Public

```text
I published VibeBilling: a CLI + reverse proxy for runaway AI-agent spend.

Try the no-routing scan:
npx @shinertx/vibebilling scan --source=x

Looking for 10 real agent-heavy repos to test whether it catches repeated context reads, retry loops, and missed caching.
```

## Daily Operating Loop

1. Send 10 targeted asks.
2. Post in 1 public channel only when the rules fit.
3. Check admin source breakdown and npm stats.
4. Capture every reply as either `ran scan`, `setup attempted`, `blocked`, `not relevant`, or `bug`.
5. Fix the biggest blocker before sending the next batch.

Next best goal after this sprint: turn the first external scan result into either a public case study or a setup-flow fix.
