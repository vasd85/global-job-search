# React Component Test Patterns

## General approach

Use React Testing Library: `render(...)`, `screen.getBy*` / `findBy*`,
and `userEvent` for interactions. Test from the user's perspective —
what they see and do, not what hooks fire internally.

## What to test in a component

Focus on **user-visible outcomes**:

- **UI states:** loading indicator appears/disappears, error message
  shows on failure, empty state renders when no data.
- **User interactions -> visible effects:** typing in search -> correct
  API call + results render; clicking pagination -> new page shows.
- **Async failure paths:** fetch rejects -> component doesn't crash.
  This is mandatory (see principle #6 in SKILL.md).
- **Conditional rendering:** optional fields omitted when null,
  fallback values used when primary is missing.

Avoid testing:
- Debounce timer internals (exact ms values, number of re-renders).
  Test the outcome: "rapid typing -> single fetch with final value".
- That `useCallback` or `useEffect` were called. Test what the user sees.

## `test.each` for interaction variations

When a component has multiple filters or conditional fields that follow
the same test pattern, collapse them:

```ts
// Instead of 5 nearly-identical test blocks for 5 filters:
test.each([
  ["search",        "input",  "engineer",  "search=engineer"],
  ["workplaceType", "select", "remote",    "workplaceType=remote"],
  ["vendor",        "select", "greenhouse","vendor=greenhouse"],
])("%s filter triggers fetch with %s in query",
  async (name, type, value, expected) => {
    // interact with the control, assert fetch URL contains expected param
  }
);
```

Also use `test.each` for nullable/optional field rendering in cards.

## Size guideline

A test file for a **single complex component** (with state, fetch,
pagination) should be ~200-400 lines. If it exceeds 500 lines:
- Extract shared helpers into a separate test-utils file.
- Split sub-components (e.g., `JobCard`) into their own test files.
- Check if `test.each` can replace repeated blocks.
