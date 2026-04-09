import type { LocationPreferenceTier } from "@/lib/chatbot/schemas";
import {
  deriveRemotePreference,
  derivePreferredLocations,
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

  test('only ["onsite"] returns "onsite_ok"', () => {
    const tiers = [makeTier({ workFormats: ["onsite"] })];
    expect(deriveRemotePreference(tiers)).toBe("onsite_ok");
  });

  test('only ["hybrid"] returns "hybrid_ok" (was "any" before the fix)', () => {
    const tiers = [makeTier({ workFormats: ["hybrid"] })];
    expect(deriveRemotePreference(tiers)).toBe("hybrid_ok");
  });

  test('remote + hybrid (without onsite) returns "hybrid_ok"', () => {
    const tiers = [makeTier({ workFormats: ["remote", "hybrid"] })];
    expect(deriveRemotePreference(tiers)).toBe("hybrid_ok");
  });

  test('remote + onsite across tiers returns "any"', () => {
    const tiers = [
      makeTier({ rank: 1, workFormats: ["remote"] }),
      makeTier({ rank: 2, workFormats: ["onsite"] }),
    ];
    expect(deriveRemotePreference(tiers)).toBe("any");
  });

  test('all three formats across multiple tiers returns "any"', () => {
    const tiers = [
      makeTier({ rank: 1, workFormats: ["remote", "hybrid"] }),
      makeTier({ rank: 2, workFormats: ["onsite"] }),
    ];
    expect(deriveRemotePreference(tiers)).toBe("any");
  });

  test('["remote", "hybrid", "onsite"] in a single tier returns "any"', () => {
    const tiers = [makeTier({ workFormats: ["remote", "hybrid", "onsite"] })];
    expect(deriveRemotePreference(tiers)).toBe("any");
  });

  test('["hybrid", "onsite"] without remote returns "onsite_ok"', () => {
    const tiers = [makeTier({ workFormats: ["hybrid", "onsite"] })];
    expect(deriveRemotePreference(tiers)).toBe("onsite_ok");
  });

  test('empty tiers array returns "any" (defensive boundary)', () => {
    expect(deriveRemotePreference([])).toBe("any");
  });

  test.each<[string, LocationPreferenceTier["workFormats"], string]>([
    ["remote", ["remote"], "remote_only"],
    ["hybrid", ["hybrid"], "hybrid_ok"],
    ["onsite", ["onsite"], "onsite_ok"],
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
    expect(deriveRemotePreference(tiers)).toBe("remote_only");
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
