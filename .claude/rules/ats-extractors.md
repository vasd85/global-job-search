---
paths:
  - "packages/ats-core/src/extractors/**"
description: ATS extractor conventions — function signature, error handling, buildJob pattern
---

# ATS Extractor Conventions

## Function signature

Every extractor exports a single async function:

```typescript
export async function extractFrom<Vendor>(context: ExtractionContext): Promise<ExtractionResult>
```

Each extractor must have a paired identifier parser in `../discovery/identifiers.ts`
(e.g., `parseGreenhouseBoardToken`, `parseLeverSite`). When creating a new extractor,
create the corresponding parser first.

## Imports

```typescript
import type { ExtractionContext, ExtractionResult } from "./extractor-types";
import { fetchJson } from "./common";
import { parse<Vendor>Identifier } from "../discovery/identifiers";
import { buildJob, dedupeJobs } from "../normalizer/job-normalizer";
```

## Vendor response interface

Define a typed interface for the vendor API response. Mark all fields except
the bare minimum as optional — vendor APIs change without notice:

```typescript
interface VendorJob {
  id?: string;
  title?: string;    // only title-like fields may be non-optional
  // ... all other fields optional
}
```

## Implementation flow

1. Parse vendor-specific identifier from `context.careersUrl` (board token, slug).
2. Early return `{ jobs: [], errors: [...] }` if parse fails — never throw.
3. Construct vendor API endpoint URL.
4. Call `fetchJson<VendorResponse>(endpoint, diagnostics, timeoutMs, maxRetries, maxAttempts?)` — `maxAttempts` is optional.
5. Destructure `{ data, error }`. If `!data` — return with error included in the message: `` `Vendor API failed (${endpoint}): ${error ?? "unknown error"}` ``.
6. Map response items to `RawJobInput` and pass to `buildJob()`.
7. Filter nulls: `.filter((job): job is NonNullable<typeof job> => job !== null)`.
8. Return deduplicated: `{ jobs: dedupeJobs(jobs), errors: [] }`.

## Error handling

- Never throw exceptions — collect errors in `errors: string[]`.
- Log HTTP failures to `diagnostics`.
- Missing optional fields are omitted, not defaulted to empty strings.

## Field mapping

### Fallback chains

When mapping vendor fields to `RawJobInput`, use `??`-chains from most specific
to least specific, ending with `null` (never empty string for optional fields):

```typescript
departmentRaw: posting.departmentName ?? posting.department ?? posting.team ?? null,
postedDateRaw: raw.first_published ?? raw.updated_at ?? null,
url: posting.hostedUrl ?? posting.applyUrl ?? "",  // url is required — fallback to ""
```

### `title` and `url` — required, validated by buildJob

`buildJob()` returns `null` (job discarded) if `title` or `url` is empty after
normalization. Passing `""` as a fallback is acceptable — the null filter in
step 7 will drop the job. Do not skip jobs before `buildJob()`.

### `detailFetchStatus` — conditional, not default

Set `"ok"` only when description content is actually present in the response.
Use `undefined` (omit) when no content was available — never default to `"ok"`:

```typescript
detailFetchStatus: posting.descriptionHtml || posting.descriptionPlain ? "ok" : undefined
```

## buildJob() call

```typescript
buildJob({
  raw: { title, url, locationRaw, departmentRaw, ... },
  sourceType: "ats_api",
  sourceRef: "<vendor-name>",   // Must match JobSourceRef type
  baseUrl: context.careersUrl,
})
```

All `RawJobInput` fields except `title` and `url` are optional/nullable.
