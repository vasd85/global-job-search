// ---- Mocks ----------------------------------------------------------------

// Mock Drizzle condition builders with token strings for assertion
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: string, val: unknown) => `eq(${col},${String(val)})`),
  lte: vi.fn((col: string, val: unknown) => `lte(${col},${String(val)})`),
  or: vi.fn((...args: unknown[]) => `or(${args.join(",")})`),
  and: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((col: string) => `isNull(${col})`),
}));

const mockWhere = vi.fn().mockResolvedValue([]);
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
vi.mock("@/lib/db", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  db: { select: (...args: unknown[]) => mockSelect(...args) },
}));

// Mock schema columns as identifiable strings
vi.mock("@/lib/db/schema", () => ({
  companies: {
    id: "companies.id",
    slug: "companies.slug",
    atsVendor: "companies.atsVendor",
    isActive: "companies.isActive",
    nextPollAfter: "companies.nextPollAfter",
  },
}));

// Mock VENDOR_QUEUES with the real values
vi.mock("@gjs/ingestion", () => ({
  VENDOR_QUEUES: {
    greenhouse: "poll/greenhouse",
    lever: "poll/lever",
    ashby: "poll/ashby",
    smartrecruiters: "poll/smartrecruiters",
  },
}));

const mockSend = vi.fn().mockResolvedValue("job-id-1");
const mockBoss = { send: mockSend };
const mockGetQueue = vi.fn().mockResolvedValue(mockBoss);
vi.mock("@/lib/queue", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  getQueue: (...args: unknown[]) => mockGetQueue(...args),
}));

import { POST } from "./route";

// ---- Helpers ---------------------------------------------------------------

function makeRequest(
  headers?: Record<string, string>
): Request {
  return new Request("http://localhost/api/internal/dispatch-polling", {
    method: "POST",
    headers,
  });
}

interface CompanyRow {
  id: string;
  slug: string;
  atsVendor: string;
}

function makeCompany(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: "uuid-" + (overrides.slug ?? "default"),
    slug: overrides.slug ?? "acme-corp",
    atsVendor: overrides.atsVendor ?? "greenhouse",
    ...overrides,
  };
}

// ---- Setup -----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockWhere.mockResolvedValue([]);
  mockSend.mockResolvedValue("job-id-1");
  mockGetQueue.mockResolvedValue(mockBoss);
});

// ---- Tests -----------------------------------------------------------------

// Note: DISPATCH_SECRET is captured at module load time from process.env.
// In this test file, process.env.DISPATCH_SECRET is NOT set at import time,
// so the captured value is undefined -- meaning auth is open (dev mode).
// Tests that need DISPATCH_SECRET set must use vi.resetModules() + dynamic
// re-import. Auth-specific tests are in a separate describe block below.
// TODO: The auth check uses === string comparison, not timing-safe compare.
// This is theoretically vulnerable to timing attacks but acceptable for
// an internal cron endpoint.

