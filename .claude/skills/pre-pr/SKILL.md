---
name: pre-pr
description: >-
  Pre-PR quality pipeline. Runs typecheck, lint, tests, then launches
  test-writer and code-reviewer agents. Use before opening a pull request.
disable-model-invocation: true
argument-hint: "[base-branch]"
---

# Pre-PR Pipeline

> **For comprehensive coverage** on medium/large tasks (3+ files, new
> features, architectural changes), use `/implement` instead. It runs
> the full pipeline: architect → developer → test-scenario-designer →
> test-writer → code-reviewer → PR.
>
> `/pre-pr` is the **fast path** for small changes where you've already
> written the code and tests yourself and just need quality checks.

Run the full quality pipeline before opening a PR.
Base branch defaults to `main` unless `$ARGUMENTS[0]` specifies otherwise.

## Steps

### 1. Static checks

Run all three in sequence — stop on first failure:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

If any fail, fix the issues and re-run before proceeding.

### 2. Test coverage — test-writer agent

Launch the **test-writer** subagent to cover new and changed code:

```
Analyze the branch diff against main and write tests for all new and
changed code. Follow your standard process.
```

Review its output. If it created or modified test files, commit them
with scope `test`:

```
test(<scope>): add tests for <what was covered>
```

### 3. Code review — code-reviewer agent

Launch the **code-reviewer** subagent:

```
Review the branch diff against main. Follow your standard process.
```

Present findings to the user.

### 4. Fix and open PR

If code-reviewer reports Critical findings — fix them, commit, and
re-run `pnpm typecheck && pnpm test` (no need to re-run agents).

Once ready, open the PR:

```bash
gh pr create --title "<title>" --body "<body>"
```

The `pre-pr-checks.sh` hook will run typecheck + tests one final time
as a deterministic backstop before `gh pr create` executes.
