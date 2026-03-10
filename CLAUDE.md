# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

```
global-job-search/
├── apps/web/              # Next.js web UI for browsing/matching jobs
├── packages/ats-core/     # Shared ATS extraction/discovery library (@gjs/ats-core)
├── qa-jobs-scrapper/      # CLI scraping pipeline (has its own CLAUDE.md)
├── drizzle/               # DB migration files
└── seed/                  # DB seeding utilities
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

# Scraper pipeline (run from qa-jobs-scrapper/)
pnpm run pipeline -- run      # Start new pipeline run
pnpm run pipeline -- resume   # Resume from manual checkpoint
pnpm run pipeline -- status   # Inspect run state
pnpm test                     # Vitest tests (qa-jobs-scrapper only)
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

Exports reusable ATS vendor logic consumed by both the web app and scraper:
- `extractors` — Vendor-specific job data extraction
- `discovery` — Career URL detection and ATS vendor identification
- `normalizer` / `utils` — Shared normalization helpers

### Scraper Pipeline (`qa-jobs-scrapper`)

A staged CLI pipeline with manual GPT checkpoints. See `qa-jobs-scrapper/CLAUDE.md` for full details.

Supports 11 ATS vendors: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, Teamtailor, Personio, BambooHR, Breezy, Custom.

Pipeline config (`qa-jobs-scrapper/pipeline.config.json`) sets `search_root` — the directory where all run artifacts are stored.

### ES Modules

All packages use `"type": "module"` with ES2022/ESNext TypeScript. Imports must use explicit `.js` extensions even for `.ts` source files.

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

**Commit message format (agent must use this exact pattern):**

```bash
git commit -F - <<'EOF'
feat(web): short description here

Optional longer body explaining why.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
```

Use `git commit -F -` with a heredoc — **not** `git commit -m "$(cat <<'EOF'...)"`.
The `$()` subshell form can leave `index.lock` unreleased when Cursor's background
`gitWorker` process grabs the index concurrently between the subshell exit and the
parent `git commit` invocation.

**Rules for the agent:**
- One commit = one logical change
- Do not group unrelated changes into a single commit
- Always run `pnpm typecheck && pnpm lint` before committing
- Never use `git add .` — add files explicitly
- Do not commit: `.env*`, `node_modules/`, `*.tsbuildinfo`, `.next/`
- If `index.lock` error occurs: verify no real git process is running (`ps aux | grep git`), then remove the stale lock file

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
