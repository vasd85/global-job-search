# BYOK API Key Storage Options

Status: Draft | Date: 2026-03-19

---

## 1. Purpose

This document evaluates implementation options for storing a user-provided API key (BYOK) in the product.

It focuses on:

- Encryption at rest
- Ownership scope
- Revocation and rotation
- Validation at input time
- Fit for the current stack: `Next.js App Router + Better Auth + Drizzle + PostgreSQL`

This document assumes the default authentication direction from `docs/authentication-options.md`:

- `Better Auth`
- Database sessions
- Encrypted BYOK storage in PostgreSQL

---

## 2. Project Context

The product already assumes:

- Per-user authenticated functionality
- Encrypted per-user secret storage
- Server-side background work that may need access to the stored key

This matters because background LLM scoring and other asynchronous flows are not compatible with designs where the server cannot decrypt the key on its own.

---

## 3. Security Requirements

Regardless of the final implementation, the system should follow these rules:

- Never store raw user API keys in plaintext
- Never store raw user API keys in JWTs, cookies, or auth provider metadata
- Encrypt secrets at the application layer before writing them to the database
- Use a dedicated encryption secret or KMS-backed key hierarchy
- Never return the raw key to the client after initial submission
- Enforce authorization in route handlers and server actions
- Add audit logging for key create, replace, validate, and revoke operations
- Require recent auth or step-up auth for sensitive actions such as key rotation or deletion

---

## 4. Option Comparison

### Option A: PostgreSQL + application-level AES-256-GCM + key from env/runtime secret store

Description:

- Encrypt the user API key inside the app before storing it in PostgreSQL
- Use `AES-256-GCM`
- Keep a dedicated `ENCRYPTION_KEY` outside the database

Pros:

- Strong fit for the current stack
- Minimal implementation complexity
- No auth-vendor lock-in
- Easy to model with Drizzle and user-owned rows
- Works well with server-side background jobs
- Good MVP path and a reasonable first production version

Cons:

- Key management is still owned by the app team
- If the application runtime is fully compromised, the attacker may decrypt stored keys
- Rotation and incident response require explicit implementation

Best fit:

- MVP
- Early production
- Teams optimizing for speed and clean architecture over infrastructure complexity

### Option B: PostgreSQL + envelope encryption via KMS or Vault

Description:

- Encrypt the API key with a per-write or per-record data encryption key
- Wrap that data key with a KMS/Vault-managed key encryption key
- Store encrypted data plus wrapped key material in PostgreSQL

Pros:

- Better separation between encrypted data and key management
- Stronger auditability and access control
- Easier long-term key rotation
- Smaller blast radius than a single app-managed secret
- Better fit for stricter security or compliance requirements

Cons:

- More infrastructure and operational work
- Extra latency and service dependency
- More moving parts than the app-managed approach

Best fit:

- Mature production environments
- Teams already using AWS KMS, GCP KMS, Azure Key Vault, or Vault
- Higher-security environments

### Option C: Store the key in auth provider metadata

Description:

- Store the user secret in a provider-managed identity object such as `Clerk privateMetadata`

Pros:

- Less app-side schema work
- Can look attractive if all user data already lives inside the auth vendor

Cons:

- Wrong abstraction for application secrets
- Increases vendor lock-in
- Access usually goes through provider APIs, which adds latency and rate-limit exposure
- Metadata is not queryable
- Metadata size and session-token limitations create design constraints
- Creates unnecessary coupling between identity storage and secret storage
- Conflicts with the preferred architecture for this project

Best fit:

- Small internal tools with very limited secret usage

Recommendation:

- Not recommended for this application

### Option D: External secret manager as the primary per-user secret store

Description:

- Store each user's API key as a record in a centralized secret manager instead of the app database

Pros:

- Strong secret lifecycle controls
- Centralized policies and audit logs
- Very good operational visibility in the right environment

Cons:

