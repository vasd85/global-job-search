---
paths:
  - "apps/web/src/**/*.tsx"
description: React component conventions — server components by default
---

# React Component Conventions

- Server components by default. Add `"use client"` only when the component
  needs interactivity (event handlers, hooks, browser APIs).
- Prefer early returns for guard clauses and loading/error/empty states.
