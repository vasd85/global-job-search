# Research: Background Jobs Infrastructure

Status: Draft  
Date: 2026-03-19

## 1. Goal

This document evaluates background jobs infrastructure options for `global-job-search`.

The product already has one long-running async workload and is planning at least two more:

- Scheduled ATS polling for companies
- User-triggered internet expansion for discovering new companies
- Async LLM scoring for matched jobs

The current implementation is good at polling a single company and diffing jobs, but it does not yet have a production-grade job execution layer.

## 2. Current State In This Repository

### 2.1 What already exists

The current ingestion flow is implemented inside `apps/web`:

- `apps/web/src/app/api/ingestion/route.ts`
- `apps/web/src/lib/ingestion/run-ingestion.ts`
- `apps/web/src/lib/ingestion/poll-company.ts`

Current behavior:

- `POST /api/ingestion` waits synchronously for `runIngestion()`
- `runIngestion()` creates an in-memory queue and processes companies with local concurrency
- `pollCompany()` fetches ATS jobs, syncs jobs in DB, updates company poll metadata, and writes `poll_log`

### 2.2 Important observations

- The product already has a solid diff engine in `poll-company.ts`
- `pollCompany()` is reasonably safe for retries because it syncs by `ats_job_id` and writes structured poll metadata
- The orchestration layer is not durable because the queue exists only in process memory
- A full ingestion of 10 seed companies already takes about 60-90 seconds according to `README.md`

This means the current design is good for manual runs and development, but not for production scheduling.

## 3. Product Requirements For Background Jobs

Based on `docs/business-logic-job-search.md`, the product needs more than just cron:

- Scheduled corpus maintenance via ATS polling
- Ad-hoc fan-out jobs when user requests internet expansion
- Async LLM scoring after fast filtering
- Adaptive polling frequency
- Per-vendor concurrency limits
- Jitter and backoff on repeated errors
- Progress visibility for user-triggered jobs
- Durable retries outside the request lifecycle

This is not a single cron use case. It is a small job platform.

## 4. Non-Negotiable Requirements

Any serious solution for this app should support most of the following:

- Durable execution outside API request lifecycle
- Scheduling and cron
- Retries with backoff
- Fan-out jobs
- Idempotent re-processing
- Concurrency controls
- Vendor-aware throttling or rate limiting
- Observability and failure inspection
- Safe recovery after process restart or deploy
- Low operational complexity for MVP

## 5. Evaluation Of Proposed Options

## 5.1 Vercel Cron

### What it is

A scheduler that invokes Vercel Functions on a cron schedule.

### Pros

- Very easy to set up if the app is deployed on Vercel
- Native integration with Next.js deployment
- Good for simple recurring triggers
- Included in Vercel plans

### Cons

- It is only a trigger, not a full job queue or workflow engine
- Cron jobs still execute inside Vercel Functions, so function duration limits still apply
- On Hobby, cron can run only once per day and with low timing precision
- It does not solve retries, durable fan-out, queue persistence, or long-running orchestration
- Polling 1000 companies should not live inside a single function invocation

### Important correction

The current Vercel docs do not say "2 free cron jobs". Current documented limits are:

- Up to 100 cron jobs per project
- Hobby: minimum interval once per day
- Hobby precision: hourly window
- Pro: minimum interval once per minute

Function duration limits still apply:

- Hobby: up to 300s
- Pro: up to 800s

### Verdict

Good only as a top-level trigger for dispatching work. Not enough as the core background jobs system.

## 5.2 Trigger.dev

### What it is

A managed durable task platform with scheduling, retries, queues, concurrency, and observability.

### Pros

- Durable tasks with no traditional request timeout problem
- Managed workers
- Built-in retries and backoff
- Good observability
- Good support for long-running multi-step flows
- Good fit for workflows like internet expansion and LLM scoring

### Cons

- Adds an external platform dependency
- Adds usage-based cost
- Execution model is separate from the main app runtime
- Rate limiting for external APIs is less native than in some alternatives
- Requires product logic to be modeled as Trigger tasks

### Verdict

A strong managed option if external platform dependency is acceptable and the team wants good observability with low infra work.

## 5.3 Inngest

### What it is

A durable workflow and event-driven background execution platform with cron, retries, concurrency, and throttling.

### Pros

- Excellent fit for serverless apps
- Supports cron and event-driven execution
- Step-level retries
- Good fan-out model
- Concurrency keys for multi-tenant or per-resource control
- Built-in throttling, which is especially useful for ATS vendor protection
- Good fit for scheduled polling, internet expansion, and LLM scoring in one model

### Cons

- External platform dependency
- Usage-based pricing
- Requires jobs to be split into smaller event/step functions
- Free tier is limited and likely not enough for real production traffic

