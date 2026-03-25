# Technology Stack

Status: **Approved** | Date: 2026-03-19

This document is the single source of truth for all technology decisions. Business logic is documented separately in `business-logic-job-search.md`.

Detailed research for each area is archived in `docs/archive/`.

---

## 1. Stack Overview

| Layer | Technology | License / Cost |
|---|---|---|
| **Framework** | Next.js 16 (App Router) + React 19 | Open source |
| **Language** | TypeScript (ES2022, `"type": "module"`) | Open source |
| **Styling** | Tailwind CSS 4 | Open source |
| **Database** | PostgreSQL + Drizzle ORM | Open source |
| **Authentication** | Better Auth (database sessions) | Open source (MIT) |
| **Background jobs** | pg-boss (PostgreSQL-native queue) | Open source |
| **LLM provider layer** | Vercel AI SDK Core (`ai` + `@ai-sdk/anthropic`) | Open source |
| **Schema validation** | Zod | Open source |
| **Structured UI forms** | React Hook Form | Open source |
| **BYOK encryption** | AES-256-GCM, app-layer encryption | Built-in Node.js `crypto` |
| **Deployment: web** | Render Web Service | Managed |
| **Deployment: worker** | Render Background Worker | Managed |
| **Deployment: database** | Render Postgres | Managed |
| **Deployment: cron** | Render Cron Job | Managed |

---

## 2. Architecture

```
┌─────────────────────────────────────────┐
│                Render                    │
│                                          │
│  ┌──────────────┐   ┌────────────────┐  │
│  │ Web Service   │   │ Background     │  │
│  │ (Next.js)     │   │ Worker         │  │
│  │               │   │ (pg-boss)      │  │
│  │ - App Router  │   │                │  │
│  │ - API routes  │   │ - ATS polling  │  │
│  │ - Better Auth │   │ - LLM scoring  │  │
│  │ - SSE/polling │   │ - Web search   │  │
│  │   for scores  │   │ - Company      │  │
│  │               │   │   discovery    │  │
│  └───────┬───────┘   └───────┬────────┘  │
│          │                   │            │
│          └─────────┬─────────┘            │
│                    │                      │
│          ┌─────────▼─────────┐            │
│          │  Render Postgres   │            │
│          │                    │            │
│          │  - App data        │            │
│          │  - Auth sessions   │            │
│          │  - pg-boss queues  │            │
│          │  - Encrypted BYOK  │            │
│          │  - app_config      │            │
│          └────────────────────┘            │
│                                           │
│  ┌────────────────┐                       │
│  │ Cron Job       │ → enqueues daily      │
│  │ (dispatcher)   │   polling batch       │
│  └────────────────┘                       │
└───────────────────────────────────────────┘
```

Key properties:
- **One platform, one bill.** Web, worker, DB, and cron all on Render.
- **One database for everything.** App data, auth sessions, job queues, encrypted secrets — all in PostgreSQL.
- **Zero vendor lock-in.** Better Auth and pg-boss are open-source libraries. Moving off Render = moving Docker containers.

---

## 3. Authentication: Better Auth

### 3.1 Why Better Auth

- Database-first model aligns with the app architecture (PostgreSQL is the system of record)
- Official Drizzle adapter
- Open source (MIT), no SaaS dependency
- Supports password auth, OAuth, magic links, passkeys, MFA
- Sessions stored in PostgreSQL — accessible to background workers
- No webhook sync needed (unlike Clerk)

### 3.2 MVP Configuration

- **Providers:** Google OAuth + magic link
- **Session strategy:** Database sessions (not JWT)
- **Session storage:** PostgreSQL via Drizzle adapter
- **Cookie settings:** `HttpOnly`, `Secure`, `SameSite=Lax`

### 3.3 Auth Secrets

| Secret | Purpose | Storage |
|---|---|---|
| `BETTER_AUTH_SECRET` | Session signing and CSRF protection | Environment variable |
| `ENCRYPTION_KEY` | BYOK encryption (separate from auth) | Environment variable |
| `GOOGLE_CLIENT_ID` | OAuth | Environment variable |
| `GOOGLE_CLIENT_SECRET` | OAuth | Environment variable |

