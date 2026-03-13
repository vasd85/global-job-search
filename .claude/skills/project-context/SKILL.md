---
name: project-context
description: >
  Compact project context for global-job-search monorepo. Preloaded into
  subagents that need project awareness (code-reviewer, test-writer).
user-invocable: false
---

# global-job-search — Project Context

Job aggregation platform that discovers, extracts, and matches jobs from
company ATS (Applicant Tracking System) career pages.

## Monorepo Layout

```
apps/web/              — Next.js 16 (App Router) + React 19 + Tailwind CSS 4
                         PostgreSQL via Drizzle ORM
packages/ats-core/     — Shared ATS extraction library (@gjs/ats-core)
qa-jobs-scrapper/      — Legacy, read-only reference — never modify
```

Package manager: **pnpm** (workspaces). Node ≥22. ES Modules throughout.

## Key Files

- `apps/web/src/lib/db/schema.ts` — all table definitions
- `apps/web/src/app/api/jobs/route.ts` — job search/filter API
- `apps/web/src/app/api/companies/route.ts` — companies list API
- `apps/web/src/app/api/ingestion/route.ts` — ingestion trigger API
- `apps/web/src/lib/ingestion/` — poll-company, seed-companies, run-ingestion
- `apps/web/src/components/job-search.tsx` — main search component
- `packages/ats-core/src/extractors/` — vendor-specific extraction (greenhouse, lever, ashby, smartrecruiters)
- `packages/ats-core/src/discovery/` — ATS vendor detection, URL parsing
- `packages/ats-core/src/normalizer/` — job normalization, deduplication

## Test Stack

- **Vitest** — workspace config at repo root (`vitest.config.ts`)
- **apps/web**: `jsdom` environment, React Testing Library, `globals: true`
- **packages/ats-core**: `node` environment, `globals: true`
- Test files: `*.test.ts` / `*.test.tsx` next to source files

## What ESLint Already Enforces

Do not re-check or re-state these rules — the linter catches them:
- `@typescript-eslint/no-explicit-any` and all `no-unsafe-*` rules
- Standard formatting and import rules

## Conventions

- Do not add `.js` extensions to imports — bundler resolves them.
- Commit via `git commit -F /tmp/msg.txt` (avoids Cursor index.lock race).
