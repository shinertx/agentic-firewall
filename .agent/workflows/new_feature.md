---
description: How to properly add a new feature to the Agentic Firewall
---

# New Feature Workflow

Follow these steps when implementing any new feature.

## Steps

### 1. Create a feature branch
```bash
cd /Users/benjijmac/Documents/vibebilling
git checkout main && git pull
git checkout -b feature/<short-description>
```

### 2. Verify your role
Check `AGENTS.md` to confirm you are the correct agent role for this change. Only modify files within your owned directories.

### 3. Understand the scope
Before writing code:
- Read the relevant source files
- Identify which files need to change
- Check for existing tests that might be affected

### 4. Implement the feature
- Follow the conventions in `.agent/rules/03_code_conventions.md`
- Use the established log prefixes and error shapes
- Keep changes minimal and focused

### 5. Write or update tests
- Add unit tests in `agent-proxy/tests/` for any new proxy logic
- Update existing tests if behavior changed
- **Every new endpoint or handler needs at least one test**

### 6. Run the test suite
// turbo
```bash
cd /Users/benjijmac/Documents/vibebilling/agent-proxy && npm test
```
**STOP if any tests fail.** Fix them before proceeding.

### 7. Commit with a conventional message
```bash
git add -A
git commit -m "feat: <concise description>"
```

### 8. Push and create a Pull Request
```bash
git push origin feature/<short-description>
```
Open a PR on GitHub from `feature/<short-description>` → `main`.

### 9. Check for cross-boundary impacts
If your change affects another agent's directory (e.g., a new API endpoint that the Dashboard needs to display), add a handoff comment to the PR:
```
<!-- HANDOFF: Dashboard needs to add a card for /api/new-endpoint -->
```

### 10. Deploy
Once CI passes and PR is merged, follow `.agent/workflows/deploy.md`.
