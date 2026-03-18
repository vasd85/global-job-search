// @vitest-environment node
import { createHash } from "node:crypto";
import type { AllJob, ExtractionResult } from "@gjs/ats-core";
import { companies, jobs, pollLogs } from "../db/schema";

// ---------------------------------------------------------------------------
// Mock @gjs/ats-core — we control what extractors and helpers return
// ---------------------------------------------------------------------------
const mockExtractFromGreenhouse = vi.fn<() => Promise<ExtractionResult>>();
const mockExtractFromLever = vi.fn<() => Promise<ExtractionResult>>();
const mockExtractFromAshby = vi.fn<() => Promise<ExtractionResult>>();
const mockExtractFromSmartRecruiters = vi.fn<() => Promise<ExtractionResult>>();
const mockBuildCareersUrl = vi.fn(
  (vendor: string, slug: string) => `https://mock.ats/${vendor}/${slug}`
);
const mockSha256 = vi.fn((input: string) =>
  createHash("sha256").update(input).digest("hex")
);

vi.mock("@gjs/ats-core", () => ({
  extractFromGreenhouse: mockExtractFromGreenhouse,
  extractFromLever: mockExtractFromLever,
  extractFromAshby: mockExtractFromAshby,
  extractFromSmartRecruiters: mockExtractFromSmartRecruiters,
  buildCareersUrl: mockBuildCareersUrl,
  createEmptyDiagnostics: () => ({
    attempted_urls: [],
    search_queries: [],
    last_reachable_url: null,
    attempts: 0,
    http_status: null,
    errors: [],
    notes: [],
  }),
  sha256: mockSha256,
}));

const { pollCompany } = await import("./poll-company");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2025-06-15T12:00:00Z");

function expectedHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function makeFakeJob(overrides: Partial<AllJob> = {}): AllJob {
  return {
    job_uid: "uid-1",
    job_id: "ats-1",
    title: "Software Engineer",
    url: "https://example.com/jobs/1",
    canonical_url: "https://example.com/jobs/1",
    location_raw: "Remote",
    department_raw: "Engineering",
    posted_date_raw: "2025-01-01",
    employment_type_raw: "Full-time",
    description_text: "Build things.",
    source_type: "ats_api",
    source_ref: "greenhouse",
    ...overrides,
  };
}

function makeFakeCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: "company-uuid-1",
    slug: "acme",
    name: "Acme Corp",
    website: "https://acme.com",
    industry: null,
    atsVendor: "greenhouse",
    atsSlug: "acme",
    atsCareersUrl: "https://boards.greenhouse.io/acme",
    source: "seed_list",
    isActive: true,
    lastPolledAt: null,
    lastPollStatus: null,
    lastPollError: null,
    jobsCount: 0,
    createdAt: new Date("2025-01-01T12:00:00Z"),
    updatedAt: new Date("2025-01-01T12:00:00Z"),
    ...overrides,
  };
}

