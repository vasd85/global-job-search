# ATS Extractor Test Patterns

## Why extractors are thin

Extractors are wiring layers: they build an API URL, call `fetchJson`,
and map raw fields into `BuildJobArgs.raw`. The heavy logic (normalization,
dedup, URL parsing) lives in other modules that have their own tests.
Testing an extractor should reflect this — focus on what it uniquely owns.

## What to test

### 1. API URL construction

The extractor builds the correct endpoint URL from a careers URL or board
token. This is the extractor's primary job.

### 2. Field mapping with fallback chains

Raw API response fields are mapped to `BuildJobArgs.raw`. Use `test.each`
for fallback chains — this is the most compact way to cover the logic:

```ts
test.each([
  [{ departmentName: "Eng" }, "Eng"],
  [{ department: "Sales" }, "Sales"],
  [{ team: "Design" }, "Design"],
  [{}, null],
])("department fallback: %o -> %s", (input, expected) => {
  // assert mapping produces expected department value
});
```

### 3. Context forwarding

Verify `fetchJson` receives correct timeouts, retries, and diagnostics.

### 4. Error paths

- `fetchJson` returns null (API error)
- Empty job list from API
- Missing required fields in response

## What NOT to test in extractor files

These behaviors are owned by other modules — duplicating coverage here
means two test files break for a single change, with no extra safety:

- `job_uid` computation or determinism -> `job-normalizer.test.ts`
- Deduplication scoring -> `job-normalizer.test.ts`
- Board token / URL parsing -> `identifiers.test.ts`
- URL normalization, trailing-slash stripping -> `url.test.ts`

## Size guideline

~150-300 lines per extractor test file. If it's growing beyond that,
you're likely testing the wrong layer.
