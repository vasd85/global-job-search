# global-job-search

Job aggregation platform that discovers, extracts, and matches jobs from company ATS career pages.

## Commands

Run from repo root:

```bash
pnpm dev                    # Start Next.js web app (apps/web)
pnpm build                  # Production build (apps/web)
pnpm lint                   # Lint across workspace
pnpm typecheck              # TypeScript check across workspace
pnpm test                   # Vitest workspace (apps/web + packages/ats-core)
```

Database (from apps/web or root):

```bash
pnpm drizzle-kit generate   # Generate migrations from schema changes
pnpm drizzle-kit migrate    # Apply migrations
```

Package manager: **pnpm** with workspaces. Node ≥22 required.

## Architecture

### Web App (`apps/web`)

Next.js 16 (App Router) + React 19 + Tailwind CSS 4, backed by PostgreSQL via Drizzle ORM.

Key files:
- `src/lib/db/schema.ts` — all table definitions (company, job, user_profile, job_match, poll_log, company_submission)
- `src/app/api/jobs/route.ts` — jobs search/filter API
- `src/app/api/companies/route.ts` — companies list API
- `src/lib/ingestion/` — poll-company, seed-companies, run-ingestion

Environment: `DATABASE_URL` and `ANTHROPIC_API_KEY` (see `.env.example`).

### Shared Library (`packages/ats-core`)

Exports reusable ATS vendor logic consumed by the web app:
- `extractors/` — vendor-specific job data extraction (Greenhouse, Lever, Ashby, SmartRecruiters)
- `discovery/` — career URL detection and ATS vendor identification
- `normalizer/` — job normalization, deduplication, hashing
- `utils/` — URL canonicalization, HTML→text, HTTP fetch with retries

### Legacy: `qa-jobs-scrapper/`

Read-only reference. Not part of the active workspace. Do not modify, test, or commit changes to it.

### ES Modules

All packages use `"type": "module"` with ES2022/ESNext TypeScript.
`moduleResolution: "bundler"` — **do not add `.js` extensions** to import paths.

## Code Style

Rules the linter does not enforce:
- Prefer early returns over nested conditionals.
- Keep functions focused on a single responsibility.
- Prefer server components by default; mark client with `"use client"` only for interactivity.
- Use Drizzle ORM for new queries; flag raw SQL with a comment explaining why.
- Keep shared types between `packages/ats-core` and `apps/web` in sync.
- Handle errors: never swallow silently; handle or log meaningfully.
- No secrets, API keys, or tokens in code or tests; validate external input in API routes.

## Conventions

Git workflow details: @.claude/rules/git-workflow.md

- Commit messages follow Conventional Commits: `<type>(<scope>): <description>`
- Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`
- Scopes: `web`, `ats-core`, `db`, `api`
- One commit = one logical change.
- Use `git commit -F /tmp/msg.txt` — not heredoc or `$()` subshell (Cursor index.lock race).

## Agent Workflow

### Quality pipeline

After implementing or modifying code:

1. `pnpm typecheck && pnpm lint && pnpm test` — automated checks must pass.
2. **code-reviewer** agent — reviews diff for correctness, security, conventions. Run before committing.
3. Fix findings, then commit.
4. **test-writer** agent — use when new logic is added and test coverage is missing.
5. Push only when the changeset is complete, reviewed, and all checks pass.

### Skills

- `/architect` — design implementation plans for multi-file changes, new features, or architectural decisions. Use before starting complex implementations.

### Subagents

- `code-reviewer` — post-implementation review for correctness, security, performance, and project conventions.
- `test-writer` — write and improve Vitest tests for new or changed code.
