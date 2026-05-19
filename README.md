# Global Job Search

A universal job aggregator for IT professionals, powered by ATS APIs.

The app collects job listings directly from Greenhouse, Lever, Ashby, and SmartRecruiters — no scraping, no rate limits, no cost. It keeps a live database of open positions across thousands of companies and ranks them against your profile using an LLM scoring model (bring-your-own Anthropic key).

> Experimental, solo project. Schema and API may break between commits — no backwards-compat guarantees.

## Features

- **ATS-first ingestion** — collects open jobs from company ATS boards via free JSON APIs
- **Diff engine** — tracks new/updated/closed jobs per poll, no duplicates
- **Adaptive polling** — pg-boss queue with per-company priority and backoff; cron-driven dispatch
- **Job search & filters** — keyword, workplace type (remote/hybrid/onsite), ATS vendor, company
- **Profile-aware search** — rules-based filter pipeline driven by the signed-in user's profile
- **LLM scoring** — R/S/L/C/D match model (Role / Skills / Location / Compensation / Domain) computed via Claude
- **Onboarding chatbot** — Claude-driven multi-step preference extraction that fills `user_profile`
- **BYOK** — users bring their own Anthropic key, encrypted at rest with AES-256-GCM
- **Auth** — Better Auth with Google OAuth + email magic links (Resend)

## Tech Stack

| Layer | Choice |
|-------|--------|
| Web framework | Next.js 16 (App Router) + React 19 |
| Styling | Tailwind CSS 4 |
| Database | PostgreSQL 16 + Drizzle ORM |
| Auth | Better Auth + Google OAuth |
| LLM | Anthropic Claude via `@ai-sdk/anthropic` |
| Job queue | pg-boss (Postgres-backed) |
| Email | Resend |
| Forms / validation | react-hook-form + zod |
| Logging | pino |
| Package manager | pnpm 10 (workspaces) |
| Language | TypeScript 5, ESM |

## Monorepo Structure

```
global-job-search/
├── apps/web/                  # Next.js web app (UI + API routes)
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/           # auth, jobs, search, scoring, chatbot, settings, internal
│   │   │   ├── login/         # Login page
│   │   │   ├── onboarding/    # Profile onboarding chatbot
│   │   │   ├── settings/      # BYOK + profile settings
│   │   │   └── companies/     # Companies dashboard
│   │   ├── components/
│   │   └── lib/               # auth, db, queue, search, scoring, chatbot glue
│   └── drizzle/               # Drizzle-kit generated migrations
├── packages/
│   ├── ats-core/              # ATS extractors, discovery, normalizer, taxonomy, geo
│   ├── db/                    # Drizzle schema — single source of truth
│   ├── ingestion/             # Poll engine, adaptive polling, pg-boss queues
│   ├── crypto/                # AES-256-GCM helpers for BYOK
│   └── logger/                # pino-based structured logger
├── docs/                      # ADRs, designs, plans, product manifesto, episodes
├── scripts/                   # Local CLI utilities
└── qa-jobs-scrapper/          # Legacy CLI pipeline (read-only reference)
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
brew services start postgresql@16
createdb global_job_search
```

### 3. Environment

```bash
cp apps/web/.env.example apps/web/.env.local
```

Required `.env.local` keys (see [`apps/web/.env.example`](apps/web/.env.example) for the full list):

```env
DATABASE_URL=postgresql://your_user@localhost:5432/global_job_search

# Better Auth
BETTER_AUTH_SECRET=                 # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000

# Google OAuth — https://console.cloud.google.com/apis/credentials
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Email (Resend)
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@yourdomain.com

# BYOK encryption key — 32 bytes hex
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=

# Optional — server-side Anthropic key (users normally BYOK)
ANTHROPIC_API_KEY=sk-ant-...
```

### 4. Run migrations

```bash
pnpm db:migrate
```

### 5. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Seeding and Ingestion

With the dev server running:

```bash
# Seed initial companies (well-known tech companies)
curl -X POST http://localhost:3000/api/seed

# Run ingestion (fetches all jobs from all active companies)
curl -X POST http://localhost:3000/api/ingestion \
  -H "Content-Type: application/json" \
  -d '{"concurrency": 5}'

# Browse collected jobs
open http://localhost:3000
```

A full ingestion of the seed set takes ~60–90 seconds.

## API Reference

Public:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/jobs` | List jobs with filters |
| `GET` | `/api/jobs/[id]` | Job details with full description |
| `GET` | `/api/companies` | List tracked companies |
| `POST` | `/api/seed` | Seed initial company list |
| `POST` | `/api/ingestion` | Run synchronous ingestion (local dev convenience) |

Authenticated:

| Method | Path | Description |
|--------|------|-------------|
| `*` | `/api/auth/[...all]` | Better Auth catch-all (sign-in, sign-out, callbacks) |
| `GET` | `/api/search` | Profile-aware job search via the filter pipeline |
| `POST` | `/api/search/expand` | Relax/expand filters for an existing search |
| `POST` | `/api/scoring/trigger` | Enqueue LLM scoring for the user's current candidates |
| `POST` | `/api/chatbot/message` | Send a message to the onboarding chatbot |
| `GET` / `POST` | `/api/chatbot/state` | Read or reset conversation state |
| `POST` | `/api/chatbot/save` | Persist the chatbot's draft as a `user_profile` |
| `*` | `/api/settings/api-keys` | Store / list / delete user's Anthropic key (BYOK) |
| `POST` | `/api/settings/api-keys/revalidate` | Re-validate a stored key |

Internal (cron-triggered):

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/internal/dispatch-polling` | Enqueue due companies into the polling queue |

### `GET /api/jobs` query params

| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Filter by title or department (case-insensitive) |
| `workplaceType` | `remote\|hybrid\|onsite` | Filter by workplace type |
| `vendor` | `greenhouse\|lever\|ashby\|smartrecruiters` | Filter by ATS vendor |
| `company` | string | Filter by company slug |
| `status` | `open\|stale\|closed` | Job status (default: `open`) |
| `hasDescription` | `true` | Restrict to jobs with extracted description text |
| `limit` | number | Page size, max 200 (default: 50) |
| `offset` | number | Pagination offset (default: 0) |

## Development

```bash
pnpm dev          # Next.js dev server on :3000
pnpm typecheck    # TypeScript check across all packages
pnpm lint         # ESLint across all packages
pnpm test         # Vitest across the workspace
pnpm build        # Production build
pnpm db:generate  # Generate a Drizzle migration from schema changes
pnpm db:migrate   # Apply pending migrations
```

## Supported ATS Vendors

| Vendor | Jobs API | Descriptions |
|--------|----------|--------------|
| [Greenhouse](https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true) | ✅ free JSON | ✅ inline |
| [Lever](https://api.lever.co/v0/postings/{slug}?mode=json) | ✅ free JSON | ✅ inline |
| [Ashby](https://api.ashbyhq.com/posting-api/job-board/{slug}) | ✅ free JSON | ✅ inline |
| [SmartRecruiters](https://api.smartrecruiters.com/v1/companies/{slug}/postings) | ✅ free JSON | ⚠️ separate request per job |
