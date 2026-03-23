---
name: BYOK crypto review patterns
description: Common findings from reviewing BYOK/encrypted-key-storage features — key reuse, race conditions, revalidation of revoked records, blanket error status codes
type: project
---

BYOK review (feat/add-byok) revealed recurring patterns to check in crypto/key-management features:

- Single master key reused for both encryption (AES-256-GCM) and HMAC — derive separate subkeys with HKDF
- Race conditions in read-then-write flows for "replace existing" operations — wrap in a single transaction with row locking
- Revalidation endpoints that don't filter by status can accidentally un-revoke records
- Catch-all error handlers returning a single HTTP status (e.g., 404 for everything) mask DB/crypto failures as not-found errors
- Stored fingerprint HMACs that include the raw secret as input are brute-forceable if master key leaks
- `maskedHint` storing last 4 chars of known-format keys narrows brute-force space

**Why:** These are subtle issues that pass type checking and work correctly in happy-path testing but create real security/correctness gaps under adversarial or concurrent conditions.
**How to apply:** In future key-management or crypto reviews, always check: key derivation separation, transactional atomicity of replace operations, status filtering in re-validation, and error handler specificity.
