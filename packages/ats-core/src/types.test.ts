import { createEmptyDiagnostics, ATS_VENDORS, DETAIL_FETCH_STATUSES } from "./types";

describe("createEmptyDiagnostics", () => {
  test("returns a Diagnostics object with all fields at zero/empty state", () => {
    const d = createEmptyDiagnostics();

    expect(d).toEqual({
      attempted_urls: [],
      search_queries: [],
      last_reachable_url: null,
      attempts: 0,
      http_status: null,
      errors: [],
      notes: [],
    });
  });

  test("returns a new object on each call (no shared references)", () => {
    const a = createEmptyDiagnostics();
    const b = createEmptyDiagnostics();

    expect(a).not.toBe(b);
    expect(a.attempted_urls).not.toBe(b.attempted_urls);
    expect(a.errors).not.toBe(b.errors);
  });

  test("returned arrays are mutable and independent", () => {
    const a = createEmptyDiagnostics();
    const b = createEmptyDiagnostics();

    a.attempted_urls.push("https://example.com");
    a.attempts = 5;

    expect(b.attempted_urls).toHaveLength(0);
    expect(b.attempts).toBe(0);
  });
});

describe("ATS_VENDORS constant", () => {
  test("contains all expected vendors", () => {
    expect(ATS_VENDORS).toContain("greenhouse");
    expect(ATS_VENDORS).toContain("lever");
    expect(ATS_VENDORS).toContain("ashby");
    expect(ATS_VENDORS).toContain("smartrecruiters");
    expect(ATS_VENDORS).toContain("unknown");
  });

  test("is a readonly tuple (frozen at the type level)", () => {
    expect(Array.isArray(ATS_VENDORS)).toBe(true);
    expect(ATS_VENDORS.length).toBeGreaterThan(0);
  });
});

describe("DETAIL_FETCH_STATUSES constant", () => {
  test.each(["ok", "failed", "not_supported"] as const)(
    "contains status %s",
    (status) => {
      expect(DETAIL_FETCH_STATUSES).toContain(status);
    },
  );
});
