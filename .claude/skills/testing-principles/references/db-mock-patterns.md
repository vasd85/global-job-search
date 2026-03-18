# DB Mock Patterns (Drizzle ORM)

## Why real semantics matter

A mock that always returns `undefined` proves "the code didn't crash", not
"the code did the right thing". Drizzle operations like
`insert().values().onConflictDoNothing()` have distinct outcomes (inserted
vs conflict-skipped), and the code under test often branches on that
distinction. If the mock hides it, the test can't catch the bug.

## Track `.set()` / `.values()` arguments

Capture what the code writes so assertions can verify the **data**, not
just the call count:

```ts
const setCalls: Record<string, unknown>[] = [];
const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn((data) => {
    setCalls.push(data);
    return { where: vi.fn().mockResolvedValue(undefined) };
  }),
});
```

Then assert on `setCalls`:

```ts
// Weak — only proves "something was written"
expect(updateFn).toHaveBeenCalled();

// Strong — proves the correct data was written
expect(setCalls[0]).toEqual(expect.objectContaining({
  lastPollStatus: "error",
  lastPollError: "Connection timeout",
}));
```

## Model insert-vs-conflict

When testing code that counts inserts, the mock should let you distinguish
outcomes:

```ts
let insertCount = 0;
const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({
    onConflictDoNothing: vi.fn().mockReturnValue({
      returning: vi.fn().mockImplementation(() => {
        // Return empty array for conflicts, populated for real inserts
        return Promise.resolve(insertCount++ < 2 ? [{ id: 1 }] : []);
      }),
    }),
  }),
});
```

## Test the core contract first

Before edge cases, ask: "What is the ONE thing this function exists to do?"
Write that test first:

- `seedCompanies` — "skips duplicates by (vendor, slug)"
- `syncCompanyJobs` — "inserts new jobs, updates changed, closes stale"
- `pollCompany` — "returns correct status with persisted metadata"
