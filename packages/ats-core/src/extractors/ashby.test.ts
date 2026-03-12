import { extractFromAshby } from "./ashby";
import type { ExtractionContext } from "./extractor-types";
import { createEmptyDiagnostics } from "../types";
import type { Diagnostics } from "../types";

// ---------------------------------------------------------------------------
// Mock fetchJson from ./common — we isolate the extractor from network I/O
// ---------------------------------------------------------------------------

vi.mock("./common", () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from "./common";

const fetchJsonMock = vi.mocked(fetchJson);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ExtractionContext> = {}): ExtractionContext {
  return {
    careersUrl: "https://jobs.ashbyhq.com/acmecorp",
    timeoutMs: 5000,
    maxRetries: 2,
    maxAttempts: 3,
    diagnostics: createEmptyDiagnostics(),
    ...overrides,
  };
}

/** A realistic Ashby API job entry with all fields populated. */
function makeAshbyJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-abc-123",
    title: "Senior Software Engineer",
    jobUrl: "https://jobs.ashbyhq.com/acmecorp/job-abc-123",
    applyUrl: "https://jobs.ashbyhq.com/acmecorp/job-abc-123/application",
    location: "San Francisco, CA",
    secondaryLocations: [
      { location: "New York, NY", title: "NYC Office" },
      { location: "Remote, US", title: "Remote" },
    ],
    departmentName: "Engineering",
    department: "Eng",
    team: "Platform",
    workplaceType: "Hybrid",
    descriptionHtml: "<p>We are looking for a talented engineer to join our team.</p>",
    descriptionPlain: "We are looking for a talented engineer to join our team.",
    publishedDate: "2025-11-01",
    publishedAt: "2025-11-01T00:00:00Z",
    employmentType: "FullTime",
    ...overrides,
  };
}

/** Helper to set up fetchJson to return a successful response with the given jobs array. */
function mockSuccessResponse(jobs: unknown[]) {
  fetchJsonMock.mockResolvedValue({
    data: { jobs },
    error: null,
  });
}

