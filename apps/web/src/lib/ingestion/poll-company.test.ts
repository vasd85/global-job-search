// @vitest-environment node
import { createHash } from "node:crypto";
import type { AllJob, ExtractionResult } from "@gjs/ats-core";

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

// We need to import the module under test AFTER vi.mock so the mock is active
const { pollCompany } = await import("./poll-company");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

/** Build a mock Drizzle db with chainable methods and call tracking. */
function makeMockDb(storedOpenJobs: Record<string, unknown>[] = []) {
  // Track what gets passed to insert().values()
  const insertedRows: Record<string, unknown>[] = [];
  const updatedSets: Record<string, unknown>[] = [];

  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockImplementation((row: Record<string, unknown>) => {
    insertedRows.push(row);
    return { onConflictDoNothing };
  });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockImplementation((data: Record<string, unknown>) => {
    updatedSets.push(data);
    return { where: updateWhere };
  });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  const selectWhere = vi.fn().mockResolvedValue(storedOpenJobs);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  const db = {
    select: selectFn,
    from: selectFrom,
    where: selectWhere,
    insert: insertFn,
    update: updateFn,
  };

  return {
    db: db as unknown as Parameters<typeof pollCompany>[0],
    insertedRows,
    updatedSets,
    insertFn,
    updateFn,
    updateSet,
    updateWhere,
    selectWhere,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── computeDescriptionHash (tested indirectly via syncCompanyJobs) ─────────
// The function is not exported, so we verify its behavior via pollCompany.
// We can also verify sha256 mock is called correctly.

describe("pollCompany — hash behavior", () => {
  test("calls sha256 for jobs with description text", async () => {
    const job = makeFakeJob({ description_text: "Some description" });
    mockExtractFromGreenhouse.mockResolvedValueOnce({ jobs: [job], errors: [] });
    const { db } = makeMockDb();

    await pollCompany(db, makeFakeCompany());

    expect(mockSha256).toHaveBeenCalledWith("Some description");
  });

  test("does not call sha256 when description_text is null", async () => {
    const job = makeFakeJob({ description_text: null });
    mockExtractFromGreenhouse.mockResolvedValueOnce({ jobs: [job], errors: [] });
    const { db } = makeMockDb();

    await pollCompany(db, makeFakeCompany());

    expect(mockSha256).not.toHaveBeenCalled();
  });

  test("does not call sha256 when description_text is empty string", async () => {
    const job = makeFakeJob({ description_text: "" });
    mockExtractFromGreenhouse.mockResolvedValueOnce({ jobs: [job], errors: [] });
    const { db } = makeMockDb();

    await pollCompany(db, makeFakeCompany());

    // Empty string is falsy, so computeDescriptionHash returns null
    expect(mockSha256).not.toHaveBeenCalled();
  });
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

  test("returns error for unsupported vendor", async () => {
    const { db, updateFn } = makeMockDb();

    const result = await pollCompany(
      db,
      makeFakeCompany({ atsVendor: "workday", atsSlug: "acme" })
    );

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("Unsupported ATS vendor: workday");
    expect(result.jobsFound).toBe(0);
    // Should still update company status to error
    expect(updateFn).toHaveBeenCalled();
  });

  test("returns error for unknown vendor string", async () => {
    const { db } = makeMockDb();

    const result = await pollCompany(
      db,
      makeFakeCompany({ atsVendor: "totally-fake-ats", atsSlug: "slug" })
    );

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("Unsupported ATS vendor: totally-fake-ats");
  });
});

// ─── syncCompanyJobs (diff engine) ──────────────────────────────────────────

describe("pollCompany — sync: new jobs are inserted", () => {
  test("inserts new jobs that do not exist in the database", async () => {
    const freshJob = makeFakeJob({ job_id: "new-1", job_uid: "uid-new-1" });
    mockExtractFromGreenhouse.mockResolvedValueOnce({
      jobs: [freshJob],
      errors: [],
    });
    const { db, insertFn } = makeMockDb([]); // no stored jobs

    const result = await pollCompany(db, makeFakeCompany());

    expect(result.jobsNew).toBe(1);
    expect(result.jobsFound).toBe(1);
    // insert called: once for the new job + once for pollLogs
    expect(insertFn).toHaveBeenCalled();
  });
});

describe("pollCompany — sync: existing jobs are updated when hash changes", () => {
  test("updates job when description hash changes", async () => {
    const oldHash = createHash("sha256").update("Old description").digest("hex");
    const storedJob = {
      id: "job-uuid-1",
      companyId: "company-uuid-1",
      atsJobId: "ats-1",
      jobUid: "uid-1",
      title: "Software Engineer",
      url: "https://example.com/jobs/1",
      canonicalUrl: "https://example.com/jobs/1",
      status: "open",
      descriptionHash: oldHash,
      lastSeenAt: new Date(),
      firstSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const freshJob = makeFakeJob({
      job_id: "ats-1",
      description_text: "New description",
    });
    mockExtractFromGreenhouse.mockResolvedValueOnce({
      jobs: [freshJob],
      errors: [],
    });
    const { db, updatedSets } = makeMockDb([storedJob]);

    const result = await pollCompany(db, makeFakeCompany());

    expect(result.jobsUpdated).toBe(1);
    expect(result.jobsNew).toBe(0);
    // The update should contain the new description
    const contentUpdate = updatedSets.find(
      (s) => s.descriptionText !== undefined
    );
    expect(contentUpdate).toBeDefined();
    expect(contentUpdate!.descriptionText).toBe("New description");
  });

  test("bumps lastSeenAt without update when hash is unchanged", async () => {
    const descText = "Same description";
    const hash = createHash("sha256").update(descText).digest("hex");
    const storedJob = {
      id: "job-uuid-1",
      companyId: "company-uuid-1",
      atsJobId: "ats-1",
      jobUid: "uid-1",
      title: "Software Engineer",
      url: "https://example.com/jobs/1",
      canonicalUrl: "https://example.com/jobs/1",
      status: "open",
      descriptionHash: hash,
      lastSeenAt: new Date(),
      firstSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const freshJob = makeFakeJob({
      job_id: "ats-1",
      description_text: descText,
    });
    mockExtractFromGreenhouse.mockResolvedValueOnce({
      jobs: [freshJob],
      errors: [],
    });
    const { db, updatedSets } = makeMockDb([storedJob]);

    const result = await pollCompany(db, makeFakeCompany());

    expect(result.jobsUpdated).toBe(0);
    // Should still bump lastSeenAt (one of the update calls will have
    // lastSeenAt but not descriptionText)
    const bumpUpdate = updatedSets.find(
      (s) => s.lastSeenAt !== undefined && s.descriptionText === undefined
    );
    expect(bumpUpdate).toBeDefined();
  });
});

describe("pollCompany — sync: stale/closed thresholds for missing jobs", () => {
  function makeStoredJobMissingFromApi(daysSinceLastSeen: number) {
    const lastSeen = new Date();
    lastSeen.setDate(lastSeen.getDate() - daysSinceLastSeen);
    return {
      id: `job-uuid-old-${daysSinceLastSeen}`,
      companyId: "company-uuid-1",
      atsJobId: `missing-${daysSinceLastSeen}`,
      jobUid: `uid-missing-${daysSinceLastSeen}`,
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
  }

  test("leaves job open during grace period (< 7 days missing)", async () => {
    const storedJob = makeStoredJobMissingFromApi(3);
    // Fresh API returns no jobs at all
    mockExtractFromGreenhouse.mockResolvedValueOnce({ jobs: [], errors: [] });
    const { db } = makeMockDb([storedJob]);

    const result = await pollCompany(db, makeFakeCompany());

    // Job should remain open, no closures
    expect(result.jobsClosed).toBe(0);
    expect(result.status).toBe("empty");
  });

  test("marks job as stale after >= 7 days missing", async () => {
    const storedJob = makeStoredJobMissingFromApi(10);
    mockExtractFromGreenhouse.mockResolvedValueOnce({ jobs: [], errors: [] });
    const { db, updatedSets } = makeMockDb([storedJob]);

    const result = await pollCompany(db, makeFakeCompany());

    // TODO: jobsClosed is incremented for stale jobs too, which is misleading.
    // The counter name suggests "closed" but stale jobs are only marked stale,
    // not closed. Consider renaming to jobsRemoved or using separate counters.
    expect(result.jobsClosed).toBe(1);
    const staleUpdate = updatedSets.find((s) => s.status === "stale");
    expect(staleUpdate).toBeDefined();
  });

  test("marks job as closed after >= 30 days missing", async () => {
    const storedJob = makeStoredJobMissingFromApi(35);
    mockExtractFromGreenhouse.mockResolvedValueOnce({ jobs: [], errors: [] });
    const { db, updatedSets } = makeMockDb([storedJob]);

    const result = await pollCompany(db, makeFakeCompany());

    expect(result.jobsClosed).toBe(1);
    const closedUpdate = updatedSets.find((s) => s.status === "closed");
    expect(closedUpdate).toBeDefined();
    expect(closedUpdate!.closedAt).toBeInstanceOf(Date);
  });

  test.each([
    [6, 0, "within grace period"],
    [7, 1, "exactly at stale threshold"],
    [29, 1, "just before closed threshold"],
    [30, 1, "exactly at closed threshold"],
  ])(
    "with %d days missing: expects %d closure(s) (%s)",
    async (days, expectedClosures) => {
      const storedJob = makeStoredJobMissingFromApi(days);
      mockExtractFromGreenhouse.mockResolvedValueOnce({ jobs: [], errors: [] });
      const { db } = makeMockDb([storedJob]);

      const result = await pollCompany(db, makeFakeCompany());

      expect(result.jobsClosed).toBe(expectedClosures);
    }
  );
});

// ─── pollCompany orchestrator ───────────────────────────────────────────────

describe("pollCompany — success path", () => {
  test("updates company metadata and logs on successful poll", async () => {
    const freshJob = makeFakeJob();
    mockExtractFromGreenhouse.mockResolvedValueOnce({
      jobs: [freshJob],
      errors: [],
    });
    const { db, updateFn, insertFn } = makeMockDb();

    const result = await pollCompany(db, makeFakeCompany());

    expect(result.status).toBe("ok");
    expect(result.jobsFound).toBe(1);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    // company update + at least one job-related update
    expect(updateFn).toHaveBeenCalled();
    // pollLogs insert + job insert
    expect(insertFn).toHaveBeenCalled();
  });

  test("returns status 'empty' when ATS returns zero jobs and no errors", async () => {
    mockExtractFromGreenhouse.mockResolvedValueOnce({ jobs: [], errors: [] });
    const { db } = makeMockDb();

    const result = await pollCompany(db, makeFakeCompany());

    expect(result.status).toBe("empty");
    expect(result.jobsFound).toBe(0);
    expect(result.jobsNew).toBe(0);
  });
});

describe("pollCompany — error from ATS (errors array, no jobs)", () => {
  test("returns error status and logs the error message", async () => {
    mockExtractFromGreenhouse.mockResolvedValueOnce({
      jobs: [],
      errors: ["API rate limited", "Timeout exceeded"],
    });
    const { db, updateFn } = makeMockDb();

    const result = await pollCompany(db, makeFakeCompany());

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("API rate limited; Timeout exceeded");
    expect(result.jobsFound).toBe(0);
    expect(updateFn).toHaveBeenCalled();
  });
});

describe("pollCompany — exception in extractor (catch block)", () => {
  test("catches thrown errors and returns error result", async () => {
    mockExtractFromGreenhouse.mockRejectedValueOnce(
      new Error("Network failure")
    );
    const { db } = makeMockDb();

    const result = await pollCompany(db, makeFakeCompany());

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Network failure");
    expect(result.jobsFound).toBe(0);
  });

  test("catches non-Error thrown values", async () => {
    mockExtractFromGreenhouse.mockRejectedValueOnce("string error");
    const { db } = makeMockDb();

    const result = await pollCompany(db, makeFakeCompany());

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("string error");
  });
});
