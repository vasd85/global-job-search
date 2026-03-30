import type { LocationPreferenceTier } from "@/lib/chatbot/schemas";
import {
  deriveRemotePreference,
  derivePreferredLocations,
  legacyToTiers,
} from "./location-utils";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTier(
  overrides: Partial<LocationPreferenceTier> & {
    workFormats: LocationPreferenceTier["workFormats"];
  },
): LocationPreferenceTier {
  return {
    rank: 1,
    scope: { type: "any", include: [] },
    ...overrides,
  };
}

// ===========================================================================
// deriveRemotePreference
// ===========================================================================

describe("deriveRemotePreference", () => {
  // ---- Critical: exhaustive branch coverage ----

  test('single tier with only ["remote"] returns "remote_only"', () => {
    const tiers = [makeTier({ workFormats: ["remote"] })];
    expect(deriveRemotePreference(tiers)).toBe("remote_only");
  });

  test('remote + onsite across tiers returns "any" (not "hybrid_ok" or "onsite_ok")', () => {
    const tiers = [
      makeTier({ rank: 1, workFormats: ["remote"] }),
      makeTier({ rank: 2, workFormats: ["onsite"] }),
    ];
    expect(deriveRemotePreference(tiers)).toBe("any");
  });

  test('remote + hybrid (without onsite) returns "hybrid_ok"', () => {
    const tiers = [makeTier({ workFormats: ["remote", "hybrid"] })];
    expect(deriveRemotePreference(tiers)).toBe("hybrid_ok");
  });

  test('only ["onsite"] returns "onsite_ok"', () => {
    const tiers = [makeTier({ workFormats: ["onsite"] })];
    expect(deriveRemotePreference(tiers)).toBe("onsite_ok");
  });

  test('only ["relocation"] returns "onsite_ok"', () => {
    const tiers = [makeTier({ workFormats: ["relocation"] })];
    expect(deriveRemotePreference(tiers)).toBe("onsite_ok");
  });

  // ---- Important: combination and boundary cases ----

  test('all four formats across multiple tiers returns "any"', () => {
    const tiers = [
      makeTier({ rank: 1, workFormats: ["remote", "hybrid"] }),
      makeTier({ rank: 2, workFormats: ["onsite", "relocation"] }),
    ];
    expect(deriveRemotePreference(tiers)).toBe("any");
  });

  // TODO: "hybrid" alone should arguably map to "hybrid_ok" rather than "any".
  // The `remote+hybrid` check requires `remote` to be present, so pure-hybrid
  // falls through to the default. This may be a logic gap.
  test('only ["hybrid"] returns "any" (fallback -- no specific branch matches)', () => {
    const tiers = [makeTier({ workFormats: ["hybrid"] })];
    expect(deriveRemotePreference(tiers)).toBe("any");
  });

  test('empty tiers array returns "any" (defensive boundary)', () => {
    expect(deriveRemotePreference([])).toBe("any");
  });

  test.each<[string, LocationPreferenceTier["workFormats"], string]>([
    ["remote", ["remote"], "remote_only"],
    ["hybrid", ["hybrid"], "any"],
    ["onsite", ["onsite"], "onsite_ok"],
    ["relocation", ["relocation"], "onsite_ok"],
  ])(
    "single format %s returns %s",
    (_format, workFormats, expected) => {
      const tiers = [makeTier({ workFormats })];
      expect(deriveRemotePreference(tiers)).toBe(expected);
    },
  );

  // ---- Nice-to-have: Set deduplication ----

  test("duplicate formats across tiers are deduplicated by Set", () => {
    const tiers = [
      makeTier({ rank: 1, workFormats: ["remote"] }),
      makeTier({ rank: 2, workFormats: ["remote"] }),
    ];
    // Set deduplicates -- still size 1, still just "remote"
    expect(deriveRemotePreference(tiers)).toBe("remote_only");
  });

  // ---- Corner cases: branch ordering sensitivity ----

  test('["remote", "hybrid", "onsite"] returns "any" (remote+onsite wins over remote+hybrid)', () => {
    const tiers = [makeTier({ workFormats: ["remote", "hybrid", "onsite"] })];
    expect(deriveRemotePreference(tiers)).toBe("any");
  });

  test('["hybrid", "onsite"] without remote returns "onsite_ok"', () => {
    const tiers = [makeTier({ workFormats: ["hybrid", "onsite"] })];
    expect(deriveRemotePreference(tiers)).toBe("onsite_ok");
  });
});

// ===========================================================================
// derivePreferredLocations
// ===========================================================================

