# Authentication Options for Global Job Search

Status: Draft | Date: 2026-03-19

---

## 1. Why Authentication Is Needed

Authentication is not optional for this product.

- `user_profile.userId` in `apps/web/src/lib/db/schema.ts` already expects an external auth user ID.
- Future user-specific functionality depends on authenticated identity: `user_profile`, `job_match`, company submissions, and user settings.
- The business logic already assumes BYOK for Anthropic and encrypted per-user key storage.
- Internal operational routes such as `/api/seed` and `/api/ingestion` must be protected separately from normal end-user authentication.

---

## 2. Project Requirements

The authentication system should support the following requirements:

- Strong privacy guarantees for user profile data and BYOK secrets
- No plaintext secret storage
- Good fit for `Next.js App Router + Drizzle + PostgreSQL`
- Clean server-side authorization in route handlers and server components
- Support for OAuth, magic links, and future passkeys or MFA
- Reasonable migration path and minimal lock-in
- Ability to protect both user routes and internal admin or machine routes

---

## 3. Core Security Principles

There is no such thing as 100% secure authentication. The correct goal is defense in depth and strong operational security.

Regardless of the provider, the project should follow these rules:

- Never store user API keys in plaintext
- Never store user API keys in JWT payloads, cookies, or auth provider metadata
- Encrypt user secrets at rest using a dedicated encryption key or KMS-backed envelope encryption
- Prefer `HttpOnly`, `Secure`, `SameSite` cookies and server-side session validation
- Do not rely only on middleware for authorization
- Enforce authorization inside route handlers and server actions
- Protect internal operational routes with admin roles or machine credentials
- Consider PostgreSQL RLS for user-owned data
- Add step-up authentication or MFA for sensitive actions such as rotating or deleting stored API keys

---

## 4. Option Comparison

### Clerk

Type: Managed authentication platform

Best for:
- Fastest MVP on Next.js

Pros:
- Excellent Next.js developer experience
- Hosted sign-in and sign-up UI
- Built-in session handling, social auth, passkeys, MFA, and user management
- Very fast time to production

Cons:
- User identity data lives with a third-party vendor
- More vendor lock-in than self-hosted or DB-first options
- Syncing user data to the app database relies on webhooks and eventual consistency
- Less attractive if strong privacy and control are the top priorities

Project fit:
- Strong fit if MVP speed is the main priority

### Auth.js

Type: Open-source auth and session framework

Best for:
- Teams that want control and are willing to assemble more pieces

Pros:
- Open source
- Strong Next.js fit
- Official Drizzle adapter
- Flexible session strategy: JWT or database sessions
- Good control over providers, callbacks, and schema decisions

Cons:
- More integration work than Clerk
- More low-level assembly for password flows, email flows, MFA, and abuse prevention
- Easier to misconfigure than a more opinionated platform

Project fit:
- Good fit if the team wants control and accepts more auth engineering work

### Better Auth

Type: Open-source DB-first auth framework with optional paid infrastructure

Best for:
- Modern TypeScript stacks using Drizzle and PostgreSQL

Pros:
- Strong fit for `Next.js + Drizzle + PostgreSQL`
- Database-first model aligns with app-owned data
- Supports password auth, social auth, plugins, and passkeys
- Core framework can be used for free
- Optional managed dashboard and infrastructure instead of mandatory SaaS lock-in

Cons:
- Less mature ecosystem than Clerk
- More operational and security ownership stays with the app team
- Some advanced workflows still require implementation decisions

Project fit:
- One of the best overall fits for this repository

### Supabase Auth

Type: Managed auth service built around the Supabase ecosystem

Best for:
- Teams already using Supabase heavily

Pros:
- Quick setup
- Multiple auth methods
- Good story when combined with Supabase Database, RLS, and SDKs
- Can self-host GoTrue

Cons:
- The main advantage comes from the broader Supabase ecosystem
- The current project is not built on Supabase
- Adds another system without fully benefiting from the ecosystem
- Still requires custom integration with the existing Drizzle and PostgreSQL patterns

Project fit:
- Not the strongest default choice for this repository unless a broader Supabase move is planned

### ZITADEL

Type: IAM / OIDC identity provider, managed or self-hosted

Best for:
- Maximum privacy, control, and long-term identity ownership

Pros:
- Open standards: OIDC, OAuth2, PKCE
- Strong privacy and control story
- Good path to passkeys, SSO, and enterprise identity requirements
- Better fit than consumer-auth SaaS when identity ownership matters

