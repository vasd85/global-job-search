import type { MockInstance } from "vitest";
import type { Database } from "../db";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("./poll-company", () => ({
  pollCompany: vi.fn(),
}));

// Re-import after mock registration so the module binds to the mock.
import { pollCompany } from "./poll-company";
import { runIngestion } from "./run-ingestion";

const pollCompanyMock = pollCompany as ReturnType<typeof vi.fn>;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Minimal company row that satisfies the fields `runIngestion` reads. */
function fakeCompany(overrides: Partial<{ id: string; slug: string; isActive: boolean }> = {}) {
  return {
    id: overrides.id ?? "c-1",
    slug: overrides.slug ?? "acme",
    name: "Acme Inc",
    website: null,
    industry: null,
    atsVendor: "greenhouse",
    atsSlug: "acme",
    atsCareersUrl: null,
    source: "seed_list",
    isActive: overrides.isActive ?? true,
    lastPolledAt: null,
    lastPollStatus: null,
    lastPollError: null,
    jobsCount: 0,
    createdAt: new Date("2025-01-15T12:00:00Z"),
    updatedAt: new Date("2025-01-15T12:00:00Z"),
  };
}

function successResult(jobs = { jobsNew: 1, jobsClosed: 0, jobsUpdated: 0 }) {
  return {
    status: "ok" as const,
    jobsFound: jobs.jobsNew,
    jobsNew: jobs.jobsNew,
    jobsClosed: jobs.jobsClosed,
    jobsUpdated: jobs.jobsUpdated,
    durationMs: 10,
  };
}

function errorResult(msg = "timeout") {
  return {
    status: "error" as const,
    jobsFound: 0,
    jobsNew: 0,
    jobsClosed: 0,
    jobsUpdated: 0,
    errorMessage: msg,
    durationMs: 5,
  };
}

/**
 * Build a fake Drizzle `db` object that supports the chainable
 * `.select().from(companies).where(...)` call used by `runIngestion`.
 * Returns the provided `rows` for every query.
 *
 * Note: This mock ignores the `where` clause — it does not model the
 * `isActive` filter. If the source removes that filter, no test breaks.
 * This is acceptable since `runIngestion` is a thin orchestrator.
 */
function fakeDb(rows: ReturnType<typeof fakeCompany>[]): Database {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
  return chain as unknown as Database;
}

// ─── Setup / teardown ───────────────────────────────────────────────────────

