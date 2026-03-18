import { canonicalizeHttpUrl, normalizeUrl, sameRegistrableHost } from "./url";

// ---------------------------------------------------------------------------
// canonicalizeHttpUrl
// ---------------------------------------------------------------------------

describe("canonicalizeHttpUrl", () => {
  // -- Basic HTTP/HTTPS acceptance ------------------------------------------

  test.each([
    ["https://example.com/jobs", "https://example.com/jobs"],
    ["http://example.com/careers", "http://example.com/careers"],
  ])("returns canonical form for %s", (input, expected) => {
    expect(canonicalizeHttpUrl(input)).toBe(expected);
  });

  // -- Non-HTTP protocol rejection ------------------------------------------

  test.each([
    "ftp://files.example.com/data",
    "mailto:jobs@example.com",
    "file:///etc/hosts",
    "javascript:void(0)",
    "data:text/html,<h1>hi</h1>",
  ])("rejects non-HTTP URL: %s", (input) => {
    expect(canonicalizeHttpUrl(input)).toBeNull();
  });

  // -- Invalid URL handling -------------------------------------------------

  test.each([
    ["garbage string", "not a url at all"],
    ["empty string", ""],
    ["bare path without base", "/careers"],
  ])("returns null for %s", (_label, input) => {
    expect(canonicalizeHttpUrl(input)).toBeNull();
  });

  // -- Tracking parameter removal -------------------------------------------

  test.each([
    ["utm_source", "https://example.com/jobs?utm_source=google"],
    ["utm_medium", "https://example.com/jobs?utm_medium=cpc"],
    ["utm_campaign", "https://example.com/jobs?utm_campaign=spring2025"],
    ["utm_term", "https://example.com/jobs?utm_term=developer"],
    ["utm_content", "https://example.com/jobs?utm_content=sidebar"],
    ["gclid", "https://example.com/jobs?gclid=abc123"],
    ["fbclid", "https://example.com/jobs?fbclid=xyz789"],
    ["uppercase UTM_SOURCE", "https://example.com/jobs?UTM_SOURCE=google"],
    ["mixed-case Utm_Campaign", "https://example.com/jobs?Utm_Campaign=winter"],
  ])("removes %s tracking param", (_param, input) => {
    expect(canonicalizeHttpUrl(input)).toBe("https://example.com/jobs");
  });

  test("removes multiple tracking params while preserving non-tracking ones", () => {
    const url =
      "https://example.com/jobs?utm_source=google&utm_medium=cpc&gclid=abc&page=2";
    expect(canonicalizeHttpUrl(url)).toBe("https://example.com/jobs?page=2");
  });

  test("preserves all non-tracking query parameters", () => {
    expect(
      canonicalizeHttpUrl("https://example.com/jobs?page=3&q=engineer"),
    ).toBe("https://example.com/jobs?page=3&q=engineer");
  });

  test("keeps non-tracking params while removing tracking ones (mixed)", () => {
    const url =
      "https://example.com/search?q=dev&utm_source=twitter&page=1&fbclid=abc";
    const result = canonicalizeHttpUrl(url);
    expect(result).toContain("q=dev");
    expect(result).toContain("page=1");
    expect(result).not.toContain("utm_source");
    expect(result).not.toContain("fbclid");
  });

  // -- Trailing slash removal -----------------------------------------------

  test.each<[string, string]>([
    ["https://example.com/jobs/", "https://example.com/jobs"],
    ["https://example.com/a/b/c/d/", "https://example.com/a/b/c/d"],
    ["https://example.com/", "https://example.com/"],
    ["https://example.com/careers", "https://example.com/careers"],
  ])("trailing slash: %s → %s", (input, expected) => {
    expect(canonicalizeHttpUrl(input)).toBe(expected);
  });

  // -- Hash route handling --------------------------------------------------

  describe("hash route preservation (keepHashRoute defaults to true)", () => {
    test.each([
      "#/jobs",
      "#/job",
      "#/careers",
      "#/career",
      "#/positions",
      "#/position",
      "#/vacancy",
      "#/vacancies",
      "#/openings",
      "#/opening",
      "#jobs",
      "#/Jobs",
    ])("preserves job-related hash route: %s", (hash) => {
      expect(
        canonicalizeHttpUrl(`https://example.com/${hash}`),
      ).toBe(`https://example.com/${hash}`);
    });

    test.each([
      ["non-job fragment", "https://example.com/page#section-2", "https://example.com/page"],
      ["empty hash", "https://example.com/page#", "https://example.com/page"],
    ])("strips %s", (_label, input, expected) => {
      expect(canonicalizeHttpUrl(input)).toBe(expected);
    });

    // TODO: HASH_JOB_ROUTE_REGEX matches prefix, not whole word — #/jobsearch
    // and #/careers-page are preserved as "job-related" routes. This may be a
    // false-positive bug if non-job hash routes happen to start with these words.
    test.each([
      ["#/jobsearch", "https://example.com/#/jobsearch"],
      ["#/careers-page", "https://example.com/#/careers-page"],
    ])("adversarial: regex matches partial word %s (prefix match)", (_label, input) => {
      expect(canonicalizeHttpUrl(input)).toBe(input);
    });
  });

  describe("hash route with keepHashRoute explicitly false", () => {
    test.each([
      ["#/jobs", "https://example.com/#/jobs"],
      ["#/careers", "https://example.com/#/careers"],
    ])("strips %s hash when keepHashRoute is false", (_label, input) => {
      expect(
        canonicalizeHttpUrl(input, { keepHashRoute: false }),
      ).toBe("https://example.com/");
    });
  });

  // -- Relative URL resolution with base ------------------------------------

  test.each<[string, string, string]>([
    ["/careers", "https://example.com", "https://example.com/careers"],
    ["jobs/123", "https://example.com/company/", "https://example.com/company/jobs/123"],
    ["/open-positions", "https://example.com/a/b/c", "https://example.com/open-positions"],
  ])("resolves relative URL '%s' with base '%s'", (input, base, expected) => {
    expect(canonicalizeHttpUrl(input, { base })).toBe(expected);
  });

  test("absolute URL ignores base when provided", () => {
    expect(
      canonicalizeHttpUrl("https://other.com/jobs", {
        base: "https://example.com",
      }),
    ).toBe("https://other.com/jobs");
  });

  // -- Combined behaviors ---------------------------------------------------

  test("removes tracking params and trailing slash together", () => {
    expect(
      canonicalizeHttpUrl(
        "https://example.com/jobs/?utm_source=linkedin&gclid=x",
      ),
    ).toBe("https://example.com/jobs");
  });

  test("preserves hash route when query params precede the hash", () => {
    expect(
      canonicalizeHttpUrl(
        "https://example.com/?utm_source=google&page=1#/careers",
      ),
    ).toBe("https://example.com/?page=1#/careers");
  });

  test("keeps hash fragment intact when query-like text follows it", () => {
    const result = canonicalizeHttpUrl(
      "https://example.com/#/careers?utm_source=google&page=1",
    );
    expect(result).not.toBeNull();
    expect(result).toContain("#/careers");
  });

  test("handles URL with port number", () => {
    expect(
      canonicalizeHttpUrl("https://example.com:8080/jobs/"),
    ).toBe("https://example.com:8080/jobs");
  });

  test("handles URL with credentials in authority", () => {
    const result = canonicalizeHttpUrl("https://user:pass@example.com/jobs");
    expect(result).not.toBeNull();
    expect(result).toContain("example.com/jobs");
  });
});