### 3.4 Authorization Rules

- Enforce authorization inside route handlers and server actions (not just middleware)
- Protect internal operational routes (`/api/seed`, `/api/ingestion`) with admin role
- `user_profiles` and `job_matches` are user-owned — query by authenticated `userId`

### 3.5 Future Extensions

- Add passkeys when browser support is sufficient
- Add MFA for sensitive actions (API key rotation, account deletion)
- Consider PostgreSQL RLS for user-owned data isolation

**Full research:** `docs/archive/authentication-options.md`

---

## 4. BYOK: API Key Storage

### 4.1 Design

Users provide their own Anthropic API key. The app encrypts it at rest and uses it for server-side LLM operations.

### 4.2 Encryption

- **Algorithm:** AES-256-GCM
- **IV:** Generated with `crypto.randomBytes(12)` per write
- **Key:** Dedicated `ENCRYPTION_KEY` environment variable (not `BETTER_AUTH_SECRET`)
- **Key versioning:** `keyVersion` field from day one — supports lazy re-encryption on rotation
- **AAD (Additional Authenticated Data):** `userId + provider + credentialId` — prevents ciphertext copying between records

### 4.3 Data Model: `user_api_keys` table

| Field | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `userId` | text | Owner (references auth user) |
| `provider` | text | `"anthropic"` (extensible to `"openai"`, `"google"`) |
| `ciphertext` | bytea | Encrypted API key |
| `iv` | bytea | Initialization vector |
| `authTag` | bytea | GCM authentication tag |
| `keyVersion` | integer | Encryption key version |
| `status` | text | `"active"` / `"invalid"` / `"revoked"` |
| `maskedHint` | text | Last 4 chars for UX (`"...xK7m"`) |
| `fingerprintHmac` | text | HMAC of raw key for dedup detection |
| `lastValidatedAt` | timestamp | Last successful provider check |
| `lastErrorCode` | text | Last provider error (401, 402, etc.) |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |
| `revokedAt` | timestamp | |

Constraint: one active key per `userId + provider`.

### 4.4 Validation

On save: server calls `GET https://api.anthropic.com/v1/models` with the key.

| Response | Action |
|---|---|
| 200 OK | Store key, set `status = "active"` |
| 401 | Reject — invalid key |
| 402 | Warn — billing problem |
| 403 | Reject — permission problem |
| 429 | Accept — temporary rate limit, not an invalid key |

### 4.5 Lifecycle Operations

- **Add:** Validate → encrypt → store
- **Replace:** Validate new → atomically deactivate old + activate new
- **Revalidate:** Re-check with provider on demand or after repeated failures
- **Revoke:** Set `status = "revoked"`, set `revokedAt`, stop new work

### 4.6 Security Rules

- Never return raw key to client after initial submission
- Never store key in JWT, cookies, or auth metadata
- Never log raw or decrypted key
- Require recent auth for key rotation or deletion
- In-flight background jobs: stop new work on revoked key, allow in-progress to complete

### 4.7 Future Upgrade

Keep the same DB model, move key management to KMS (AWS KMS / GCP KMS) with envelope encryption when infrastructure maturity justifies it.

**Full research:** `docs/archive/byok-api-key-storage.md`

---

## 5. Background Jobs: pg-boss

### 5.1 Why pg-boss

- PostgreSQL-native — no Redis, no new infrastructure
- Durable job scheduling with cron expressions
- Retries with configurable backoff
- Concurrency control per queue
- Job state lives in PostgreSQL — survives process restarts
- Well-maintained, widely used in Node.js ecosystem

### 5.2 Job Types

| Job | Trigger | Concurrency | Notes |
|---|---|---|---|
| **ATS polling** | Cron (daily dispatcher) | Per-vendor limit (default 5) | Adaptive frequency, jitter |
| **LLM scoring** | User search request | Per-user limit (1-3) | Fan-out per matched job |
| **Internet expansion** | User "Expand search" action | 1 per user | Discovers + polls new companies |
| **Description fetch** | LLM scoring (pre-step) | Per-vendor limit | Lazy fetch for Ashby, SmartRecruiters |
| **Role taxonomy expansion** | User enters unknown role | 1 | LLM proposes new role family |

