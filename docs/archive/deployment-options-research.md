# Research: Deployment Options

Status: Draft
Date: 2026-03-19

---

## 1. Goal

This document evaluates deployment platform options for `global-job-search`.

The product is a Next.js 16 monorepo that requires:

- A web tier for the Next.js app (UI + API routes)
- A background worker tier for scheduled ATS polling, internet expansion, and async LLM scoring
- A PostgreSQL database
- Cron scheduling for periodic ingestion

The choice of deployment platform directly constrains what is possible for background jobs, long-running tasks, and database operations. This document is a companion to `background-jobs-infrastructure-research.md`.

---

## 2. Application Requirements Summary

Based on `apps/web/src/app/api/ingestion/route.ts`, `apps/web/src/lib/ingestion/run-ingestion.ts`, and `docs/business-logic-job-search.md`:

- `POST /api/ingestion` currently runs ingestion synchronously inside an API route
- A full poll of 10 seed companies takes ~60–90 seconds (from `README.md`)
- At 1,000 companies the ingestion is estimated at ~100 seconds of compute
- Future phases require durable fan-out (internet expansion), async LLM scoring with SSE progress streaming, and adaptive polling frequency
- The database is PostgreSQL with Drizzle ORM; no Redis is currently used
- The ingestion workload is I/O-bound, not CPU-heavy

These constraints mean:

- A pure serverless-only platform with strict function duration limits is insufficient as the sole runtime
- A background worker process or equivalent is required
- PostgreSQL must be available as a persistent managed service

---

## 3. Platforms Evaluated

### 3.1 Vercel

#### What it is

A managed deployment platform optimized for Next.js. Cron jobs and serverless functions are the primary runtime primitives.

#### Pros

- Best-in-class DX for Next.js: preview deployments, zero-config builds, CI/CD from Git
- Fluid Compute (as of June 2025): multi-request sharing of a single function instance, better connection pooling behavior
- Function duration: 300s default/max on Hobby; up to 800s on Pro
- Cron: up to 100 jobs per project; Pro allows per-minute precision
- `attachDatabasePool` helper for idle connection cleanup in Fluid Compute
- Vercel Workflow (WDK): new durable workflow primitive built on open-source Workflow DevKit — no timeouts, pay only for active execution time

#### Cons

- Hobby cron: once per day only, precision within ±59 minutes
- Cron on Vercel only triggers a serverless function; it is not a job queue or durable worker
- Full ingestion of 1,000 companies in a single function invocation is impractical even on Pro
- No persistent background worker primitive — long-running processes require a separate platform
- Connection pooling requires explicit `attachDatabasePool` setup; raw `postgres` driver (current stack) needs adaptation
- Vercel Workflow is new (2025); maturity and pricing should be validated before betting the architecture on it

#### Cron limits (official docs, verified March 2026)

| Plan | Interval | Precision |
|---|---|---|
| Hobby | Once per day | ±59 min |
| Pro | Once per minute | Per-minute |
| Enterprise | Once per minute | Per-minute |

#### Function duration limits (Fluid Compute, June 2025)

| Plan | Default | Maximum |
|---|---|---|
| Hobby | 300s | 300s |
| Pro | 300s | 800s |
| Enterprise | 300s | 800s |

#### Verdict

Excellent web tier. Insufficient as the sole runtime for this application. Best used in a hybrid architecture: Vercel for the web app, an external job platform (Inngest, Trigger.dev, or Vercel Workflow) for background execution.

---

### 3.2 Railway

#### What it is

A managed container platform with persistent services, cron jobs, and usage-based billing.

#### Pros

- Persistent services: always-running processes for web and worker
- Monorepo support: deploy multiple services from the same repository with different start commands
- Cron jobs: built-in scheduler with standard cron expressions; minimum interval 5 minutes
- Usage-based billing: pay per vCPU-minute and GB-minute, not per fixed tier
- Good DX: auto-deploys from Git, separate logs per service, independent scaling

#### Cons

- Railway cron is designed for short-lived tasks that exit on completion; if a previous run is still active, the next run is skipped
- No built-in durable job queue or workflow primitive; a library like `pg-boss` or `Graphile Worker` is still required for durability
- Minimum cron interval is 5 minutes (not 1 minute)
- Pricing is resource-based and can be less predictable than fixed-tier platforms

#### Pricing (verified March 2026)

- Hobby plan: $5/month subscription (includes $5 of resource usage)
- RAM: $10/GB/month ($0.000231/GB/minute)
- CPU: $20/vCPU/month ($0.000463/vCPU/minute)
- Volume storage: $0.15/GB/month
- Network egress: $0.05/GB

