---
name: Auth review patterns
description: Common findings from reviewing better-auth integration — XSS in email templates, middleware vs route handler consistency, cookie-only checks
type: project
---

First auth review (feat/add-auth) revealed recurring patterns to check:
- HTML email templates with interpolated URLs need sanitization
- Middleware cookie checks are optimistic; route handlers must re-validate server-side
- Non-null assertions on env vars crash at import time if missing
- Error handling in sendMagicLink affects whether clients get useful errors or 500s

**Why:** These are easy to miss because the code compiles and appears to work in happy-path dev.
**How to apply:** In future auth-related reviews, always check email templates for injection, env var handling, and whether middleware + route handler checks are consistent.