### 5.3 Worker Architecture

The worker runs as a **separate Render Background Worker service** from the same monorepo.

```
apps/
  web/          → Next.js (Render Web Service)
  worker/       → pg-boss worker (Render Background Worker)
packages/
  ats-core/     → shared ATS extraction logic
```

The web app enqueues jobs via pg-boss. The worker processes them.

### 5.4 Vendor Rate Limiting

pg-boss queues are configured per ATS vendor:

```
queue: "poll:greenhouse"    → concurrency 5
queue: "poll:lever"         → concurrency 5
queue: "poll:ashby"         → concurrency 5
queue: "poll:smartrecruiters" → concurrency 5
```

Jitter (0-5 sec random delay) added between requests to the same vendor.

### 5.5 Cron Dispatcher

A Render Cron Job triggers `POST /api/internal/dispatch-polling` on schedule. This API route:

1. Queries companies where `nextPollAfter <= now AND isActive = true`
2. Enqueues one pg-boss job per company into the appropriate vendor queue
3. Returns immediately

The worker picks up jobs asynchronously with proper concurrency.

### 5.6 Monitoring

pg-boss stores job state in PostgreSQL. Observable via:
- Direct SQL queries on `pgboss.job` table
- `poll_logs` table (already implemented) for polling results
- Future: admin dashboard page

**Full research:** `docs/archive/background-jobs-infrastructure-research.md`

---

## 6. Chatbot: LLM Integration

### 6.1 Architecture Principle

The chatbot is **not** a general-purpose AI chat. It is a structured onboarding engine that looks conversational.

```
Chat UI + structured controls (React Hook Form)
         │
         ▼
App-owned conversation engine (deterministic)
         │
         ▼
Canonical preferences draft + Zod validation
         │
         ▼
Task-oriented LLM service layer
         │
         ▼
Provider adapters (AI SDK Core)
```

### 6.2 What the LLM Does

- Parse free-text answers into typed partial preferences
- Normalize synonyms and fuzzy user input
- Propose clarifying questions when input is ambiguous
- Summarize the current preferences draft
- Propose role taxonomy expansions for unknown roles

### 6.3 What the LLM Does NOT Do

- Decide the next conversation step (app controls this)
- Skip required fields
- Write directly to the canonical preferences record
- Silently create new enum values without user confirmation
- Control final validation of business rules

### 6.4 Provider Strategy

**MVP:** Anthropic only, via AI SDK Core.

```
Packages:
  ai                    → core abstraction
  @ai-sdk/anthropic     → Anthropic provider
  zod                   → structured output schemas
```

**Future multi-provider:** Add `@ai-sdk/openai` and `@ai-sdk/google` when needed. The app routes by task, not by UI surface.

### 6.5 App-Facing Contract

The app depends on a task-oriented service, not a generic chat model:

```typescript
interface PreferenceCollectionLlm {
  extractPartialPreferences(input: {
    userText: string;
    currentStep: string;
    currentDraft: unknown;
  }): Promise<unknown>;

  summarizeDraft(input: {
    currentDraft: unknown;
  }): Promise<string>;

  proposeClarification(input: {
    userText: string;
    currentStep: string;
    currentDraft: unknown;
  }): Promise<string>;

  proposeRoleFamilyExpansion(input: {
    targetRole: string;
    existingFamilies: string[];
  }): Promise<unknown>;
}
```

### 6.6 Canonical State

The chatbot persists two artifacts:

1. **Canonical state** (source of truth): structured preferences draft — current values, current step, missing required fields, validation status, pending confirmations
2. **Transcript** (optional, for UX): message history for display and analytics. Must not be the authoritative state.

### 6.7 Structured Output Over Tool Calling

For this chatbot, structured extraction (Zod schema → `generateObject`) is preferred over tool-calling agent loops. The model is not deciding what to do — the app already knows which field to collect.

### 6.8 Streaming

Selective. Streaming is useful for assistant explanations and summaries. Not needed for validation results, field updates, or deterministic next-step decisions.