let consoleSpy: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("runIngestion", () => {
  // --- Empty / trivial cases ---

  test("returns zero counts when no companies are active", async () => {
    const db = fakeDb([]);

    const result = await runIngestion(db);

    expect(result.totalCompanies).toBe(0);
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.totalJobsNew).toBe(0);
    expect(result.totalJobsClosed).toBe(0);
    expect(result.totalJobsUpdated).toBe(0);
    expect(result.errors).toEqual([]);
    expect(pollCompanyMock).not.toHaveBeenCalled();
  });

  // --- Single company ---

  test("aggregates a single successful poll correctly", async () => {
    const company = fakeCompany();
    const db = fakeDb([company]);
    pollCompanyMock.mockResolvedValueOnce(
      successResult({ jobsNew: 3, jobsClosed: 1, jobsUpdated: 2 })
    );

    const result = await runIngestion(db);

    expect(result.totalCompanies).toBe(1);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.totalJobsNew).toBe(3);
    expect(result.totalJobsClosed).toBe(1);
    expect(result.totalJobsUpdated).toBe(2);
    expect(result.errors).toEqual([]);
  });

  // --- Mixed results ---

  test("counts failures and collects error messages from pollCompany error status", async () => {
    const c1 = fakeCompany({ id: "c-1", slug: "good-co" });
    const c2 = fakeCompany({ id: "c-2", slug: "bad-co" });
    const db = fakeDb([c1, c2]);

    pollCompanyMock
      .mockResolvedValueOnce(successResult())
      .mockResolvedValueOnce(errorResult("rate limited"));

    const result = await runIngestion(db, { concurrency: 1 });

    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([
      { companySlug: "bad-co", error: "rate limited" },
    ]);
  });

  test.each<[string, () => void, string]>([
    [
      "thrown Error",
      () => pollCompanyMock.mockRejectedValueOnce(new Error("network failure")),
      "network failure",
    ],
    [
      "thrown non-Error value",
      () => pollCompanyMock.mockRejectedValueOnce("string error"),
      "string error",
    ],
    [
      "error status without errorMessage",
      () =>
        pollCompanyMock.mockResolvedValueOnce({
          status: "error",
          jobsFound: 0,
          jobsNew: 0,
          jobsClosed: 0,
          jobsUpdated: 0,
          durationMs: 1,
        }),
      "unknown error",
    ],
  ])(
    "records failure with correct message for %s",
    async (_scenario, setupMock, expectedError) => {
      const c1 = fakeCompany({ id: "c-1", slug: "fail-co" });
      const db = fakeDb([c1]);
      setupMock();

      const result = await runIngestion(db);

      expect(result.failed).toBe(1);
      expect(result.successful).toBe(0);
      expect(result.errors).toEqual([
        { companySlug: "fail-co", error: expectedError },
      ]);
    }
  );

  // --- Job count aggregation across multiple companies ---

  test("sums job counts across multiple companies", async () => {
    const co = [
      fakeCompany({ id: "c-1", slug: "a" }),
      fakeCompany({ id: "c-2", slug: "b" }),
      fakeCompany({ id: "c-3", slug: "c" }),
    ];
    const db = fakeDb(co);

    pollCompanyMock
      .mockResolvedValueOnce(successResult({ jobsNew: 2, jobsClosed: 0, jobsUpdated: 1 }))
      .mockResolvedValueOnce(successResult({ jobsNew: 5, jobsClosed: 3, jobsUpdated: 0 }))
      .mockResolvedValueOnce(successResult({ jobsNew: 0, jobsClosed: 1, jobsUpdated: 4 }));

    const result = await runIngestion(db, { concurrency: 1 });

    expect(result.totalJobsNew).toBe(7);
    expect(result.totalJobsClosed).toBe(4);
    expect(result.totalJobsUpdated).toBe(5);
    expect(result.successful).toBe(3);
  });

  // TODO: When pollCompany returns status "error", runIngestion still adds
  // jobsNew/jobsClosed/jobsUpdated to totals (lines 76-78). This means error
  // results with non-zero job counts would inflate totals. In practice
  // pollCompany returns zeroes on error, but the aggregation logic doesn't
  // guard against it. Consider whether failed polls should skip accumulation.

  // --- DB failure ---

  // TODO: runIngestion does not wrap the DB query in try/catch, so a DB
  // failure surfaces as an unhandled rejection. Consider wrapping the query
  // and returning a structured error instead of letting it propagate.
  test("propagates DB query errors as unhandled rejections", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockRejectedValue(new Error("connection refused")),
    };
    const db = chain as unknown as Database;

    await expect(runIngestion(db)).rejects.toThrow("connection refused");
  });

  // --- companyIds filter ---

  test("filters companies by companyIds when provided", async () => {
    const c1 = fakeCompany({ id: "c-1", slug: "wanted" });
    const c2 = fakeCompany({ id: "c-2", slug: "unwanted" });
    const db = fakeDb([c1, c2]);

    pollCompanyMock.mockResolvedValue(successResult());

    const result = await runIngestion(db, { companyIds: ["c-1"] });

    expect(result.totalCompanies).toBe(1);
    expect(pollCompanyMock).toHaveBeenCalledTimes(1);
    expect(pollCompanyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "c-1" })
    );
  });

  // TODO: The companyIds filter (lines 33-38) fetches ALL active companies
  // from the DB and then filters in JS with Array.filter. This is
  // inefficient for large company tables. The SQL query should use an `inArray`
  // clause instead.

  test("polls all companies when companyIds is an empty array", async () => {
    const c1 = fakeCompany({ id: "c-1", slug: "a" });
    const c2 = fakeCompany({ id: "c-2", slug: "b" });
    const db = fakeDb([c1, c2]);

    pollCompanyMock.mockResolvedValue(successResult());

    const result = await runIngestion(db, { companyIds: [] });

    expect(result.totalCompanies).toBe(2);
    expect(pollCompanyMock).toHaveBeenCalledTimes(2);
  });

  // --- Duration ---

  test("computes a non-negative durationMs", async () => {
    const db = fakeDb([fakeCompany()]);
    pollCompanyMock.mockResolvedValueOnce(successResult());

    const result = await runIngestion(db);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // --- Console logging ---

  test("logs summary after ingestion completes", async () => {
    const db = fakeDb([fakeCompany()]);
    pollCompanyMock.mockResolvedValueOnce(successResult({ jobsNew: 2, jobsClosed: 0, jobsUpdated: 1 }));

    await runIngestion(db);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Ingestion] Done:")
    );
  });

  test("logs error details when there are failures", async () => {
    const c1 = fakeCompany({ id: "c-1", slug: "fail-co" });
    const db = fakeDb([c1]);
    pollCompanyMock.mockResolvedValueOnce(errorResult("bad request"));

    await runIngestion(db);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Ingestion] Errors"),
      expect.stringContaining("fail-co")
    );
  });

  // --- Concurrency ---

  test("launches at most `concurrency` parallel workers", async () => {
    const numCompanies = 6;
    const concurrency = 2;
    const co = Array.from({ length: numCompanies }, (_, i) =>
      fakeCompany({ id: `c-${i}`, slug: `co-${i}` })
    );
    const db = fakeDb(co);

    // Track how many polls are running concurrently at peak.
    let inFlight = 0;
    let maxInFlight = 0;

    pollCompanyMock.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Simulate async work so the event loop can interleave workers.
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return successResult();
    });

    await runIngestion(db, { concurrency });

    expect(pollCompanyMock).toHaveBeenCalledTimes(numCompanies);
    expect(maxInFlight).toBeLessThanOrEqual(concurrency);
  });

  test("processes all companies when fewer than default concurrency", async () => {
    const co = Array.from({ length: 3 }, (_, i) =>
      fakeCompany({ id: `c-${i}`, slug: `co-${i}` })
    );
    const db = fakeDb(co);
    pollCompanyMock.mockResolvedValue(successResult());

    const result = await runIngestion(db);

    expect(result.totalCompanies).toBe(3);
    expect(result.successful).toBe(3);
  });
});