### Verdict

The strongest managed serverless-first option for this application.

## 5.4 BullMQ + Redis

### What it is

A Redis-backed queue and worker system for Node.js.

### Pros

- Mature and widely used
- Full control over workers, queues, retries, scheduling, and concurrency
- Strong scaling story
- Good queue-level rate limiting
- Good fit for heavier workloads at larger scale

### Cons

- Requires Redis, which the project does not currently use
- Requires separate worker infrastructure
- More moving parts than the current stack
- More operational overhead than a Postgres-native option
- Stronger fit for a dedicated async platform than for a lean MVP

### Verdict

A good long-term option if the product grows into a larger worker platform, but probably not the best MVP choice for the current stack.

## 5.5 Simple pg-based scheduler with `scheduled_jobs` table

### What it is

A custom scheduler built in application code using PostgreSQL tables and cron-triggered routes or scripts.

### Pros

- Reuses existing PostgreSQL
- Minimal external dependencies
- Full control

### Cons

- You must build job claiming, locking, retries, backoff, deduplication, failure handling, and observability yourself
- Very easy to get race conditions or duplicate execution wrong
- Turns infrastructure work into application work
- Weak long-term maintainability compared with established libraries

### Verdict

Not recommended for this product except for extremely small and temporary use cases.

## 6. Better Options Not In The Original List

## 6.1 pg-boss

### What it is

A Postgres-native job queue for Node.js with scheduling, retries, backoff, and worker support.

### Pros

- Excellent fit for current stack: PostgreSQL + Node.js
- No Redis required
- Supports cron scheduling
- Supports retries and backoff
- Supports reliable job processing with PostgreSQL locking primitives
- Keeps background infrastructure close to the existing system design
- Good MVP path without building custom queue internals

### Cons

- Requires a separate worker process or service
- Queue load and product data share the same PostgreSQL cluster
- Less workflow-oriented than managed platforms like Inngest or Trigger.dev

### Verdict

Best MVP fit for this repository.

## 6.2 Graphile Worker

### What it is

Another Postgres-native worker system with cron, retries, backfill, and named queues.

### Pros

- No Redis required
- Good reliability model
- Good cron support
- Backfill support is useful if workers are temporarily down
- Strong fit for DB-centric Node apps

### Cons

- Slightly less ergonomic for workflow-style product flows
- Less obvious observability story than managed platforms
- More queue-oriented than workflow-oriented

### Verdict

A very strong second Postgres-native option.

## 6.3 pg_cron

### What it is

A PostgreSQL extension that schedules SQL commands directly inside the database.

### Pros

- Useful for recurring SQL-based work
- Runs inside PostgreSQL
- Prevents overlapping runs of the same scheduled job
- Good as a lightweight dispatcher or maintenance scheduler

### Cons

- Not a full TypeScript job platform
- Not suitable as the main system for HTTP-heavy ATS polling, web search, or LLM workflows
- Requires DB extension support from the managed Postgres provider

### Verdict

Useful as a helper, not as the main background jobs system.

## 6.4 Upstash QStash

### What it is

A serverless HTTP-based message delivery system with retries, DLQ, and schedules.

### Pros

- Serverless-friendly
- Supports retries and DLQ
- Supports scheduling
- Good when architecture is based on invoking HTTP endpoints

### Cons

- Better for reliable delivery than for full multi-step workflow orchestration
- Less natural fit for stateful workflow logic
- More limited than Inngest or Trigger.dev for complex background pipelines

### Verdict

Interesting niche option, but not the strongest primary platform for this app.

## 6.5 Cloud Tasks / SQS + Scheduler

### What it is

Cloud-managed queues combined with scheduler services and worker consumers.

### Pros

- Very scalable
- Strong retry and queue semantics
- Good rate control
- Good separation between web app and worker platform

### Cons

- More cloud-specific infrastructure
- More operational complexity
- More setup burden than needed for current project stage

### Verdict

Good at larger scale, probably overkill for current MVP.

## 6.6 Vercel Workflow

### What it is

A durable workflow system inside the Vercel ecosystem.

### Pros

- Good Vercel integration
- Durable steps and resumable workflows
- Strong fit if the whole app is deeply Vercel-centric

### Cons

- Newer option compared with more established workflow products
- Still separate from normal request handling
- Pricing and maturity should be validated carefully before adopting it as the foundation

### Verdict

Promising, but not the first recommendation for this project right now.

## 7. Which Options Fit This App Best

The best-fit options for `global-job-search` are:

1. `pg-boss`
2. `Inngest`
3. `Trigger.dev`
4. `Graphile Worker`
5. `BullMQ + Redis`

