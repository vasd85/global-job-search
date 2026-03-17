---
paths:
  - "apps/web/src/**"
  - "packages/ats-core/src/**"
description: Security baseline — no secrets in source, no leaked internals
---

# Security Baseline

- No hardcoded API keys, tokens, passwords, or connection strings in source files.
  Use environment variables via `process.env` for all credentials.
- Do not log or persist secrets, tokens, or full request bodies containing credentials.
