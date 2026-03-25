import type { Database } from "../db";
import { roleFamilies } from "../db/schema";
import {
  seedRoleFamilies,
  ROLE_FAMILY_SEED_DATA,
} from "./seed-role-families";

// ---------------------------------------------------------------------------
// Mock DB builder -- captures .values() arguments for data assertions
// (see db-mock-patterns.md: "Track .set() / .values() arguments")
// ---------------------------------------------------------------------------

function createMockDb(opts?: {
  onConflictBehavior?: Array<"resolve" | "reject">;
}) {
  const valuesCalls: Record<string, unknown>[] = [];
  const behaviors = opts?.onConflictBehavior;

  let callIndex = 0;
  const onConflictDoNothing = vi.fn().mockImplementation(() => {
    const behavior = behaviors?.[callIndex++];
    if (behavior === "reject") {
      return Promise.reject(new Error("DB error"));
    }
    return Promise.resolve(undefined);
  });

  const values = vi.fn().mockImplementation((data: Record<string, unknown>) => {
    valuesCalls.push(data);
    return { onConflictDoNothing };
  });

  const insert = vi.fn().mockReturnValue({ values });

  return {
    db: { insert } as unknown as Database,
    valuesCalls,
    insertSpy: insert,
  };
}

// ---------------------------------------------------------------------------
// seedRoleFamilies()
// ---------------------------------------------------------------------------

describe("seedRoleFamilies", () => {
  // --- Critical scenarios ---------------------------------------------------

  test("returns zeros when given an empty array", async () => {
    const { db } = createMockDb();
    const result = await seedRoleFamilies(db, []);
    expect(result).toEqual({ inserted: 0, skipped: 0 });
  });

  test("inserts a single entry with correct field mapping from snake_case to camelCase", async () => {
    const { db, valuesCalls, insertSpy } = createMockDb();
    const entry = {
      slug: "qa_testing",
      name: "QA & Testing",
      strong_match: ["qa engineer"],
      moderate_match: ["quality engineer"],
      department_boost: ["qa"],
      department_exclude: ["finance"],
    };

    const result = await seedRoleFamilies(db, [entry]);

    expect(result).toEqual({ inserted: 1, skipped: 0 });
    expect(insertSpy).toHaveBeenCalledWith(roleFamilies);
    expect(valuesCalls[0]).toEqual({
      slug: "qa_testing",
      name: "QA & Testing",
      strongMatch: ["qa engineer"],
      moderateMatch: ["quality engineer"],
      departmentBoost: ["qa"],
      departmentExclude: ["finance"],
      isSystemDefined: true,
    });
  });

  test("counts a throwing insert as skipped, not inserted", async () => {
    const { db } = createMockDb({ onConflictBehavior: ["reject"] });

    const result = await seedRoleFamilies(db, [
      {
        slug: "fail",
        name: "Fail",
        strong_match: ["x"],
        moderate_match: ["y"],
        department_boost: ["z"],
        department_exclude: ["w"],
      },
    ]);

    expect(result).toEqual({ inserted: 0, skipped: 1 });
  });

  test("processes all entries and reports correct totals for a mixed batch", async () => {
    const { db, valuesCalls } = createMockDb({
      onConflictBehavior: ["resolve", "reject", "resolve"],
    });

    const data = [
      { slug: "a", name: "A", strong_match: ["a"], moderate_match: [], department_boost: [], department_exclude: [] },
      { slug: "b", name: "B", strong_match: ["b"], moderate_match: [], department_boost: [], department_exclude: [] },
      { slug: "c", name: "C", strong_match: ["c"], moderate_match: [], department_boost: [], department_exclude: [] },
    ];

    const result = await seedRoleFamilies(db, data);

    expect(result).toEqual({ inserted: 2, skipped: 1 });
    // All 3 entries had .values() called -- processing continued past the failure
    expect(valuesCalls).toHaveLength(3);
  });

  // --- Important scenarios --------------------------------------------------

  test("uses default ROLE_FAMILY_SEED_DATA when data parameter is omitted", async () => {
    const { db, valuesCalls } = createMockDb();

    const result = await seedRoleFamilies(db);

    expect(valuesCalls).toHaveLength(10);
    expect(result.inserted).toBe(10);
  });

  test("hardcodes isSystemDefined to true regardless of input", async () => {
    const { db, valuesCalls } = createMockDb();

    await seedRoleFamilies(db, [
      { slug: "test", name: "Test", strong_match: ["x"], moderate_match: [], department_boost: [], department_exclude: [] },
    ]);

    expect(valuesCalls[0]).toEqual(
      expect.objectContaining({ isSystemDefined: true }),
    );
  });

  test("passes empty arrays through correctly without coercing to null", async () => {
    const { db, valuesCalls } = createMockDb();

    await seedRoleFamilies(db, [
      { slug: "empty", name: "Empty", strong_match: [], moderate_match: [], department_boost: [], department_exclude: [] },
    ]);

    expect(valuesCalls[0]).toEqual(
      expect.objectContaining({
        strongMatch: [],
        moderateMatch: [],
        departmentBoost: [],
        departmentExclude: [],
      }),
    );
  });

  // --- Nice-to-have scenarios -----------------------------------------------

  test("passes through special characters in name field unchanged", async () => {
    const { db, valuesCalls } = createMockDb();

    await seedRoleFamilies(db, [
      { slug: "r_and_d", name: "R&D Engineering", strong_match: ["r&d"], moderate_match: [], department_boost: [], department_exclude: [] },
    ]);

    expect(valuesCalls[0]).toEqual(
      expect.objectContaining({ name: "R&D Engineering" }),
    );
  });

  // --- Negative / failure scenarios -----------------------------------------

  test("counts all entries as skipped when every insert fails", async () => {
    const { db } = createMockDb({
      onConflictBehavior: ["reject", "reject", "reject"],
    });

    const data = [
      { slug: "a", name: "A", strong_match: ["a"], moderate_match: [], department_boost: [], department_exclude: [] },
      { slug: "b", name: "B", strong_match: ["b"], moderate_match: [], department_boost: [], department_exclude: [] },
      { slug: "c", name: "C", strong_match: ["c"], moderate_match: [], department_boost: [], department_exclude: [] },
    ];

    const result = await seedRoleFamilies(db, data);
    expect(result).toEqual({ inserted: 0, skipped: 3 });
  });

  test("does not propagate DB errors to the caller", async () => {
    const { db } = createMockDb({ onConflictBehavior: ["reject"] });

    // Must resolve, not reject -- the function catches errors internally
    await expect(
      seedRoleFamilies(db, [
        { slug: "err", name: "Err", strong_match: ["e"], moderate_match: [], department_boost: [], department_exclude: [] },
      ]),
    ).resolves.toBeDefined();
  });

  // --- Corner case: onConflictDoNothing counting ----------------------------

  // TODO: This is a known limitation shared with seedCompanies.
  // onConflictDoNothing() resolves without error even when a conflict occurs,
  // so the function cannot distinguish "inserted new row" from "conflict, did
  // nothing". The inserted counter reports "attempted inserts without error",
  // not "actually created rows".
  test("counts both duplicate-slug entries as inserted when both resolve", async () => {
    const { db } = createMockDb({
      onConflictBehavior: ["resolve", "resolve"],
    });

    const data = [
      { slug: "same", name: "First", strong_match: ["a"], moderate_match: [], department_boost: [], department_exclude: [] },
      { slug: "same", name: "Second", strong_match: ["b"], moderate_match: [], department_boost: [], department_exclude: [] },
    ];

    const result = await seedRoleFamilies(db, data);
    expect(result).toEqual({ inserted: 2, skipped: 0 });
  });
});