#### Verdict

Strong platform for the `web + worker + Postgres` architecture. Works well with `pg-boss` or `Graphile Worker` for durable job execution. The worker runs as a separate persistent service from the same repository.

---

### 3.3 Render

#### What it is

A managed cloud platform with dedicated service types for web services, background workers, cron jobs, and managed databases.

#### Pros

- Explicit `background workers` service type: always-running processes that do not receive HTTP traffic
- Cron jobs: dedicated service type, billed per active second, max runtime 12 hours, single-run guarantee
- Managed Postgres and managed Redis (Key Value) available on the same platform
- `Render Workflows` (beta): durable task execution with automatic retries, chaining, up to 24-hour task runtime, TypeScript SDK
- Predictable fixed-tier pricing for web/worker services
- Zero-downtime deploys, SSH access, monorepo support

#### Cons

- Render Workflows is in public beta; bugs and API changes are possible
- No built-in cron scheduling inside Workflows yet (must combine with a cron job service)
- Starter tier (512 MB / 0.5 CPU) may be tight for heavy ingestion under load
- Less native Next.js DX than Vercel (no preview deployments linked to GitHub PRs)

#### Cron behavior

- Single-run guarantee: at most one run active at a time
- If a run is active when the next scheduled time arrives, the next run is delayed until the current one finishes
- Maximum runtime: 12 hours; tasks that run continuously should use background workers instead

#### Pricing (verified March 2026)

**Web and background worker services:**

| Instance | Price | RAM | CPU |
|---|---|---|---|
| Starter | $7/month | 512 MB | 0.5 |
| Standard | $25/month | 2 GB | 1 |
| Pro | $85/month | 4 GB | 2 |

**Render Postgres:**

| Tier | Price | RAM |
|---|---|---|
| Basic-256mb | $6/month | 256 MB |
| Basic-1gb | $19/month | 1 GB |
| Basic-4gb | $75/month | 4 GB |
| Pro-4gb | $55/month | 4 GB |

**Cron jobs:** Billed per active second; minimum $1/month per cron service.

**Render Workflows (beta):**

| Compute | Price/hour | CPU | RAM |
|---|---|---|---|
| Starter | $0.05 | 0.5 | 512 MB |
| Standard | $0.20 | 1 | 2 GB |
| Pro | $0.40 | 2 | 4 GB |

#### Verdict

The strongest single-platform managed option for this application. Has explicit primitives for every required service type. Render Workflows is a promising future path for replacing `pg-boss` with a fully managed durable execution layer, but its beta status means it should not be the primary dependency yet.

---

### 3.4 Hetzner VPS + Coolify

#### What it is

A self-managed deployment: a low-cost Hetzner Cloud server running Coolify, an open-source self-hosted PaaS. Coolify deploys applications as Docker containers and provides a UI for managing services, SSL, domains, environment variables, and databases.

#### Pros

- Lowest cost of all options by a significant margin
- Full control over the server, processes, scheduling, and database configuration
- Coolify is free (open-source, self-hosted); provides a UI that eliminates most of the raw Docker/Compose complexity
- Can run Next.js web, worker, Postgres, and cron all on a single server
- Hetzner servers are priced in EUR and include 20 TB of traffic

#### Cons

- Server maintenance, OS updates, security patches, and backups are your responsibility
- No managed database: Postgres runs on the same server or requires a separate service
- No automatic failover or HA without additional setup
- SSL setup, domain configuration, and monitoring require manual work (Coolify helps, but it is not zero-ops)
- Not suitable if you want to move fast without ops overhead

#### Hetzner Cloud pricing (effective April 1, 2026, EU regions, excl. VAT)

| Server | vCPU | RAM | SSD | Price |
|---|---|---|---|---|
| CX23 | 2 (shared) | 4 GB | 40 GB | €3.99/month |
| CX33 | 4 (shared) | 8 GB | 80 GB | €6.49/month |
| CPX11 | 2 (shared) | 2 GB | 40 GB | €4.49/month |
| CPX21 | 3 (shared) | 4 GB | 80 GB | €7.99/month |

All plans include 20 TB outbound traffic.

#### Coolify

- Installation: single `curl` command, ready in under a minute
- Supports Next.js, Node.js, Docker, and 200+ one-click services (Postgres, Redis, etc.)
- Free, open-source (no paywall features)
- Requires minimum 2 GB RAM, 2 CPU cores, 30 GB storage on the host server

