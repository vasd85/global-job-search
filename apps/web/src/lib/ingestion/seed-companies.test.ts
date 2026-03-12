import type { Database } from "../db";
import { companies } from "../db/schema";
import { seedCompanies, TEST_SEED_COMPANIES } from "./seed-companies";

// ---------------------------------------------------------------------------
// Mock DB builder
// ---------------------------------------------------------------------------

function createMockDb(opts?: { throwOnInsert?: boolean }) {
  const onConflictDoNothing = opts?.throwOnInsert
    ? vi.fn().mockRejectedValue(new Error("DB error"))
    : vi.fn().mockResolvedValue(undefined);

  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    db: { insert } as unknown as Database,
    spies: { insert, values, onConflictDoNothing },
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
    const { db, spies } = createMockDb();
    const entry = {
      name: "Stripe",
      ats_vendor: "greenhouse",
      ats_slug: "stripe",
      website: "https://stripe.com",
      industry: ["fintech"],
    };

    const result = await seedCompanies(db, [entry]);

    expect(result).toEqual({ inserted: 1, skipped: 0 });
    expect(spies.insert).toHaveBeenCalledWith(companies);
    expect(spies.values).toHaveBeenCalledWith({
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
    const { db, spies } = createMockDb();
    const entry = { name: "Acme", ats_vendor: "lever", ats_slug: "acme" };

    await seedCompanies(db, [entry]);

    expect(spies.values).toHaveBeenCalledWith(
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
    // TODO: consecutive hyphens are NOT collapsed — "a--b" stays as-is
    ["dots in both parts", "ats.io", "co.uk", "ats-io-co-uk"],
  ])(
    "generates correct slug when input has %s",
    async (_label, vendor, slug, expectedSlug) => {
      const { db, spies } = createMockDb();
      await seedCompanies(db, [
        { name: "X", ats_vendor: vendor, ats_slug: slug },
      ]);
      expect(spies.values).toHaveBeenCalledWith(
        expect.objectContaining({ slug: expectedSlug }),
      );
    },
  );

  // --- Error handling -------------------------------------------------------

  test("counts a throwing insert as skipped, not inserted", async () => {
    const { db } = createMockDb({ throwOnInsert: true });

    const result = await seedCompanies(db, [
      { name: "Fail", ats_vendor: "lever", ats_slug: "fail" },
    ]);

    expect(result).toEqual({ inserted: 0, skipped: 1 });
  });

  test("processes all entries and reports correct totals for a batch", async () => {
    // Build a mock where the second insert throws
    const onConflict = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce(undefined);

    const values = vi.fn().mockReturnValue({ onConflictDoNothing: onConflict });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as Database;

    const data = [
      { name: "A", ats_vendor: "greenhouse", ats_slug: "a" },
      { name: "B", ats_vendor: "lever", ats_slug: "b" },
      { name: "C", ats_vendor: "ashby", ats_slug: "c" },
    ];

    const result = await seedCompanies(db, data);

    expect(result).toEqual({ inserted: 2, skipped: 1 });
    expect(insert).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// TEST_SEED_COMPANIES static array
// ---------------------------------------------------------------------------

describe("TEST_SEED_COMPANIES", () => {
  test("contains exactly 10 entries", () => {
    expect(TEST_SEED_COMPANIES).toHaveLength(10);
  });

  test("every entry has the required name, ats_vendor, and ats_slug fields", () => {
    for (const entry of TEST_SEED_COMPANIES) {
      expect(entry.name).toBeTruthy();
      expect(entry.ats_vendor).toBeTruthy();
      expect(entry.ats_slug).toBeTruthy();
    }
  });

  test("every entry has a website and at least one industry tag", () => {
    for (const entry of TEST_SEED_COMPANIES) {
      expect(entry.website).toMatch(/^https?:\/\//);
      expect(entry.industry!.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("all slugs are unique across the array", () => {
    const slugs = TEST_SEED_COMPANIES.map(
      (e) => `${e.ats_vendor}-${e.ats_slug}`,
    );
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
