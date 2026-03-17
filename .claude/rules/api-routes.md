---
paths:
  - "apps/web/src/app/api/**"
description: Input validation and security standards for API route handlers
---

# API Route Standards

## Input validation

- Validate and sanitize ALL query params and request body fields before use.
- Parse numeric params with `Number()` and check `isNaN()` before passing to Drizzle.
- Use Zod schemas for request bodies with more than 2 fields.
- Never pass raw user input directly into Drizzle conditions (`eq`, `ilike`, `gte`).

## Error responses

- Return structured JSON errors: `{ error: string, status: number }`.
- Never expose stack traces, internal file paths, or DB error details to clients.
- Use appropriate HTTP status codes: 400 for validation, 404 for not found, 500 for unexpected.
