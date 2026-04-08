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
- `src/lib/db/schema.ts` — re-exports all table definitions from `packages/db/src/schema.ts` (company, job, user_profile, job_match, poll_log, company_submission)
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
- Commit via stdin HEREDOC — `-m` and `-am` are blocked by deny list:
  ```bash
  git add <specific files>
  git commit -F - <<'EOF'
  type(scope): description

  Optional body explaining why.
  EOF
  ```
  The HEREDOC delimiter must be exactly `EOF` (single-quoted) so the
  commit-guard hook can extract and validate the message. No temp file —
  previous `/tmp/gjs_msg.txt` convention is retired. Do not add a
  `Co-Authored-By:` trailer — this is a solo personal project and the
  attribution is noise. `git log` is your audit trail.
- Push only when changeset is complete, reviewed, and all checks pass.
- PRs via `gh pr create` with title and description. Rebase on main first.

## Quality Pipeline

Hooks enforce typecheck + lint before commit and tests before PR creation.

### Workflows

- `/implement <task>` — full pipeline for medium/large tasks (3+ files, new features, architecture).
- `/pre-pr` — quick quality gate for small changes.
- `/code-architect` — standalone architectural planning.
