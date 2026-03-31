import { isUsState, isCanadianProvince } from "./us-states";

// ---------------------------------------------------------------------------
// isUsState()
// ---------------------------------------------------------------------------

describe("isUsState", () => {
  // -- Critical scenarios ---------------------------------------------------

  test.each<[string]>([["ca"], ["CA"], ["Ca"]])(
    "valid US state abbreviation %s is case-insensitive",
    (code) => {
      expect(isUsState(code)).toBe(true);
    },
  );

  test("DC is included", () => {
    expect(isUsState("DC")).toBe(true);
  });

  test("PR (Puerto Rico) territory is included", () => {
    expect(isUsState("PR")).toBe(true);
  });

  test("UK is not a US state", () => {
    expect(isUsState("UK")).toBe(false);
  });

  test("DE (Delaware) IS a US state", () => {
    // DE is both a country code (Germany) and a US state abbreviation
    // (Delaware). isUsState correctly returns true for DE as Delaware.
    expect(isUsState("DE")).toBe(true);
  });

  test("empty string returns false", () => {
    expect(isUsState("")).toBe(false);
  });

  test("single character returns false", () => {
    expect(isUsState("A")).toBe(false);
  });

  test("three characters returns false", () => {
    expect(isUsState("NYC")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isCanadianProvince()
// ---------------------------------------------------------------------------

describe("isCanadianProvince", () => {
  // -- Critical scenarios ---------------------------------------------------

  test.each<[string]>([["ON"], ["BC"], ["QC"]])(
    "valid Canadian province %s returns true",
    (code) => {
      expect(isCanadianProvince(code)).toBe(true);
    },
  );

  test("NL (Newfoundland) is a Canadian province", () => {
    // NL is also the Netherlands country code. The parser resolves this
    // collision by trying country first, so "St. John's, NL" would match
    // Netherlands. This is a known limitation documented in the scenarios.
    expect(isCanadianProvince("NL")).toBe(true);
  });

  test("case-insensitive lookup", () => {
    expect(isCanadianProvince("on")).toBe(true);
    expect(isCanadianProvince("bc")).toBe(true);
  });

  test("non-province code returns false", () => {
    expect(isCanadianProvince("ZZ")).toBe(false);
  });

  test("empty string returns false", () => {
    expect(isCanadianProvince("")).toBe(false);
  });
});
