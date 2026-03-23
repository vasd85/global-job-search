---
name: testing-principles
description: >-
  Core testing principles and project-specific test patterns for the
  global-job-search monorepo. Preloaded into test-writer and code-reviewer
  subagents. Use this skill whenever writing tests, reviewing test code,
  evaluating test coverage, or deciding how to mock dependencies — even if
  the user doesn't explicitly mention testing conventions.
user-invocable: false
---

# Testing Principles

This skill is the single source of truth for testing conventions in the
global-job-search monorepo. It covers universal principles (applicable to
all test files) and project-specific patterns (in `references/`).

## Core Principles

### 1. Test the contract, not the implementation

Tests verify **what** a function promises, not **how** it achieves it.
This matters because implementations change during refactoring — if tests
are coupled to internals, every refactor breaks tests without any real
regression.

- Describe expected behavior from the caller's perspective in test names.
  Never reference internal code structure (e.g., "comes first in the code",
  "uses indexOf internally").
- If current behavior looks potentially buggy (e.g., a generic fallback
  when a field is missing), write the test but add `// TODO:` explaining
  why the behavior may be wrong. Don't silently enshrine bugs as the
  expected contract.

### 2. Adversarial negative testing

For any code that does string matching, URL parsing, domain validation,
or pattern recognition — false positives are the biggest risk. A function
that matches too broadly can silently accept bad input for months before
anyone notices.

