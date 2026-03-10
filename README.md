# Global Job Search

A universal job aggregator for IT professionals, powered by ATS APIs.

The app collects job listings directly from Greenhouse, Lever, Ashby, and SmartRecruiters — no scraping, no rate limits, no cost. It keeps a live database of open positions across thousands of companies, updated daily, and (coming soon) ranks them against your profile using an LLM scoring model.

## Features

- **ATS-first ingestion** — collects all open jobs from company ATS boards via free JSON APIs
- **Diff engine** — tracks new/updated/closed jobs on every poll, no duplicates
- **Search & filter** — by keyword, workplace type (remote/hybrid/onsite), ATS vendor, or company
- **Companies dashboard** — see all tracked companies with job counts and poll status
- **Job detail API** — full description text for each job, ready for LLM scoring

## Tech Stack

| Layer | Choice |
|-------|--------|
| Web framework | Next.js 16 (App Router) + React 19 |
| Styling | Tailwind CSS 4 |
| Database | PostgreSQL 16 + Drizzle ORM |
| ATS library | `@gjs/ats-core` (workspace package) |
| Package manager | pnpm 10 (workspaces) |
| Language | TypeScript 5, ESM |

## Monorepo Structure

```
global-job-search/
├── apps/web/              # Next.js web app (UI + API routes + ingestion)
│   ├── src/
│   │   ├── app/           # App Router pages and API routes
│   │   ├── components/    # React components (job-search, etc.)
│   │   └── lib/
│   │       ├── db/        # Drizzle schema + DB connection
│   │       └── ingestion/ # Poll engine, diff logic, seed data
│   └── drizzle/           # DB migration files
├── packages/ats-core/     # Shared ATS extraction library (@gjs/ats-core)
│   └── src/
│       ├── extractors/    # Greenhouse, Lever, Ashby, SmartRecruiters
│       ├── discovery/     # ATS vendor detection, slug parsers
│       ├── normalizer/    # buildJob(), dedupeJobs()
│       └── utils/         # http, hash, url, text helpers
└── qa-jobs-scrapper/      # Legacy CLI pipeline (for reference)
```

## Local Setup

### Prerequisites

- Node.js ≥ 22
- pnpm 10: `npm install -g pnpm`
- PostgreSQL 16: `brew install postgresql@16`

### 1. Clone and install

```bash
git clone git@github.com:vasd85/global-job-search.git
cd global-job-search
pnpm install
```

### 2. Database

```bash
# Start PostgreSQL
brew services start postgresql@16

# Create database
createdb global_job_search
```

### 3. Environment

```bash
cp apps/web/.env.example apps/web/.env.local
# Edit .env.local and set DATABASE_URL
```

`.env.local` example:
```env
DATABASE_URL=postgresql://your_user@localhost:5432/global_job_search
ANTHROPIC_API_KEY=your_key_here   # needed for Phase 3 LLM scoring
```

### 4. Run migrations

```bash
cd apps/web
npx drizzle-kit push
```

### 5. Start the dev server

```bash
cd ../..
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Seeding and Ingestion

With the dev server running:

```bash
# Seed initial companies (10 well-known tech companies)
curl -X POST http://localhost:3000/api/seed

# Run ingestion (fetches all jobs from all active companies)
curl -X POST http://localhost:3000/api/ingestion \
  -H "Content-Type: application/json" \
  -d '{"concurrency": 5}'

# Browse collected jobs
open http://localhost:3000
```

A full ingestion of 10 seed companies takes ~60-90 seconds and collects ~2,000 jobs.

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/jobs` | List jobs with filters |
| `GET` | `/api/jobs/[id]` | Job details with full description |
| `GET` | `/api/companies` | All tracked companies |
| `POST` | `/api/seed` | Seed initial company list |
| `POST` | `/api/ingestion` | Run ingestion for all (or specific) companies |

### `GET /api/jobs` query params

| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Filter by title or department (case-insensitive) |
| `workplaceType` | `remote\|hybrid\|onsite` | Filter by workplace type |
| `vendor` | `greenhouse\|lever\|ashby` | Filter by ATS vendor |
| `company` | string | Filter by company slug (e.g. `greenhouse-stripe`) |
| `status` | `open\|stale\|closed` | Job status (default: `open`) |
| `limit` | number | Page size, max 200 (default: 50) |
| `offset` | number | Pagination offset (default: 0) |

## Development

```bash
pnpm dev          # Start Next.js dev server on :3000
pnpm typecheck    # TypeScript check across all packages
pnpm lint         # ESLint across all packages
pnpm build        # Production build
```

## Roadmap

- [x] **Phase 0** — Monorepo setup, `ats-core` package extraction
- [x] **Phase 1** — Ingestion pipeline: ATS poll → diff → upsert, poll logs
- [x] **Phase 2** — Job search UI: keyword search, filters, pagination, companies dashboard
- [ ] **Phase 3** — LLM scoring: user profile → M/D/S/C model via Claude API, `job_match` cache
- [ ] **Phase 4** — Company discovery: URL submission, demand-driven LLM discovery
- [ ] **Phase 5** — Auth, saved jobs, notifications

## Supported ATS Vendors

| Vendor | Jobs API | Descriptions |
|--------|----------|--------------|
| [Greenhouse](https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true) | ✅ free JSON | ✅ inline |
| [Lever](https://api.lever.co/v0/postings/{slug}?mode=json) | ✅ free JSON | ✅ inline |
| [Ashby](https://api.ashbyhq.com/posting-api/job-board/{slug}) | ✅ free JSON | ✅ inline |
| [SmartRecruiters](https://api.smartrecruiters.com/v1/companies/{slug}/postings) | ✅ free JSON | ⚠️ separate request per job |
