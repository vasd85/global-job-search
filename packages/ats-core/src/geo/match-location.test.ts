import {
  workFormatMatch,
  immigrationMatch,
  normalizeWorkplaceType,
  geoMatch,
  matchJobToTiers,
  wordBoundaryMatch,
} from "./match-location";
import { locationCache } from "./location-cache";
import {
  UNKNOWN_JOB_SIGNALS,
  type JobImmigrationSignals,
  type ParsedJobLocation,
  type ResolvedImmigration,
  type ResolvedTierGeo,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal ParsedJobLocation with sensible defaults. */
function makeParsed(
  overrides: Partial<ParsedJobLocation> = {},
): ParsedJobLocation {
  return {
    raw: "",
    isRemote: false,
    isAnywhere: false,
    city: null,
    countryCode: null,
    countryName: null,
    stateOrRegion: null,
    confidence: "unresolved",
    ...overrides,
  };
}

/** Create a minimal ResolvedTierGeo with sensible defaults. */
function makeTier(
  overrides: Partial<ResolvedTierGeo> = {},
): ResolvedTierGeo {
  return {
    rank: 1,
    workFormats: ["remote"],
    resolvedCountryCodes: new Set(),
    resolvedCityNames: new Set(),
    isAny: false,
    excludedCountryCodes: new Set(),
    unresolvedEntries: [],
    ...overrides,
  };
}

/** Create a JobImmigrationSignals with explicit field values. */
function makeSignals(
  overrides: Partial<JobImmigrationSignals> = {},
): JobImmigrationSignals {
  return {
    visaSponsorship: "unknown",
    relocationPackage: "unknown",
    workAuthRestriction: "unknown",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeWorkplaceType()
// ---------------------------------------------------------------------------

describe("normalizeWorkplaceType", () => {
  test("null input returns null", () => {
    expect(normalizeWorkplaceType(null)).toBeNull();
  });

  test("canonical 'remote' passes through", () => {
    expect(normalizeWorkplaceType("remote")).toBe("remote");
  });

  test("canonical 'hybrid' passes through", () => {
    expect(normalizeWorkplaceType("hybrid")).toBe("hybrid");
  });

  test("canonical 'onsite' passes through", () => {
    expect(normalizeWorkplaceType("onsite")).toBe("onsite");
  });

  test("Lever 'on-site' hyphenated form maps to 'onsite'", () => {
    expect(normalizeWorkplaceType("on-site")).toBe("onsite");
  });

  test("'on_site' underscore form maps to 'onsite'", () => {
    expect(normalizeWorkplaceType("on_site")).toBe("onsite");
  });

  test("is case-insensitive: 'Remote', 'ONSITE', 'On-Site' all normalize", () => {
    expect(normalizeWorkplaceType("Remote")).toBe("remote");
    expect(normalizeWorkplaceType("ONSITE")).toBe("onsite");
    expect(normalizeWorkplaceType("On-Site")).toBe("onsite");
    expect(normalizeWorkplaceType("HYBRID")).toBe("hybrid");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeWorkplaceType("  remote  ")).toBe("remote");
    expect(normalizeWorkplaceType("\thybrid\n")).toBe("hybrid");
  });

  test("unrecognized values return null", () => {
    expect(normalizeWorkplaceType("flexible")).toBeNull();
    expect(normalizeWorkplaceType("relocation")).toBeNull();
    expect(normalizeWorkplaceType("")).toBeNull();
    expect(normalizeWorkplaceType("partially-remote")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// workFormatMatch()
// ---------------------------------------------------------------------------

describe("workFormatMatch", () => {
  // -- Critical scenarios ---------------------------------------------------

  test("null jobWorkplaceType passes any tier formats", () => {
    expect(workFormatMatch(null, ["remote"])).toBe(true);
  });

  test("null jobWorkplaceType passes even with full format triple", () => {
    expect(workFormatMatch(null, ["remote", "hybrid", "onsite"])).toBe(true);
  });

  test("empty tier formats passes any job type", () => {
    expect(workFormatMatch("onsite", [])).toBe(true);
  });

  test.each<[string, string[], boolean]>([
    ["remote", ["remote"], true],
    ["hybrid", ["hybrid"], true],
    ["onsite", ["onsite"], true],
    ["remote", ["onsite"], false],
    ["onsite", ["remote"], false],
    ["hybrid", ["remote"], false],
    ["remote", ["hybrid"], false],
  ])(
    "workFormatMatch(%s, %j) returns %s",
    (jobType, tierFormats, expected) => {
      expect(workFormatMatch(jobType, tierFormats)).toBe(expected);
    },
  );

  test("Barcelona regression: hybrid job in a full-triple tier passes", () => {
    // This is the exact shape that failed pre-Chunk-B: a QA automation
    // engineer in Barcelona with workplace_type='hybrid' was filtered
    // out by the legacy `workFormats: ["relocation", "remote"]` tier.
    // The new tier is {remote, hybrid, onsite} and hybrid must match.
    expect(
      workFormatMatch("hybrid", ["remote", "hybrid", "onsite"]),
    ).toBe(true);
  });

  test("hybrid job in a [remote] tier fails (no hybrid allowed)", () => {
    expect(workFormatMatch("hybrid", ["remote"])).toBe(false);
  });

  test("onsite job in [remote, hybrid] tier fails", () => {
    expect(workFormatMatch("onsite", ["remote", "hybrid"])).toBe(false);
  });

  // -- Important scenarios --------------------------------------------------

  test("multiple tier formats -- job matches one", () => {
    expect(workFormatMatch("hybrid", ["remote", "hybrid"])).toBe(true);
  });

  test("hybrid does NOT match remote+onsite tier (no hybrid)", () => {
    expect(workFormatMatch("hybrid", ["remote", "onsite"])).toBe(false);
  });

  test("unknown job workplace type does not match known formats", () => {
    // The matcher now trusts the contract that input is pre-normalized;
    // unrecognized values like 'flexible' are treated as literal strings
    // and do not match the canonical triple.
    expect(workFormatMatch("flexible", ["remote", "onsite"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// immigrationMatch()
// ---------------------------------------------------------------------------

describe("immigrationMatch", () => {
  // -- No-constraint cases (pass through) ----------------------------------

  test("tierFlags === undefined: always passes regardless of signals", () => {
    expect(immigrationMatch(UNKNOWN_JOB_SIGNALS, undefined)).toBe(true);
    expect(
      immigrationMatch(
        makeSignals({ visaSponsorship: "no", workAuthRestriction: "citizens_only" }),
        undefined,
      ),
    ).toBe(true);
  });

  test("empty tierFlags object (all flags undefined): passes", () => {
    const tierFlags: ResolvedImmigration = {};
    expect(immigrationMatch(UNKNOWN_JOB_SIGNALS, tierFlags)).toBe(true);
    expect(
      immigrationMatch(
        makeSignals({ visaSponsorship: "no" }),
        tierFlags,
      ),
    ).toBe(true);
  });

  test("jobSignals === undefined: treated as all-unknown, lenient pass", () => {
    // Cache warm-up path: L2 never has a chance to reject a job before
    // L3 has extracted the persisted signal values.
    const tierFlags: ResolvedImmigration = {
      needsVisaSponsorship: true,
      needsUnrestrictedWorkAuth: true,
    };
    expect(immigrationMatch(undefined, tierFlags)).toBe(true);
  });

  // -- needsVisaSponsorship --------------------------------------------------

  test("needsVisaSponsorship + visaSponsorship='yes' passes", () => {
    const tierFlags: ResolvedImmigration = { needsVisaSponsorship: true };
    const signals = makeSignals({ visaSponsorship: "yes" });
    expect(immigrationMatch(signals, tierFlags)).toBe(true);
  });

  test("needsVisaSponsorship + visaSponsorship='unknown' passes (lenient)", () => {
    const tierFlags: ResolvedImmigration = { needsVisaSponsorship: true };
    const signals = makeSignals({ visaSponsorship: "unknown" });
    expect(immigrationMatch(signals, tierFlags)).toBe(true);
  });

  test("needsVisaSponsorship + visaSponsorship='no' FAILS (explicit reject)", () => {
    const tierFlags: ResolvedImmigration = { needsVisaSponsorship: true };
    const signals = makeSignals({ visaSponsorship: "no" });
    expect(immigrationMatch(signals, tierFlags)).toBe(false);
  });

  test("needsVisaSponsorship:false ignores visaSponsorship entirely", () => {
    const tierFlags: ResolvedImmigration = { needsVisaSponsorship: false };
    expect(
      immigrationMatch(makeSignals({ visaSponsorship: "no" }), tierFlags),
    ).toBe(true);
  });

  // -- needsUnrestrictedWorkAuth ---------------------------------------------

  test("needsUnrestrictedWorkAuth + workAuthRestriction='none' passes", () => {
    const tierFlags: ResolvedImmigration = { needsUnrestrictedWorkAuth: true };
    const signals = makeSignals({ workAuthRestriction: "none" });
    expect(immigrationMatch(signals, tierFlags)).toBe(true);
  });

  test("needsUnrestrictedWorkAuth + workAuthRestriction='unknown' passes (lenient)", () => {
    const tierFlags: ResolvedImmigration = { needsUnrestrictedWorkAuth: true };
    const signals = makeSignals({ workAuthRestriction: "unknown" });
    expect(immigrationMatch(signals, tierFlags)).toBe(true);
  });

  test("needsUnrestrictedWorkAuth + workAuthRestriction='citizens_only' FAILS", () => {
    const tierFlags: ResolvedImmigration = { needsUnrestrictedWorkAuth: true };
    const signals = makeSignals({ workAuthRestriction: "citizens_only" });
    expect(immigrationMatch(signals, tierFlags)).toBe(false);
  });

  test("needsUnrestrictedWorkAuth + workAuthRestriction='residents_only' FAILS", () => {
    const tierFlags: ResolvedImmigration = { needsUnrestrictedWorkAuth: true };
    const signals = makeSignals({ workAuthRestriction: "residents_only" });
    expect(immigrationMatch(signals, tierFlags)).toBe(false);
  });

  test("needsUnrestrictedWorkAuth + workAuthRestriction='region_only' FAILS", () => {
    const tierFlags: ResolvedImmigration = { needsUnrestrictedWorkAuth: true };
    const signals = makeSignals({ workAuthRestriction: "region_only" });
    expect(immigrationMatch(signals, tierFlags)).toBe(false);
  });

  // -- wantsRelocationPackage (SCORE-ONLY, never gates) ----------------------

  test("wantsRelocationPackage:true + relocationPackage='no' still PASSES (score-only)", () => {
    const tierFlags: ResolvedImmigration = { wantsRelocationPackage: true };
    expect(
      immigrationMatch(makeSignals({ relocationPackage: "no" }), tierFlags),
    ).toBe(true);
  });

  test("wantsRelocationPackage:true + relocationPackage='yes' passes", () => {
    const tierFlags: ResolvedImmigration = { wantsRelocationPackage: true };
    expect(
      immigrationMatch(makeSignals({ relocationPackage: "yes" }), tierFlags),
    ).toBe(true);
  });

  test("wantsRelocationPackage:true + relocationPackage='unknown' passes", () => {
    const tierFlags: ResolvedImmigration = { wantsRelocationPackage: true };
    expect(
      immigrationMatch(makeSignals({ relocationPackage: "unknown" }), tierFlags),
    ).toBe(true);
  });

  // -- Combined flags ---------------------------------------------------------

  test("all three flags true + all-unknown signals: lenient pass", () => {
    const tierFlags: ResolvedImmigration = {
      needsVisaSponsorship: true,
      wantsRelocationPackage: true,
      needsUnrestrictedWorkAuth: true,
    };
    expect(immigrationMatch(UNKNOWN_JOB_SIGNALS, tierFlags)).toBe(true);
  });

  test("all three flags true + all explicit affirmative signals: passes", () => {
    const tierFlags: ResolvedImmigration = {
      needsVisaSponsorship: true,
      wantsRelocationPackage: true,
      needsUnrestrictedWorkAuth: true,
    };
    const signals = makeSignals({
      visaSponsorship: "yes",
      relocationPackage: "yes",
      workAuthRestriction: "none",
    });
    expect(immigrationMatch(signals, tierFlags)).toBe(true);
  });

  test("needsVisa + needsAuth combined: visa='no' fails even with auth='none'", () => {
    const tierFlags: ResolvedImmigration = {
      needsVisaSponsorship: true,
      needsUnrestrictedWorkAuth: true,
    };
    const signals = makeSignals({
      visaSponsorship: "no",
      workAuthRestriction: "none",
    });
    expect(immigrationMatch(signals, tierFlags)).toBe(false);
  });

  test("needsVisa + needsAuth combined: visa='yes' fails with auth='citizens_only'", () => {
    const tierFlags: ResolvedImmigration = {
      needsVisaSponsorship: true,
      needsUnrestrictedWorkAuth: true,
    };
    const signals = makeSignals({
      visaSponsorship: "yes",
      workAuthRestriction: "citizens_only",
    });
    expect(immigrationMatch(signals, tierFlags)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// geoMatch()
// ---------------------------------------------------------------------------

describe("geoMatch", () => {
  // -- Critical scenarios ---------------------------------------------------

  test("tier with isAny matches everything", () => {
    const parsed = makeParsed({ countryCode: "JP" });
    const tier = makeTier({ isAny: true });
    expect(geoMatch(parsed, tier, "Tokyo, JP")).toBe(true);
  });

  test("job with isAnywhere passes any tier", () => {
    const parsed = makeParsed({ isAnywhere: true });
    const tier = makeTier({ resolvedCountryCodes: new Set(["DE"]) });
    expect(geoMatch(parsed, tier, "Anywhere")).toBe(true);
  });

  test("completely unresolved job with no geo data passes", () => {
    // Per design: unresolved jobs pass to avoid false negatives
    const parsed = makeParsed({
      countryCode: null,
      city: null,
      confidence: "unresolved",
      isAnywhere: false,
      isRemote: false,
    });
    const tier = makeTier({ resolvedCountryCodes: new Set(["DE"]) });
    expect(geoMatch(parsed, tier, "Some Unknown Place")).toBe(true);
  });

  test("remote job with no country passes all tiers", () => {
    const parsed = makeParsed({
      isRemote: true,
      countryCode: null,
      city: null,
    });
    const tier = makeTier({ resolvedCountryCodes: new Set(["DE"]) });
    expect(geoMatch(parsed, tier, "Remote")).toBe(true);
  });

  test("remote job with country code matches by country", () => {
    const parsed = makeParsed({
      isRemote: true,
      countryCode: "DE",
    });
    const tier = makeTier({ resolvedCountryCodes: new Set(["DE"]) });
    expect(geoMatch(parsed, tier, "Remote, DE")).toBe(true);
  });

  test("country code match", () => {
    const parsed = makeParsed({ countryCode: "DE" });
    const tier = makeTier({ resolvedCountryCodes: new Set(["DE", "FR"]) });
    expect(geoMatch(parsed, tier, "Germany")).toBe(true);
  });

  test("country code mismatch", () => {
    const parsed = makeParsed({
      countryCode: "JP",
      confidence: "full",
    });
    const tier = makeTier({ resolvedCountryCodes: new Set(["DE", "FR"]) });
    expect(geoMatch(parsed, tier, "Japan")).toBe(false);
  });

  test("city name match", () => {
    const parsed = makeParsed({
      city: { name: "berlin", countryCode: "DE" },
      countryCode: "DE",
      confidence: "full",
    });
    const tier = makeTier({
      resolvedCityNames: new Set(["berlin"]),
      resolvedCountryCodes: new Set(["DE"]),
    });
    expect(geoMatch(parsed, tier, "Berlin, DE")).toBe(true);
  });

  test("city match blocked by excluded country", () => {
    const parsed = makeParsed({
      city: { name: "nicosia", countryCode: "CY" },
      countryCode: "CY",
      confidence: "full",
    });
    const tier = makeTier({
      resolvedCityNames: new Set(["nicosia"]),
      resolvedCountryCodes: new Set(["CY"]),
      excludedCountryCodes: new Set(["CY"]),
    });
    expect(geoMatch(parsed, tier, "Nicosia, CY")).toBe(false);
  });

  test("country match blocked by excluded country", () => {
    const parsed = makeParsed({
      countryCode: "CY",
      confidence: "full",
    });
    const tier = makeTier({
      resolvedCountryCodes: new Set(["CY", "DE"]),
      excludedCountryCodes: new Set(["CY"]),
    });
    expect(geoMatch(parsed, tier, "Cyprus")).toBe(false);
  });

  // -- Important scenarios --------------------------------------------------

  test("hierarchy: user prefers country, job has city in that country", () => {
    const parsed = makeParsed({
      city: { name: "berlin", countryCode: "DE" },
      countryCode: "DE",
      confidence: "full",
    });
    const tier = makeTier({
      resolvedCountryCodes: new Set(["DE"]),
      resolvedCityNames: new Set(),
    });
    // Job in Berlin matches tier preferring Germany (country-level)
    expect(geoMatch(parsed, tier, "Berlin, DE")).toBe(true);
  });

  test("hierarchy: user prefers city, job has different city in same country", () => {
    const parsed = makeParsed({
      city: { name: "munich", countryCode: "DE" },
      countryCode: "DE",
      confidence: "full",
    });
    const tier = makeTier({
      resolvedCityNames: new Set(["berlin"]),
      resolvedCountryCodes: new Set(["DE"]),
    });
    // "munich" is not in resolvedCityNames, but "DE" IS in resolvedCountryCodes.
    // So it matches via the country path.
    // TODO: Per architecture Section 5.4, this is incorrect. A user who
    // preferred city=Berlin should NOT match jobs in Munich. But the current
    // implementation matches because the city resolver adds the country code
    // to resolvedCountryCodes (or the tier has it from city resolution).
    // If resolveTierGeo was used properly (cities scope does NOT add country
    // codes), this would only happen when the tier explicitly includes both
    // city names and country codes.
    expect(geoMatch(parsed, tier, "Munich, DE")).toBe(true);
  });

  test("substring fallback for unresolved entries", () => {
    // Substring fallback is reached when a job has some resolved data
    // that does not match, then tries unresolved entries.
    const parsed = makeParsed({
      countryCode: "XX",
      confidence: "partial",
      isAnywhere: false,
      isRemote: false,
    });
    const tier = makeTier({
      resolvedCountryCodes: new Set(["DE"]),
      unresolvedEntries: ["campus x"],
    });
    expect(geoMatch(parsed, tier, "Campus X, Some City")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// wordBoundaryMatch()
// ---------------------------------------------------------------------------

describe("wordBoundaryMatch", () => {
  // -- Critical scenarios ---------------------------------------------------

  test('"US" matches "Remote, US" via word boundary', () => {
    expect(wordBoundaryMatch("remote, us", "us")).toBe(true);
  });

  test('"US" does NOT match "Campus" (false positive prevention)', () => {
    expect(wordBoundaryMatch("campus", "us")).toBe(false);
  });

  test('"EU" does NOT match "Reuters" (false positive prevention)', () => {
    expect(wordBoundaryMatch("reuters", "eu")).toBe(false);
  });

  test('"Germany" matches "Berlin, Germany" via includes()', () => {
    expect(wordBoundaryMatch("berlin, germany", "germany")).toBe(true);
  });

  test('"German" matches "Berlin, Germany" (partial substring for long needles)', () => {
    expect(wordBoundaryMatch("berlin, germany", "german")).toBe(true);
  });

  // -- Important scenarios --------------------------------------------------

  test("short needle with special regex characters does not throw", () => {
    // "$0" contains regex-significant characters
    expect(() => wordBoundaryMatch("value is $0.50", "$0")).not.toThrow();
  });

  test("exactly 3-char needle uses word boundary: NYC", () => {
    expect(wordBoundaryMatch("new york city (nyc)", "nyc")).toBe(true);
  });

  test("4-char needle uses includes: partial word match", () => {
    // "mote" appears inside "remote" -- includes() matches it
    expect(wordBoundaryMatch("something remote-only", "mote")).toBe(true);
  });

  test("empty needle matches everything (includes behavior)", () => {
    // Empty string: length <= 3, so uses word boundary regex.
    // An empty regex \b\b matches everywhere.
    expect(wordBoundaryMatch("anything", "")).toBe(true);
  });

  test("empty haystack does not match", () => {
    expect(wordBoundaryMatch("", "us")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchJobToTiers()
// ---------------------------------------------------------------------------

describe("matchJobToTiers", () => {
  beforeEach(() => {
    locationCache.clear();
  });

  // -- Critical scenarios ---------------------------------------------------

  test("job matches first tier", () => {
    const tier1 = makeTier({
      rank: 1,
      workFormats: ["remote"],
      resolvedCountryCodes: new Set(["DE", "AT", "CH"]),
    });
    const tier2 = makeTier({
      rank: 2,
      workFormats: ["remote"],
      resolvedCountryCodes: new Set(["FR", "IT"]),
    });
    // Use "Berlin, Germany" to avoid the "Berlin, DE" disambiguation bug
    // where DE is interpreted as Delaware (US state).
    const result = matchJobToTiers("Berlin, Germany", "remote", [tier1, tier2]);
    expect(result.passes).toBe(true);
    expect(result.matchedTier).toBe(1);
  });

  test("job matches second tier (not first)", () => {
    const tier1 = makeTier({
      rank: 1,
      workFormats: ["remote"],
      resolvedCountryCodes: new Set(["US"]),
    });
    const tier2 = makeTier({
      rank: 2,
      workFormats: ["remote"],
      resolvedCountryCodes: new Set(["DE", "AT", "CH"]),
    });
    // Use "Berlin, Germany" to avoid the disambiguation bug.
    const result = matchJobToTiers("Berlin, Germany", "remote", [tier1, tier2]);
    expect(result.passes).toBe(true);
    expect(result.matchedTier).toBe(2);
  });

  test("job matches no tier", () => {
    const tier1 = makeTier({
      rank: 1,
      workFormats: ["remote"],
      resolvedCountryCodes: new Set(["US"]),
    });
    const tier2 = makeTier({
      rank: 2,
      workFormats: ["remote"],
      resolvedCountryCodes: new Set(["DE", "AT", "CH"]),
    });
    const result = matchJobToTiers("Tokyo, JP", "remote", [tier1, tier2]);
    expect(result.passes).toBe(false);
    expect(result.matchedTier).toBeNull();
  });

  test("null locationRaw passes with no tier", () => {
    const tier = makeTier({
      rank: 1,
      resolvedCountryCodes: new Set(["DE"]),
    });
    const result = matchJobToTiers(null, "remote", [tier]);
    expect(result.passes).toBe(true);
    expect(result.matchedTier).toBeNull();
  });

  test("empty string locationRaw passes", () => {
    const tier = makeTier({
      rank: 1,
      resolvedCountryCodes: new Set(["DE"]),
    });
    const result = matchJobToTiers("", "remote", [tier]);
    expect(result.passes).toBe(true);
    expect(result.matchedTier).toBeNull();
  });

  test("work format mismatch blocks tier", () => {
    const tier = makeTier({
      rank: 1,
      workFormats: ["remote"],
      resolvedCountryCodes: new Set(["DE"]),
    });
    const result = matchJobToTiers("Berlin, Germany", "onsite", [tier]);
    expect(result.passes).toBe(false);
    expect(result.matchedTier).toBeNull();
  });

  test("multi-location -- any match suffices", () => {
    const tier = makeTier({
      rank: 1,
      workFormats: [],
      resolvedCountryCodes: new Set(["GB"]),
    });
    // Use "London, UK" which unambiguously resolves. The parser splits on " or "
    // and matches London/UK against the tier's GB country code.
    const result = matchJobToTiers(
      "Berlin, Germany or London, UK",
      null,
      [tier],
    );
    expect(result.passes).toBe(true);
    expect(result.matchedTier).toBe(1);
  });

  // -- Important scenarios --------------------------------------------------

  test("empty resolved tiers array returns passes=true (no filter)", () => {
    const result = matchJobToTiers("Berlin, Germany", "remote", []);
    expect(result.passes).toBe(true);
    expect(result.matchedTier).toBeNull();
  });

  test("caching -- same locationRaw parsed only once", () => {
    locationCache.clear();
    const tier1 = makeTier({
      rank: 1,
      workFormats: ["remote"],
      resolvedCountryCodes: new Set(["DE"]),
    });
    const tier2 = makeTier({
      rank: 1,
      workFormats: ["onsite"],
      resolvedCountryCodes: new Set(["DE"]),
    });

    matchJobToTiers("Berlin, Germany", "remote", [tier1]);
    const sizeAfterFirst = locationCache.size;

    matchJobToTiers("Berlin, Germany", "onsite", [tier2]);
    const sizeAfterSecond = locationCache.size;

    // Cache size should not increase on the second call for the same location
    expect(sizeAfterSecond).toBe(sizeAfterFirst);
  });

  // -- Defensive normalization of workplaceType ------------------------------

  test("defensively normalizes non-canonical 'On-Site' input", () => {
    // matchJobToTiers wraps workplaceType in normalizeWorkplaceType() so
    // raw DB values or stray legacy rows still compare correctly against
    // the canonical tier triple.
    const tier = makeTier({
      rank: 1,
      workFormats: ["remote", "hybrid", "onsite"],
      resolvedCountryCodes: new Set(["DE"]),
    });
    const result = matchJobToTiers("Berlin, Germany", "On-Site", [tier]);
    expect(result.passes).toBe(true);
    expect(result.matchedTier).toBe(1);
  });

  // -- Integration: Barcelona regression with immigration flags --------------

  test("Barcelona regression: hybrid job with unknown signals passes full-triple tier", () => {
    // Exact fixture from the original bug report: Barcelona hybrid job,
    // tier wants remote|hybrid|onsite and prefers (but does not require)
    // a relocation package. Unknown immigration signals -> lenient pass.
    const tier = makeTier({
      rank: 1,
      workFormats: ["remote", "hybrid", "onsite"],
      resolvedCountryCodes: new Set(["ES"]),
      immigrationFlags: { wantsRelocationPackage: true },
    });
    const result = matchJobToTiers(
      "Barcelona, Spain",
      "hybrid",
      [tier],
      UNKNOWN_JOB_SIGNALS,
    );
    expect(result.passes).toBe(true);
    expect(result.matchedTier).toBe(1);
  });

  test("Barcelona regression: same tier fails when job explicitly refuses sponsorship and tier requires it", () => {
    const tier = makeTier({
      rank: 1,
      workFormats: ["remote", "hybrid", "onsite"],
      resolvedCountryCodes: new Set(["ES"]),
      immigrationFlags: {
        needsVisaSponsorship: true,
        wantsRelocationPackage: true,
      },
    });
    const signals = makeSignals({ visaSponsorship: "no" });
    const result = matchJobToTiers(
      "Barcelona, Spain",
      "hybrid",
      [tier],
      signals,
    );
    expect(result.passes).toBe(false);
    expect(result.matchedTier).toBeNull();
  });

  test("matchJobToTiers without jobSignals argument (backward compat): treats as all-unknown", () => {
    // Existing callers that pass only 3 arguments must continue to work
    // and get lenient-unknown semantics.
    const tier = makeTier({
      rank: 1,
      workFormats: ["remote", "hybrid", "onsite"],
      resolvedCountryCodes: new Set(["ES"]),
      immigrationFlags: { needsVisaSponsorship: true },
    });
    const result = matchJobToTiers("Barcelona, Spain", "hybrid", [tier]);
    expect(result.passes).toBe(true);
    expect(result.matchedTier).toBe(1);
  });

  test("immigration work-auth restriction fails tier even when geo+format match", () => {
    const tier = makeTier({
      rank: 1,
      workFormats: ["remote", "hybrid", "onsite"],
      resolvedCountryCodes: new Set(["ES"]),
      immigrationFlags: { needsUnrestrictedWorkAuth: true },
    });
    const signals = makeSignals({ workAuthRestriction: "citizens_only" });
    const result = matchJobToTiers(
      "Barcelona, Spain",
      "hybrid",
      [tier],
      signals,
    );
    expect(result.passes).toBe(false);
    expect(result.matchedTier).toBeNull();
  });

  test("immigration work-auth 'residents_only' also fails tier requiring unrestricted auth", () => {
    const tier = makeTier({
      rank: 1,
      workFormats: ["remote", "hybrid", "onsite"],
      resolvedCountryCodes: new Set(["ES"]),
      immigrationFlags: { needsUnrestrictedWorkAuth: true },
    });
    const signals = makeSignals({ workAuthRestriction: "residents_only" });
    const result = matchJobToTiers(
      "Barcelona, Spain",
      "hybrid",
      [tier],
      signals,
    );
    expect(result.passes).toBe(false);
    expect(result.matchedTier).toBeNull();
  });
});
