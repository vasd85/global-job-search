// @vitest-environment node

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const { dbSelectMock, expandMock } = vi.hoisted(() => {
  const dbSelectMock = vi.fn();
  const expandMock = vi.fn();
  return { dbSelectMock, expandMock };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: dbSelectMock,
    })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  synonymGroup: "synonym_group_table_token",
}));

vi.mock("@gjs/ats-core", () => ({
  expandTerms: expandMock,
}));

import { expandTerms, invalidateSynonymCache } from "./synonym-cache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSynonymRow(overrides: Record<string, unknown> = {}) {
  return {
    dimension: "industry",
    canonical: "crypto",
    synonyms: ["crypto", "cryptocurrency"],
    umbrellaKey: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  invalidateSynonymCache();
  expandMock.mockImplementation(
    (_groups: unknown[], terms: string[]) => terms,
  );
});

// ---------------------------------------------------------------------------
// Cache Loading (Critical)
// ---------------------------------------------------------------------------

describe("synonym-cache -- cache loading", () => {
  test("first call loads synonym groups from the DB and caches them", async () => {
    const industryRow = makeSynonymRow();
    const skillRow = makeSynonymRow({
      dimension: "skill",
      canonical: "python",
      synonyms: ["python", "py"],
    });
    dbSelectMock.mockResolvedValueOnce([industryRow, skillRow]);
    expandMock.mockReturnValue(["crypto", "cryptocurrency"]);

    const result = await expandTerms("industry", ["crypto"]);

    // DB queried exactly once
    expect(dbSelectMock).toHaveBeenCalledTimes(1);
    // ats-core expand receives ONLY industry groups, not skill groups
    expect(expandMock).toHaveBeenCalledWith(
      [{ canonical: "crypto", synonyms: ["crypto", "cryptocurrency"], umbrellaKey: null }],
      ["crypto"],
    );
    expect(result).toEqual(["crypto", "cryptocurrency"]);
  });

  test("second call returns cached data without hitting the DB", async () => {
    const row = makeSynonymRow();
    dbSelectMock.mockResolvedValueOnce([row]);
    expandMock.mockReturnValue(["crypto", "cryptocurrency"]);

    const result1 = await expandTerms("industry", ["crypto"]);
    const result2 = await expandTerms("industry", ["crypto"]);

    // DB queried only once, not twice
    expect(dbSelectMock).toHaveBeenCalledTimes(1);
    expect(result1).toEqual(result2);
  });

  test("invalidateSynonymCache clears cache, forcing reload on next call", async () => {
    // First load
    const row1 = makeSynonymRow({ synonyms: ["crypto", "cryptocurrency"] });
    dbSelectMock.mockResolvedValueOnce([row1]);
    expandMock.mockReturnValueOnce(["crypto", "cryptocurrency"]);

    await expandTerms("industry", ["crypto"]);

    // Invalidate
    invalidateSynonymCache();

    // Second load returns different data
    const row2 = makeSynonymRow({
      synonyms: ["crypto", "cryptocurrency", "bitcoin"],
    });
    dbSelectMock.mockResolvedValueOnce([row2]);
    expandMock.mockReturnValueOnce(["crypto", "cryptocurrency", "bitcoin"]);

    const result = await expandTerms("industry", ["crypto"]);

    // DB queried twice (once per load)
    expect(dbSelectMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual(["crypto", "cryptocurrency", "bitcoin"]);
  });

  test("unknown dimension returns empty groups array to ats-core", async () => {
    const row = makeSynonymRow({ dimension: "industry" });
    dbSelectMock.mockResolvedValueOnce([row]);
    expandMock.mockImplementation(
      (_groups: unknown[], terms: string[]) => terms,
    );

    const result = await expandTerms("nonexistent_dimension", ["anything"]);

    // ats-core expand receives empty groups array (fallback from ?? [])
    expect(expandMock).toHaveBeenCalledWith([], ["anything"]);
    // Passthrough: unknown terms return unchanged
    expect(result).toEqual(["anything"]);
  });
});

// ---------------------------------------------------------------------------
// Error Handling (Important)
// ---------------------------------------------------------------------------

describe("synonym-cache -- error handling", () => {
  test("DB query failure on first load propagates as rejection", async () => {
    dbSelectMock.mockRejectedValueOnce(new Error("connection refused"));

    await expect(
      expandTerms("industry", ["crypto"]),
    ).rejects.toThrow("connection refused");
  });

  test("DB failure does not poison the cache -- retry works after invalidation", async () => {
    // First call: DB fails
    dbSelectMock.mockRejectedValueOnce(new Error("connection refused"));

    await expect(
      expandTerms("industry", ["crypto"]),
    ).rejects.toThrow("connection refused");

    // Cache should still be null (not set to empty Map).
    // Second call should hit DB again without needing explicit invalidation,
    // because cache was never set.
    const row = makeSynonymRow();
    dbSelectMock.mockResolvedValueOnce([row]);
    expandMock.mockReturnValue(["crypto", "cryptocurrency"]);

    const result = await expandTerms("industry", ["crypto"]);

    expect(dbSelectMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual(["crypto", "cryptocurrency"]);
  });

  test("empty DB table results in empty cache (not null) -- no re-query", async () => {
    dbSelectMock.mockResolvedValueOnce([]);
    expandMock.mockImplementation(
      (_groups: unknown[], terms: string[]) => terms,
    );

    const result1 = await expandTerms("industry", ["crypto"]);

    // ats-core receives empty groups
    expect(expandMock).toHaveBeenCalledWith([], ["crypto"]);
    expect(result1).toEqual(["crypto"]);

    // Second call should NOT query DB again (cache is set, just empty)
    const result2 = await expandTerms("industry", ["crypto"]);

    expect(dbSelectMock).toHaveBeenCalledTimes(1);
    expect(result2).toEqual(["crypto"]);
  });
});

// ---------------------------------------------------------------------------
// Dimension Partitioning (Important)
// ---------------------------------------------------------------------------

describe("synonym-cache -- dimension partitioning", () => {
  test("multiple dimensions are correctly partitioned in a single DB load", async () => {
    const industryRow = makeSynonymRow({
      dimension: "industry",
      canonical: "crypto",
      synonyms: ["crypto", "cryptocurrency"],
    });
    const skillRow = makeSynonymRow({
      dimension: "skill",
      canonical: "python",
      synonyms: ["python", "py"],
    });
    dbSelectMock.mockResolvedValueOnce([industryRow, skillRow]);

    // Call with "industry" dimension
    await expandTerms("industry", ["crypto"]);
    expect(expandMock).toHaveBeenCalledWith(
      [{ canonical: "crypto", synonyms: ["crypto", "cryptocurrency"], umbrellaKey: null }],
      ["crypto"],
    );

    // Call with "skill" dimension -- same cache, no new DB query
    await expandTerms("skill", ["python"]);
    expect(expandMock).toHaveBeenCalledWith(
      [{ canonical: "python", synonyms: ["python", "py"], umbrellaKey: null }],
      ["python"],
    );

    // Only one DB query total
    expect(dbSelectMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Corner Cases
// ---------------------------------------------------------------------------

describe("synonym-cache -- corner cases", () => {
  test("invalidateSynonymCache called before any load is a no-op", () => {
    // Should not throw
    invalidateSynonymCache();
    invalidateSynonymCache();
  });

  test("DB returns rows with empty synonyms array does not crash", async () => {
    const row = makeSynonymRow({
      canonical: "test",
      synonyms: [],
    });
    dbSelectMock.mockResolvedValueOnce([row]);
    expandMock.mockImplementation(
      (_groups: unknown[], terms: string[]) => terms,
    );

    const result = await expandTerms("industry", ["test"]);

    // The group is loaded with empty synonyms -- no crash
    expect(expandMock).toHaveBeenCalledWith(
      [{ canonical: "test", synonyms: [], umbrellaKey: null }],
      ["test"],
    );
    expect(result).toEqual(["test"]);
  });

  test("DB returns rows with null synonyms -- documents behavior", async () => {
    // The DB schema defines synonyms as NOT NULL, but test the runtime guard.
    // The code does `cache.get(dim)!.push({ synonyms: row.synonyms })`.
    // With null synonyms, the group is stored with null, and ats-core
    // expandTerms would crash when iterating `group.synonyms`.
    const row = makeSynonymRow({
      canonical: "test",
      synonyms: null,
    });
    dbSelectMock.mockResolvedValueOnce([row]);

    // The cache loading itself should NOT crash (it just stores the value).
    // The crash would happen in ats-core when iterating null synonyms.
    // Since we mock ats-core, we just verify the group is passed as-is.
    expandMock.mockReturnValue(["test"]);

    const result = await expandTerms("industry", ["test"]);

    expect(expandMock).toHaveBeenCalledWith(
      [{ canonical: "test", synonyms: null, umbrellaKey: null }],
      ["test"],
    );
    // TODO: The code has no runtime guard for null synonyms. The DB schema
    // prevents this (NOT NULL), but a corrupted row would pass null to
    // ats-core expandTerms, which would crash on `for (const synonym of group.synonyms)`.
    expect(result).toEqual(["test"]);
  });

  test("concurrent first calls both execute DB queries (documenting race)", async () => {
    // The implementation has no deduplication lock. Two concurrent calls
    // where cache is null will both execute the DB query.
    let resolveFirst!: (value: unknown[]) => void;
    let resolveSecond!: (value: unknown[]) => void;

    const firstPromise = new Promise<unknown[]>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise<unknown[]>((resolve) => {
      resolveSecond = resolve;
    });

    dbSelectMock.mockReturnValueOnce(firstPromise);
    dbSelectMock.mockReturnValueOnce(secondPromise);
    expandMock.mockReturnValue(["crypto"]);

    // Start both calls before either resolves
    const call1 = expandTerms("industry", ["crypto"]);
    const call2 = expandTerms("skill", ["python"]);

    // Resolve both
    const row = makeSynonymRow();
    resolveFirst([row]);
    resolveSecond([row]);

    await call1;
    await call2;

    // TODO: consider deduplicating concurrent cache loads. Both calls
    // execute the DB query since cache is null when they start. This is
    // not a correctness bug (both produce the same result), but wastes
    // one DB round-trip.
    expect(dbSelectMock).toHaveBeenCalledTimes(2);
  });
});
