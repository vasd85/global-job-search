---
name: project-context
description: >
  Compact project context for global-job-search monorepo. Preloaded into
  subagents that need project awareness.
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

## Agent Pipeline

This project uses a thinker/doer agent architecture coordinated by the
`/implement` skill:

| Agent | Role | Category |
|-------|------|----------|
| code-architect | Design plans and architecture | Thinker (read-only + scratchpad write) |
| test-scenario-designer | Design test strategies and scenarios | Thinker (read-only + scratchpad write) |
| code-reviewer | Review code and test quality | Thinker (read-only + scratchpad write) |
| developer | Implement code from plans | Doer (full write access) |
| test-writer | Implement tests from scenarios | Doer (full write access) |

Context is passed between agents via files in `.claude/scratchpads/<task>/`:
plan.md, dev-progress.md, test-scenarios.md, test-progress.md, review.md,
phase-state.md.

## Conventions

- Do not add `.js` extensions to imports — bundler resolves them.
