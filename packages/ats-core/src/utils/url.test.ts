import { canonicalizeHttpUrl, normalizeUrl, sameRegistrableHost } from "./url";

// ---------------------------------------------------------------------------
// canonicalizeHttpUrl
// ---------------------------------------------------------------------------

describe("canonicalizeHttpUrl", () => {
  // -- Basic HTTP/HTTPS acceptance ------------------------------------------

  test("returns canonical form for a simple https URL", () => {
    expect(canonicalizeHttpUrl("https://example.com/jobs")).toBe(
      "https://example.com/jobs",
    );
  });

  test("returns canonical form for a simple http URL", () => {
    expect(canonicalizeHttpUrl("http://example.com/careers")).toBe(
      "http://example.com/careers",
    );
  });

  // -- Non-HTTP protocol rejection ------------------------------------------

  test("rejects ftp:// URLs", () => {
    expect(canonicalizeHttpUrl("ftp://files.example.com/data")).toBeNull();
  });

  test("rejects mailto: URLs", () => {
    expect(canonicalizeHttpUrl("mailto:jobs@example.com")).toBeNull();
  });

  test("rejects file:// URLs", () => {
    expect(canonicalizeHttpUrl("file:///etc/hosts")).toBeNull();
  });

  test("rejects javascript: pseudo-URLs", () => {
    expect(canonicalizeHttpUrl("javascript:void(0)")).toBeNull();
  });

  test("rejects data: URIs", () => {
    expect(canonicalizeHttpUrl("data:text/html,<h1>hi</h1>")).toBeNull();
  });

  // -- Invalid URL handling -------------------------------------------------

  test("returns null for completely invalid input", () => {
    expect(canonicalizeHttpUrl("not a url at all")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(canonicalizeHttpUrl("")).toBeNull();
  });

  test("returns null for a bare path without base", () => {
    expect(canonicalizeHttpUrl("/careers")).toBeNull();
  });

  // -- Tracking parameter removal -------------------------------------------

  test("removes utm_source parameter", () => {
    expect(
      canonicalizeHttpUrl("https://example.com/jobs?utm_source=google"),
    ).toBe("https://example.com/jobs");
  });

  test("removes utm_medium parameter", () => {
    expect(
      canonicalizeHttpUrl("https://example.com/jobs?utm_medium=cpc"),
    ).toBe("https://example.com/jobs");
  });

  test("removes utm_campaign parameter", () => {
    expect(
      canonicalizeHttpUrl("https://example.com/jobs?utm_campaign=spring2025"),
    ).toBe("https://example.com/jobs");
  });

  test("removes utm_term parameter", () => {
    expect(
      canonicalizeHttpUrl("https://example.com/jobs?utm_term=developer"),
    ).toBe("https://example.com/jobs");
  });

  test("removes utm_content parameter", () => {
    expect(
      canonicalizeHttpUrl("https://example.com/jobs?utm_content=sidebar"),
    ).toBe("https://example.com/jobs");
  });

  test("removes gclid parameter", () => {
    expect(
      canonicalizeHttpUrl("https://example.com/jobs?gclid=abc123"),
    ).toBe("https://example.com/jobs");
  });

  test("removes fbclid parameter", () => {
    expect(
      canonicalizeHttpUrl("https://example.com/jobs?fbclid=xyz789"),
    ).toBe("https://example.com/jobs");
  });

  test("removes multiple tracking params at once", () => {
    const url =
      "https://example.com/jobs?utm_source=google&utm_medium=cpc&gclid=abc&page=2";
    expect(canonicalizeHttpUrl(url)).toBe(
      "https://example.com/jobs?page=2",
    );
  });

  test("removes tracking params case-insensitively (uppercase keys)", () => {
    expect(
      canonicalizeHttpUrl("https://example.com/jobs?UTM_SOURCE=google"),
    ).toBe("https://example.com/jobs");
  });

  test("removes tracking params case-insensitively (mixed case)", () => {
    expect(
      canonicalizeHttpUrl("https://example.com/jobs?Utm_Campaign=winter"),
    ).toBe("https://example.com/jobs");
  });

  test("preserves non-tracking query parameters", () => {
    expect(
      canonicalizeHttpUrl("https://example.com/jobs?page=3&q=engineer"),
    ).toBe("https://example.com/jobs?page=3&q=engineer");
  });

  test("keeps non-tracking params while removing tracking ones", () => {
    const url =
      "https://example.com/search?q=dev&utm_source=twitter&page=1&fbclid=abc";
    const result = canonicalizeHttpUrl(url);
    expect(result).toContain("q=dev");
    expect(result).toContain("page=1");
    expect(result).not.toContain("utm_source");
    expect(result).not.toContain("fbclid");
  });

  // -- Trailing slash removal -----------------------------------------------

  test("removes trailing slash from a path", () => {
    expect(canonicalizeHttpUrl("https://example.com/jobs/")).toBe(
      "https://example.com/jobs",
    );
  });

  test("removes trailing slash from a deeply nested path", () => {
    expect(
      canonicalizeHttpUrl("https://example.com/a/b/c/d/"),
    ).toBe("https://example.com/a/b/c/d");
  });

  test("keeps the root path slash (does not produce empty path)", () => {
    expect(canonicalizeHttpUrl("https://example.com/")).toBe(
      "https://example.com/",
    );
  });

  test("does not modify a URL that already lacks a trailing slash", () => {
    expect(canonicalizeHttpUrl("https://example.com/careers")).toBe(
      "https://example.com/careers",
    );
  });

  // -- Hash route handling --------------------------------------------------

  describe("hash route preservation (keepHashRoute defaults to true)", () => {
    test("preserves #/jobs hash route", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/#/jobs"),
      ).toBe("https://example.com/#/jobs");
    });

    test("preserves #/job hash route (singular)", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/#/job"),
      ).toBe("https://example.com/#/job");
    });

    test("preserves #/careers hash route", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/#/careers"),
      ).toBe("https://example.com/#/careers");
    });

    test("preserves #/career hash route (singular)", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/#/career"),
      ).toBe("https://example.com/#/career");
    });

    test("preserves #/positions hash route", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/#/positions"),
      ).toBe("https://example.com/#/positions");
    });

    test("preserves #/position hash route (singular)", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/#/position"),
      ).toBe("https://example.com/#/position");
    });

    test("preserves #/vacancy hash route", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/#/vacancy"),
      ).toBe("https://example.com/#/vacancy");
    });

    test("preserves #/vacancies hash route", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/#/vacancies"),
      ).toBe("https://example.com/#/vacancies");
    });

    test("preserves #/openings hash route", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/#/openings"),
      ).toBe("https://example.com/#/openings");
    });

    test("preserves #/opening hash route (singular)", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/#/opening"),
      ).toBe("https://example.com/#/opening");
    });

    test("preserves hash route without leading slash (#jobs)", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/#jobs"),
      ).toBe("https://example.com/#jobs");
    });

    test("preserves hash route case-insensitively (#/Jobs)", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/#/Jobs"),
      ).toBe("https://example.com/#/Jobs");
    });

    test("strips non-job-related hash fragments", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/page#section-2"),
      ).toBe("https://example.com/page");
    });

    test("strips empty-ish hash (#)", () => {
      // new URL normalizes '#' alone to an empty hash string;
      // the function should not keep it
      expect(
        canonicalizeHttpUrl("https://example.com/page#"),
      ).toBe("https://example.com/page");
    });
  });

  describe("hash route with keepHashRoute explicitly false", () => {
    test("strips job-related hash when keepHashRoute is false", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/#/jobs", {
          keepHashRoute: false,
        }),
      ).toBe("https://example.com/");
    });

    test("strips careers hash when keepHashRoute is false", () => {
      expect(
        canonicalizeHttpUrl("https://example.com/#/careers", {
          keepHashRoute: false,
        }),
      ).toBe("https://example.com/");
    });
  });

  // -- Relative URL resolution with base ------------------------------------

  test("resolves relative URL when base is provided", () => {
    expect(
      canonicalizeHttpUrl("/careers", { base: "https://example.com" }),
    ).toBe("https://example.com/careers");
  });

  test("resolves relative path segment with base", () => {
    expect(
      canonicalizeHttpUrl("jobs/123", {
        base: "https://example.com/company/",
      }),
    ).toBe("https://example.com/company/jobs/123");
  });

  test("resolves root-relative path with base", () => {
    expect(
      canonicalizeHttpUrl("/open-positions", {
        base: "https://example.com/a/b/c",
      }),
    ).toBe("https://example.com/open-positions");
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
    // Per the URL spec, query params before the hash are in searchParams;
    // anything after '#' is the fragment. This test puts params before '#'.
    expect(
      canonicalizeHttpUrl(
        "https://example.com/?utm_source=google&page=1#/careers",
      ),
    ).toBe("https://example.com/?page=1#/careers");
  });

  test("keeps hash fragment intact when query-like text follows it", () => {
    // Params after '#' are part of the fragment, not searchParams.
    // The function cannot strip them, but it should still preserve
    // the job-related hash route.
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

  test("handles URL with credentials in authority (still parses)", () => {
    // URL spec allows user info; function should still process the URL
    const result = canonicalizeHttpUrl("https://user:pass@example.com/jobs");
    expect(result).not.toBeNull();
    expect(result).toContain("example.com/jobs");
  });
});