#### Verdict

Best option for minimizing monthly cost. Appropriate if you are comfortable managing a Linux server and are willing to handle ops. A `CX33` (€6.49/month) is a comfortable baseline for running web + worker + Postgres together via Coolify.

---

### 3.5 Fly.io (not in original list — recommended addition)

#### What it is

A container-native platform that runs Firecracker micro-VMs. Applications are packaged as Docker images and deployed as Fly Machines. Fly supports `process groups`: multiple named processes within a single app, each running in its own Machine and scalable independently.

#### Pros

- Process groups: define `web` and `worker` in `fly.toml`, both deployed from the same Docker image
- Pay-as-you-go: Machines billed per second when running, per rootfs GB when stopped
- Scale to zero for worker Machines when not actively processing (saves cost during idle periods)
- Good middle ground between PaaS convenience and VPS control
- `flyctl` CLI and `fly.toml` config are straightforward
- European regions available (Frankfurt `fra`, Amsterdam `ams`)

#### Cons

- No built-in managed Postgres with connection pooling; best combined with an external managed Postgres (e.g., Neon)
- Volumes are pinned to physical hosts; scale-to-zero Machines that may migrate cannot use volumes reliably
- DX is less "Next.js native" than Vercel; more like deploying a generic Node.js Docker container
- Slightly more infrastructure thinking than Render or Railway

#### Pricing (verified March 2026, EU region `fra`)

| Machine | CPU | RAM | Price/month |
|---|---|---|---|
| shared-cpu-1x, 512 MB | 1 shared | 512 MB | ~$3.19 |
| shared-cpu-2x, 2 GB | 2 shared | 2 GB | ~$11.39 |
| performance-1x, 2 GB | 1 dedicated | 2 GB | ~$31.00 |

Stopped Machines: $0.15/GB of rootfs per month.

#### Fly.io process groups example (`fly.toml`)

```toml
[processes]
  web    = "node apps/web/server.js"
  worker = "node packages/worker/src/index.js"
```

Each process runs in its own Machine(s) and can be scaled independently.

#### Verdict

Strong option for teams that want more control than Render/Railway without the full ops burden of a VPS. Best used with an external managed Postgres (Neon recommended).

---

### 3.6 Options not recommended for this application at current stage

#### Google Cloud Run

Supports Cloud Run Services (web) and Cloud Run Jobs (batch/cron). Technically capable but adds GCP-specific complexity: IAM roles, Cloud Scheduler, Cloud Build, Artifact Registry. Overkill for the current MVP stage. Good option at larger scale with a dedicated DevOps resource.

#### Northflank

Strong platform for jobs, cron, and workers. Slightly more enterprise-oriented than Render or Railway. Price-per-container model starts at $2.70/month for smallest plan. Good option at larger scale; not the simplest starting point for an MVP.

---

## 4. Hybrid Pattern: Vercel + External Job Platform

If the web app is deployed on Vercel and long-running jobs are not acceptable in any form, the cleanest solution is to pair Vercel with a dedicated background job platform.

### 4.1 Vercel + Inngest

- Inngest integrates with Next.js via an API route handler
- Functions run on Inngest's managed workers, not inside Vercel Functions
- Supports cron, fan-out, concurrency keys, throttling, and step-level retries
- Hobby: free, 50k executions/month, 5 concurrent steps
- Pro: $75/month, 1M executions included, 100+ concurrent steps

### 4.2 Vercel + Trigger.dev

- Similar to Inngest but with a more task-centric model
- Tasks run on Trigger.dev managed workers with no timeout
- Compute: $0.0000338/sec on Small 1x (default); $0.000025 per run invocation
- Free: $5/month usage included; Hobby: $10/month; Pro: $50/month
- Self-hostable (Apache 2.0 license)

### 4.3 Vercel + Vercel Workflow (WDK)

- Open-source Workflow DevKit deployed on Vercel's own infrastructure
- `"use workflow"` and `"use step"` directives mark durable functions
- No execution timeout; pay only for active CPU time
- State managed by Vercel; no external platform dependency
- New product (2025); pricing details should be validated before adoption

---

## 5. External Managed Postgres Options

Relevant when the deployment platform does not include a built-in Postgres (e.g., Fly.io).

### 5.1 Neon (recommended for Fly.io)

- Serverless Postgres with autoscaling and scale-to-zero
- Includes pgBouncer connection pooling on all plans
- Launch plan: $0.106/CU-hour, $0.35/GB-month; typical spend ~$15/month
- Scale-to-zero default: Neon worker instances shut down when idle, saving compute costs

