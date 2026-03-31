import { lookupTimezoneGroup } from "./timezone-groups";

// ---------------------------------------------------------------------------
// lookupTimezoneGroup()
// ---------------------------------------------------------------------------

describe("lookupTimezoneGroup", () => {
  // -- Critical scenarios ---------------------------------------------------

  test("canonical name lookup: us_timezone", () => {
    const result = lookupTimezoneGroup("us_timezone");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("us_timezone");
    expect(result!.memberCountryCodes).toContain("US");
    expect(result!.memberCountryCodes).toContain("CA");
    expect(result!.memberCountryCodes).toContain("MX");
  });

  test("EST alias maps to us_timezone", () => {
    const result = lookupTimezoneGroup("est");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("us_timezone");
  });

  test("IST alias maps to asia_timezone", () => {
    const result = lookupTimezoneGroup("ist");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("asia_timezone");
  });

  test("CET alias maps to europe_timezone", () => {
    const result = lookupTimezoneGroup("cet");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("europe_timezone");
  });

  test("unrecognized timezone returns null", () => {
    expect(lookupTimezoneGroup("mars timezone")).toBeNull();
  });

  // -- Important scenarios --------------------------------------------------

  test.each<[string]>([["EST"], ["Est"]])(
    "case insensitivity: %s resolves to us_timezone",
    (input) => {
      const result = lookupTimezoneGroup(input);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("us_timezone");
    },
  );

  test("GMT resolves to europe_timezone", () => {
    const result = lookupTimezoneGroup("gmt");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("europe_timezone");
  });
});