Cons:
- More IAM complexity
- Slower setup than Clerk or Better Auth
- Higher operational burden, especially if self-hosted

Project fit:
- Strong fit if privacy, control, and long-term identity ownership are critical

---

## 5. Other Notable Options

### WorkOS AuthKit

- Good managed auth option, especially if enterprise SSO may matter later
- Probably not the best first pick for a B2C MVP like this one

### Keycloak

- Powerful and mature self-hosted IAM
- Usually too heavy unless the team already has strong IAM or Keycloak experience

---

## 6. Recommended Ranking for This Project

### Best overall fit

1. Better Auth
2. Clerk
3. ZITADEL
4. Auth.js
5. Supabase Auth

### Best by scenario

Fastest MVP:
- Clerk

Best long-term balance of control and developer experience:
- Better Auth

Strongest privacy and identity ownership:
- ZITADEL

Lowest-level flexible framework if the team wants to build more itself:
- Auth.js

---

## 7. Pricing Notes

### Better Auth

- The core framework is free and open source
- Optional managed infrastructure is paid
- This means the project can use Better Auth without mandatory subscription costs

### Clerk

- Managed service with a free tier and paid plans
- Good for quick startup, but long-term cost depends on user growth and feature usage

### Supabase Auth

- Managed pricing is MAU-based and tied to the Supabase platform model
- Best value usually comes when the rest of the stack also uses Supabase

### ZITADEL

- Managed and self-hosted models exist
- Cost depends on whether the team wants convenience or full operational control

---

## 8. Recommended Decision

If the primary goal is shipping a user-facing MVP quickly:
- Choose Clerk
- Keep only the external user ID in `user_profile.userId`
- Store all product data and encrypted user secrets in the app database

If the primary goal is balancing privacy, control, and stack fit:
- Choose Better Auth
- Use database-backed sessions
- Start with Google OAuth and magic link
- Add passkeys later if needed

If the primary goal is maximum identity control and privacy:
- Choose ZITADEL
- Use standard OIDC integration with Next.js
- Keep all product data and encrypted secrets in PostgreSQL

---

## 9. Security Requirements Regardless of Provider

- Store the user Anthropic API key encrypted at rest
- Use a dedicated encryption secret or KMS, separate from auth and session secrets
- Never expose raw API keys to the client after initial submission
- Enforce authorization in route handlers and server actions
- Add admin-only protection to internal operational routes such as `/api/seed` and `/api/ingestion`
- Log sensitive actions
- Consider RLS for user-owned tables
- Add rate limits and bot protection to auth flows
- Prefer passkeys or OAuth plus optional MFA over password-only auth

---

## 10. Final Recommendation

The best short list for this codebase is not just `Clerk + Auth.js + Supabase Auth`.

The stronger short list is:

1. Better Auth
2. Clerk
3. ZITADEL

`Auth.js` remains viable but lower-level.

`Supabase Auth` is reasonable, but not a natural fit unless the project moves deeper into the Supabase ecosystem.

---

## 11. Decision Summary

Recommended default path:
- Better Auth
- Database sessions
- Google OAuth plus magic link for MVP
- Encrypted BYOK storage in PostgreSQL
- Server-side authorization for all user and admin routes

Recommended fallback if speed matters more than control:
- Clerk

Recommended fallback if privacy and identity ownership matter more than implementation speed:
- ZITADEL

---

## 12. References

- [Clerk pricing](https://clerk.dev/pricing)
- [Clerk webhook sync guidance](https://clerk.com/docs/integrations/webhooks/sync-data)
- [Auth.js session strategies](https://authjs.dev/concepts/session-strategies)
- [Auth.js Drizzle adapter](https://authjs.dev/getting-started/adapters/drizzle)
- [Better Auth installation](https://www.better-auth.com/docs/installation)
- [Better Auth Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle)
- [Better Auth infrastructure](https://better-auth.com/products/infrastructure)
- [Supabase Auth docs](https://supabase.com/docs/guides/auth)
- [Supabase self-hosted auth](https://supabase.com/docs/reference/self-hosting-auth/introduction)
- [ZITADEL Next.js example](https://zitadel.com/docs/sdk-examples/nextjs)
- [ZITADEL passkeys](https://zitadel.com/docs/concepts/features/passkeys)
- [WorkOS pricing](https://workos.com/pricing)