### 5.2 Supabase

- Hosted Postgres with REST API, Auth, Storage, Realtime
- Pro plan: $25/month per organization (includes 8 GB database, 250 GB egress)
- More features than needed for this app at MVP stage; use if Auth or Realtime become relevant

---

## 6. Cost Estimates

All estimates are for a realistic MVP profile: one developer, 10–50 companies, web + worker + Postgres, no significant traffic yet.

### 6.1 Render — managed single platform

| Service | Tier | Price/month |
|---|---|---|
| Web service (Next.js) | Starter: 0.5 CPU, 512 MB | $7 |
| Background worker (pg-boss) | Starter: 0.5 CPU, 512 MB | $7 |
| Render Postgres | Basic-1gb | $19 |
| Cron trigger (dispatcher) | Starter, per-second billing | ~$1 |
| **Total** | | **~$34/month** |

Upgrade web to Standard (2 GB / 1 CPU) for more comfortable ingestion headroom: **~$52/month**.

### 6.2 Fly.io + Neon Postgres

| Service | Profile | Price/month |
|---|---|---|
| Web Machine (shared-cpu-2x, 2 GB) | Always running, `fra` region | ~$11.83 |
| Worker Machine (shared-cpu-1x, 512 MB) | Process group, can scale to zero | ~$3.32 |
| Neon Postgres (Launch) | Typical MVP spend | ~$15 |
| **Total** | | **~$30/month** |

### 6.3 Hetzner + Coolify

| Service | Profile | Price/month |
|---|---|---|
| Hetzner CX23 (2 vCPU, 4 GB RAM) | Web + worker + Postgres on one VPS | ~$4.30 (€3.99) |
| Coolify | Self-hosted, open-source | free |
| **Total** | | **~$4–5/month** |

For more comfortable headroom (separate containers, more RAM):

| Hetzner CX33 (4 vCPU, 8 GB RAM) | ~$7 (€6.49) |
|---|---|

### 6.4 Railway

| Service | Profile | Price/month |
|---|---|---|
| Hobby plan subscription | Includes $5 of usage | $5 |
| Web service (512 MB RAM, 0.25 vCPU) | Always running | ~$10 |
| Worker service (512 MB RAM, 0.25 vCPU) | Always running | ~$10 |
| Postgres service + volume (10 GB) | 512 MB RAM + volume | ~$11.50 |
| **Total** | | **~$30–35/month** |

### 6.5 Vercel + Trigger.dev + Neon (hybrid)

| Service | Tier | Price/month |
|---|---|---|
| Vercel Pro (1 developer seat) | Includes $20 usage credit | $20 |
| Trigger.dev Hobby | Includes $10 usage | $10 |
| Neon Postgres (Launch) | Typical MVP spend | ~$15 |
| **Total** | | **~$45/month** |

With Inngest Hobby (free, 50k executions) instead of Trigger.dev: **~$35/month**.

### 6.6 Summary

| Option | Price/month | Ops burden | Best for |
|---|---|---|---|
| Hetzner + Coolify | ~$5–7 | High | Minimizing cost; comfortable with Linux ops |
| Fly.io + Neon | ~$30 | Medium | Control without full VPS ops |
| Railway | ~$30–35 | Low | Flexible usage billing, good DX |
| Render | ~$34–52 | Low | Single managed platform with all primitives |
| Vercel + Trigger.dev + Neon | ~$35–45 | Very low | Staying in Vercel ecosystem |

---

## 7. Recommended Deployment Architectures

### 7.1 Best managed single-platform path

**Recommendation:** Render

**Why:**
- Explicit service types for every required primitive: web service, background worker, cron job, Postgres
- Cron jobs have single-run guarantee and up to 12-hour runtime
- Render Workflows (beta) provides a future path to durable execution without `pg-boss`
- Predictable fixed-tier pricing
- Low operational overhead

**Architecture:**

```
Render Web Service     → Next.js (UI + API routes)
Render Background Worker → pg-boss worker (ingestion, scoring)
Render Postgres        → shared database
Render Cron Job        → dispatches scheduled ingestion to worker
```

**Start command for worker (example):**
```bash
node apps/worker/src/index.js
```

### 7.2 Best cost-control path

**Recommendation:** Fly.io + Neon Postgres

**Why:**
- Fly process groups allow web and worker in one app definition
- Worker Machines can scale to zero between polling windows
- Neon provides managed Postgres with pgBouncer and scale-to-zero
- Monthly cost is the lowest among managed options (~$30/month)