### 6.9 Future Additions

| When | Add |
|---|---|
| Multi-provider needed | `@ai-sdk/openai`, `@ai-sdk/google` |
| Complex branching | XState for conversation state |
| Richer chat UI | `@ai-sdk/react` or `assistant-ui` |

**Full research:** `docs/archive/chatbot-technology-research.md`

---

## 7. Deployment: Render

### 7.1 Services

| Render Service | Type | Start command | Tier |
|---|---|---|---|
| `gjs-web` | Web Service | `node apps/web/server.js` | Starter ($7) |
| `gjs-worker` | Background Worker | `node apps/worker/src/index.js` | Starter ($7) |
| `gjs-db` | Postgres | — | Basic-1gb ($19) |
| `gjs-poll-cron` | Cron Job | `curl -X POST .../api/internal/dispatch-polling` | Per-second (~$1) |

### 7.2 Cost

| Component | Monthly cost |
|---|---|
| Web service (Starter) | $7 |
| Background worker (Starter) | $7 |
| Render Postgres (Basic-1gb) | $19 |
| Cron job trigger | ~$1 |
| Better Auth | $0 |
| pg-boss | $0 |
| AI SDK + Zod | $0 |
| LLM API (user pays via BYOK) | $0 |
| **Total** | **~$34/month** |

Upgrade path: web + worker to Standard (1 CPU, 2 GB) → $25 each = **~$70/month**.

### 7.3 Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Auth session signing |
| `ENCRYPTION_KEY` | BYOK AES-256-GCM key |
| `GOOGLE_CLIENT_ID` | OAuth provider |
| `GOOGLE_CLIENT_SECRET` | OAuth provider |
| `BETTER_AUTH_URL` | Public URL for auth callbacks |

### 7.4 Deployment Flow

- Auto-deploy from Git (main branch)
- Monorepo: Render deploys each service with its own root directory and build command
- Zero-downtime deploys for web service
- Worker restarts gracefully (pg-boss recovers in-progress jobs on restart)

### 7.5 Render Cron Behavior

- Single-run guarantee: at most one run active at a time
- If previous run is still active, next run is skipped
- Maximum runtime: 12 hours
- Minimum interval: any (billed per active second)

### 7.6 Render Postgres

- Managed backups
- Connection pooling (if needed via pgBouncer add-on)
- Basic-1gb: 1 GB RAM, adequate for MVP

### 7.7 Why Not Vercel

- Vercel Hobby: cron once per day with ±59 min precision — insufficient
- No persistent background worker — requires external job platform
- Function duration limits (300s Hobby, 800s Pro) — too short for full polling
- Adding Inngest/Trigger.dev increases complexity and cost

### 7.8 Migration Path

If Render is outgrown:
- Same Docker containers run on Railway, Fly.io, AWS ECS, or any container host
- pg-boss and Better Auth are libraries — no SaaS vendor to migrate from
- PostgreSQL is portable to any managed Postgres provider

**Full research:** `docs/archive/deployment-options-research.md`

---

## 8. Package Dependencies (New)

### 8.1 Already in the project

- `next` (16)
- `react` (19)
- `tailwindcss` (4)
- `drizzle-orm` + `drizzle-kit`
- `postgres` (driver)
- `zod`

### 8.2 To add

| Package | Purpose | Layer |
|---|---|---|
| `better-auth` | Authentication framework | Auth |
| `pg-boss` | PostgreSQL job queue | Background jobs |
| `ai` | Vercel AI SDK Core | LLM abstraction |
| `@ai-sdk/anthropic` | Anthropic provider for AI SDK | LLM provider |
| `react-hook-form` | Structured form controls | UI |
| `@hookform/resolvers` | Zod resolver for RHF | UI |

---

## 9. Monorepo Structure (Updated)

