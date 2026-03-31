import { lookupCountry, COUNTRIES, COUNTRY_REVERSE_INDEX } from "./country-data";

// ---------------------------------------------------------------------------
// lookupCountry() -- Core lookups
// ---------------------------------------------------------------------------

describe("lookupCountry", () => {
  // -- Critical scenarios ---------------------------------------------------

  test.each<[string, string]>([
    ["us", "US"],
    ["US", "US"],
    ["deu", "DE"],
    ["germany", "DE"],
    ["uk", "GB"],
    ["usa", "US"],
    ["uae", "AE"],
    ["holland", "NL"],
    ["czech republic", "CZ"],
  ])(
    "resolves %s to %s",
    (input, expected) => {
      expect(lookupCountry(input)).toBe(expected);
    },
  );

  test.each<[string, string]>([
    ["england", "GB"],
    ["scotland", "GB"],
    ["wales", "GB"],
    ["northern ireland", "GB"],
  ])(
    "constituent country %s resolves to GB",
    (input, expected) => {
      expect(lookupCountry(input)).toBe(expected);
    },
  );

  test("non-existent country returns null", () => {
    expect(lookupCountry("atlantis")).toBeNull();
  });

  test("empty string returns null", () => {
    expect(lookupCountry("")).toBeNull();
  });

  // -- Ambiguous code collision: country alpha-2 is also a US state abbrev --

  test.each<[string, string]>([
    ["de", "DE"],
    ["in", "IN"],
    ["ga", "GA"],
  ])(
    "lookupCountry(%s) returns the country code (not the US state)",
    (input, expected) => {
      // lookupCountry always resolves to the country. The parser determines
      // context (country vs. US state) based on city validation.
      expect(lookupCountry(input)).toBe(expected);
    },
  );

  // -- Important scenarios --------------------------------------------------

  test("trims whitespace", () => {
    expect(lookupCountry("  germany  ")).toBe("DE");
  });

  test("handles mixed case", () => {
    expect(lookupCountry("United Kingdom")).toBe("GB");
  });

  test.each<[string]>([["xk"], ["kosovo"]])(
    "Kosovo lookup via %s resolves to XK",
    (input) => {
      expect(lookupCountry(input)).toBe("XK");
    },
  );

  test("country with apostrophe -- Cote d'Ivoire", () => {
    expect(lookupCountry("cote d'ivoire")).toBe("CI");
    expect(lookupCountry("ivory coast")).toBe("CI");
  });

  // -- Nice-to-have: data integrity -----------------------------------------

  test("all alpha-2 keys in COUNTRIES are exactly 2 uppercase letters", () => {
    for (const key of COUNTRIES.keys()) {
      expect(key).toMatch(/^[A-Z]{2}$/);
    }
  });

  test("reverse index contains all aliases from all country records", () => {
    for (const [alpha2, record] of COUNTRIES) {
      // alpha-2 lowercase
      expect(COUNTRY_REVERSE_INDEX.get(alpha2.toLowerCase())).toBe(alpha2);
      // alpha-3 lowercase
      expect(COUNTRY_REVERSE_INDEX.get(record.alpha3.toLowerCase())).toBe(alpha2);
      // canonical name
      expect(COUNTRY_REVERSE_INDEX.get(record.name)).toBe(alpha2);
      // all aliases
      for (const alias of record.aliases) {
        expect(COUNTRY_REVERSE_INDEX.get(alias)).toBe(alpha2);
      }
    }
  });
});
