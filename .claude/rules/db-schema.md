---
paths:
  - "apps/web/src/lib/db/**"
  - "apps/web/drizzle/**"
description: DB schema conventions — naming, migrations, consumer updates
---

# DB Schema Conventions

## Naming

- Snake_case for DB column names, camelCase for TypeScript fields.
- Table names: singular in DB (`"company"`, `"job"`), plural for TS constants (`companies`, `jobs`).
- Primary key: `id: uuid("id").primaryKey().defaultRandom()`.
- Index naming: `{table}_{columns}_idx` (e.g., `job_status_idx`, `poll_log_company_idx`).

## Timestamps

- Pattern: `timestamp(..., { withTimezone: true }).notNull().defaultNow()`.
- Most tables have `createdAt` + `updatedAt`. Exceptions: append-only tables
  (`poll_log` uses `polledAt` instead; `company_submission` omits `updatedAt`).
- **`updatedAt` is NOT auto-updated by Drizzle.** `defaultNow()` only fires on INSERT.
  Every `.update()` call must explicitly set `updatedAt: new Date()`.

## Enum-like columns

- Use `text()` with an inline comment listing allowed values
  (e.g., `// open | stale | closed`). Do not use `pgEnum` — keeps migrations simpler.

## After changing schema

1. Run `pnpm drizzle-kit generate` to create a migration.
2. Review the generated SQL in `apps/web/drizzle/` before applying.
3. Check all consumers in `apps/web/src/` that query the modified table —
   update their select/insert/where clauses to match.
4. If a column is referenced in `packages/ats-core` types (`AllJob`, `RawJobInput`),
   keep both sides in sync. Note: `AllJob` uses snake_case field names,
   schema uses camelCase — the mapping lives in `apps/web/src/lib/ingestion/poll-company.ts`.

## Patterns

- Use `.array()` for multi-value fields (industries, skills, locations).
- Use `.jsonb()` for complex nested objects (e.g., `sourceRaw`).
- Foreign keys: `.references(() => table.id, { onDelete: "cascade" })` for required
  relationships. Nullable FKs (e.g., `resolvedCompanyId`) may omit `onDelete`
  to preserve the child row when the parent is deleted.
- Unique composite indexes for vendor+entity lookups.
- Deduplication key: `job_uid` (SHA1 of canonical URL).
- Insert deduplication: use `.onConflictDoNothing()` when inserting rows
  that may already exist (see `poll-company.ts`, `seed-companies.ts`).