```
global-job-search/
├── apps/
│   ├── web/                  → Next.js (Render Web Service)
│   │   ├── src/
│   │   │   ├── app/          → App Router pages + API routes
│   │   │   ├── lib/
│   │   │   │   ├── db/       → Drizzle schema + connection
│   │   │   │   ├── auth/     → Better Auth config
│   │   │   │   ├── crypto/   → BYOK encryption utilities
│   │   │   │   ├── ingestion/→ poll-company (existing)
│   │   │   │   └── llm/      → AI SDK service layer
│   │   │   └── components/   → React components
│   │   └── ...
│   └── worker/               → pg-boss worker (Render Background Worker) [NEW]
│       └── src/
│           ├── index.ts      → worker entry point
│           ├── handlers/     → job handlers (polling, scoring, search)
│           └── ...
├── packages/
│   └── ats-core/             → shared ATS extraction logic (existing)
│       └── src/
│           ├── classifier/   → role family title matching (P4)
│           ├── discovery/    → career URL detection, ATS vendor ID
│           ├── extractors/   → vendor-specific job extraction
│           ├── normalizer/   → job normalization, dedup, hashing
│           └── utils/        → URL, HTML, HTTP helpers
├── docs/                     → project documentation
│   ├── business-logic-job-search.md
│   ├── technology-stack.md   → this document
│   └── archive/              → research documents
└── ...
```

---

## 10. Implementation Phases

| Phase | What | Key technologies | Depends on |
|---|---|---|---|
| ~~**P1**~~ | ~~Better Auth setup~~ | `better-auth`, Google OAuth, magic link | ✅ Done |
| ~~**P2**~~ | ~~BYOK table + encryption~~ | `crypto`, AES-256-GCM, `user_api_keys` table | ✅ Done |
| ~~**P3**~~ | ~~Schema migration~~ | `app_config`, `role_families`, `user_company_preferences`, MDSC → RSLCD | ✅ Done |
| ~~**P4**~~ | ~~Role family classifier~~ | Taxonomy in DB, matching algorithm | ✅ Done |
| **P5** | Chatbot: preferences | `ai`, `@ai-sdk/anthropic`, `react-hook-form`, conversation engine | P1, P3 |
| **P6** | Search API | Instant DB search with Level 2 filter | P3, P4 |
| **P7** | pg-boss worker + Render deploy | `pg-boss`, `apps/worker/`, Render services | P3 |
| **P8** | LLM scoring | Level 3 evaluation, RSLCD scoring, `job_matches` | P5, P6, P7 |
| **P9** | Adaptive polling + rate limiting | Vendor queues, jitter, backoff | P7 |
| **P10** | Internet search expansion | Company discovery, ATS detection, immediate poll | P7, P8 |
| **P11** | UI: results + dashboard | Search results, job detail, score display | P6, P8 |

---

## 11. Decisions Log

| # | Decision | Rationale |
|---|---|---|
| D1 | **Render** as deployment platform | One platform for web + worker + DB + cron. No vendor lock-in. $34/month. |
| D2 | **Better Auth** for authentication | DB-first, open source, Drizzle adapter, no SaaS dependency. |
| D3 | **pg-boss** for background jobs | PostgreSQL-native, no Redis, durable scheduling, fits existing stack. |
| D4 | **AI SDK Core** for LLM layer | Multi-provider abstraction, structured output, clean Next.js fit. |
| D5 | **AES-256-GCM** for BYOK encryption | App-layer encryption in PostgreSQL, dedicated key, versioned from day one. |
| D6 | **App-owned conversation engine** for chatbot | Deterministic dialogue, LLM only for parsing. Not model-controlled chat. |
| D7 | **React Hook Form** for structured inputs | Many preference fields are enums, multi-select, sliders — not free text. |
| D8 | **Zod** as canonical schema layer | Source of truth for preferences, validation, and structured LLM extraction. |

---

## 12. Sources

- [Better Auth docs](https://www.better-auth.com/docs)
- [Better Auth Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle)
- [pg-boss docs](https://github.com/timgit/pg-boss)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)
- [AI SDK Anthropic provider](https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic)
- [Render pricing](https://docs.render.com/pricing)
- [Render background workers](https://render.com/docs/background-workers)
- [Render cron jobs](https://render.com/docs/cronjobs)
- [Anthropic Models API](https://docs.anthropic.com/en/api/models)
- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
