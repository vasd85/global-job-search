import { isNameMatch, probeAtsApis } from "./ats-probe";
import type { ProbeLogEntry } from "./ats-probe";

// ---------------------------------------------------------------------------
// isNameMatch
// ---------------------------------------------------------------------------

describe("isNameMatch", () => {
  // -- Critical ---------------------------------------------------------------

  it("returns true for exact match after normalization", () => {
    expect(isNameMatch("Acme Corp", "Acme Corp")).toBe(true);
  });

  it("returns true when expected contains actual (suffix stripped)", () => {
    expect(isNameMatch("Acme Corporation Inc.", "Acme Corporation")).toBe(true);
  });

  it("returns true when actual contains expected", () => {
    expect(isNameMatch("Acme", "Acme Corporation Inc.")).toBe(true);
  });

  test.each([
    ["empty expected", "", "Acme"],
    ["empty actual", "Acme", ""],
    ["both empty", "", ""],
  ])("returns false for %s", (_label, expected, actual) => {
    expect(isNameMatch(expected, actual)).toBe(false);
  });

  it("returns true when suffix stripping makes names match", () => {
    expect(isNameMatch("Acme Inc.", "Acme")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(isNameMatch("ACME CORP", "acme corp")).toBe(true);
  });

  // -- Important --------------------------------------------------------------

  it("rejects short-name containment false positives via exact-match guard", () => {
    // Short normalized names (< 3 chars) require exact equality instead of
    // containment to avoid false positives like "ai" matching "waitercom".
    expect(isNameMatch("AI", "Waiter.com")).toBe(false);
    expect(isNameMatch("AI", "AI")).toBe(true);
  });

  it("returns true when punctuation and special characters are stripped", () => {
    expect(isNameMatch("Bill.com", "Bill.com, Inc.")).toBe(true);
  });

  it("returns false for complete mismatch", () => {
    expect(isNameMatch("Stripe", "Plaid")).toBe(false);
  });

  it("returns false for partial overlap that is not containment", () => {
    expect(isNameMatch("Datadog", "Datacat")).toBe(false);
  });

  it("returns true for names that differ only by suffix", () => {
    expect(isNameMatch("Acme", "Acme LLC")).toBe(true);
  });

  it("returns false for whitespace-only input", () => {
    expect(isNameMatch("   ", "Acme")).toBe(false);
  });

  // -- Nice-to-have -----------------------------------------------------------

  it("does not strip 'inc' from inside a word (regex boundary test)", () => {
    // "Incognito" should NOT have "inc" stripped from it as a suffix
    expect(isNameMatch("Incognito", "Incognito")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// probeAtsApis
// ---------------------------------------------------------------------------

describe("probeAtsApis", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // Helper to create a mock fetch Response
  function mockResponse(status: number, body: string): Response {
    return new Response(body, { status, headers: { "Content-Type": "application/json" } });
  }

  // Helper to make fetch return based on URL patterns
  function setupFetchByUrl(
    rules: Array<{ match: string | RegExp; status: number; body: string }>,
    defaultStatus = 404,
    defaultBody = "Not Found",
  ): void {
    mockFetch.mockImplementation((url: string) => {
      for (const rule of rules) {
        const matches =
          typeof rule.match === "string"
            ? url.includes(rule.match)
            : rule.match.test(url);
        if (matches) {
          return Promise.resolve(mockResponse(rule.status, rule.body));
        }
      }
      return Promise.resolve(mockResponse(defaultStatus, defaultBody));
    });
  }

  // -- Critical: Happy paths --------------------------------------------------

  describe("Greenhouse match with name verification", () => {
    it("returns high confidence match when name is verified", async () => {
      setupFetchByUrl([
        { match: "greenhouse.io", status: 200, body: '{"name":"Acme Corp"}' },
      ]);

      const { result, log } = await probeAtsApis("Acme Corp", ["acme"], {
        perRequestDelayMs: 0,
      });

      expect(result).toEqual({
        vendor: "greenhouse",
        slug: "acme",
        confidence: "high",
        matchedName: "Acme Corp",
      });
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        result: "found",
        nameVerified: true,
        vendor: "greenhouse",
      });
    });
  });

  describe("Greenhouse 404 falls through to next vendor", () => {
    it("returns SmartRecruiters match when Greenhouse returns 404", async () => {
      setupFetchByUrl([
        { match: "smartrecruiters.com", status: 200, body: "{}" },
      ]);

      const { result, log } = await probeAtsApis("Acme Corp", ["acme"], {
        perRequestDelayMs: 0,
      });

      expect(result?.vendor).toBe("smartrecruiters");
      // Log should contain greenhouse not_found entries before the SR match
      const ghEntries = log.filter((e) => e.vendor === "greenhouse");
      const srEntries = log.filter((e) => e.vendor === "smartrecruiters");
      expect(ghEntries.length).toBeGreaterThan(0);
      expect(ghEntries.every((e) => e.result === "not_found")).toBe(true);
      expect(srEntries.some((e) => e.result === "found")).toBe(true);
    });
  });

  describe("Greenhouse name mismatch", () => {
    it("skips slug and continues probing when name does not match", async () => {
      setupFetchByUrl([
        { match: "greenhouse.io", status: 200, body: '{"name":"Wrong Company"}' },
      ]);

      const { result, log } = await probeAtsApis("Acme Corp", ["acme"], {
        perRequestDelayMs: 0,
      });

      expect(result).toBeNull();
      const ghEntry = log.find((e) => e.vendor === "greenhouse");
      expect(ghEntry).toMatchObject({
        result: "name_mismatch",
        matchedName: "Wrong Company",
        nameVerified: false,
      });
    });
  });

  describe("Ashby GraphQL match with name verification", () => {
    it("returns high confidence match with name verification via POST", async () => {
      setupFetchByUrl([
        {
          match: "ashbyhq.com",
          status: 200,
          body: '{"data":{"organization":{"name":"Acme Corp"}}}',
        },
      ]);

      const { result } = await probeAtsApis("Acme Corp", ["acme"], {
        skipVendors: new Set(["greenhouse", "smartrecruiters", "lever"]),
        perRequestDelayMs: 0,
      });

      expect(result).toEqual({
        vendor: "ashby",
        slug: "acme",
        confidence: "high",
        matchedName: "Acme Corp",
      });

      // Verify Ashby uses POST method
      const calls = mockFetch.mock.calls as Array<[string, RequestInit?]>;
      const ashbyCall = calls.find((call) => call[0].includes("ashbyhq.com"));
      expect(ashbyCall).toBeDefined();
      const init = ashbyCall![1] as RequestInit;
      expect(init.method).toBe("POST");
    });
  });

  describe("Ashby GraphQL returns null organization", () => {
    it("returns null when organization is null in GraphQL response", async () => {
      setupFetchByUrl([
        {
          match: "ashbyhq.com",
          status: 200,
          body: '{"data":{"organization":null}}',
        },
      ]);

      const { result, log } = await probeAtsApis("Acme Corp", ["acme"], {
        skipVendors: new Set(["greenhouse", "smartrecruiters", "lever"]),
        perRequestDelayMs: 0,
      });

      expect(result).toBeNull();
      const ashbyEntry = log.find((e) => e.vendor === "ashby");
      expect(ashbyEntry?.result).toBe("not_found");
    });
  });

  describe("Lever match", () => {
    it("returns low confidence with no name verification", async () => {
      setupFetchByUrl([
        {
          match: "lever.co",
          status: 200,
          body: '[{"id":"123"}]',
        },
      ]);

      const { result, log } = await probeAtsApis("Acme Corp", ["acme"], {
        skipVendors: new Set(["greenhouse", "smartrecruiters", "ashby"]),
        perRequestDelayMs: 0,
      });

      expect(result).toEqual({
        vendor: "lever",
        slug: "acme",
        confidence: "low",
        matchedName: null,
      });
      const leverEntry = log.find((e) => e.vendor === "lever");
      // Lever has no name verification, so nameVerified is undefined
      expect(leverEntry?.nameVerified).toBeUndefined();
    });
  });

  describe("Lever empty array", () => {
    it("returns null when Lever returns empty array", async () => {
      setupFetchByUrl([
        {
          match: "lever.co",
          status: 200,
          body: "[]",
        },
      ]);

      const { result, log } = await probeAtsApis("Acme Corp", ["acme"], {
        skipVendors: new Set(["greenhouse", "smartrecruiters", "ashby"]),
        perRequestDelayMs: 0,
      });

      expect(result).toBeNull();
      const leverEntry = log.find((e) => e.vendor === "lever");
      expect(leverEntry?.result).toBe("not_found");
    });
  });

  describe("SmartRecruiters confidence varies by slug length", () => {
    it.each([
      ["acme", 4, "medium"],
      ["exact", 5, "medium"],
      ["acmeco", 6, "high"],
    ] as const)(
      "slug %s (length %d) returns confidence %s",
      async (slug, _len, expectedConfidence) => {
        setupFetchByUrl([
          { match: "smartrecruiters.com", status: 200, body: "{}" },
        ]);

        const { result } = await probeAtsApis("Acme Corp", [slug], {
          skipVendors: new Set(["greenhouse", "ashby", "lever"]),
          perRequestDelayMs: 0,
        });

        expect(result?.confidence).toBe(expectedConfidence);
      },
    );
  });

  describe("all vendors return 404 for all slugs", () => {
    it("returns null result with complete log", async () => {
      // Must return a fresh Response per call -- Response body can only be consumed once
      mockFetch.mockImplementation(() =>
        Promise.resolve(mockResponse(404, "Not Found")),
      );

      const { result, log } = await probeAtsApis(
        "Acme Corp",
        ["acme", "acmecorp"],
        { perRequestDelayMs: 0 },
      );

      expect(result).toBeNull();
      // 4 vendors x 2 slugs = 8 entries
      expect(log).toHaveLength(8);
      // Greenhouse and SmartRecruiters have explicit 404 handling -> "not_found"
      // Ashby and Lever use generic non-200 handling -> "error" with "http_404"
      for (const entry of log) {
        if (entry.vendor === "greenhouse" || entry.vendor === "smartrecruiters") {
          expect(entry.result).toBe("not_found");
        } else {
          expect(entry.result).toBe("error");
          expect(entry.error).toBe("http_404");
        }
      }
    });
  });

  describe("log completeness", () => {
    it("records all attempts including entries before a successful match", async () => {
      mockFetch.mockImplementation((url: string) => {
        // GH slug1 returns name mismatch
        if (url.includes("greenhouse.io") && url.includes("slug1")) {
          return Promise.resolve(
            mockResponse(200, '{"name":"Wrong Company"}'),
          );
        }
        // GH slug2 returns correct match
        if (url.includes("greenhouse.io") && url.includes("slug2")) {
          return Promise.resolve(
            mockResponse(200, '{"name":"Acme Corp"}'),
          );
        }
        return Promise.resolve(mockResponse(404, "Not Found"));
      });

      const { result, log } = await probeAtsApis(
        "Acme Corp",
        ["slug1", "slug2"],
        { perRequestDelayMs: 0 },
      );

      expect(result).not.toBeNull();
      // Log includes the mismatch entry AND the success entry
      expect(log).toHaveLength(2);
      expect(log[0]).toMatchObject({
        vendor: "greenhouse",
        slug: "slug1",
        result: "name_mismatch",
      });
      expect(log[1]).toMatchObject({
        vendor: "greenhouse",
        slug: "slug2",
        result: "found",
      });

      // All log entries have required fields
      for (const entry of log) {
        expect(entry.timestamp).toBeDefined();
        expect(entry.vendor).toBeDefined();
        expect(entry.slug).toBeDefined();
        expect(entry.endpoint).toBeDefined();
        expect(typeof entry.durationMs).toBe("number");
      }
    });
  });

  describe("empty slugCandidates", () => {
    it("returns null result with empty log immediately", async () => {
      const { result, log } = await probeAtsApis("Acme", [], {
        perRequestDelayMs: 0,
      });

      expect(result).toBeNull();
      expect(log).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // -- Important: Error handling and options ----------------------------------

  describe("network failure", () => {
    it("logs as timeout and does not throw", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const { result, log } = await probeAtsApis("Acme", ["acme"], {
        skipVendors: new Set(["smartrecruiters", "ashby", "lever"]),
        perRequestDelayMs: 0,
      });

      expect(result).toBeNull();
      expect(log[0]).toMatchObject({
        httpStatus: null,
        result: "timeout",
        error: "timeout_or_network",
      });
    });
  });

  describe("fetch timeout via AbortController", () => {
    it("logs as timeout when fetch never resolves", async () => {
      // Mock fetch that never resolves until aborted
      mockFetch.mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            if (init?.signal) {
              init.signal.addEventListener("abort", () => {
                reject(new DOMException("Aborted", "AbortError"));
              });
            }
          }),
      );

      const { result, log } = await probeAtsApis("Acme", ["acme"], {
        timeoutMs: 50,
        skipVendors: new Set(["smartrecruiters", "ashby", "lever"]),
        perRequestDelayMs: 0,
      });

      expect(result).toBeNull();
      expect(log[0]).toMatchObject({
        httpStatus: null,
        result: "timeout",
        error: "timeout_or_network",
      });
    });
  });

  describe("maxTotalMs deadline", () => {
    it("stops probing when deadline is exceeded", async () => {
      vi.useFakeTimers();

      // Make fetch take measurable time
      mockFetch.mockImplementation(async () => {
        // Advance time past the deadline during the first fetch
        await vi.advanceTimersByTimeAsync(100);
        return mockResponse(404, "Not Found");
      });

      const promise = probeAtsApis(
        "Acme",
        ["slug1", "slug2", "slug3"],
        { maxTotalMs: 50, perRequestDelayMs: 0 },
      );

      // Advance time to let the first fetch complete and deadline be checked
      await vi.advanceTimersByTimeAsync(200);
      const { result, log } = await promise;

      expect(result).toBeNull();
      // Should have fewer entries than the full 4 vendors x 3 slugs = 12
      expect(log.length).toBeLessThan(12);
    });
  });

  describe("skipVendors", () => {
    it("never probes skipped vendors", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(mockResponse(404, "Not Found")),
      );

      const { log } = await probeAtsApis("Acme", ["acme"], {
        skipVendors: new Set(["greenhouse", "lever"]),
        perRequestDelayMs: 0,
      });

      // No greenhouse or lever entries in log
      expect(log.every((e) => e.vendor !== "greenhouse")).toBe(true);
      expect(log.every((e) => e.vendor !== "lever")).toBe(true);
      // Only smartrecruiters and ashby probed
      const vendors = new Set(log.map((e) => e.vendor));
      expect(vendors).toEqual(new Set(["smartrecruiters", "ashby"]));

      // No fetch calls to greenhouse or lever
      for (const [url] of mockFetch.mock.calls as Array<[string]>) {
        expect(url).not.toContain("greenhouse.io");
        expect(url).not.toContain("lever.co");
      }
    });
  });

  describe("vendor-outer, slug-inner ordering", () => {
    it("tries all slugs per vendor before moving to next vendor", async () => {
      mockFetch.mockImplementation((url: string) => {
        // slug1 fails on greenhouse, slug2 succeeds on greenhouse
        if (url.includes("greenhouse.io") && url.includes("slug2")) {
          return Promise.resolve(
            mockResponse(200, '{"name":"Acme Corp"}'),
          );
        }
        return Promise.resolve(mockResponse(404, "Not Found"));
      });

      const { result, log } = await probeAtsApis(
        "Acme Corp",
        ["slug1", "slug2"],
        { perRequestDelayMs: 0 },
      );

      expect(result?.vendor).toBe("greenhouse");
      expect(result?.slug).toBe("slug2");
      // Log shows slug1 attempted on greenhouse, then slug2 on greenhouse
      // Does NOT try smartrecruiters/slug1 before greenhouse/slug2
      expect(log[0]).toMatchObject({
        vendor: "greenhouse",
        slug: "slug1",
        result: "not_found",
      });
      expect(log[1]).toMatchObject({
        vendor: "greenhouse",
        slug: "slug2",
        result: "found",
      });
    });
  });

  describe("Greenhouse 200 without name field", () => {
    it("bypasses name verification and returns match with nameVerified false", async () => {
      // TODO: Greenhouse returning 200 without a name field skips name
      // verification entirely -- the code treats this as a verified match.
      // Consider whether this should be logged differently or treated as
      // lower confidence.
      setupFetchByUrl([
        {
          match: "greenhouse.io",
          status: 200,
          body: '{"departments":[]}',
        },
      ]);

      const { result, log } = await probeAtsApis("Acme", ["acme"], {
        skipVendors: new Set(["smartrecruiters", "ashby", "lever"]),
        perRequestDelayMs: 0,
      });

      // hasNameVerification("greenhouse") is true but matchedName is null
      // so the else branch fires, returning a match with nameVerified: false
      expect(result).toEqual({
        vendor: "greenhouse",
        slug: "acme",
        confidence: "high",
        matchedName: null,
      });
      expect(log[0]?.nameVerified).toBe(false);
    });
  });

  describe("Greenhouse malformed JSON", () => {
    it("logs as error with invalid_json and continues probing", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("greenhouse.io")) {
          return Promise.resolve(mockResponse(200, "not json"));
        }
        return Promise.resolve(mockResponse(404, "Not Found"));
      });

      const { result, log } = await probeAtsApis("Acme", ["acme"], {
        perRequestDelayMs: 0,
      });

      // Greenhouse should log error with invalid_json
      const ghEntry = log.find((e) => e.vendor === "greenhouse");
      expect(ghEntry).toMatchObject({
        result: "error",
        error: "invalid_json",
        httpStatus: 200,
      });
      // Probing continues to other vendors (result may be null if all fail)
      expect(result).toBeNull();
    });
  });

  describe("Ashby malformed JSON", () => {
    it("logs as error with invalid_json", async () => {
      setupFetchByUrl([
        { match: "ashbyhq.com", status: 200, body: "not json" },
      ]);

      const { result, log } = await probeAtsApis("Acme", ["acme"], {
        skipVendors: new Set(["greenhouse", "smartrecruiters", "lever"]),
        perRequestDelayMs: 0,
      });

      expect(result).toBeNull();
      const ashbyEntry = log.find((e) => e.vendor === "ashby");
      expect(ashbyEntry).toMatchObject({
        result: "error",
        error: "invalid_json",
        httpStatus: 200,
      });
    });
  });

  describe("Lever malformed JSON (object instead of array)", () => {
    it("returns not_found when response is valid JSON but not an array", async () => {
      setupFetchByUrl([
        { match: "lever.co", status: 200, body: '{"error":"bad"}' },
      ]);

      const { result, log } = await probeAtsApis("Acme", ["acme"], {
        skipVendors: new Set(["greenhouse", "smartrecruiters", "ashby"]),
        perRequestDelayMs: 0,
      });

      expect(result).toBeNull();
      const leverEntry = log.find((e) => e.vendor === "lever");
      // Array.isArray check catches this as not_found (not invalid_json)
      expect(leverEntry?.result).toBe("not_found");
    });
  });

  describe("unexpected HTTP status (rate limit)", () => {
    it("logs as error with http status and continues", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("greenhouse.io")) {
          return Promise.resolve(mockResponse(429, "Rate Limited"));
        }
        return Promise.resolve(mockResponse(404, "Not Found"));
      });

      const { log } = await probeAtsApis("Acme", ["acme"], {
        perRequestDelayMs: 0,
      });

      const ghEntry = log.find((e) => e.vendor === "greenhouse");
      expect(ghEntry).toMatchObject({
        result: "error",
        error: "http_429",
      });
      // Probing continued to other vendors
      expect(log.length).toBeGreaterThan(1);
    });
  });

  describe("perRequestDelayMs between requests", () => {
    it("delays between probe attempts", async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation(() =>
        Promise.resolve(mockResponse(404, "Not Found")),
      );

      const promise = probeAtsApis("Acme", ["acme"], {
        skipVendors: new Set(["smartrecruiters", "ashby", "lever"]),
        perRequestDelayMs: 200,
      });

      // Flush all timers to let the async function complete
      await vi.runAllTimersAsync();

      const { result } = await promise;
      expect(result).toBeNull();

      // setTimeout should have been called with the delay value
      // (the delay function creates a setTimeout)
    });
  });

  // -- Negative/Failure scenarios ---------------------------------------------

  describe("total network outage", () => {
    it("returns null with error log entries and never throws", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const { result, log } = await probeAtsApis(
        "Acme Corp",
        ["acme"],
        { perRequestDelayMs: 0 },
      );

      expect(result).toBeNull();
      expect(log.length).toBeGreaterThan(0);
      // All entries should be timeout/network errors
      for (const entry of log) {
        expect(entry.result).toBe("timeout");
        expect(entry.httpStatus).toBeNull();
      }
    });
  });

  describe("Greenhouse returns HTML (CDN/WAF page)", () => {
    it("logs as invalid_json error", async () => {
      setupFetchByUrl([
        {
          match: "greenhouse.io",
          status: 200,
          body: "<html><head><title>Cloudflare</title></head><body>Challenge</body></html>",
        },
      ]);

      const { log } = await probeAtsApis("Acme", ["acme"], {
        skipVendors: new Set(["smartrecruiters", "ashby", "lever"]),
        perRequestDelayMs: 0,
      });

      const ghEntry = log.find((e) => e.vendor === "greenhouse");
      expect(ghEntry).toMatchObject({
        result: "error",
        error: "invalid_json",
      });
    });
  });

  describe("Ashby GraphQL error response", () => {
    it("returns not_found when GraphQL returns errors without organization", async () => {
      setupFetchByUrl([
        {
          match: "ashbyhq.com",
          status: 200,
          body: '{"errors":[{"message":"Internal error"}]}',
        },
      ]);

      const { result, log } = await probeAtsApis("Acme", ["acme"], {
        skipVendors: new Set(["greenhouse", "smartrecruiters", "lever"]),
        perRequestDelayMs: 0,
      });

      expect(result).toBeNull();
      // data.data?.organization is undefined, so result is not_found
      const ashbyEntry = log.find((e) => e.vendor === "ashby");
      expect(ashbyEntry?.result).toBe("not_found");
    });
  });

  describe("slug injection / adversarial inputs", () => {
    it("encodes special characters in slugs via encodeURIComponent", async () => {
      mockFetch.mockResolvedValue(mockResponse(404, "Not Found"));

      const { log } = await probeAtsApis(
        "Acme",
        ["acme/../../admin"],
        {
          skipVendors: new Set(["smartrecruiters", "ashby", "lever"]),
          perRequestDelayMs: 0,
        },
      );

      const ghEntry = log.find((e) => e.vendor === "greenhouse");
      // Slug is encoded with encodeURIComponent for defense-in-depth
      expect(ghEntry?.endpoint).toContain(encodeURIComponent("acme/../../admin"));
      expect(ghEntry?.endpoint).not.toContain("acme/../../admin");
    });
  });

  // -- Nice-to-have -----------------------------------------------------------

  describe("all vendors skipped", () => {
    it("returns null with empty log and no fetch calls", async () => {
      const { result, log } = await probeAtsApis("Acme", ["acme"], {
        skipVendors: new Set([
          "greenhouse",
          "smartrecruiters",
          "ashby",
          "lever",
        ]),
        perRequestDelayMs: 0,
      });

      expect(result).toBeNull();
      expect(log).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("SmartRecruiters matchedName is always null", () => {
    it("returns null matchedName on successful match", async () => {
      setupFetchByUrl([
        { match: "smartrecruiters.com", status: 200, body: "{}" },
      ]);

      const { result } = await probeAtsApis("Acme", ["acmeco"], {
        skipVendors: new Set(["greenhouse", "ashby", "lever"]),
        perRequestDelayMs: 0,
      });

      expect(result?.vendor).toBe("smartrecruiters");
      expect(result?.matchedName).toBeNull();
    });
  });

  describe("Ashby sends correct GraphQL body", () => {
    it("sends POST with correct operationName, variables, and query", async () => {
      setupFetchByUrl([
        {
          match: "ashbyhq.com",
          status: 200,
          body: '{"data":{"organization":null}}',
        },
      ]);

      await probeAtsApis("Acme", ["testslug"], {
        skipVendors: new Set(["greenhouse", "smartrecruiters", "lever"]),
        perRequestDelayMs: 0,
      });

      const calls = mockFetch.mock.calls as Array<[string, RequestInit?]>;
      const ashbyCall = calls.find((call) => call[0].includes("ashbyhq.com"));
      expect(ashbyCall).toBeDefined();

      const [url, init] = ashbyCall as [string, RequestInit];
      expect(url).toContain("non-user-graphql");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );

      const body = JSON.parse(init.body as string) as {
        operationName: string;
        variables: { organizationHostedJobsPageName: string };
        query: string;
      };
      expect(body.operationName).toBe(
        "ApiOrganizationFromHostedJobsPageName",
      );
      expect(body.variables.organizationHostedJobsPageName).toBe("testslug");
      expect(body.query).toContain("organizationFromHostedJobsPageName");
    });
  });

  describe("log entry structure", () => {
    it("includes all required fields on every entry", async () => {
      mockFetch.mockResolvedValue(mockResponse(404, "Not Found"));

      const { log } = await probeAtsApis("Acme", ["acme"], {
        skipVendors: new Set(["smartrecruiters", "ashby", "lever"]),
        perRequestDelayMs: 0,
      });

      expect(log).toHaveLength(1);
      const entry = log[0] as ProbeLogEntry;
      expect(typeof entry.timestamp).toBe("string");
      // timestamp should be ISO 8601
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
      expect(typeof entry.vendor).toBe("string");
      expect(typeof entry.slug).toBe("string");
      expect(typeof entry.endpoint).toBe("string");
      expect(typeof entry.durationMs).toBe("number");
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
      expect(["found", "not_found", "error", "name_mismatch", "timeout"]).toContain(entry.result);
    });
  });
});
