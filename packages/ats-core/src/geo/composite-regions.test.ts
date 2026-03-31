import {
  lookupRegion,
  COMPOSITE_REGIONS,
} from "./composite-regions";

// ---------------------------------------------------------------------------
// lookupRegion()
// ---------------------------------------------------------------------------

describe("lookupRegion", () => {
  // -- Critical scenarios ---------------------------------------------------

  test("exact canonical name lookup: eu", () => {
    const result = lookupRegion("eu");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("eu");
    expect(result!.memberCountryCodes).toHaveLength(27);
  });

  test("alias lookup: european union resolves to eu", () => {
    const result = lookupRegion("european union");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("eu");
  });

  test("EEA includes EU members + IS, LI, NO", () => {
    const result = lookupRegion("eea");
    expect(result).not.toBeNull();
    expect(result!.memberCountryCodes).toHaveLength(30);
    expect(result!.memberCountryCodes).toContain("IS");
    expect(result!.memberCountryCodes).toContain("LI");
    expect(result!.memberCountryCodes).toContain("NO");
  });

  test("DACH includes exactly DE, AT, CH", () => {
    const result = lookupRegion("dach");
    expect(result).not.toBeNull();
    expect(result!.memberCountryCodes).toEqual(
      expect.arrayContaining(["DE", "AT", "CH"]),
    );
    expect(result!.memberCountryCodes).toHaveLength(3);
  });

  test.each<[string]>([["APAC"], ["Apac"], ["apac"]])(
    "case insensitivity: %s resolves to apac",
    (input) => {
      const result = lookupRegion(input);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("apac");
    },
  );

  test("unrecognized region returns null", () => {
    expect(lookupRegion("wakanda")).toBeNull();
  });

  test("Scandinavia alias resolves to nordics", () => {
    const result = lookupRegion("scandinavia");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("nordics");
  });

  // -- Important scenarios --------------------------------------------------

  test.each(
    COMPOSITE_REGIONS.map((r) => [r.name] as [string]),
  )(
    "all regions accessible by canonical name: %s",
    (name) => {
      expect(lookupRegion(name)).not.toBeNull();
    },
  );

  test("UK & Ireland includes exactly GB and IE", () => {
    const result = lookupRegion("uk & ireland");
    expect(result).not.toBeNull();
    expect(result!.memberCountryCodes).toContain("GB");
    expect(result!.memberCountryCodes).toContain("IE");
    expect(result!.memberCountryCodes).toHaveLength(2);
  });

  test("Europe (broad) includes Turkey and Russia", () => {
    const result = lookupRegion("europe");
    expect(result).not.toBeNull();
    expect(result!.memberCountryCodes).toContain("TR");
    expect(result!.memberCountryCodes).toContain("RU");
  });
});
