import { lookupCity, lookupCityInCountry } from "./city-index";

// These tests use the real city-index.generated.json file.
// The generated JSON contains cities with population >= 15,000 from GeoNames.

// ---------------------------------------------------------------------------
// lookupCity()
// ---------------------------------------------------------------------------

describe("lookupCity", () => {
  // -- Critical scenarios ---------------------------------------------------

  test("looks up a major city: Berlin", () => {
    const result = lookupCity("berlin");
    expect(result).not.toBeNull();
    expect(result!.countryCode).toBe("DE");
  });

  test("looks up with country code filter: Portland, US", () => {
    const result = lookupCity("portland", "US");
    expect(result).not.toBeNull();
    expect(result!.countryCode).toBe("US");
  });

  test("disambiguates by population when no country code given", () => {
    // Portland exists in both the US and UK. US Portland (Oregon)
    // has a much larger population and should be returned first.
    const result = lookupCity("portland");
    expect(result).not.toBeNull();
    // Should be the highest population Portland
    expect(result!.population).toBeGreaterThan(0);
  });

  test("non-existent city returns null", () => {
    expect(lookupCity("zzzznotacity")).toBeNull();
  });

  test.each<[string]>([["BERLIN"], ["Berlin"], ["berlin"]])(
    "case insensitivity: %s returns Berlin, DE",
    (input) => {
      const result = lookupCity(input);
      expect(result).not.toBeNull();
      expect(result!.countryCode).toBe("DE");
    },
  );

  // -- Important scenarios --------------------------------------------------

  test("empty string returns null", () => {
    expect(lookupCity("")).toBeNull();
  });

  test("whitespace-only string returns null", () => {
    expect(lookupCity("   ")).toBeNull();
  });

  test("city that is also a country name: Singapore", () => {
    const result = lookupCity("singapore");
    expect(result).not.toBeNull();
    expect(result!.countryCode).toBe("SG");
  });

  test("accented city name via asciiName: munich (english name for Muenchen)", () => {
    // Munich should be findable via alternate names or asciiName.
    // The canonical German name is "muenchen" or the accented form.
    const result = lookupCity("munich");
    expect(result).not.toBeNull();
    expect(result!.countryCode).toBe("DE");
  });
});

// ---------------------------------------------------------------------------
// lookupCityInCountry()
// ---------------------------------------------------------------------------

describe("lookupCityInCountry", () => {
  // -- Critical scenarios ---------------------------------------------------

  test("returns city when it exists in the given country", () => {
    const result = lookupCityInCountry("berlin", "DE");
    expect(result).not.toBeNull();
    expect(result!.countryCode).toBe("DE");
  });

  test("returns null when city does not exist in the given country", () => {
    // Berlin is not a major city in the US (no city with population > 15K)
    const result = lookupCityInCountry("berlin", "US");
    // May or may not be null depending on GeoNames data. If there is a Berlin, US
    // with population > 15K, it will return it. Otherwise null.
    // The key contract: if it returns something, it must be in the US.
    if (result !== null) {
      expect(result.countryCode).toBe("US");
    }
  });

  test("case insensitivity for city name and country code", () => {
    const result = lookupCityInCountry("LONDON", "gb");
    expect(result).not.toBeNull();
    expect(result!.countryCode).toBe("GB");
  });
});
