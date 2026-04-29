# Stack Comparison: 3 Recommended Architectures

Status: Draft | Date: 2026-03-19

---

## 1. What's Common Across All Stacks

Regardless of the deployment model, the following choices are the same for all three stacks. These were established in the individual research documents.

| Layer | Choice | Why |
|---|---|---|
| **LLM provider abstraction** | Vercel AI SDK Core (`ai` + `@ai-sdk/anthropic`) | Multi-provider support, structured output, clean Next.js fit |
| **Canonical schema** | Zod | Source of truth for preferences, validation, structured extraction |
| **BYOK encryption** | PostgreSQL + AES-256-GCM + dedicated `ENCRYPTION_KEY` | Best fit for server-side async jobs; no auth-vendor coupling |
| **Chatbot architecture** | App-owned conversation engine + selective LLM assistance | Deterministic dialogue, LLM only for parsing and clarification |
| **Database** | PostgreSQL + Drizzle ORM | Already in place, no reason to change |
| **Structured UI** | React Hook Form (for non-freetext inputs) | Multi-select, sliders, weights, salary — not everything is chat |

These components cost nothing extra (all open source / already in the stack).

---

## 2. The Three Stacks

### Stack A: "DB-First, One Platform" — Render

Everything is database-centric and lives on one managed platform.

| Layer | Technology | Type |
|---|---|---|
| Auth | Better Auth | Open source, self-hosted in app |
| Background jobs | pg-boss | PostgreSQL-native queue |
| Deployment: web | Render Web Service | Managed |
| Deployment: worker | Render Background Worker | Managed |
| Database | Render Postgres | Managed |
| Cron trigger | Render Cron Job | Managed |

### Stack B: "Serverless Hybrid" — Vercel + Inngest + Neon

Delegate infrastructure to specialized platforms. Minimal ops.

| Layer | Technology | Type |
|---|---|---|
| Auth | Clerk | SaaS |
| Background jobs | Inngest | SaaS |
| Deployment: web | Vercel | Managed |
| Deployment: worker | Inngest (no separate worker) | SaaS |
| Database | Neon Postgres | Managed serverless |
| Cron trigger | Inngest built-in cron | SaaS |

### Stack C: "Self-Hosted" — Hetzner + Coolify

Same architecture as Stack A, but self-managed for minimum cost.

| Layer | Technology | Type |
|---|---|---|
| Auth | Better Auth | Open source, self-hosted in app |
| Background jobs | pg-boss | PostgreSQL-native queue |
| Deployment: all | Hetzner CX33 + Coolify | Self-managed VPS |
| Database | PostgreSQL via Coolify | Self-managed |
| Cron trigger | System cron or Coolify scheduler | Self-managed |

---

## 3. Cost Breakdown

### 3.1 Stack A: Render — ~$34/month

| Service | Tier | Monthly cost |
|---|---|---|
| Web service (Next.js) | Starter (0.5 CPU, 512 MB) | $7 |
| Background worker (pg-boss) | Starter (0.5 CPU, 512 MB) | $7 |
| Render Postgres | Basic-1gb | $19 |
| Cron job trigger | Starter, per-second billing | ~$1 |
| Better Auth | Free (open source) | $0 |
| pg-boss | Free (open source) | $0 |
| AI SDK + Zod | Free (open source) | $0 |
| **Total infrastructure** | | **~$34/month** |

Upgrade path: web + worker to Standard (1 CPU, 2 GB) = $25 each → **~$70/month**.

### 3.2 Stack B: Vercel + Inngest + Neon — ~$35–55/month

| Service | Tier | Monthly cost |
|---|---|---|
| Vercel | Hobby (free) or Pro ($20) | $0–20 |
| Neon Postgres | Launch plan | ~$15 |
| Inngest | Free (50K executions) | $0 |
| Clerk | Free (50K MAU) | $0 |
| AI SDK + Zod | Free (open source) | $0 |
| **Total (Hobby Vercel)** | | **~$15/month** |
| **Total (Pro Vercel)** | | **~$35/month** |

If Inngest free tier is exceeded → Pro $50/month. If Clerk free tier is exceeded → Pro $25/month. Realistic growth ceiling: **~$110/month** at scale.

Note: Vercel Hobby has limitations — no team collaboration, 300s function timeout, once-per-day cron precision. For a serious product, Pro ($20/month) is the realistic starting point.

### 3.3 Stack C: Hetzner + Coolify — ~$7/month

