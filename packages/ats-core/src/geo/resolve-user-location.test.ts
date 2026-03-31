import { resolveTierGeo, resolveAllTiers } from "./resolve-user-location";
import type { LocationPreferenceTierInput } from "./resolve-user-location";

/** Create a minimal tier input with sensible defaults. */
function makeTier(
  overrides: Partial<LocationPreferenceTierInput> = {},
): LocationPreferenceTierInput {
  return {
    rank: 1,
    workFormats: ["remote"],
    scope: { type: "any", include: [] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveTierGeo() -- scope type "any"
// ---------------------------------------------------------------------------

describe("resolveTierGeo -- scope any", () => {
  test('scope type "any" returns isAny=true with empty sets', () => {
    const result = resolveTierGeo(
      makeTier({ scope: { type: "any", include: [] } }),
    );
    expect(result.isAny).toBe(true);
    expect(result.resolvedCountryCodes.size).toBe(0);
    expect(result.resolvedCityNames.size).toBe(0);
    expect(result.excludedCountryCodes.size).toBe(0);
    expect(result.unresolvedEntries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveTierGeo() -- scope type "countries"
// ---------------------------------------------------------------------------

describe("resolveTierGeo -- scope countries", () => {
  test("resolves valid country names to country codes", () => {
    const result = resolveTierGeo(
      makeTier({
        workFormats: ["remote", "hybrid"],
        scope: { type: "countries", include: ["Germany", "France"] },
      }),
    );
    expect(result.resolvedCountryCodes.has("DE")).toBe(true);
    expect(result.resolvedCountryCodes.has("FR")).toBe(true);
  });

  test("falls back to region lookup when country name is a region", () => {
    const result = resolveTierGeo(
      makeTier({
        scope: { type: "countries", include: ["EU"] },
      }),
    );
    // "EU" is not a country name, but lookupRegion("EU") resolves.
    // All 27 EU member country codes should be in resolvedCountryCodes.
    expect(result.resolvedCountryCodes.size).toBe(27);
    expect(result.resolvedCountryCodes.has("DE")).toBe(true);
    expect(result.resolvedCountryCodes.has("FR")).toBe(true);
  });

  test("unresolved entry is preserved in unresolvedEntries", () => {
    const result = resolveTierGeo(
      makeTier({
        scope: { type: "countries", include: ["Narnia"] },
      }),
    );
    expect(result.resolvedCountryCodes.size).toBe(0);
    expect(result.unresolvedEntries).toContain("Narnia");
  });

  test("multiple entries: some resolved, some not", () => {
    const result = resolveTierGeo(
      makeTier({
        scope: { type: "countries", include: ["Germany", "Narnia", "UK"] },
      }),
    );
    expect(result.resolvedCountryCodes.has("DE")).toBe(true);
    expect(result.resolvedCountryCodes.has("GB")).toBe(true);
    expect(result.unresolvedEntries).toContain("Narnia");
  });

  test("empty include list results in empty resolved sets", () => {
    const result = resolveTierGeo(
      makeTier({
        scope: { type: "countries", include: [] },
      }),
    );
    expect(result.resolvedCountryCodes.size).toBe(0);
    expect(result.unresolvedEntries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveTierGeo() -- scope type "regions"
// ---------------------------------------------------------------------------

describe("resolveTierGeo -- scope regions", () => {
  test("resolves valid region to member country codes", () => {
    const result = resolveTierGeo(
      makeTier({
        scope: { type: "regions", include: ["DACH"] },
      }),
    );
    expect(result.resolvedCountryCodes.has("DE")).toBe(true);
    expect(result.resolvedCountryCodes.has("AT")).toBe(true);
    expect(result.resolvedCountryCodes.has("CH")).toBe(true);
  });

  test("falls back to country lookup when region name is a country", () => {
    const result = resolveTierGeo(
      makeTier({
        scope: { type: "regions", include: ["Germany"] },
      }),
    );
    // "Germany" is not a region name, but lookupCountry("Germany") resolves to "DE"
    expect(result.resolvedCountryCodes.has("DE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTierGeo() -- scope type "timezones"
// ---------------------------------------------------------------------------

describe("resolveTierGeo -- scope timezones", () => {
  test("resolves timezone group to member country codes", () => {
    const result = resolveTierGeo(
      makeTier({
        scope: { type: "timezones", include: ["est"] },
      }),
    );
    expect(result.resolvedCountryCodes.has("US")).toBe(true);
    expect(result.resolvedCountryCodes.has("CA")).toBe(true);
    expect(result.resolvedCountryCodes.has("MX")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTierGeo() -- scope type "cities"
// ---------------------------------------------------------------------------

describe("resolveTierGeo -- scope cities", () => {
  test("resolves city name to resolvedCityNames", () => {
    const result = resolveTierGeo(
      makeTier({
        scope: { type: "cities", include: ["Berlin"] },
      }),
    );
    expect(result.resolvedCityNames.has("berlin")).toBe(true);
    // NOTE: City scope does NOT add the country code to resolvedCountryCodes.
    // This is by design -- city-scoped tiers should not leak to country-wide matching.
    expect(result.resolvedCountryCodes.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveTierGeo() -- Exclusion handling
// ---------------------------------------------------------------------------

describe("resolveTierGeo -- exclusions", () => {
  test("EU excluding Cyprus: 26 countries, CY excluded", () => {
    const result = resolveTierGeo(
      makeTier({
        scope: {
          type: "regions",
          include: ["EU"],
          exclude: ["Cyprus"],
        },
      }),
    );
    // EU has 27 members. Excluding CY leaves 26.
    expect(result.excludedCountryCodes.has("CY")).toBe(true);
    // CY should be subtracted from resolvedCountryCodes
    expect(result.resolvedCountryCodes.has("CY")).toBe(false);
    expect(result.resolvedCountryCodes.size).toBe(26);
  });

  test("city exclusion adds excluded city's country to excludedCountryCodes", () => {
    const result = resolveTierGeo(
      makeTier({
        scope: {
          type: "cities",
          include: ["Berlin", "Paris"],
          exclude: ["Berlin"],
        },
      }),
    );
    // Excluding Berlin adds DE to excludedCountryCodes
    expect(result.excludedCountryCodes.has("DE")).toBe(true);
    // TODO: City exclusion removes the city's COUNTRY, not just the city.
    // This means excluding Berlin removes ALL of Germany, which is
    // potentially overly broad. Users might expect only Berlin to be
    // excluded, not Munich or Frankfurt.
  });
});

// ---------------------------------------------------------------------------
// resolveAllTiers()
// ---------------------------------------------------------------------------

describe("resolveAllTiers", () => {
  test("sorts tiers by rank ascending", () => {
    const result = resolveAllTiers([
      makeTier({ rank: 3, scope: { type: "any", include: [] } }),
      makeTier({ rank: 1, scope: { type: "any", include: [] } }),
      makeTier({ rank: 2, scope: { type: "any", include: [] } }),
    ]);
    expect(result.map((t) => t.rank)).toEqual([1, 2, 3]);
  });

  test("empty tiers array returns empty array", () => {
    const result = resolveAllTiers([]);
    expect(result).toEqual([]);
  });
});