- Heavy operational overhead for per-user secret CRUD
- More expensive and harder to integrate cleanly
- Often unnecessary for a single application at this scale

Best fit:

- Organizations with an existing secret-management platform and strong compliance requirements

Recommendation:

- Usually overkill for the current stage of this product

### Option E: Client-side encryption with a user passphrase

Description:

- The app stores only ciphertext that the server cannot decrypt without additional user input

Pros:

- Strong privacy properties in some threat models
- Limits what a server compromise can immediately reveal

Cons:

- Poor fit for background jobs and server-side automation
- Worse UX
- More complex recovery and rotation flows
- Hard to use for async scoring or scheduled jobs

Best fit:

- Apps where the server must never be able to decrypt user secrets autonomously

Recommendation:

- Not a good fit for this application

---

## 5. Recommended Direction for This App

### Short version

Recommended default:

- Store BYOK in PostgreSQL
- Encrypt at the application layer with `AES-256-GCM`
- Use a dedicated versioned encryption secret separate from auth/session secrets
- Keep auth and secret storage as separate concerns

Recommended production upgrade path:

- Keep the same database model
- Move key management to `KMS` or `Vault`
- Use envelope encryption when infrastructure maturity justifies it

### Why this is the best fit

- It aligns with the chosen `Better Auth + database sessions + PostgreSQL` direction
- It keeps user-owned product data and user-owned secrets in the app data model
- It avoids coupling secrets to the auth provider
- It works naturally with server-side and async workflows
- It gives a clean migration path from simple app-managed encryption to KMS-backed encryption

---

## 6. Encryption Design Notes

Recommended baseline:

- Algorithm: `AES-256-GCM`
- Generate IVs with a cryptographically secure RNG
- Store `ciphertext`, `iv`, `auth tag`, and `keyVersion`
- Keep encryption keys separate from database data
- Do not reuse `BETTER_AUTH_SECRET` or session secrets for BYOK encryption

Recommended associated data (`AAD`):

- `userId`
- `provider`
- `credentialId`

Using `AAD` helps prevent ciphertext from being copied between records without detection.

Key management guidance:

- Use a dedicated secret such as `ENCRYPTION_KEY`
- Make it versioned from the start
- Support decrypting old records by `keyVersion`
- Re-encrypt lazily on writes or via a dedicated rotation job

Important limitation:

- Application-layer encryption protects against plaintext disclosure from the database alone
- It does not fully protect against total runtime compromise
- KMS/Vault improves this posture, but does not remove all risk

---

## 7. Ownership Scope

### Recommended scope: user account

The key should be attached to the authenticated user account, not to a session and not to a specific `user_profile`.

Why:

- The current schema already treats `userId` as the main external identity anchor
- The product currently behaves like a single-user account model, not a workspace model
- One user may have multiple sessions or devices, but should not need to manage a separate API key for each one
- Background jobs should be able to resolve the current active key by account identity

### Future extension

If the product later adds organizations or teams, the ownership model can evolve to:

- `ownerType = user | workspace`
- `ownerId`

This keeps the first version simple while leaving room for future multi-tenant expansion.

---

## 8. Revocation, Rotation, and Replacement

The system should support these operations:

- Add key
- Replace key
- Revalidate key
- Revoke key

Recommended behavior:

- Allow one active key per `userId + provider`
- Replacing a key should atomically deactivate the old key and activate the new one
- Revoking a key should make it unavailable to future jobs immediately
- Prefer deleting the stored ciphertext on revoke, while optionally keeping a metadata-only audit trail
- Sensitive operations should require recent authentication or step-up auth

Operational note:

- In-flight jobs may need a clear rule: either fail immediately on revoked credentials or continue only if the key was already loaded before revocation
- The stricter default is to stop new work from starting once the key is revoked

---

## 9. Validation Strategy

### Should the app validate the key when the user enters it?

Yes, but only on the server.

Recommended validation flow for Anthropic:

