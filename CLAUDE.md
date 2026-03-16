# global-job-search

Job aggregation platform that discovers, extracts, and matches jobs from company ATS career pages.

## Commands

```bash
pnpm dev                    # Start Next.js web app (apps/web)
pnpm build                  # Production build (apps/web)
pnpm lint                   # Lint across workspace
pnpm typecheck              # TypeScript check across workspace
pnpm test                   # Vitest workspace (apps/web + packages/ats-core)
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

Read-only legacy reference. Not part of active workspace. Editing blocked by hook.

### ES Modules

All packages use `"type": "module"` with ES2022/ESNext TypeScript.
`moduleResolution: "bundler"` — **do not add `.js` extensions** to import paths.

## Conventions

- Prefer early returns over nested conditionals.
- Use Drizzle ORM for new queries; flag raw SQL with a comment explaining why.
- Keep shared types between `packages/ats-core` and `apps/web` in sync.
- Handle errors: never swallow silently; handle or log meaningfully.

### Git

- Branch from main: `git checkout -b <type>/<short-description>`
- Conventional Commits: `<type>(<scope>): <description>`
- Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`
- Scopes: `web`, `ats-core`, `db`, `api`
- One commit = one logical change.
- Commit via temp file: `git commit -F /tmp/gjs_msg.txt` (Cursor index.lock race — `git commit -m` is blocked by deny list).
- Push only when changeset is complete, reviewed, and all checks pass.
- PRs via `gh pr create` with title and description. Rebase on main first.

## Quality Pipeline

Hooks enforce typecheck + lint before commit and tests before PR creation.
Before opening a PR, always run both agents in order:

1. `pnpm typecheck && pnpm lint && pnpm test`
2. Fix findings, then commit.
3. **test-writer** agent — covers all new and changed code with tests.
4. **code-reviewer** agent — reviews branch diff for logic bugs and correctness.
5. Fix findings from both agents, commit, then open PR.

### Available Skills

- `/pre-pr` — full quality pipeline: typecheck, lint, tests, test-writer, code-reviewer, then PR.
- `/architect` — implementation plans, architectural decisions, and evolution roadmaps for complex changes.
