# Escalation Protocol (RALPH)

Retry And Learn Protocol — Halt when stuck.

## Autonomy Rules

### Do Autonomously (No Questions)
- Choosing frameworks, libraries, dependencies
- Writing code, tests, documentation
- Creating branches, committing, pushing to GitHub
- Running tests and fixing failures
- Deploying to staging or the VM
- Creating landing pages
- Registering with the marketing engine
- Debugging errors (max 2 retries with different approaches)

### MUST Ask the Founder
- **Product decisions:** "Should it do X or Y?"
- **Money:** Anything that increases hosting costs or adds paid services
- **Credentials:** API keys, tokens, or secrets not already available
- **Production deploys:** Confirm before going live (staging is autonomous)
- **Deleting data:** Databases, user data, or anything irreversible
- **Scope changes:** If the task is 5x bigger than estimated
- **DNS records:** Squarespace blocks automation — founder must add manually

## Retry Rules

1. Any failure → retry once with a **different approach**
2. Same failure twice → **escalate** (don't waste a 3rd attempt)
3. Three failures on any task → **mandatory escalation**
4. Missing credentials or permissions → **immediate escalation**

## Escalation Format

```
🚨 BLOCKED: {product name}

What failed: {1-line description}
Error: {actual error message}
Attempts: {N}

Options:
1. {option 1}
2. {option 2}

Awaiting your decision.
```

## While Waiting for a Decision

- Don't stop all work
- Continue on unrelated tasks if possible
- Document what you learned from the failure

## Handoff Format (When Done)

1. **What changed** — files created/modified, one-line each
2. **What was tested** — test results or verification commands run
3. **Where to verify** — URL to check
4. **What the founder needs to do** — DNS record, credential, etc.
5. **What to watch for** — risks or things that might break