Reasoning:

- The app already uses PostgreSQL and does not use Redis
- The workload is mostly I/O-bound, not CPU-heavy
- The app needs both scheduled and user-triggered jobs
- Polling needs durable execution plus per-vendor protection
- Internet expansion and scoring need fan-out and retries
- The current architecture would benefit from moving long-running work out of API routes without introducing unnecessary infrastructure

## 8. Recommended Architecture Paths

## 8.1 Best MVP Path

### Recommendation

Use `pg-boss` with a dedicated worker service.

### Why

- Best match for current stack
- No Redis required
- Durable jobs and scheduling without building custom scheduler logic
- Lowest operational jump from current design
- Easy to move web app and worker apart later

### Shape of the architecture

- Next.js app handles user-facing HTTP/API traffic
- Next.js app only enqueues jobs
- A separate worker service processes polling, discovery, and scoring jobs
- Scheduler triggers enqueue dispatcher jobs
- Worker applies vendor-level concurrency and retry rules
- Database remains the system of record

### Best deployment shape

- Web app on Vercel
- Worker on Railway, Render, Fly.io, or another long-lived Node host
- Shared PostgreSQL

## 8.2 Best Serverless-First Path

### Recommendation

Use `Inngest`.

### Why

- Best managed fit for cron + fan-out + async scoring
- Strong support for throttling and concurrency
- Good if the team wants to avoid running a permanent worker service

### Shape of the architecture

- Scheduled function creates batches or per-company work
- Company polling runs as separate units of work
- Internet expansion emits company discovery and initial poll events
- Scoring runs as separate fan-out jobs
- Shared throttling limits protect ATS vendors and LLM providers

## 8.3 When To Choose Trigger.dev Instead

Choose `Trigger.dev` instead of `Inngest` if the team values:

- Managed workers
- Strong run-level observability
- Durable long-running tasks
- A more task-centric model than an event-centric model

It is still a very good fit. It is simply not the top recommendation here because `Inngest` appears slightly better aligned with throttled fan-out workloads.

## 8.4 When To Choose BullMQ Instead

Choose `BullMQ + Redis` if all of the following become true:

- Background workload grows significantly
- Redis is acceptable as an infrastructure dependency
- The team wants full infra control
- The team is ready to operate dedicated workers and queue infrastructure

## 9. What Should Not Be Done

The following would be weak choices for this app:

- Keeping full ingestion inside API request handlers
- Relying on Vercel Cron alone as the background jobs system
- Building a custom `scheduled_jobs` system from scratch unless the scope stays trivial
- Treating polling, internet expansion, and scoring as unrelated systems

## 10. Final Recommendation

### Primary recommendation

Use `pg-boss` and a separate worker service.

This is the best balance of:

- stack fit
- MVP speed
- operational simplicity
- durability
- scalability for the next stage

### Secondary recommendation

If the product should remain strongly serverless-first and the team does not want to run a dedicated worker service, use `Inngest`.

### Supporting recommendation

Use `Vercel Cron` only as a dispatcher trigger if needed, not as the core background infrastructure.

## 11. Short Decision Summary

| Option | Fit For This App | Main Strength | Main Weakness | Recommendation |
|---|---|---|---|---|
| Vercel Cron | Low as core system | Simple scheduler | Not a queue or workflow system | Use only as trigger |
| Trigger.dev | High | Durable managed tasks | Extra platform and cost | Good managed option |
| Inngest | Very high | Cron + fan-out + throttling | External platform and execution pricing | Best managed option |
| BullMQ + Redis | Medium | Full control and scaling | Redis and ops overhead | Good later-stage option |
| DIY pg scheduler | Low | No new external platform | You build too much yourself | Not recommended |
| pg-boss | Very high | Best stack fit, no Redis | Needs worker service | Best MVP option |
| Graphile Worker | High | Strong Postgres-native model | Less workflow-native | Good alternative to pg-boss |
| pg_cron | Medium as helper | Lightweight scheduling | Not a full job system | Use only as helper |

## 12. Sources Used

- Vercel Cron docs
- Vercel Functions limits docs
- Trigger.dev scheduling, retry, concurrency, and pricing docs
- Inngest scheduling, concurrency, throttling, and pricing docs
- pg-boss docs
- Graphile Worker docs
- pg_cron docs
- Upstash QStash docs
- Cloud Tasks docs
- Repository files:
  - `apps/web/src/app/api/ingestion/route.ts`
  - `apps/web/src/lib/ingestion/run-ingestion.ts`
  - `apps/web/src/lib/ingestion/poll-company.ts`
  - `README.md`
  - `docs/business-logic-job-search.md`