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
