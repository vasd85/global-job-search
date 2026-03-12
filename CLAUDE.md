# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

```
global-job-search/
├── apps/web/              # Next.js web UI for browsing/matching jobs
├── packages/ats-core/     # Shared ATS extraction/discovery library (@gjs/ats-core)
├── drizzle/               # DB migration files
├── seed/                  # DB seeding utilities
└── qa-jobs-scrapper/      # ⛔ Legacy — read-only reference (see below)
```

Package manager: **pnpm@10.30.1** with workspaces. Node ≥22 required.

## Commands

Run from repo root unless noted:

```bash
# Development
pnpm dev                    # Start Next.js web app (apps/web)
pnpm build                  # Production build (apps/web)
pnpm lint                   # Lint across workspace
pnpm typecheck              # TypeScript check across workspace

# Database (run from apps/web or root with drizzle.config.ts)
pnpm drizzle-kit generate   # Generate migrations from schema changes
pnpm drizzle-kit migrate    # Apply migrations

# Tests (run from repo root)
pnpm test                     # Vitest workspace (apps/web + packages/ats-core)
```

## Architecture

### Web App (`apps/web`)

Next.js 16 (App Router) + React 19 + Tailwind CSS 4, backed by PostgreSQL via Drizzle ORM.

Key files:
- `src/lib/db/schema.ts` — All table definitions (company, job, user_profile, job_match, poll_log, company_submission)
- `src/app/api/jobs/route.ts` — Jobs search/filter API
- `src/app/api/companies/route.ts` — Companies list API

Environment: `DATABASE_URL` and `ANTHROPIC_API_KEY` (see `.env.example`).

### Shared Library (`packages/ats-core`)

Exports reusable ATS vendor logic consumed by the web app:
- `extractors` — Vendor-specific job data extraction
- `discovery` — Career URL detection and ATS vendor identification
- `normalizer` / `utils` — Shared normalization helpers

### Legacy: `qa-jobs-scrapper/`

**Read-only reference.** This is the original scraping pipeline (pre-monorepo).
It is not part of the active workspace, not included in CI, and should not be
modified. Use it only as a source of logic and patterns when building new
features in `apps/web` or `packages/ats-core`. Do not run its commands, do not
write tests for it, do not include it in commits.

### ES Modules

All packages use `"type": "module"` with ES2022/ESNext TypeScript. Both `tsconfig.base.json` and `apps/web/tsconfig.json` use `moduleResolution: "bundler"`, so **do not add `.js` extensions** to import paths — the bundler resolves them automatically.

## AI-assisted workflow

All review and quality checks happen locally via Claude Code before pushing.

### Local review pipeline

After implementing or modifying code, run checks in this order:

1. `pnpm typecheck && pnpm lint && pnpm test` — automated checks must pass.
2. **`code-reviewer`** agent — reviews the diff for correctness, security,
   and adherence to `REVIEW.md`. Run before committing.
3. Fix any findings, then commit.
4. **`test-writer`** agent — use when new logic is added or existing logic
   changes and test coverage is missing. Run before or after committing.
5. Push only when the changeset is complete and all checks pass.

### Subagents

- `code-reviewer` (`.claude/agents/code-reviewer.md`)
  - Use after implementing or modifying features to review recent changes.
  - Focus on logic, TypeScript quality, security, and adherence to
    project conventions and `REVIEW.md`.

- `test-writer` (`.claude/agents/test-writer.md`)
  - Use when new logic is added or existing logic changes and there are
    no or few tests.
  - Generate or extend Vitest tests in `apps/web` and `packages/ats-core`
    following existing patterns.

### Agent teams (optional)

Future option: add only when needed for complex changes.


## Git Workflow

### Branches

- `main` — stable branch, direct commits are forbidden
- Every change starts from a new branch: `git checkout -b <type>/<short-description>`
- Branch types: `feature/`, `fix/`, `refactor/`, `chore/`
- Examples: `feature/job-filters`, `fix/api-pagination`

### Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`
Scope (optional): `web`, `ats-core`, `db`, `api`

Examples:
```
feat(web): add salary filter to job search
fix(ats-core): handle empty Greenhouse job list
chore(db): add index on jobs.posted_at
```

Use `git commit -F /tmp/msg.txt` with a temp file — **not** `git commit -m "$(cat <<'EOF'...)"` and not `git commit -F - <<'EOF'`.
Cursor's background `gitWorker` process grabs `index.lock` intermittently; the
`$()` subshell and stdin heredoc forms are both vulnerable to this race. Writing
the message to a temp file and passing it via `-F` is the most reliable pattern.

**Rules for the agent:**
- One commit = one logical change
- Do not group unrelated changes into a single commit
- Always run `pnpm typecheck && pnpm lint` before committing
- If `index.lock` error occurs: verify no real git process is running (`ps aux | grep git`), then remove the stale lock file

### Pushing to remote

Every `git push` to a PR branch triggers CI (typecheck, lint, build, test).

- **Push = "ready to merge"**. Do not push intermediate WIP states.
- Work locally: commit as often as needed, but push only when the changeset
  is complete, locally reviewed, and all checks pass.
- Use `git commit --amend` or interactive rebase locally to clean up history
  **before** pushing — never force-push to a branch that already has a PR
  without explicit user confirmation.

### Pull Requests

Requires `gh` CLI to be installed and authenticated:
```bash
brew install gh   # if not installed
gh auth login     # once, opens browser for OAuth
```

- Each task → a separate PR into `main`
- Create PRs via `gh pr create` with a title and description
- The PR description must include: what changed, why, and how to test it
- Before creating a PR, ensure the branch is up to date: `git pull origin main --rebase`

### Forbidden operations

The agent must **never** perform these without explicit user confirmation:
- `git push --force` / `git push --force-with-lease`
- `git reset --hard`
- `git rebase` onto `main`
- Direct `git push origin main`
- Deleting branches: `git branch -D`

### Working with the remote repository

- Remote: `git@github.com:vasd85/global-job-search.git`
- Transport: SSH (key from the macOS system agent, no token required)
- Before starting work: run `git pull origin main` to synchronize