describe("derivePreferredLocations", () => {
  // ---- Critical ----

  test("single tier with multiple locations returns all of them", () => {
    const tiers = [
      makeTier({
        workFormats: ["remote"],
        scope: { type: "countries", include: ["US", "UK"] },
      }),
    ];
    expect(derivePreferredLocations(tiers)).toEqual(["US", "UK"]);
  });

  test("multiple tiers with overlapping locations are deduplicated", () => {
    const tiers = [
      makeTier({
        rank: 1,
        workFormats: ["remote"],
        scope: { type: "countries", include: ["US", "UK"] },
      }),
      makeTier({
        rank: 2,
        workFormats: ["onsite"],
        scope: { type: "countries", include: ["UK", "DE"] },
      }),
    ];
    expect(derivePreferredLocations(tiers)).toEqual(["US", "UK", "DE"]);
  });

  test("empty include array produces empty result", () => {
    const tiers = [
      makeTier({
        workFormats: ["remote"],
        scope: { type: "any", include: [] },
      }),
    ];
    expect(derivePreferredLocations(tiers)).toEqual([]);
  });

  // ---- Important ----

  test("locations are returned in insertion order (Set iteration)", () => {
    const tiers = [
      makeTier({
        rank: 1,
        workFormats: ["remote"],
        scope: { type: "countries", include: ["DE"] },
      }),
      makeTier({
        rank: 2,
        workFormats: ["onsite"],
        scope: { type: "countries", include: ["US"] },
      }),
    ];
    expect(derivePreferredLocations(tiers)).toEqual(["DE", "US"]);
  });

  test("exclude array in scope is NOT included in output", () => {
    const tiers = [
      makeTier({
        workFormats: ["remote"],
        scope: {
          type: "regions",
          include: ["EU"],
          exclude: ["Cyprus"],
        },
      }),
    ];
    expect(derivePreferredLocations(tiers)).toEqual(["EU"]);
  });
});

// ===========================================================================
// legacyToTiers
// ===========================================================================

describe("legacyToTiers", () => {
  // ---- Critical ----

  test('"remote_only" maps to workFormats: ["remote"]', () => {
    const result = legacyToTiers(["US"], "remote_only");
    expect(result).toEqual({
      tiers: [
        {
          rank: 1,
          workFormats: ["remote"],
          scope: { type: "countries", include: ["US"] },
        },
      ],
    });
  });

  test('"hybrid_ok" maps to workFormats: ["remote", "hybrid"]', () => {
    const result = legacyToTiers(["UK"], "hybrid_ok");
    expect(result.tiers[0]?.workFormats).toEqual(["remote", "hybrid"]);
  });

  // TODO: Legacy "onsite_ok" arguably means "onsite is acceptable but remote
  // might also be." The tier conversion drops remote entirely. Round-tripping
  // preserves the value, but the user's original intent may have been broader.
  test('"onsite_ok" maps to workFormats: ["onsite", "relocation"]', () => {
    const result = legacyToTiers(["DE"], "onsite_ok");
    expect(result.tiers[0]?.workFormats).toEqual(["onsite", "relocation"]);
  });

  test('"any" maps to all four formats', () => {
    const result = legacyToTiers(["US"], "any");
    expect(result.tiers[0]?.workFormats).toEqual([
      "remote",
      "hybrid",
      "onsite",
      "relocation",
    ]);
  });

  test('empty locations array sets scope type to "any"', () => {
    const result = legacyToTiers([], "remote_only");
    expect(result.tiers[0]?.scope).toEqual({ type: "any", include: [] });
  });

  test('non-empty locations array sets scope type to "countries"', () => {
    const result = legacyToTiers(["Israel", "US"], "remote_only");
    expect(result.tiers[0]?.scope).toEqual({
      type: "countries",
      include: ["Israel", "US"],
    });
  });

  // ---- Important ----

  test("unrecognized remotePref string falls to the default (all formats)", () => {
    const result = legacyToTiers(["US"], "something_weird");
    expect(result.tiers[0]?.workFormats).toEqual([
      "remote",
      "hybrid",
      "onsite",
      "relocation",
    ]);
  });

  test.each<[string]>([
    ["remote_only"],
    ["hybrid_ok"],
    ["onsite_ok"],
    ["any"],
  ])(
    "round-trip: legacyToTiers -> deriveRemotePreference recovers %s",
    (pref) => {
      const tiers = legacyToTiers(["US"], pref);
      expect(deriveRemotePreference(tiers.tiers)).toBe(pref);
    },
  );

  // ---- Nice-to-have ----

  test("single location wraps correctly", () => {
    const result = legacyToTiers(["Tel Aviv"], "hybrid_ok");
    expect(result.tiers[0]?.scope).toEqual({
      type: "countries",
      include: ["Tel Aviv"],
    });
  });

  // ---- Corner case: scope type is always "countries" ----

  test('always assigns "countries" as scope type regardless of content', () => {
    // "Berlin" looks like a city name, but legacyToTiers always uses "countries"
    const result = legacyToTiers(["Berlin"], "any");
    expect(result.tiers[0]?.scope.type).toBe("countries");
  });
});