/** Helper to set up fetchJson to return an error. */
function mockErrorResponse(error: string) {
  fetchJsonMock.mockResolvedValue({
    data: null,
    error,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractFromAshby", () => {
  // -------------------------------------------------------------------------
  // Board parsing — invalid careers URLs
  // -------------------------------------------------------------------------

  describe("when the careers URL cannot be parsed into a board name", () => {
    const invalidUrls = [
      { url: "not-a-valid-url", label: "malformed URL" },
      { url: "https://example.com/acmecorp", label: "non-ashby domain without ?for= param" },
      { url: "https://jobs.ashbyhq.com/", label: "ashby domain with no path segments" },
      { url: "https://jobs.ashbyhq.com/jobs", label: "reserved segment 'jobs'" },
      { url: "https://jobs.ashbyhq.com/careers", label: "reserved segment 'careers'" },
      { url: "https://jobs.ashbyhq.com/embed", label: "reserved segment 'embed'" },
    ];

    test.each(invalidUrls)(
      "returns an error when careers URL is a $label",
      async ({ url }) => {
        const ctx = makeContext({ careersUrl: url });
        const result = await extractFromAshby(ctx);

        expect(result.jobs).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain("Unable to parse Ashby board");
        expect(result.errors[0]).toContain(url);
        expect(fetchJsonMock).not.toHaveBeenCalled();
      },
    );
  });

  // Adversarial near-miss: a URL that looks similar to ashby but is not
  describe("adversarial board-name near-misses", () => {
    test("rejects a URL on ashbyhq.org (wrong TLD)", async () => {
      const ctx = makeContext({ careersUrl: "https://jobs.ashbyhq.org/acmecorp" });
      const result = await extractFromAshby(ctx);

      expect(result.jobs).toEqual([]);
      expect(result.errors[0]).toContain("Unable to parse Ashby board");
    });

    test("rejects a URL with ashbyhq as a path segment on a different domain", async () => {
      const ctx = makeContext({ careersUrl: "https://example.com/ashbyhq.com/acmecorp" });
      const result = await extractFromAshby(ctx);

      expect(result.jobs).toEqual([]);
      expect(result.errors[0]).toContain("Unable to parse Ashby board");
    });

    test("accepts a URL with ?for= param even on a non-ashby domain", async () => {
      mockSuccessResponse([]);
      const ctx = makeContext({ careersUrl: "https://example.com/careers?for=acmecorp" });
      const result = await extractFromAshby(ctx);

      // Should succeed (no board parse error) — the ?for= param is accepted
      expect(result.errors).toEqual([]);
      expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // API endpoint construction
  // -------------------------------------------------------------------------

  describe("API endpoint construction", () => {
    test("calls fetchJson with the correct Ashby posting API URL", async () => {
      mockSuccessResponse([]);
      const ctx = makeContext({ careersUrl: "https://jobs.ashbyhq.com/acmecorp" });
      await extractFromAshby(ctx);

      expect(fetchJsonMock).toHaveBeenCalledWith(
        "https://api.ashbyhq.com/posting-api/job-board/acmecorp",
        ctx.diagnostics,
        ctx.timeoutMs,
        ctx.maxRetries,
        ctx.maxAttempts,
      );
    });

    test("passes board from ?for= query param to the API endpoint", async () => {
      mockSuccessResponse([]);
      const ctx = makeContext({ careersUrl: "https://jobs.ashbyhq.com/embed?for=betacorp" });
      await extractFromAshby(ctx);

      expect(fetchJsonMock).toHaveBeenCalledWith(
        "https://api.ashbyhq.com/posting-api/job-board/betacorp",
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    test("forwards diagnostics, timeoutMs, maxRetries, and maxAttempts to fetchJson", async () => {
      mockSuccessResponse([]);
      const diag: Diagnostics = createEmptyDiagnostics();
      const ctx = makeContext({ diagnostics: diag, timeoutMs: 9999, maxRetries: 5, maxAttempts: 7 });
      await extractFromAshby(ctx);

      expect(fetchJsonMock).toHaveBeenCalledWith(
        expect.any(String),
        diag,
        9999,
        5,
        7,
      );
    });
  });

  // -------------------------------------------------------------------------
  // API error handling
  // -------------------------------------------------------------------------

  describe("when the API call fails", () => {
    test("returns an error message containing the endpoint URL and the error text", async () => {
      mockErrorResponse("connection timeout");
      const ctx = makeContext();
      const result = await extractFromAshby(ctx);

      expect(result.jobs).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Ashby API failed");
      expect(result.errors[0]).toContain("api.ashbyhq.com/posting-api/job-board/acmecorp");
      expect(result.errors[0]).toContain("connection timeout");
    });

    test("returns 'unknown error' when fetchJson returns null data with no error string", async () => {
      fetchJsonMock.mockResolvedValue({ data: null, error: null });
      const ctx = makeContext();
      const result = await extractFromAshby(ctx);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("unknown error");
    });
  });

  // -------------------------------------------------------------------------
  // Empty job list
  // -------------------------------------------------------------------------

  describe("when the API returns an empty job list", () => {
    test("returns zero jobs and no errors when jobs array is empty", async () => {
      mockSuccessResponse([]);
      const ctx = makeContext();
      const result = await extractFromAshby(ctx);

      expect(result.jobs).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    test("returns zero jobs and no errors when jobs field is undefined", async () => {
      fetchJsonMock.mockResolvedValue({ data: {}, error: null });
      const ctx = makeContext();
      const result = await extractFromAshby(ctx);

      expect(result.jobs).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Successful extraction — field mapping
  // -------------------------------------------------------------------------

  describe("successful extraction with fully-populated job", () => {
    test("maps a fully-populated Ashby job to the correct normalized fields", async () => {
      const ashbyJob = makeAshbyJob();
      mockSuccessResponse([ashbyJob]);
      const ctx = makeContext();
      const result = await extractFromAshby(ctx);

      expect(result.errors).toEqual([]);
      expect(result.jobs).toHaveLength(1);

      const job = result.jobs[0];
      expect(job.title).toBe("Senior Software Engineer");
      expect(job.url).toBe("https://jobs.ashbyhq.com/acmecorp/job-abc-123");
      expect(job.job_id).toBe("job-abc-123");
      expect(job.location_raw).toBe("San Francisco, CA");
      expect(job.department_raw).toBe("Engineering");
      expect(job.posted_date_raw).toBe("2025-11-01");
      expect(job.employment_type_raw).toBe("FullTime");
      expect(job.workplace_type).toBe("Hybrid");
      expect(job.description_text).toContain("We are looking for a talented engineer");
      expect(job.source_type).toBe("ats_api");
      expect(job.source_ref).toBe("ashby");
    });

    test("sets apply_url from applyUrl field", async () => {
      mockSuccessResponse([makeAshbyJob()]);
      const result = await extractFromAshby(makeContext());

      const job = result.jobs[0];
      expect(job.apply_url).toBe(
        "https://jobs.ashbyhq.com/acmecorp/job-abc-123/application",
      );
    });

    test("sets source_detail_url from jobUrl field", async () => {
      mockSuccessResponse([makeAshbyJob()]);
      const result = await extractFromAshby(makeContext());

      const job = result.jobs[0];
      expect(job.source_detail_url).toBe(
        "https://jobs.ashbyhq.com/acmecorp/job-abc-123",
      );
    });

    test("sets detail_fetch_status to 'ok' when descriptionHtml is present", async () => {
      mockSuccessResponse([makeAshbyJob()]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs[0].detail_fetch_status).toBe("ok");
    });

    test("generates a deterministic job_uid based on canonical URL", async () => {
      mockSuccessResponse([makeAshbyJob()]);
      const result1 = await extractFromAshby(makeContext());

      vi.clearAllMocks();
      mockSuccessResponse([makeAshbyJob()]);
      const result2 = await extractFromAshby(makeContext());

      expect(result1.jobs[0].job_uid).toBe(result2.jobs[0].job_uid);
      expect(result1.jobs[0].job_uid).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Field fallback logic
  // -------------------------------------------------------------------------

  describe("field fallback behavior", () => {
    // -- URL fallbacks: jobUrl vs applyUrl -----------------------------------

    test("falls back to applyUrl for the job URL when jobUrl is missing", async () => {
      mockSuccessResponse([makeAshbyJob({ jobUrl: undefined })]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs[0].url).toBe(
        "https://jobs.ashbyhq.com/acmecorp/job-abc-123/application",
      );
    });

    test("falls back to jobUrl for apply_url when applyUrl is missing", async () => {
      mockSuccessResponse([makeAshbyJob({ applyUrl: undefined })]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs[0].apply_url).toBe(
        "https://jobs.ashbyhq.com/acmecorp/job-abc-123",
      );
    });

    test("falls back to applyUrl for source_detail_url when jobUrl is missing", async () => {
      mockSuccessResponse([makeAshbyJob({ jobUrl: undefined })]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs[0].source_detail_url).toBe(
        "https://jobs.ashbyhq.com/acmecorp/job-abc-123/application",
      );
    });

    // -- Location fallback: location vs secondaryLocations -------------------

    test("falls back to secondaryLocations when location is missing", async () => {
      mockSuccessResponse([
        makeAshbyJob({
          location: undefined,
          secondaryLocations: [
            { location: "Berlin, DE" },
            { location: "London, UK" },
          ],
        }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs[0].location_raw).toBe("Berlin, DE, London, UK");
    });

    test("uses title from secondaryLocations entry when location sub-field is missing", async () => {
      mockSuccessResponse([
        makeAshbyJob({
          location: undefined,
          secondaryLocations: [
            { title: "Remote US" },
            { location: "Paris, FR" },
          ],
        }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs[0].location_raw).toBe("Remote US, Paris, FR");
    });

    test("sets location_raw to null when both location and secondaryLocations are absent", async () => {
      mockSuccessResponse([
        makeAshbyJob({
          location: undefined,
          secondaryLocations: undefined,
        }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs[0].location_raw).toBeNull();
    });

    // -- Department fallback: departmentName vs department vs team -----------

    test("falls back to department when departmentName is missing", async () => {
      mockSuccessResponse([makeAshbyJob({ departmentName: undefined })]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs[0].department_raw).toBe("Eng");
    });

    test("falls back to team when both departmentName and department are missing", async () => {
      mockSuccessResponse([
        makeAshbyJob({ departmentName: undefined, department: undefined }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs[0].department_raw).toBe("Platform");
    });

    test("sets department_raw to null when all department fields are absent", async () => {
      mockSuccessResponse([
        makeAshbyJob({
          departmentName: undefined,
          department: undefined,
          team: undefined,
        }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs[0].department_raw).toBeNull();
    });

    // -- Date fallback: publishedDate vs publishedAt -------------------------

    test("falls back to publishedAt when publishedDate is missing", async () => {
      mockSuccessResponse([makeAshbyJob({ publishedDate: undefined })]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs[0].posted_date_raw).toBe("2025-11-01T00:00:00Z");
    });

    test("sets posted_date_raw to null when both date fields are absent", async () => {
      mockSuccessResponse([
        makeAshbyJob({ publishedDate: undefined, publishedAt: undefined }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs[0].posted_date_raw).toBeNull();
    });

    // -- Description: descriptionHtml vs descriptionPlain -------------------

    test("uses descriptionPlain as description_text when both are present", async () => {
      // buildJob prefers descriptionText (mapped from descriptionPlain) over descriptionHtml
      mockSuccessResponse([makeAshbyJob()]);
      const result = await extractFromAshby(makeContext());

      // Should be the plain text, not HTML-converted
      expect(result.jobs[0].description_text).toBe(
        "We are looking for a talented engineer to join our team.",
      );
    });

    test("falls back to descriptionHtml when descriptionPlain is absent", async () => {
      mockSuccessResponse([
        makeAshbyJob({
          descriptionPlain: undefined,
          descriptionHtml: "<p>Build great products.</p>",
        }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs[0].description_text).toContain("Build great products.");
      // Should not contain HTML tags after conversion
      expect(result.jobs[0].description_text).not.toContain("<p>");
    });

    test("does not set detail_fetch_status when neither description field is present", async () => {
      mockSuccessResponse([
        makeAshbyJob({
          descriptionHtml: undefined,
          descriptionPlain: undefined,
        }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs[0]).not.toHaveProperty("detail_fetch_status");
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases: missing / null fields
  // -------------------------------------------------------------------------

  describe("edge cases with missing or null fields", () => {
    test("handles a job where all optional fields are undefined", async () => {
      mockSuccessResponse([
        {
          title: "QA Analyst",
          jobUrl: "https://jobs.ashbyhq.com/acmecorp/qa-analyst",
        },
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.errors).toEqual([]);
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].title).toBe("QA Analyst");
      expect(result.jobs[0].location_raw).toBeNull();
      expect(result.jobs[0].department_raw).toBeNull();
      expect(result.jobs[0].posted_date_raw).toBeNull();
      expect(result.jobs[0].employment_type_raw).toBeNull();
    });

    test("filters out a job with an empty title (buildJob returns null)", async () => {
      mockSuccessResponse([
        makeAshbyJob({ title: "" }),
        makeAshbyJob({ id: "good-job", title: "Product Designer" }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].title).toBe("Product Designer");
    });

    test("filters out a job with an undefined title", async () => {
      mockSuccessResponse([
        makeAshbyJob({ title: undefined }),
        makeAshbyJob({ id: "valid-job", title: "Data Engineer" }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].title).toBe("Data Engineer");
    });

    test("uses job_uid prefix as job_id when the id field is missing", async () => {
      mockSuccessResponse([
        makeAshbyJob({ id: undefined }),
      ]);
      const result = await extractFromAshby(makeContext());

      const job = result.jobs[0];
      expect(job.job_id).toBe(job.job_uid.slice(0, 12));
      expect(job.job_id).toHaveLength(12);
    });

    test("handles secondaryLocations with empty entries gracefully", async () => {
      mockSuccessResponse([
        makeAshbyJob({
          location: undefined,
          secondaryLocations: [
            { location: undefined, title: undefined },
            { location: "Austin, TX" },
          ],
        }),
      ]);
      const result = await extractFromAshby(makeContext());

      // The empty entry should be filtered out by .filter(Boolean)
      expect(result.jobs[0].location_raw).toBe("Austin, TX");
    });
  });

  // -------------------------------------------------------------------------
  // Multiple jobs and deduplication
  // -------------------------------------------------------------------------

  describe("multiple jobs extraction and deduplication", () => {
    test("extracts multiple jobs from a single API response", async () => {
      mockSuccessResponse([
        makeAshbyJob({ id: "job-1", title: "Frontend Engineer", jobUrl: "https://jobs.ashbyhq.com/acmecorp/job-1" }),
        makeAshbyJob({ id: "job-2", title: "Backend Engineer", jobUrl: "https://jobs.ashbyhq.com/acmecorp/job-2" }),
        makeAshbyJob({ id: "job-3", title: "DevOps Engineer", jobUrl: "https://jobs.ashbyhq.com/acmecorp/job-3" }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs).toHaveLength(3);
      expect(result.jobs.map((j) => j.title)).toEqual([
        "Frontend Engineer",
        "Backend Engineer",
        "DevOps Engineer",
      ]);
    });

    test("deduplicates jobs that share the same canonical URL", async () => {
      const sharedUrl = "https://jobs.ashbyhq.com/acmecorp/same-job";
      mockSuccessResponse([
        makeAshbyJob({ id: "dup-1", title: "Software Engineer", jobUrl: sharedUrl }),
        makeAshbyJob({ id: "dup-2", title: "Software Engineer", jobUrl: sharedUrl }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs).toHaveLength(1);
    });

    test("preserves distinct jobs that have different URLs", async () => {
      mockSuccessResponse([
        makeAshbyJob({ id: "a", title: "Role A", jobUrl: "https://jobs.ashbyhq.com/acmecorp/a" }),
        makeAshbyJob({ id: "b", title: "Role B", jobUrl: "https://jobs.ashbyhq.com/acmecorp/b" }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // URL resolution — relative vs absolute
  // -------------------------------------------------------------------------

  describe("URL handling", () => {
    test("resolves relative jobUrl against the careers URL base", async () => {
      mockSuccessResponse([
        makeAshbyJob({ jobUrl: "/acmecorp/job-relative-123", applyUrl: undefined }),
      ]);
      const result = await extractFromAshby(makeContext());

      // buildJob uses normalizeUrl which resolves against baseUrl (careersUrl)
      expect(result.jobs[0].url).toBe(
        "https://jobs.ashbyhq.com/acmecorp/job-relative-123",
      );
    });

    // TODO: If both jobUrl and applyUrl are empty strings, buildJob attempts to
    // resolve "" against the baseUrl, which produces the baseUrl itself. This
    // could potentially create misleading canonical URLs. The current behavior
    // is tested here for regression safety.
    test("uses careers URL as fallback when both jobUrl and applyUrl are empty", async () => {
      mockSuccessResponse([
        makeAshbyJob({ jobUrl: "", applyUrl: "" }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs).toHaveLength(1);
      // url resolves to the base URL
      expect(result.jobs[0].url).toBe("https://jobs.ashbyhq.com/acmecorp");
    });
  });
});