// ---------------------------------------------------------------------------
// normalizeUrl — thin wrapper, only test its own contract (Principle #3)
// ---------------------------------------------------------------------------

describe("normalizeUrl", () => {
  test("passes base as positional argument", () => {
    expect(normalizeUrl("/careers", "https://example.com")).toBe(
      "https://example.com/careers",
    );
  });

  test("always preserves job-related hash routes", () => {
    expect(normalizeUrl("https://example.com/#/jobs")).toBe(
      "https://example.com/#/jobs",
    );
  });

  test.each(["not-a-url", "", "ftp://example.com", "/careers"])(
    "returns null for invalid input: %s",
    (input) => {
      expect(normalizeUrl(input)).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// sameRegistrableHost
// ---------------------------------------------------------------------------

describe("sameRegistrableHost", () => {
  test.each<[string, string, string]>([
    ["identical hosts", "https://example.com/jobs", "https://example.com/careers"],
    ["www vs bare", "https://www.example.com", "https://example.com"],
    ["both www", "https://www.example.com", "https://www.example.com"],
    ["WWW uppercase", "https://WWW.example.com", "https://example.com"],
    ["subdomain of second", "https://careers.example.com", "https://example.com"],
    ["subdomain of first", "https://example.com", "https://jobs.example.com"],
    ["deeply nested subdomain", "https://apply.careers.example.com", "https://example.com"],
    ["case-insensitive", "https://EXAMPLE.COM/jobs", "https://example.com/careers"],
    ["different paths", "https://example.com/a/b/c", "https://example.com/x/y/z"],
    ["different ports", "https://example.com:3000", "https://example.com:8080"],
    ["http vs https", "http://example.com", "https://example.com"],
  ])("returns true: %s", (_label, a, b) => {
    expect(sameRegistrableHost(a, b)).toBe(true);
  });

  test.each<[string, string, string]>([
    ["different domains", "https://example.com", "https://other.com"],
    ["similar-looking domain", "https://myexample.com", "https://example.com"],
    ["different TLDs", "https://example.com", "https://example.org"],
    ["two unrelated subdomains", "https://careers.example.com", "https://jobs.example.com"],
    // Adversarial: suffix-based attacks (Principle #2)
    ["suffix attack: example.com.evil.com", "https://example.com.evil.com", "https://example.com"],
    ["hyphenated look-alike", "https://evil-example.com", "https://example.com"],
  ])("returns false: %s", (_label, a, b) => {
    expect(sameRegistrableHost(a, b)).toBe(false);
  });

  test.each<[string, string, string]>([
    ["first arg invalid", "not a url", "https://example.com"],
    ["second arg invalid", "https://example.com", "garbage"],
    ["both invalid", "", ""],
  ])("returns false for invalid input: %s", (_label, a, b) => {
    expect(sameRegistrableHost(a, b)).toBe(false);
  });
});