- User submits the key once over TLS
- Server performs a lightweight test request
- If valid, server encrypts and stores the key
- Server returns only validation status and masked key hint

Recommended validation request:

- `GET /v1/models`

Why:

- It is lighter than a real inference request
- It verifies that the API key is currently accepted
- It avoids unnecessary model usage costs

Expected outcomes:

- `401`: invalid key
- `402`: billing problem
- `403`: permission problem
- `429`: temporary rate limit, do not immediately mark the key as invalid

Important limitation:

Validation only proves that the key is accepted at validation time.

It does not guarantee:

- Future billing health
- Future spend-limit availability
- Future rate-limit availability
- Long-term account status

Recommended stored status fields:

- `status`
- `lastValidatedAt`
- `lastErrorCode`
- `lastErrorMessage` or normalized internal reason

Recommended product behavior:

- Validate on initial save
- Allow manual revalidation
- Revalidate automatically after repeated provider failures
- Do not aggressively invalidate a key from a single transient provider error

---

## 10. Recommended Data Model

Create a dedicated table such as `user_api_keys` or `llm_credentials`.

Suggested fields:

- `id`
- `userId`
- `provider`
- `ciphertext`
- `iv`
- `authTag`
- `keyVersion`
- `status`
- `maskedHint`
- `fingerprintHmac`
- `lastValidatedAt`
- `lastErrorCode`
- `createdAt`
- `updatedAt`
- `revokedAt`

Notes:

- `maskedHint` can store only a safe suffix or prefix for UX
- `fingerprintHmac` can help deduplicate or detect repeated submission of the same key without storing the raw key
- Do not log the raw key or decrypted key
- Do not expose the ciphertext to the client

Recommended constraint:

- One active key per `userId + provider`

---

## 11. Why Auth Provider Metadata Is Not the Right Default

Even when an auth provider offers private metadata, it is still not the right default location for BYOK in this product.

Reasons:

- Secret storage is application data, not identity data
- The current project direction is DB-first with `Better Auth`
- Accessing provider metadata adds external API dependency and rate-limit exposure
- Metadata usually has size and token-refresh constraints
- Product-owned secret lifecycle is easier to manage in the app database

Conclusion:

- Use auth providers for identity and sessions
- Use the application database for encrypted user secrets

---

## 12. Implementation Checklist

- Add a dedicated secrets table keyed by `userId`
- Encrypt with `AES-256-GCM`
- Introduce a dedicated versioned encryption secret
- Add server-side save, replace, revoke, and revalidate flows
- Validate Anthropic keys with `GET /v1/models`
- Store only masked hints and validation status for UX
- Add audit logging for secret lifecycle events
- Add recent-auth or step-up protection for rotation and deletion
- Plan an upgrade path to KMS/Vault-backed envelope encryption

---

## 13. Final Recommendation

Best default for this application:

- `Better Auth` for authentication and sessions
- `PostgreSQL` for encrypted BYOK storage
- `AES-256-GCM` for application-layer encryption
- A dedicated versioned `ENCRYPTION_KEY`
- Server-side validation on save
- User-account-level ownership

Best later upgrade:

- Keep the database design
- Move key management to `KMS` or `Vault`
- Use envelope encryption for stronger operational security

Not recommended as the primary design:

- Auth provider metadata for stored API keys
- Client-only decryptability if background jobs need the key

---

## 14. References

- [Clerk User metadata](https://clerk.com/docs/users/metadata)
- [Clerk Sync data to your app with webhooks](https://clerk.com/docs/guides/development/webhooks/syncing)
- [Better Auth Security](https://www.better-auth.com/docs/reference/security)
- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [Google Cloud KMS: Envelope encryption](https://docs.cloud.google.com/kms/docs/envelope-encryption)
- [Anthropic Models API](https://docs.anthropic.com/en/api/models)
- [Anthropic Errors](https://docs.anthropic.com/en/api/errors)