| Service | Tier | Monthly cost |
|---|---|---|
| Hetzner CX33 (4 vCPU, 8 GB, 80 GB SSD) | Shared | ~$7 (€6.49) |
| Coolify | Free (open source, self-hosted) | $0 |
| PostgreSQL | Self-managed via Coolify | $0 |
| Better Auth | Free (open source) | $0 |
| pg-boss | Free (open source) | $0 |
| AI SDK + Zod | Free (open source) | $0 |
| **Total** | | **~$7/month** |

Minimum viable: Hetzner CX23 (2 vCPU, 4 GB) = ~$4.30/month (€3.99).

### 3.4 Cost Summary Table

| Stack | Monthly cost (MVP) | Monthly cost (growth) | External dependencies |
|---|---|---|---|
| **A: Render** | ~$34 | ~$70 | 0 SaaS (all self-hosted/managed) |
| **B: Vercel + Inngest** | ~$15–35 | ~$110 | 3 SaaS (Clerk, Inngest, Neon) |
| **C: Hetzner + Coolify** | ~$7 | ~$7 (same server) | 0 SaaS |

Note: LLM API costs (Anthropic) are paid by the user (BYOK) and are not included in any stack.

---

## 4. Trade-off Analysis

### 4.1 Ops Burden

| Stack | What you manage | What the platform manages |
|---|---|---|
| **A: Render** | Application code, pg-boss config, deployment config | OS, scaling, SSL, DB backups, cron scheduling |
| **B: Vercel + Inngest** | Application code, Inngest function definitions | Everything else (infra, auth, jobs, DB) |
| **C: Hetzner + Coolify** | Application code, OS updates, security patches, backups, SSL, monitoring, incident response | Nothing (Coolify helps with deploy UX but doesn't monitor or fix things) |

### 4.2 Vendor Lock-in

| Stack | Lock-in risk | Migration cost |
|---|---|---|
| **A: Render** | Low. Better Auth + pg-boss are portable. Render is just a container host. | Move Docker containers to any other platform |
| **B: Vercel + Inngest** | Medium-High. Clerk user data, Inngest function model, Vercel-specific optimizations. | Auth migration is painful. Inngest functions need rewriting. Neon is standard PG. |
| **C: Hetzner + Coolify** | Very low. Everything is open source and portable. | Move Docker containers + data to any host |

### 4.3 Time to First Deploy

| Stack | Estimated time | Notes |
|---|---|---|
| **A: Render** | ~1 day | Set up 4 Render services, configure env vars, deploy |
| **B: Vercel + Inngest** | ~2-3 hours | Vercel auto-deploys from Git, Clerk has pre-built UI, Neon connects via URL |
| **C: Hetzner + Coolify** | ~1-2 days | Provision server, install Coolify, configure services, set up SSL, test |

### 4.4 Scalability Path

| Stack | How it scales | Ceiling |
|---|---|---|
| **A: Render** | Upgrade service tiers. Add worker replicas. Upgrade Postgres tier. | High (Render handles scaling) |
| **B: Vercel + Inngest** | Automatic (serverless). Neon autoscales compute. Inngest handles concurrency. | Very high (serverless = near-infinite) |
| **C: Hetzner + Coolify** | Upgrade VPS. Eventually add second server. Eventually migrate to managed platform. | Medium (single server ceiling, then architecture change needed) |

---

## 5. Architectural Diagrams

### Stack A: Render

```
┌─────────────────────────────────────┐
│              Render                 │
│                                     │
│  ┌─────────────┐  ┌──────────────┐ │
│  │  Web Service │  │ Background   │ │
│  │  (Next.js)   │  │ Worker       │ │
│  │  + Better    │  │ (pg-boss)    │ │
│  │    Auth      │  │              │ │
│  └──────┬───────┘  └──────┬───────┘ │
│         │                 │         │
│         └────────┬────────┘         │
│                  │                  │
│         ┌────────▼────────┐         │
│         │  Render Postgres │         │
│         │  (data + jobs    │         │
│         │   + sessions)    │         │
│         └─────────────────┘         │
│                                     │
│  ┌──────────────┐                   │
│  │  Cron Job    │ → enqueues daily  │
│  │  (dispatcher)│   polling batch   │
│  └──────────────┘                   │
└─────────────────────────────────────┘
```

### Stack B: Vercel + Inngest + Neon

```
┌──────────┐   ┌──────────┐   ┌──────────┐
│  Vercel  │   │  Inngest │   │   Clerk  │
│          │   │          │   │          │
│ Next.js  │──▶│ Polling  │   │ Auth     │
│ Web App  │   │ Scoring  │   │ Sessions │
│          │   │ Search   │   │          │
└────┬─────┘   └────┬─────┘   └──────────┘
     │              │
     └──────┬───────┘
            │
     ┌──────▼──────┐
     │    Neon     │
     │  Postgres   │
     │ (data only) │
     └─────────────┘
```

### Stack C: Hetzner + Coolify

```
┌─────────────────────────────────────┐
│     Hetzner CX33 + Coolify         │
│                                     │
│  ┌──────────────┐ ┌──────────────┐ │
│  │  Next.js     │ │  pg-boss     │ │
│  │  container   │ │  worker      │ │
│  │  + Better    │ │  container   │ │
│  │    Auth      │ │              │ │
│  └──────┬───────┘ └──────┬───────┘ │
│         │                │         │
│         └────────┬───────┘         │
│                  │                 │
│         ┌────────▼────────┐        │
│         │  PostgreSQL     │        │
│         │  container      │        │
│         └─────────────────┘        │
│                                    │
│  system cron → triggers polling    │
└────────────────────────────────────┘
```

---

## 6. Recommendation

### For this project right now

**Stack A (Render)** is the best starting point.

Reasoning:

1. **Zero vendor lock-in.** Better Auth and pg-boss are open source libraries, not SaaS. Moving away from Render means moving Docker containers — that's it.

2. **One platform, one bill.** No coordination between 3-4 different SaaS providers. Debugging is simpler when web, worker, and database are on the same platform.

3. **Best architectural fit.** The app is database-centric (PostgreSQL holds data, jobs, sessions, encrypted keys). Keeping everything around one Postgres instance is the natural architecture.

4. **Reasonable cost.** $34/month is affordable for an MVP. It's more than Hetzner ($7) but trades ops burden for convenience.

5. **Clean upgrade path.** If the app grows beyond Render's capacity, the same pg-boss + Better Auth code runs anywhere (Railway, Fly.io, AWS ECS). No vendor-specific rewrites.

### When to choose Stack B instead

- Speed of initial launch matters more than architectural control
- You don't want to manage auth (Clerk handles everything)
- You don't want to run a persistent worker process
- You're already familiar with the Vercel ecosystem
- **Risk:** Clerk migration is painful if you later want to own auth. Inngest lock-in for job definitions.

### When to choose Stack C instead

- Budget is the primary constraint
- You're comfortable managing a Linux server
- You want maximum control and zero third-party dependencies
- **Risk:** Ops overhead grows with the product. Backups, monitoring, security patches are all on you.

---

## 7. Recommended Phase Plan

Starting with Stack A (Render), the implementation phases are:

| Phase | What | Dependencies |
|---|---|---|
| P1 | Better Auth setup (Google OAuth + magic link) | — |
| P2 | BYOK table + AES-256-GCM encryption | P1 |
| P3 | Schema migration: new tables (`app_config`, `role_families`, `user_company_preferences`), MDSC → RSLCD | P1 |
| P4 | Role family classifier (Level 2 filter) | P3 |
| P5 | Chatbot: preference collection (conversation engine + AI SDK) | P1, P3 |
| P6 | Search API (instant DB search) | P3, P4 |
| P7 | pg-boss worker setup + Render deployment | P3 |
| P8 | LLM scoring (Level 3 evaluation) | P5, P6, P7 |
| P9 | Adaptive polling + per-vendor rate limiting | P7 |
| P10 | Internet search expansion | P7, P8 |
| P11 | UI: search results, dashboard, job detail | P6, P8 |

---

## 8. Sources

- [Better Auth — free and open source (MIT)](https://github.com/better-auth/better-auth)
- [Clerk pricing — free up to 50K MAU](https://clerk.com/pricing)
- [Inngest pricing — free 50K executions/month](https://www.inngest.com/pricing)
- [Render pricing](https://docs.render.com/pricing)
- [Neon pricing](https://neon.tech/pricing)
- [Hetzner Cloud pricing](https://www.hetzner.com/cloud/)
- [Vercel pricing](https://vercel.com/pricing)
- [Trigger.dev pricing](https://trigger.dev/pricing)
- [Coolify — open source self-hosted PaaS](https://coolify.io/)
- [pg-boss — PostgreSQL job queue](https://github.com/timgit/pg-boss)

Cross-references:
- `docs/authentication-options.md`
- `docs/byok-api-key-storage.md`
- `docs/background-jobs-infrastructure-research.md`
- `docs/chatbot-technology-research.md`
- `docs/deployment-options-research.md`
- `docs/business-logic-job-search.md`