// ---------------------------------------------------------------------------
// ROLE_FAMILY_SEED_DATA static array
// ---------------------------------------------------------------------------

describe("ROLE_FAMILY_SEED_DATA", () => {
  // --- Critical scenarios ---------------------------------------------------

  test("contains exactly 10 entries", () => {
    expect(ROLE_FAMILY_SEED_DATA).toHaveLength(10);
  });

  test("all slugs are unique", () => {
    const slugs = ROLE_FAMILY_SEED_DATA.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("contains all 10 required slugs from the spec", () => {
    const slugs = new Set(ROLE_FAMILY_SEED_DATA.map((e) => e.slug));
    const expected = new Set([
      "qa_testing",
      "backend",
      "frontend",
      "fullstack",
      "devops_infra",
      "data_engineering",
      "data_science",
      "product_management",
      "design",
      "engineering_management",
    ]);
    expect(slugs).toEqual(expected);
  });

  // --- Important scenarios (table-driven) -----------------------------------

  test.each(ROLE_FAMILY_SEED_DATA.map((e) => [e.slug, e] as const))(
    "%s has required fields with correct types",
    (_slug, entry) => {
      expect(entry.slug).toBeTruthy();
      expect(typeof entry.slug).toBe("string");
      expect(entry.name).toBeTruthy();
      expect(typeof entry.name).toBe("string");
      expect(Array.isArray(entry.strong_match)).toBe(true);
      expect(Array.isArray(entry.moderate_match)).toBe(true);
      expect(Array.isArray(entry.department_boost)).toBe(true);
      expect(Array.isArray(entry.department_exclude)).toBe(true);
    },
  );

  test.each(ROLE_FAMILY_SEED_DATA.map((e) => [e.slug, e] as const))(
    "%s has at least one strong_match pattern",
    (_slug, entry) => {
      expect(entry.strong_match.length).toBeGreaterThanOrEqual(1);
    },
  );

  test.each(ROLE_FAMILY_SEED_DATA.map((e) => [e.slug, e] as const))(
    "%s has at least one department_exclude pattern",
    (_slug, entry) => {
      expect(entry.department_exclude.length).toBeGreaterThanOrEqual(1);
    },
  );

  test("all pattern strings are lowercase", () => {
    const allPatterns = ROLE_FAMILY_SEED_DATA.flatMap((e) => [
      ...e.strong_match,
      ...e.moderate_match,
      ...e.department_boost,
      ...e.department_exclude,
    ]);

    for (const pattern of allPatterns) {
      expect(pattern).toBe(pattern.toLowerCase());
    }
  });

  test("no pattern strings are empty or whitespace-only", () => {
    const allPatterns = ROLE_FAMILY_SEED_DATA.flatMap((e) => [
      ...e.strong_match,
      ...e.moderate_match,
      ...e.department_boost,
      ...e.department_exclude,
    ]);

    for (const pattern of allPatterns) {
      expect(pattern.trim().length).toBeGreaterThan(0);
    }
  });

  // --- Nice-to-have scenarios -----------------------------------------------

  test.each(ROLE_FAMILY_SEED_DATA.map((e) => [e.slug, e] as const))(
    "%s has no duplicate patterns within strong_match",
    (_slug, entry) => {
      expect(new Set(entry.strong_match).size).toBe(entry.strong_match.length);
    },
  );

  test.each(ROLE_FAMILY_SEED_DATA.map((e) => [e.slug, e] as const))(
    "%s has no overlap between strong_match and moderate_match",
    (_slug, entry) => {
      const strongSet = new Set(entry.strong_match);
      const overlap = entry.moderate_match.filter((p) => strongSet.has(p));
      expect(overlap).toEqual([]);
    },
  );
});