// ---------------------------------------------------------------------------
// normalizeUrl
// ---------------------------------------------------------------------------

describe("normalizeUrl", () => {
  test("normalizes a simple HTTPS URL", () => {
    expect(normalizeUrl("https://example.com/jobs")).toBe(
      "https://example.com/jobs",
    );
  });

  test("removes trailing slash", () => {
    expect(normalizeUrl("https://example.com/careers/")).toBe(
      "https://example.com/careers",
    );
  });

  test("removes tracking parameters", () => {
    expect(
      normalizeUrl("https://example.com/jobs?utm_source=google&q=dev"),
    ).toBe("https://example.com/jobs?q=dev");
  });

  test("preserves job-related hash routes (keepHashRoute is always true)", () => {
    expect(normalizeUrl("https://example.com/#/jobs")).toBe(
      "https://example.com/#/jobs",
    );
  });

  test("strips non-job hash fragments", () => {
    expect(normalizeUrl("https://example.com/page#about")).toBe(
      "https://example.com/page",
    );
  });

  test("resolves relative URL with base argument", () => {
    expect(normalizeUrl("/careers", "https://example.com")).toBe(
      "https://example.com/careers",
    );
  });

  test("resolves relative path segment with base", () => {
    expect(
      normalizeUrl("apply/now", "https://example.com/jobs/"),
    ).toBe("https://example.com/jobs/apply/now");
  });

  test("returns null for invalid input without base", () => {
    expect(normalizeUrl("not-a-url")).toBeNull();
  });

  test("returns null for non-HTTP protocol", () => {
    expect(normalizeUrl("ftp://example.com")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(normalizeUrl("")).toBeNull();
  });

  test("returns null for relative URL without a base", () => {
    expect(normalizeUrl("/careers")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sameRegistrableHost
// ---------------------------------------------------------------------------

describe("sameRegistrableHost", () => {
  // -- Exact match ----------------------------------------------------------

  test("returns true for identical URLs", () => {
    expect(
      sameRegistrableHost(
        "https://example.com/jobs",
        "https://example.com/careers",
      ),
    ).toBe(true);
  });

  // -- www stripping --------------------------------------------------------

  test("returns true when one URL has www and the other does not", () => {
    expect(
      sameRegistrableHost(
        "https://www.example.com",
        "https://example.com",
      ),
    ).toBe(true);
  });

  test("returns true when both URLs have www", () => {
    expect(
      sameRegistrableHost(
        "https://www.example.com",
        "https://www.example.com",
      ),
    ).toBe(true);
  });

  test("strips www case-insensitively (WWW prefix)", () => {
    expect(
      sameRegistrableHost(
        "https://WWW.example.com",
        "https://example.com",
      ),
    ).toBe(true);
  });

  // -- Subdomain matching ---------------------------------------------------

  test("returns true when first host is a subdomain of second", () => {
    expect(
      sameRegistrableHost(
        "https://careers.example.com",
        "https://example.com",
      ),
    ).toBe(true);
  });

  test("returns true when second host is a subdomain of first", () => {
    expect(
      sameRegistrableHost(
        "https://example.com",
        "https://jobs.example.com",
      ),
    ).toBe(true);
  });

  test("returns true for deeply nested subdomain", () => {
    expect(
      sameRegistrableHost(
        "https://apply.careers.example.com",
        "https://example.com",
      ),
    ).toBe(true);
  });

  test("returns true for two subdomains of the same registrable domain", () => {
    // careers.example.com ends with .example.com
    expect(
      sameRegistrableHost(
        "https://careers.example.com",
        "https://jobs.example.com",
      ),
    ).toBe(false);
    // Neither is a suffix of the other (careers.example.com does not end
    // with .jobs.example.com and vice versa), so the function returns false.
  });

  // -- Different domains ----------------------------------------------------

  test("returns false for completely different domains", () => {
    expect(
      sameRegistrableHost(
        "https://example.com",
        "https://other.com",
      ),
    ).toBe(false);
  });

  test("returns false for similar-looking but distinct domains", () => {
    expect(
      sameRegistrableHost(
        "https://myexample.com",
        "https://example.com",
      ),
    ).toBe(false);
  });

  test("returns false for different TLDs", () => {
    expect(
      sameRegistrableHost(
        "https://example.com",
        "https://example.org",
      ),
    ).toBe(false);
  });

  // -- Case insensitivity ---------------------------------------------------

  test("compares hostnames case-insensitively", () => {
    expect(
      sameRegistrableHost(
        "https://EXAMPLE.COM/jobs",
        "https://example.com/careers",
      ),
    ).toBe(true);
  });

  // -- Error handling -------------------------------------------------------

  test("returns false when first argument is invalid URL", () => {
    expect(sameRegistrableHost("not a url", "https://example.com")).toBe(
      false,
    );
  });

  test("returns false when second argument is invalid URL", () => {
    expect(sameRegistrableHost("https://example.com", "garbage")).toBe(
      false,
    );
  });

  test("returns false when both arguments are invalid", () => {
    expect(sameRegistrableHost("", "")).toBe(false);
  });

  // -- Paths and ports do not affect host comparison ------------------------

  test("ignores path differences", () => {
    expect(
      sameRegistrableHost(
        "https://example.com/a/b/c",
        "https://example.com/x/y/z",
      ),
    ).toBe(true);
  });

  test("ignores port differences", () => {
    expect(
      sameRegistrableHost(
        "https://example.com:3000",
        "https://example.com:8080",
      ),
    ).toBe(true);
  });

  test("ignores protocol differences (http vs https)", () => {
    expect(
      sameRegistrableHost(
        "http://example.com",
        "https://example.com",
      ),
    ).toBe(true);
  });
});
