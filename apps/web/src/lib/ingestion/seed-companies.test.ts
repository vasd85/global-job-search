import type { Database } from "../db";
import { companies } from "../db/schema";
import { seedCompanies, TEST_SEED_COMPANIES } from "./seed-companies";

// ---------------------------------------------------------------------------
// Mock DB builder — captures .values() arguments for data assertions
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
// seedCompanies()
// ---------------------------------------------------------------------------

describe("seedCompanies", () => {
  test("returns zeros when given an empty array", async () => {
    const { db } = createMockDb();
    const result = await seedCompanies(db, []);
    expect(result).toEqual({ inserted: 0, skipped: 0 });
  });

  test("inserts a single company with correct slug and field mapping", async () => {
    const { db, valuesCalls, insertSpy } = createMockDb();
    const entry = {
      name: "Stripe",
      ats_vendor: "greenhouse",
      ats_slug: "stripe",
      website: "https://stripe.com",
      industry: ["fintech"],
    };

    const result = await seedCompanies(db, [entry]);

    expect(result).toEqual({ inserted: 1, skipped: 0 });
    expect(insertSpy).toHaveBeenCalledWith(companies);
    expect(valuesCalls[0]).toEqual({
      slug: "greenhouse-stripe",
      name: "Stripe",
      website: "https://stripe.com",
      industry: ["fintech"],
      atsVendor: "greenhouse",
      atsSlug: "stripe",
      source: "seed_list",
    });
  });

  test("defaults website and industry to null when omitted", async () => {
    const { db, valuesCalls } = createMockDb();
    const entry = { name: "Acme", ats_vendor: "lever", ats_slug: "acme" };

    await seedCompanies(db, [entry]);

    expect(valuesCalls[0]).toEqual(
      expect.objectContaining({ website: null, industry: null }),
    );
  });

  // --- Slug normalization (table-driven) -----------------------------------

  // TODO: The slug regex `replace(/[^a-z0-9-]/g, "-")` replaces dots with
  // hyphens, which means "kraken.com" becomes "ashby-kraken-com". This may
  // cause unexpected multi-hyphen slugs or collisions. Consider whether dots
  // should be stripped instead of replaced, or whether consecutive hyphens
  // should be collapsed (e.g., "a--b" stays "a--b" today).

  test.each([
    ["uppercase vendor/slug", "GreenHouse", "Stripe", "greenhouse-stripe"],
    ["special characters replaced with hyphens", "lever", "acme.co", "lever-acme-co"],
    ["spaces become hyphens", "ashby", "my company", "ashby-my-company"],
    ["underscores become hyphens", "greenhouse", "my_slug", "greenhouse-my-slug"],
    ["dots in both parts", "ats.io", "co.uk", "ats-io-co-uk"],
    // TODO: consecutive hyphens are NOT collapsed — "a--b" stays as-is
    ["consecutive special chars produce multi-hyphens", "lever", "a..b", "lever-a--b"],
    // TODO: unicode is replaced char-by-char, producing trailing hyphens
    ["unicode characters replaced with hyphens", "greenhouse", "café", "greenhouse-caf-"],
  ])(
    "generates correct slug when input has %s",
    async (_label, vendor, slug, expectedSlug) => {
      const { db, valuesCalls } = createMockDb();
      await seedCompanies(db, [
        { name: "X", ats_vendor: vendor, ats_slug: slug },
      ]);
      expect(valuesCalls[0]).toEqual(
        expect.objectContaining({ slug: expectedSlug }),
      );
    },
  );

  // --- Error handling -------------------------------------------------------

  test("counts a throwing insert as skipped, not inserted", async () => {
    const { db } = createMockDb({ onConflictBehavior: ["reject"] });

    const result = await seedCompanies(db, [
      { name: "Fail", ats_vendor: "lever", ats_slug: "fail" },
    ]);

    expect(result).toEqual({ inserted: 0, skipped: 1 });
  });

  test("processes all entries and reports correct totals for a batch", async () => {
    const { db, valuesCalls } = createMockDb({
      onConflictBehavior: ["resolve", "reject", "resolve"],
    });

    const data = [
      { name: "A", ats_vendor: "greenhouse", ats_slug: "a" },
      { name: "B", ats_vendor: "lever", ats_slug: "b" },
      { name: "C", ats_vendor: "ashby", ats_slug: "c" },
    ];

    const result = await seedCompanies(db, data);

    expect(result).toEqual({ inserted: 2, skipped: 1 });
    expect(valuesCalls).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// TEST_SEED_COMPANIES static array
// ---------------------------------------------------------------------------

describe("TEST_SEED_COMPANIES", () => {
  test("is non-empty", () => {
    expect(TEST_SEED_COMPANIES.length).toBeGreaterThan(0);
  });

  test.each(TEST_SEED_COMPANIES.map((e) => [e.name, e] as const))(
    "%s has required fields and valid website with industry",
    (_name, entry) => {
      expect(entry.name).toBeTruthy();
      expect(entry.ats_vendor).toBeTruthy();
      expect(entry.ats_slug).toBeTruthy();
      expect(entry.website).toMatch(/^https?:\/\//);
      expect(entry.industry!.length).toBeGreaterThanOrEqual(1);
    },
  );

  test("all slugs are unique across the array", () => {
    const slugs = TEST_SEED_COMPANIES.map(
      (e) => `${e.ats_vendor}-${e.ats_slug}`,
    );
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