describe("POST /api/internal/dispatch-polling", () => {
  // --- Critical: core dispatch logic ---

  test("queries due companies and enqueues jobs into correct vendor queues", async () => {
    const companies = [
      makeCompany({ slug: "co1", atsVendor: "greenhouse" }),
      makeCompany({ slug: "co2", atsVendor: "lever" }),
      makeCompany({ slug: "co3", atsVendor: "ashby" }),
    ];
    mockWhere.mockResolvedValueOnce(companies);

    const res = await POST(makeRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ enqueued: 3, skipped: 0, failed: 0, total: 3 });

    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(mockSend).toHaveBeenCalledWith("poll/greenhouse", { companyId: "uuid-co1" });
    expect(mockSend).toHaveBeenCalledWith("poll/lever", { companyId: "uuid-co2" });
    expect(mockSend).toHaveBeenCalledWith("poll/ashby", { companyId: "uuid-co3" });
  });

  test("returns correct counts when no companies are due", async () => {
    mockWhere.mockResolvedValueOnce([]);

    const res = await POST(makeRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ enqueued: 0, skipped: 0, failed: 0, total: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("skips companies with unknown ATS vendor", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const companies = [
      makeCompany({ slug: "known", atsVendor: "greenhouse" }),
      makeCompany({ slug: "unknown", atsVendor: "workday" }),
    ];
    mockWhere.mockResolvedValueOnce(companies);

    const res = await POST(makeRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ enqueued: 1, skipped: 1, failed: 0, total: 2 });
    expect(mockSend).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("workday"),
      // The warn message also includes the slug
    );

    warnSpy.mockRestore();
  });

  test("returns 500 when DB query fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWhere.mockRejectedValueOnce(new Error("connection timeout"));

    const res = await POST(makeRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "Failed to dispatch polling jobs" });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  test("counts failed sends separately when boss.send() rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const companies = [makeCompany({ slug: "fail", atsVendor: "greenhouse" })];
    mockWhere.mockResolvedValueOnce(companies);
    mockSend.mockRejectedValueOnce(new Error("queue not found"));

    const res = await POST(makeRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = await res.json();

    // Per-send try/catch: the route returns 200 with failed count, not 500
    expect(res.status).toBe(200);
    expect(json).toEqual({ enqueued: 0, skipped: 0, failed: 1, total: 1 });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to enqueue"),
      expect.any(Error)
    );

    errorSpy.mockRestore();
  });

  // --- Important: vendor mapping and payload ---

  test("all four known vendors map to correct queues", async () => {
    const companies = [
      makeCompany({ slug: "gh", atsVendor: "greenhouse" }),
      makeCompany({ slug: "lv", atsVendor: "lever" }),
      makeCompany({ slug: "ab", atsVendor: "ashby" }),
      makeCompany({ slug: "sr", atsVendor: "smartrecruiters" }),
    ];
    mockWhere.mockResolvedValueOnce(companies);

    const res = await POST(makeRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = await res.json();

    expect(json).toEqual({ enqueued: 4, skipped: 0, failed: 0, total: 4 });
    expect(mockSend).toHaveBeenNthCalledWith(1, "poll/greenhouse", { companyId: "uuid-gh" });
    expect(mockSend).toHaveBeenNthCalledWith(2, "poll/lever", { companyId: "uuid-lv" });
    expect(mockSend).toHaveBeenNthCalledWith(3, "poll/ashby", { companyId: "uuid-ab" });
    expect(mockSend).toHaveBeenNthCalledWith(4, "poll/smartrecruiters", { companyId: "uuid-sr" });
  });

  test("DB query filters on isActive=true AND (nextPollAfter<=now OR nextPollAfter IS NULL)", async () => {
    const { eq, lte, or, and, isNull } = await import("drizzle-orm");

    await POST(makeRequest());

    // Verify the correct columns are filtered on
    expect(eq).toHaveBeenCalledWith("companies.isActive", true);
    expect(lte).toHaveBeenCalledWith("companies.nextPollAfter", expect.any(Date));
    expect(isNull).toHaveBeenCalledWith("companies.nextPollAfter");
    // or() combines the two date conditions
    expect(or).toHaveBeenCalledWith(
      expect.stringContaining("lte(companies.nextPollAfter"),
      "isNull(companies.nextPollAfter)"
    );
    // and() combines isActive with the or()
    expect(and).toHaveBeenCalledWith(
      expect.stringContaining("eq(companies.isActive"),
      expect.stringContaining("or(")
    );
  });

  test("select only fetches id, slug, and atsVendor columns", async () => {
    await POST(makeRequest());

    expect(mockSelect).toHaveBeenCalledWith({
      id: "companies.id",
      slug: "companies.slug",
      atsVendor: "companies.atsVendor",
    });
  });

  test("partial send failure -- first succeeds, second fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const companies = [
      makeCompany({ slug: "ok", atsVendor: "greenhouse" }),
      makeCompany({ slug: "fail", atsVendor: "lever" }),
    ];
    mockWhere.mockResolvedValueOnce(companies);
    mockSend
      .mockResolvedValueOnce("job-ok")
      .mockRejectedValueOnce(new Error("queue error"));

    const res = await POST(makeRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = await res.json();

    // Per-send try/catch: first job succeeds, second fails, both counted
    expect(res.status).toBe(200);
    expect(json).toEqual({ enqueued: 1, skipped: 0, failed: 1, total: 2 });

    errorSpy.mockRestore();
  });

  test("companyId in job payload is the UUID, not the slug", async () => {
    const company = makeCompany({ id: "real-uuid-abc", slug: "acme-corp", atsVendor: "lever" });
    mockWhere.mockResolvedValueOnce([company]);

    await POST(makeRequest());

    expect(mockSend).toHaveBeenCalledWith("poll/lever", { companyId: "real-uuid-abc" });
  });

  test("returns 500 when getQueue() fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWhere.mockResolvedValueOnce([makeCompany()]);
    mockGetQueue.mockRejectedValueOnce(new Error("DATABASE_URL is required"));

    const res = await POST(makeRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "Failed to dispatch polling jobs" });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  // --- Important: vendor key casing ---

  test("lowercases vendor key before VENDOR_QUEUES lookup (mixed case)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const companies = [
      makeCompany({ slug: "upper", atsVendor: "Greenhouse" }),
      makeCompany({ slug: "allcaps", atsVendor: "LEVER" }),
    ];
    mockWhere.mockResolvedValueOnce(companies);

    const res = await POST(makeRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ enqueued: 2, skipped: 0, failed: 0, total: 2 });
    expect(mockSend).toHaveBeenCalledWith("poll/greenhouse", { companyId: "uuid-upper" });
    expect(mockSend).toHaveBeenCalledWith("poll/lever", { companyId: "uuid-allcaps" });
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  // --- Nice-to-have ---

  test("company with empty string atsVendor is skipped", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockWhere.mockResolvedValueOnce([makeCompany({ slug: "empty", atsVendor: "" })]);

    const res = await POST(makeRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = await res.json();

    expect(json).toEqual({ enqueued: 0, skipped: 1, failed: 0, total: 1 });
    expect(mockSend).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test("large batch of 100 companies enqueues all sequentially", async () => {
    const companies = Array.from({ length: 100 }, (_, i) =>
      makeCompany({ slug: `co-${i}`, atsVendor: "greenhouse", id: `uuid-${i}` })
    );
    mockWhere.mockResolvedValueOnce(companies);

    const res = await POST(makeRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = await res.json();

    expect(json).toEqual({ enqueued: 100, skipped: 0, failed: 0, total: 100 });
    expect(mockSend).toHaveBeenCalledTimes(100);
  });

  // --- Integration: response shape ---

  test("successful dispatch returns 200 with JSON body containing all count fields", async () => {
    mockWhere.mockResolvedValueOnce([makeCompany()]);

    const res = await POST(makeRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json: Record<string, unknown> = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveProperty("enqueued");
    expect(json).toHaveProperty("skipped");
    expect(json).toHaveProperty("failed");
    expect(json).toHaveProperty("total");
    expect(typeof json.enqueued).toBe("number");
    expect(typeof json.skipped).toBe("number");
    expect(typeof json.failed).toBe("number");
    expect(typeof json.total).toBe("number");
  });

  test("internal server error returns 500 with safe error message, no stack trace", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWhere.mockRejectedValueOnce(
      new Error("FATAL: password authentication failed for user 'admin'")
    );

    const res = await POST(makeRequest());
    const text = await res.text();

    expect(res.status).toBe(500);
    // Response must NOT contain DB connection details
    expect(text).not.toContain("password");
    expect(text).not.toContain("admin");
    expect(text).toContain("Failed to dispatch polling jobs");

    errorSpy.mockRestore();
  });
});

// ---- Auth tests (require separate module-level DISPATCH_SECRET) --------

describe("POST /api/internal/dispatch-polling -- auth", () => {
  /**
   * Auth tests need DISPATCH_SECRET set at module load time. Since the
   * route captures process.env.DISPATCH_SECRET in a module-level const,
   * we must use vi.resetModules() + dynamic import with the env already
   * set to get the desired behavior.
   */

  async function importWithSecret(secret: string | undefined) {
    vi.resetModules();
    if (secret === undefined) {
      delete process.env.DISPATCH_SECRET;
    } else {
      vi.stubEnv("DISPATCH_SECRET", secret);
    }
    const mod = await import("./route");
    return mod.POST;
  }

  // --- Critical ---

  test("rejects request when DISPATCH_SECRET is set and Authorization header is missing", async () => {
    const handler = await importWithSecret("s3cret");

    const res = await handler(makeRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized" });
  });

  test("rejects request when Authorization header has wrong token", async () => {
    const handler = await importWithSecret("s3cret");

    const res = await handler(makeRequest({ Authorization: "Bearer wrong-token" }));

    expect(res.status).toBe(401);
  });

  test("accepts request with correct Bearer token", async () => {
    const handler = await importWithSecret("s3cret");

    const res = await handler(makeRequest({ Authorization: "Bearer s3cret" }));

    // Should proceed (not 401) -- exact status depends on DB mock
    expect(res.status).not.toBe(401);
  });

  test("allows request when DISPATCH_SECRET is not configured (dev mode)", async () => {
    const handler = await importWithSecret(undefined);

    const res = await handler(makeRequest());

    expect(res.status).not.toBe(401);
  });

  // --- Important ---

  test("rejects Basic auth scheme even with correct secret value", async () => {
    const handler = await importWithSecret("s3cret");

    const res = await handler(makeRequest({ Authorization: "Basic s3cret" }));

    expect(res.status).toBe(401);
  });

  test("rejects Bearer token with extra whitespace", async () => {
    const handler = await importWithSecret("s3cret");

    // Double space between "Bearer" and token
    const res = await handler(makeRequest({ Authorization: "Bearer  s3cret" }));

    expect(res.status).toBe(401);
  });

  test("DISPATCH_SECRET is captured at module load time, not per-request", async () => {
    // Import with initial secret
    const handler = await importWithSecret("initial");

    // Change env var after import
    vi.stubEnv("DISPATCH_SECRET", "changed");

    // Request with the initial secret should still work
    const res1 = await handler(makeRequest({ Authorization: "Bearer initial" }));
    expect(res1.status).not.toBe(401);

    // Request with the changed secret should be rejected
    const res2 = await handler(makeRequest({ Authorization: "Bearer changed" }));
    expect(res2.status).toBe(401);
  });

  test("Authorization header with empty token after Bearer is rejected", async () => {
    const handler = await importWithSecret("s3cret");

    const res = await handler(makeRequest({ Authorization: "Bearer " }));

    expect(res.status).toBe(401);
  });

  test("empty string DISPATCH_SECRET effectively disables auth", async () => {
    // TODO: Setting DISPATCH_SECRET to "" makes the const falsy, so
    // isAuthorized() returns true for all requests. This means an empty
    // secret in deployment config silently disables auth. Consider
    // validating at startup that the secret is non-empty if set.
    const handler = await importWithSecret("");

    const res = await handler(makeRequest());

    // Empty string is falsy -> auth is effectively disabled
    expect(res.status).not.toBe(401);
  });
});
