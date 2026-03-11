# Code Review Guidelines

This document defines project-specific review rules for the **global-job-search**
monorepo. Claude Code and automated reviewers should treat these as additive
rules on top of general correctness checks.

## Always check

- **TypeScript strictness**
  - Avoid `any` and overly-broad types unless clearly justified.
  - Keep shared types in sync between `packages/ats-core` and `apps/web`.

- **ES modules and imports**
  - Use ES modules consistently.
  - Do not add `.js` extensions to import paths — the project uses
    `moduleResolution: "bundler"` and all code is processed by a bundler.

- **Error handling and robustness**
  - Handle failures from external services and database operations.
  - Do not swallow errors silently; either handle or log them meaningfully.

- **Security**
  - No secrets, API keys, tokens, or credentials in code or tests.
  - Validate and sanitize external input, especially in API routes.
  - Do not leak internal error details to end users.

- **Monorepo rules**
  - Changes in `packages/ats-core` must not silently break consumers in
    `apps/web`.
  - When you change shared contracts (types, shapes of objects, enums),
    ensure all callers are updated.

- **Tests**
  - Non-trivial changes in logic should be covered by tests (Vitest).
  - Prefer focused unit tests over huge integration tests at this stage.
  - Run tests from the repo root with `pnpm test` (Vitest workspace).

- **Performance**
  - No N+1 queries in API routes; use joins or batch fetches.
  - Avoid unbounded `SELECT *` without pagination or limits.
  - Watch for unnecessary re-renders in React components.

- **Accessibility**
  - Use semantic HTML elements (`<button>`, `<nav>`, `<main>`, etc.).
  - All images must have meaningful `alt` text.
  - Interactive elements must be keyboard-accessible.

## Style and architectural preferences

- **Control flow**
  - Prefer early returns over deeply nested conditionals.
  - Keep functions small and focused on a single responsibility where
    reasonable.

- **Next.js 16 and React 19**
  - Prefer server components by default in `apps/web`.
  - Mark client components explicitly with `"use client"` and only when
    interactivity is required.

- **Database access**
  - Use Drizzle ORM for new queries.
  - Avoid raw SQL unless there is a strong reason; call it out if used.

## Skip / de-emphasize

- Generated or external files:
  - Drizzle migration files under `drizzle/` that are clearly generated.
  - Lock files (`pnpm-lock.yaml`) and similar dependency artifacts.

- Pure formatting-only diffs where there is no behavioral change.

## How to report findings

Reviews happen locally via Claude Code agents. Output findings grouped by
severity:

- **Critical** — must fix before committing.
- **Warning** — should fix, but not blocking.
- **Suggestion** — nice improvement, non-blocking.

For each finding: quote the relevant code, explain **why** it is a problem,
and propose a concrete fix.