**Architecture:**

```
Fly App: web process      → Next.js
Fly App: worker process   → pg-boss worker
Neon Postgres             → DATABASE_URL
```

**`fly.toml` process groups:**
```toml
[processes]
  web    = "node .next/server/server.js"
  worker = "node dist/worker/index.js"
```

### 7.3 Best low-ops path (Vercel ecosystem)

**Recommendation:** Vercel (web) + Inngest or Trigger.dev (jobs) + Neon (DB)

**Why:**
- Zero infrastructure management for the web tier
- Inngest and Trigger.dev handle durable execution, retries, fan-out, and throttling
- Neon handles Postgres with connection pooling
- No persistent background process to maintain

**Architecture:**

```
Vercel               → Next.js web app
Inngest / Trigger.dev → polling tasks, internet expansion, LLM scoring
Neon Postgres         → DATABASE_URL
```

**When to choose Inngest:** better throttling model for ATS vendor protection, built-in concurrency keys for per-vendor rate limiting.

**When to choose Trigger.dev:** stronger run-level observability, self-hostable, task-centric model.

### 7.4 Best cost-minimum path (self-managed)

**Recommendation:** Hetzner CX33 + Coolify

**Why:**
- ~$7/month covers web + worker + Postgres + Coolify for an MVP
- Coolify eliminates most raw Docker/compose complexity
- Full control over scheduling, resources, and database

**Tradeoff:** You are responsible for OS updates, security, backups, SSL renewal, and incident response.

---

## 8. What Not to Do

- Do not keep full ingestion synchronous inside an API route handler in production
- Do not rely on Vercel Cron alone as the background jobs system; it is a trigger, not a queue
- Do not deploy everything on a Hobby/free tier with the expectation that cron works reliably at hourly or sub-hourly intervals
- Do not combine a serverless platform with a stateful always-on worker in the same process

---

## 9. Decision Matrix

| Requirement | Vercel only | Render | Railway | Fly.io + Neon | Hetzner + Coolify |
|---|---|---|---|---|---|
| Next.js web | ✅ best | ✅ good | ✅ good | ✅ good | ✅ manual |
| Long-running worker | ❌ | ✅ explicit type | ✅ persistent service | ✅ process group | ✅ Docker container |
| Cron scheduling | ⚠️ once/day (Hobby) | ✅ built-in | ✅ built-in (5 min min) | ⚠️ via supercronic | ✅ system cron |
| Managed Postgres | ✅ via marketplace | ✅ built-in | ✅ built-in | ❌ external needed | ⚠️ self-managed |
| Durable job queue | ❌ need external | ⚠️ Workflows (beta) | ❌ need pg-boss | ❌ need pg-boss | ❌ need pg-boss |
| Monthly cost (MVP) | $20+ + job platform | ~$34 | ~$30–35 | ~$30 | ~$5–7 |
| Ops burden | Very low | Low | Low | Medium | High |

---

## 10. Sources

- Vercel Cron docs: `vercel.com/docs/cron-jobs/usage-and-pricing`
- Vercel Fluid Compute changelog: `vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute`
- Vercel connection pooling guide: `vercel.com/guides/connection-pooling-with-functions`
- Vercel Workflow: `vercel.com/workflow`
- Railway pricing: `docs.railway.com/reference/pricing/plans`
- Railway cron: `docs.railway.com/guides/cron-jobs`
- Railway services: `docs.railway.com/guides/services`
- Render background workers: `render.com/docs/background-workers`
- Render cron jobs: `render.com/docs/cronjobs`
- Render pricing: `docs.render.com/pricing`
- Render Workflows: `docs.render.com/docs/workflows`
- Fly.io pricing: `fly.io/docs/pricing/`
- Fly.io process groups: `fly.io/docs/launch/processes/`
- Hetzner Cloud pricing: `hetzner.com/cloud/cost-optimized`, `hetzner.com/cloud/regular-performance`
- Hetzner price adjustment (April 2026): `docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/`
- Neon pricing: `neon.tech/pricing`
- Northflank pricing: `northflank.com/pricing`
- Inngest pricing: `inngest.com/pricing`
- Trigger.dev pricing: `trigger.dev/pricing`
- Repository files:
  - `apps/web/src/app/api/ingestion/route.ts`
  - `apps/web/src/lib/ingestion/run-ingestion.ts`
  - `apps/web/src/lib/db/index.ts`
  - `docs/background-jobs-infrastructure-research.md`
  - `docs/business-logic-job-search.md`
  - `README.md`