/** Build a mock Drizzle db with chainable methods and table-aware tracking. */
function makeMockDb(storedOpenJobs: Record<string, unknown>[] = []) {
  const insertedRows: Array<{ _table: unknown } & Record<string, unknown>> = [];
  const updatedSets: Array<{ _table: unknown } & Record<string, unknown>> = [];

  const insertFn = vi.fn().mockImplementation((table: unknown) => ({
    values: vi.fn().mockImplementation((row: Record<string, unknown>) => {
      insertedRows.push({ _table: table, ...row });
      return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) };
    }),
  }));

  const updateFn = vi.fn().mockImplementation((table: unknown) => ({
    set: vi.fn().mockImplementation((data: Record<string, unknown>) => {
      updatedSets.push({ _table: table, ...data });
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));

  const selectWhere = vi.fn().mockResolvedValue(storedOpenJobs);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  const db = { select: selectFn, insert: insertFn, update: updateFn };

  return {
    db: db as unknown as Parameters<typeof pollCompany>[0],
    insertedRows,
    updatedSets,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── fetchJobsFromAts (vendor dispatch) ─────────────────────────────────────

describe("pollCompany — vendor dispatch", () => {
  const vendorExtractorPairs = [
    ["greenhouse", mockExtractFromGreenhouse],
    ["lever", mockExtractFromLever],
    ["ashby", mockExtractFromAshby],
    ["smartrecruiters", mockExtractFromSmartRecruiters],
  ] as const;

  test.each(vendorExtractorPairs)(
    "routes %s to the correct extractor",
    async (vendor, mockExtractor) => {
      const job = makeFakeJob({ source_ref: vendor as AllJob["source_ref"] });
      mockExtractor.mockResolvedValueOnce({ jobs: [job], errors: [] });
      const { db } = makeMockDb();

      const result = await pollCompany(
        db,
        makeFakeCompany({ atsVendor: vendor, atsSlug: "test-co" })
      );

      expect(mockExtractor).toHaveBeenCalledOnce();
      expect(mockBuildCareersUrl).toHaveBeenCalledWith(vendor, "test-co");
      expect(result.status).toBe("ok");
    }
  );

  test.each(["workday", "totally-fake-ats"])(
    "returns error for unsupported vendor %s",
    async (vendor) => {
      const { db, updatedSets } = makeMockDb();

      const result = await pollCompany(
        db,
        makeFakeCompany({ atsVendor: vendor, atsSlug: "slug" })
      );

      expect(result.status).toBe("error");
      expect(result.errorMessage).toContain(`Unsupported ATS vendor: ${vendor}`);
      expect(result.jobsFound).toBe(0);
      const companyUpdate = updatedSets.find(
        (s) => s._table === companies && s.lastPollStatus === "error"
      );
      expect(companyUpdate).toBeDefined();
    }
  );
});

// ─── syncCompanyJobs: new job insertion ─────────────────────────────────────

describe("pollCompany — sync: new jobs are inserted", () => {
  test.each<[string, string | null, string | null]>([
    ["non-empty description", "Build things.", expectedHash("Build things.")],
    ["null description", null, null],
    ["empty description", "", null],
  ])(
    "inserts new job with %s → correct descriptionHash",
    async (_label, descText, hash) => {
      const job = makeFakeJob({
        job_id: "new-1",
        job_uid: "uid-new-1",
        description_text: descText,
      });
      mockExtractFromGreenhouse.mockResolvedValueOnce({ jobs: [job], errors: [] });
      const { db, insertedRows } = makeMockDb([]);

      const result = await pollCompany(db, makeFakeCompany());

      expect(result.jobsNew).toBe(1);
      expect(result.jobsFound).toBe(1);
      const jobInsert = insertedRows.find((r) => r._table === jobs);
      expect(jobInsert).toEqual(
        expect.objectContaining({
          companyId: "company-uuid-1",
          atsJobId: "new-1",
          descriptionHash: hash,
          status: "open",
        })
      );
    }
  );
});

// ─── syncCompanyJobs: existing job content change detection ─────────────────

describe("pollCompany — sync: existing jobs update detection", () => {
  test.each<[string, string, string, number, boolean]>([
    ["hash changed", "Old description", "New description", 1, true],
    ["hash unchanged", "Same description", "Same description", 0, false],
  ])(
    "%s → jobsUpdated=%d",
    async (_label, storedDesc, freshDesc, expectedUpdated, expectContentUpdate) => {
      const storedHash = expectedHash(storedDesc);
      const storedJob = {
        id: "job-uuid-1",
        companyId: "company-uuid-1",
        atsJobId: "ats-1",
        jobUid: "uid-1",
        title: "Software Engineer",
        url: "https://example.com/jobs/1",
        canonicalUrl: "https://example.com/jobs/1",
        status: "open",
        descriptionHash: storedHash,
        lastSeenAt: new Date("2025-06-14T12:00:00Z"),
        firstSeenAt: new Date("2025-06-01T12:00:00Z"),
        createdAt: new Date("2025-06-01T12:00:00Z"),
        updatedAt: new Date("2025-06-14T12:00:00Z"),
      };

      const freshJob = makeFakeJob({ job_id: "ats-1", description_text: freshDesc });
      mockExtractFromGreenhouse.mockResolvedValueOnce({ jobs: [freshJob], errors: [] });
      const { db, updatedSets } = makeMockDb([storedJob]);

      const result = await pollCompany(db, makeFakeCompany());

      expect(result.jobsUpdated).toBe(expectedUpdated);
      const jobUpdate = updatedSets.find((s) => s._table === jobs);
      expect(jobUpdate).toBeDefined();
      if (expectContentUpdate) {
        expect(jobUpdate!.descriptionText).toBe(freshDesc);
        expect(jobUpdate!.contentUpdatedAt).toEqual(NOW);
      } else {
        expect(jobUpdate!.descriptionText).toBeUndefined();
        expect(jobUpdate!.lastSeenAt).toEqual(NOW);
      }
    }
  );
});

// ─── syncCompanyJobs: stale/closed thresholds ───────────────────────────────

describe("pollCompany — sync: stale/closed thresholds for missing jobs", () => {
  // TODO: jobsClosed is incremented for stale jobs too, which is misleading.
  // The counter name suggests "closed" but stale jobs are only marked stale,
  // not closed. Consider renaming to jobsRemoved or using separate counters.
  test.each<[number, number, string | null]>([
    [3, 0, null],
    [6, 0, null],
    [7, 1, "stale"],
    [10, 1, "stale"],
    [29, 1, "stale"],
    [30, 1, "closed"],
    [35, 1, "closed"],
  ])(
    "%d days missing → jobsClosed=%d, status=%s",
    async (days, expectedClosures, expectedStatus) => {
      const lastSeen = new Date(NOW);
      lastSeen.setDate(lastSeen.getDate() - days);
      const storedJob = {
        id: "job-uuid-old",
        companyId: "company-uuid-1",
        atsJobId: "missing-job",
        jobUid: "uid-missing",
        title: "Old Job",
        url: "https://example.com/jobs/old",
        canonicalUrl: "https://example.com/jobs/old",
        status: "open",
        descriptionHash: "abc",
        lastSeenAt: lastSeen,
        firstSeenAt: lastSeen,
        createdAt: lastSeen,
        updatedAt: lastSeen,
      };

      mockExtractFromGreenhouse.mockResolvedValueOnce({ jobs: [], errors: [] });
      const { db, updatedSets } = makeMockDb([storedJob]);

      const result = await pollCompany(db, makeFakeCompany());

      expect(result.jobsClosed).toBe(expectedClosures);
      if (expectedStatus) {
        const statusUpdate = updatedSets.find(
          (s) => s._table === jobs && s.status === expectedStatus
        );
        expect(statusUpdate).toBeDefined();
        if (expectedStatus === "closed") {
          expect(statusUpdate!.closedAt).toBeInstanceOf(Date);
        }
      }
    }
  );
});

// ─── pollCompany orchestrator ───────────────────────────────────────────────

describe("pollCompany — success path", () => {
  test("updates company metadata and inserts poll log on successful poll", async () => {
    const freshJob = makeFakeJob();
    mockExtractFromGreenhouse.mockResolvedValueOnce({ jobs: [freshJob], errors: [] });
    const { db, updatedSets, insertedRows } = makeMockDb();

    const result = await pollCompany(db, makeFakeCompany());

    expect(result.status).toBe("ok");
    expect(result.jobsFound).toBe(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const companyUpdate = updatedSets.find((s) => s._table === companies);
    expect(companyUpdate).toEqual(
      expect.objectContaining({
        lastPollStatus: "ok",
        lastPollError: null,
        jobsCount: 1,
      })
    );

    const logInsert = insertedRows.find((r) => r._table === pollLogs);
    expect(logInsert).toEqual(
      expect.objectContaining({ status: "ok", jobsFound: 1, jobsNew: 1 })
    );
  });

  test("returns status 'empty' when ATS returns zero jobs and no errors", async () => {
    mockExtractFromGreenhouse.mockResolvedValueOnce({ jobs: [], errors: [] });
    const { db, updatedSets } = makeMockDb();

    const result = await pollCompany(db, makeFakeCompany());

    expect(result.status).toBe("empty");
    expect(result.jobsFound).toBe(0);
    expect(result.jobsNew).toBe(0);

    const companyUpdate = updatedSets.find((s) => s._table === companies);
    expect(companyUpdate).toEqual(
      expect.objectContaining({ lastPollStatus: "empty", jobsCount: 0 })
    );
  });
});

describe("pollCompany — error from ATS (errors array, no jobs)", () => {
  test("returns error status and persists error to company metadata", async () => {
    mockExtractFromGreenhouse.mockResolvedValueOnce({
      jobs: [],
      errors: ["API rate limited", "Timeout exceeded"],
    });
    const { db, updatedSets, insertedRows } = makeMockDb();

    const result = await pollCompany(db, makeFakeCompany());

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("API rate limited; Timeout exceeded");
    expect(result.jobsFound).toBe(0);

    const companyUpdate = updatedSets.find((s) => s._table === companies);
    expect(companyUpdate).toEqual(
      expect.objectContaining({
        lastPollStatus: "error",
        lastPollError: "API rate limited; Timeout exceeded",
      })
    );

    const logInsert = insertedRows.find((r) => r._table === pollLogs);
    expect(logInsert).toEqual(
      expect.objectContaining({
        status: "error",
        errorMessage: "API rate limited; Timeout exceeded",
      })
    );
  });
});

describe("pollCompany — exception in extractor (catch block)", () => {
  test.each<[string, unknown, string]>([
    ["Error object", new Error("Network failure"), "Network failure"],
    ["non-Error value", "string error", "string error"],
  ])(
    "catches %s → errorMessage=%s",
    async (_label, thrown, expectedMessage) => {
      mockExtractFromGreenhouse.mockRejectedValueOnce(thrown);
      const { db, updatedSets, insertedRows } = makeMockDb();

      const result = await pollCompany(db, makeFakeCompany());

      expect(result.status).toBe("error");
      expect(result.errorMessage).toBe(expectedMessage);
      expect(result.jobsFound).toBe(0);

      const companyUpdate = updatedSets.find((s) => s._table === companies);
      expect(companyUpdate).toEqual(
        expect.objectContaining({
          lastPollStatus: "error",
          lastPollError: expectedMessage,
        })
      );

      const logInsert = insertedRows.find((r) => r._table === pollLogs);
      expect(logInsert).toEqual(
        expect.objectContaining({ status: "error", errorMessage: expectedMessage })
      );
    }
  );
});