- When code uses `string.includes(substring)`, write tests for boundary
  false positives. Example: if code checks `host.includes("greenhouse.io")`,
  test that `notgreenhouse.io` and `greenhouse.io.evil.com` are correctly
  rejected (or flag that they're accepted).
- For URL/identifier parsing, test adversarial inputs: look-alike domains,
  extra path segments, URL-encoded characters, protocol-relative URLs.
- For every positive pattern match, include at least one crafted near-miss
  that should **not** match.

### 3. Respect module boundaries

Before writing any test, answer: **"What is this module's own job?"**
Only test logic inside the module. Duplicating coverage from a dependency
means two test files break for a single change, with no extra safety.

If another module's test suite already covers a behavior, mock or accept
the dependency's output and focus on the current module's unique logic.

**Size guideline:** a test file for a thin wrapper/mapper should be
~150-300 lines, not 600+. If growing beyond that, you're likely testing
the wrong layer.

### 4. Every test name must be earned by its assertions

If a test is named "shows loading indicator", the assertions **must** query
the DOM for the loading element. A test that only checks `fetch` call count
does not earn that name — it creates false confidence that the UI works.

Before writing a test, state the contract it defends in plain English.
If assertions don't prove that contract, either strengthen assertions or
rename the test honestly.

### 5. Deterministic test data

Flaky tests erode trust in the entire suite. Common sources of
non-determinism:

- **Dates:** Never use midnight UTC (`T00:00:00Z`) for values formatted
  with `toLocaleDateString()` — midnight UTC becomes the previous day in
  negative-offset timezones. Use midday: `T12:00:00Z`.
- **Locale strings:** If code uses locale formatting, either mock the
  locale or assert with a regex accepting both `Jul 15` and `15 Jul`.
- **`Date.now()` / `new Date()`:** Always use `vi.setSystemTime()` or
  pass explicit timestamps. Never rely on "current time" in assertions.

### 6. Always test async failure paths

For any function/component calling `fetch`, a database, or an external
service — test at least one failure case. This catches missing error
handling before users hit it.

- `fetch` rejects (network error)
- `fetch` returns non-OK status (500, 404)
- Response body is not valid JSON

If the code lacks error handling, write the test that proves the broken
behavior and add `// TODO:` explaining the gap. This makes the issue
discoverable, not silently skipped.

### 7. Table-driven tests (`test.each`)

When 2+ tests in a `describe` call the same function with the same
matcher and only input/expected differ, replace them with `test.each`.
The goal: reduce total lines while maintaining coverage clarity.

"Same assertion shape" means same function + same matcher, not visually
identical code. Tests can differ in setup details — if the core is
`expect(fn(input)).toX(expected)`, that's one shape.

**Typing rule:** when `test.each` values feed a function accepting a
narrow type (union, enum), cast the array or use a generic to preserve
type safety:

```ts
test.each<[AtsVendor]>([["greenhouse"], ["lever"]])(
  "returns true for %s",
  (vendor) => { expect(isKnownAtsVendor(vendor)).toBe(true); },
);
```

**Where to look:** vendor lists, URL pattern sets, guard clauses
(null/undefined/empty), enum-like checks, filter variations, nullable
field rendering. Each logical group -> one `test.each`.

### 8. Flag bugs, don't enshrine them

If behavior looks wrong, write the test but add `// TODO:` explaining the
issue and what the correct behavior might be. This surfaces the problem
for future developers without silently accepting it as correct.

### 9. Test effects, not mechanisms

Verify what the caller observes, not which internal helper was called.
This is the practical application of principle #1.

```ts
// Implementation-bound: breaks if hash function changes
expect(mockSha256).toHaveBeenCalledWith("Some description");

// Contract-based: proves content-change detection works
// Feed two polls with different descriptions -> assert jobsUpdated = 1
```

**Query builder corollary:** `expect(mockWhere).toHaveBeenCalledTimes(2)`
proves "a query ran" but not "the correct filter was applied". Capture and
assert the arguments instead.

### 10. Mock real semantics

DB mocks must model real operation outcomes, not just "not fail". A mock
for `insert().onConflictDoNothing()` should distinguish "inserted new row"
from "conflict — did nothing". Assert `.set()` / `.values()` arguments,
not just call counts — `expect(mock).toHaveBeenCalled()` only proves
"something ran", not "the correct data was written".

For detailed mock patterns with code examples, see
`references/db-mock-patterns.md`.

### 11. E2E testing for user-facing changes

UI changes require at least one e2e or integration test that verifies
the user flow end-to-end — not just that a component renders, but that
the full action-to-outcome chain works.

- **UI changes:** test the user flow: navigate → interact → verify outcome.
  Use React Testing Library for component-level integration, or browser
  automation (Playwright) for full e2e.
- **API changes:** test with real request/response cycles — call the route
  handler with a constructed `Request`, assert response status and body
  shape.
- **Pattern:** setup state → perform action → assert visible outcome (not
  internal state). If the test doesn't exercise the same code path a real
  user would trigger, it's not an integration test.

### 12. Corner case identification heuristics

Before writing tests, systematically check these categories for each
function or endpoint under test:

- **Boundary values:** 0, 1, -1, MAX_SAFE_INTEGER, empty string `""`,
  single character, very long strings (1000+ chars), null, undefined.
- **Type coercion traps:** `"0"`, `"false"`, `"null"`, `"undefined"` as
  strings — JavaScript coercion can silently accept these.
- **Unicode and special characters:** emoji in text fields, RTL characters,
  zero-width spaces, HTML entities, SQL-significant characters (`'`, `;`).
- **Concurrent access:** if the code reads-then-writes shared state, test
  what happens with overlapping operations.
- **Pagination edge cases:** page 0, page -1, page beyond total, page
  size 0, empty result set, exactly one page of results.
- **Timezone sensitivity:** operations on dates near midnight UTC, DST
  transitions, date formatting across locales.
- **Empty collections:** zero results, zero matches, empty arrays passed
  to functions expecting data.

Not every function needs every category. Focus on categories relevant to
the function's inputs and domain.

## Project-Specific Patterns

Detailed code examples and patterns are in `references/`. Read the
relevant file when working on that domain:

| Domain | Reference file | When to read |
|--------|---------------|--------------|
| Drizzle ORM mocks | `references/db-mock-patterns.md` | Writing tests that mock database operations |
| API route handlers | `references/api-route-patterns.md` | Testing `apps/web/src/app/api/` routes |
| React components | `references/component-patterns.md` | Testing `apps/web/src/components/` |
| ATS extractors | `references/extractor-patterns.md` | Testing `packages/ats-core/src/extractors/` |
