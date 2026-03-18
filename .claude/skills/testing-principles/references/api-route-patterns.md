# API Route Handler Test Patterns

## Why asserting query arguments matters

A route handler's job is to translate HTTP parameters into the correct
database query. If tests only check that `mockWhere` was called N times,
any filter can silently break while tests stay green. The fix: make the
mock return identifiable tokens so you can verify WHAT was queried.

## Mock Drizzle condition builders with tokens

```ts
vi.mock("drizzle-orm", () => ({
  eq:        vi.fn((col, val) => `eq(${col},${val})`),
  ilike:     vi.fn((col, val) => `ilike(${col},${val})`),
  and:       vi.fn((...args: unknown[]) => args),
  or:        vi.fn((...args: unknown[]) => `or(${args.join(",")})`),
  isNotNull: vi.fn((col) => `isNotNull(${col})`),
  desc:      vi.fn((col) => `desc(${col})`),
  sql:       { raw: vi.fn((s: string) => s) },
}));
```

Then capture and assert on `where()` arguments:

```ts
// Weak — only proves "a query ran"
expect(mockWhere).toHaveBeenCalledTimes(2);

// Strong — proves the correct filter was applied
const whereArg = mockWhere.mock.calls[0][0];
expect(whereArg).toContain('eq(atsVendor,greenhouse)');
```

## What to test in a filter-heavy route

- Each filter parameter produces the correct condition builder call
  (`eq`, `ilike`, `isNotNull`) with the correct column and value.
- Multiple filters are combined correctly (all appear in `and(...)`).
- Missing/omitted filters do NOT produce conditions (no spurious
  `eq(column, undefined)`).
- Default conditions are always present (e.g., `status='open'`).

## What NOT to test

The internal chain sequence `select→from→innerJoin→where→orderBy` is
framework wiring, not the route's contract. If Drizzle changes its
chaining API but the query semantics stay the same, tests shouldn't break.
