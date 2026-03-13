# Git Workflow

## Branches

- `main` — stable, direct commits forbidden.
- Start every change from a new branch: `git checkout -b <type>/<short-description>`
- Types: `feature/`, `fix/`, `refactor/`, `chore/`

## Commits

Conventional Commits format:

```
<type>(<scope>): <description>
```

| Type | Meaning |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructuring without behavior change |
| `chore` | Tooling, config, dependencies |
| `docs` | Documentation only |
| `test` | Tests only |

Scopes (optional): `web`, `ats-core`, `db`, `api`

**Commit command — always use a temp file:**

```bash
printf 'type(scope): description\n\nbody\n' > /tmp/gjs_msg.txt
git commit -F /tmp/gjs_msg.txt
```

Do **not** use `git commit -m "$(cat <<'EOF'...)"` or `git commit -F - <<'EOF'`.
Cursor's background `gitWorker` grabs `index.lock` intermittently; temp file
via `-F` avoids the race.

**Rules:**
- One commit = one logical change. Do not group unrelated changes.
- Run `pnpm typecheck && pnpm lint` before committing.
- If `index.lock` error: verify no real git process is running, then remove stale lock.

## Pushing

- **Push = "ready to merge."** Do not push WIP states.
- Commit as often as needed locally; push only when the changeset is
  complete, reviewed, and all checks pass.
- Use `git commit --amend` or rebase locally to clean up history
  **before** pushing. Never force-push to a branch with an existing PR
  without explicit user confirmation.

## Pull Requests

Requires `gh` CLI (`brew install gh && gh auth login`).

- Each task → a separate PR into `main`.
- `gh pr create` with title and description (what, why, how to test).
- Before creating a PR: `git pull origin main --rebase`.

## Forbidden Operations

The following are denied in `.claude/settings.json` and require explicit
user confirmation:

`git push --force`, `git reset --hard`, `git push origin main`,
`git branch -D`, `git add .` / `git add -A`

## Remote

- Origin: `git@github.com:vasd85/global-job-search.git` (SSH)
- Before starting work: `git pull origin main` to synchronize.
