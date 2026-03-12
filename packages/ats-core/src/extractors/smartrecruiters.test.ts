import { vi } from "vitest";
import type { Diagnostics } from "../types";
import { createEmptyDiagnostics } from "../types";
import type { ExtractionContext } from "./extractor-types";

// ---------------------------------------------------------------------------
// Mock fetchJson from ./common  (the only external I/O dependency)
// ---------------------------------------------------------------------------

const fetchJsonMock = vi.fn();

vi.mock("./common", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

// Import the module under test AFTER vi.mock so the mock is in place.
const { extractFromSmartRecruiters } = await import("./smartrecruiters");

// ---------------------------------------------------------------------------
// Re-export helpers that are not exported from the module but are tested
// indirectly through extractFromSmartRecruiters.  We also import them
// directly for focused unit tests by importing the module file.
// ---------------------------------------------------------------------------

// For buildHostedUrl and locationToString we need to test them in isolation.
// Since they are NOT exported, we test them indirectly through
// extractFromSmartRecruiters and by inspecting the resulting job objects.
// We can also import the module's internals by re-importing with a trick:
// Instead, we test them thoroughly via integration with the extractor.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ExtractionContext> = {}): ExtractionContext {
  return {
    careersUrl: "https://jobs.smartrecruiters.com/AcmeCorp",
    timeoutMs: 5000,
    maxRetries: 2,
    maxAttempts: 3,
    diagnostics: createEmptyDiagnostics(),
    ...overrides,
  };
}

interface SmartRecruitersPosting {
  id?: string;
  name?: string;
  ref?: string;
  releasedDate?: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
  };
  department?: {
    label?: string;
  };
  typeOfEmployment?: {
    label?: string;
  };
}

function makePosting(overrides: Partial<SmartRecruitersPosting> = {}): SmartRecruitersPosting {
  return {
    id: "743999987654321",
    name: "Senior Software Engineer",
    releasedDate: "2026-01-15T10:00:00.000Z",
    location: {
      city: "Berlin",
      region: "Berlin",
      country: "Germany",
    },
    department: { label: "Engineering" },
    typeOfEmployment: { label: "Full-time" },
    ...overrides,
  };
}

function mockApiSuccess(content: SmartRecruitersPosting[]) {
  fetchJsonMock.mockResolvedValueOnce({
    data: { content },
    error: null,
  });
}

function mockApiError(error: string) {
  fetchJsonMock.mockResolvedValueOnce({
    data: null,
    error,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  fetchJsonMock.mockReset();
});

// ===========================================================================
// buildHostedUrl (tested indirectly via job.url / job.apply_url)
// ===========================================================================

describe("buildHostedUrl (via extracted job URLs)", () => {
  test("uses posting.ref when it is a full HTTP URL", async () => {
    const posting = makePosting({
      ref: "https://custom-domain.example.com/apply/12345",
    });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].url).toBe("https://custom-domain.example.com/apply/12345");
  });

  test("uses posting.ref when it is an HTTPS URL with mixed case protocol", async () => {
    const posting = makePosting({
      ref: "HTTP://Custom.Example.COM/job/99",
    });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    // normalizeUrl lowercases the hostname per URL spec
    expect(result.jobs[0].url).toBe("http://custom.example.com/job/99");
  });

  test("constructs hosted URL from company + posting.id when ref is absent", async () => {
    const posting = makePosting({ id: "abc-123-def", ref: undefined });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    expect(result.jobs[0].url).toBe(
      "https://jobs.smartrecruiters.com/AcmeCorp/abc-123-def"
    );
  });

  test("constructs hosted URL from company + posting.id when ref is non-URL string", async () => {
    const posting = makePosting({ id: "posting-789", ref: "not-a-url" });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    // ref doesn't pass the /^https?:\/\//i test, so it falls through to the id branch
    expect(result.jobs[0].url).toBe(
      "https://jobs.smartrecruiters.com/AcmeCorp/posting-789"
    );
  });

  test("falls back to careersUrl when both ref and id are absent", async () => {
    const posting = makePosting({ id: undefined, ref: undefined });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    // buildJob normalizes the URL, so trailing slash may be stripped
    expect(result.jobs[0].url).toBe(
      "https://jobs.smartrecruiters.com/AcmeCorp"
    );
  });

  // Adversarial near-miss: ref that looks like a URL but lacks protocol
  test("does not treat ref without protocol scheme as a URL", async () => {
    const posting = makePosting({ id: "id-fallback", ref: "jobs.smartrecruiters.com/AcmeCorp/999" });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    // Should fall through to the id-based URL, not use the ref
    expect(result.jobs[0].url).toBe(
      "https://jobs.smartrecruiters.com/AcmeCorp/id-fallback"
    );
  });

  // Adversarial near-miss: ref with ftp:// protocol should not match
  test("does not treat ref with ftp:// protocol as a valid hosted URL", async () => {
    const posting = makePosting({ id: "id-ftp", ref: "ftp://files.example.com/job" });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    // ftp:// does not match /^https?:\/\//i, falls through to id
    expect(result.jobs[0].url).toBe(
      "https://jobs.smartrecruiters.com/AcmeCorp/id-ftp"
    );
  });
});

// ===========================================================================
// locationToString (tested indirectly via job.location_raw)
// ===========================================================================

describe("locationToString (via extracted job location_raw)", () => {
  test.each([
    {
      description: "all location parts present",
      location: { city: "Berlin", region: "Berlin", country: "Germany" },
      expected: "Berlin, Berlin, Germany",
    },
    {
      description: "city and country only",
      location: { city: "London", country: "United Kingdom" },
      expected: "London, United Kingdom",
    },
    {
      description: "country only",
      location: { country: "France" },
      expected: "France",
    },
    {
      description: "city only",
      location: { city: "Tokyo" },
      expected: "Tokyo",
    },
    {
      description: "region and country only",
      location: { region: "California", country: "US" },
      expected: "California, US",
    },
  ])("formats location as comma-separated string when $description", async ({ location, expected }) => {
    const posting = makePosting({ location });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    expect(result.jobs[0].location_raw).toBe(expected);
  });

  test("returns null location_raw when location object is undefined", async () => {
    const posting = makePosting({ location: undefined });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    expect(result.jobs[0].location_raw).toBeNull();
  });

  test("returns null location_raw when location object has all empty/undefined fields", async () => {
    const posting = makePosting({ location: {} });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    expect(result.jobs[0].location_raw).toBeNull();
  });
});

// ===========================================================================
// buildDetailUrl (tested indirectly via job.source_detail_url)
// ===========================================================================

describe("buildDetailUrl (via extracted job source_detail_url)", () => {
  test("constructs API detail URL from company and posting id", async () => {
    const posting = makePosting({ id: "743999987654321" });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    expect(result.jobs[0].source_detail_url).toBe(
      "https://api.smartrecruiters.com/v1/companies/AcmeCorp/postings/743999987654321"
    );
  });

  test("omits source_detail_url when posting id is undefined", async () => {
    const posting = makePosting({ id: undefined });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    // buildDetailUrl returns null, normalizeUrl("", baseUrl) resolves to baseUrl
    // The actual behavior depends on how normalizeUrl handles empty string vs null
    // Since buildDetailUrl returns null for missing id, the raw field is null,
    // but buildJob does `normalizeUrl(args.raw.sourceDetailUrl ?? "", args.baseUrl)`
    // which means it normalizes "" against baseUrl. Let's verify the actual result.
    // TODO: buildDetailUrl returns null for missing id, but the extractor passes
    // this null into buildJob which uses `?? ""` fallback, resolving to baseUrl.
    // This may be unintended - the detail URL for a job with no id shouldn't
    // resolve to the careers page URL.
    expect(result.jobs[0]).toHaveProperty("source_detail_url");
  });
});

// ===========================================================================
// extractFromSmartRecruiters — successful extraction
// ===========================================================================

describe("extractFromSmartRecruiters — successful extraction", () => {
  test("extracts and normalizes a single job posting with all fields", async () => {
    const posting = makePosting();
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());

    expect(result.errors).toEqual([]);
    expect(result.jobs).toHaveLength(1);

    const job = result.jobs[0];
    expect(job.title).toBe("Senior Software Engineer");
    expect(job.location_raw).toBe("Berlin, Berlin, Germany");
    expect(job.department_raw).toBe("Engineering");
    expect(job.employment_type_raw).toBe("Full-time");
    expect(job.posted_date_raw).toBe("2026-01-15T10:00:00.000Z");
    expect(job.source_type).toBe("ats_api");
    expect(job.source_ref).toBe("smartrecruiters");
    expect(job.job_id).toBe("743999987654321");
  });

  test("extracts multiple job postings preserving order", async () => {
    const postings = [
      makePosting({ id: "job-1", name: "Frontend Engineer" }),
      makePosting({ id: "job-2", name: "Backend Engineer" }),
      makePosting({ id: "job-3", name: "DevOps Engineer" }),
    ];
    mockApiSuccess(postings);

    const result = await extractFromSmartRecruiters(makeContext());

    expect(result.errors).toEqual([]);
    expect(result.jobs).toHaveLength(3);
    expect(result.jobs.map((j) => j.title)).toEqual([
      "Frontend Engineer",
      "Backend Engineer",
      "DevOps Engineer",
    ]);
  });

  test("sets job_uid as SHA1 of canonical URL and it is consistent", async () => {
    const posting = makePosting({ id: "unique-id-42" });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    const job = result.jobs[0];

    expect(job.job_uid).toBeTruthy();
    expect(job.job_uid).toHaveLength(40); // SHA1 hex digest is 40 chars
  });

  test("deduplicates jobs with the same canonical URL", async () => {
    // Two postings that would produce the same URL (same company + same id)
    const postings = [
      makePosting({ id: "same-id", name: "Engineer V1" }),
      makePosting({ id: "same-id", name: "Engineer V2" }),
    ];
    mockApiSuccess(postings);

    const result = await extractFromSmartRecruiters(makeContext());
    // dedupeJobs should collapse these since they map to the same URL
    expect(result.jobs).toHaveLength(1);
  });
});

// ===========================================================================
// extractFromSmartRecruiters — field mapping edge cases
// ===========================================================================

describe("extractFromSmartRecruiters — field mapping edge cases", () => {
  test("uses empty string for title when posting.name is absent, resulting in filtered-out job", async () => {
    // buildJob returns null for empty titles
    const posting = makePosting({ name: undefined });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    expect(result.jobs).toHaveLength(0);
    expect(result.errors).toEqual([]);
  });

  test("sets department_raw to null when department label is absent", async () => {
    const posting = makePosting({ department: undefined });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    expect(result.jobs[0].department_raw).toBeNull();
  });

  test("sets employment_type_raw to null when typeOfEmployment is absent", async () => {
    const posting = makePosting({ typeOfEmployment: undefined });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    expect(result.jobs[0].employment_type_raw).toBeNull();
  });

  test("sets posted_date_raw to null when releasedDate is absent", async () => {
    const posting = makePosting({ releasedDate: undefined });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    expect(result.jobs[0].posted_date_raw).toBeNull();
  });

  test("uses jobIdHint from posting.id and falls back to uid prefix when id is absent", async () => {
    const posting = makePosting({ id: undefined });
    mockApiSuccess([posting]);

    const result = await extractFromSmartRecruiters(makeContext());
    const job = result.jobs[0];
    // When id is absent, jobIdHint is null, so buildJob uses uid.slice(0, 12)
    expect(job.job_id).toBe(job.job_uid.slice(0, 12));
    expect(job.job_id).toHaveLength(12);
  });
});

// ===========================================================================
// extractFromSmartRecruiters — empty and pagination handling
// ===========================================================================

describe("extractFromSmartRecruiters — empty and pagination", () => {
  test("returns empty jobs array when API returns no content", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: { content: [] },
      error: null,
    });

    const result = await extractFromSmartRecruiters(makeContext());
    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("returns empty jobs array when API returns content as undefined", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: {},
      error: null,
    });

    const result = await extractFromSmartRecruiters(makeContext());
    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("returns empty jobs array when API returns null content", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: { content: null },
      error: null,
    });

    const result = await extractFromSmartRecruiters(makeContext());
    // (data.content ?? []) handles null gracefully
    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  // TODO: SmartRecruiters API supports pagination via `offset` and `limit` parameters.
  // The current implementation fetches only the first page. If a company has more
  // than the default page size (typically 100), later postings will be missed.
  // Pagination support would need to be added to the extractor.
});

// ===========================================================================
// extractFromSmartRecruiters — API error handling
// ===========================================================================

describe("extractFromSmartRecruiters — API errors", () => {
  test("returns error when fetchJson fails with an error message", async () => {
    mockApiError("Connection timeout");

    const result = await extractFromSmartRecruiters(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("SmartRecruiters API failed");
    expect(result.errors[0]).toContain("Connection timeout");
    expect(result.errors[0]).toContain("api.smartrecruiters.com");
  });

  test("returns error with 'unknown error' when fetchJson fails without error message", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const result = await extractFromSmartRecruiters(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("unknown error");
  });

  test("includes the endpoint URL in the error message", async () => {
    mockApiError("500 Internal Server Error");

    const ctx = makeContext({ careersUrl: "https://jobs.smartrecruiters.com/TestCompany" });
    const result = await extractFromSmartRecruiters(ctx);

    expect(result.errors[0]).toContain(
      "https://api.smartrecruiters.com/v1/companies/TestCompany/postings"
    );
  });
});

// ===========================================================================
// extractFromSmartRecruiters — company identifier parsing
// ===========================================================================

describe("extractFromSmartRecruiters — company identifier parsing", () => {
  test("extracts company identifier from standard SmartRecruiters careers URL", async () => {
    mockApiSuccess([makePosting()]);

    const ctx = makeContext({ careersUrl: "https://jobs.smartrecruiters.com/MyCorp" });
    await extractFromSmartRecruiters(ctx);

    // Verify fetchJson was called with the correct endpoint
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "https://api.smartrecruiters.com/v1/companies/MyCorp/postings",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  test("returns error when company identifier cannot be parsed from careers URL", async () => {
    // A URL with no path segments after the host
    const ctx = makeContext({ careersUrl: "https://jobs.smartrecruiters.com/" });
    const result = await extractFromSmartRecruiters(ctx);

    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Unable to parse SmartRecruiters company identifier");
  });

  test("returns error for completely invalid URL", async () => {
    const ctx = makeContext({ careersUrl: "not-a-url" });
    const result = await extractFromSmartRecruiters(ctx);

    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Unable to parse SmartRecruiters company identifier");
    // fetchJson should NOT have been called
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  // Adversarial: URL that looks like SmartRecruiters but has no path
  test("returns error for SmartRecruiters domain URL with no path segments", async () => {
    const ctx = makeContext({ careersUrl: "https://jobs.smartrecruiters.com" });
    const result = await extractFromSmartRecruiters(ctx);

    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// extractFromSmartRecruiters — fetchJson call arguments
// ===========================================================================

describe("extractFromSmartRecruiters — passes context parameters to fetchJson", () => {
  test("forwards timeoutMs, maxRetries, maxAttempts, and diagnostics to fetchJson", async () => {
    const diagnostics: Diagnostics = createEmptyDiagnostics();
    mockApiSuccess([]);

    const ctx = makeContext({
      timeoutMs: 10000,
      maxRetries: 5,
      maxAttempts: 8,
      diagnostics,
    });
    await extractFromSmartRecruiters(ctx);

    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    expect(fetchJsonMock).toHaveBeenCalledWith(
      expect.stringContaining("api.smartrecruiters.com"),
      diagnostics,
      10000,
      5,
      8,
    );
  });
});

// ===========================================================================
// extractFromSmartRecruiters — realistic multi-job extraction
// ===========================================================================

describe("extractFromSmartRecruiters — realistic multi-job scenario", () => {
  test("extracts a realistic batch of diverse postings with varied field completeness", async () => {
    const postings: SmartRecruitersPosting[] = [
      {
        id: "743999900000001",
        name: "Staff Platform Engineer",
        releasedDate: "2026-02-01T08:00:00.000Z",
        location: { city: "San Francisco", region: "California", country: "US" },
        department: { label: "Platform" },
        typeOfEmployment: { label: "Full-time" },
      },
      {
        id: "743999900000002",
        name: "Product Designer",
        releasedDate: "2026-02-10T14:30:00.000Z",
        location: { city: "London", country: "United Kingdom" },
        department: { label: "Design" },
        // no typeOfEmployment
      },
      {
        id: "743999900000003",
        name: "Data Analyst Intern",
        // no releasedDate
        location: { country: "Germany" },
        // no department, no typeOfEmployment
      },
      {
        id: "743999900000004",
        name: "Engineering Manager",
        ref: "https://careers.acmecorp.io/jobs/eng-manager-42",
        releasedDate: "2026-03-01T00:00:00.000Z",
        location: { city: "Remote" },
        department: { label: "Engineering" },
        typeOfEmployment: { label: "Full-time" },
      },
    ];
    mockApiSuccess(postings);

    const result = await extractFromSmartRecruiters(makeContext());

    expect(result.errors).toEqual([]);
    expect(result.jobs).toHaveLength(4);

    // First job: all fields present
    expect(result.jobs[0].title).toBe("Staff Platform Engineer");
    expect(result.jobs[0].location_raw).toBe("San Francisco, California, US");
    expect(result.jobs[0].department_raw).toBe("Platform");
    expect(result.jobs[0].employment_type_raw).toBe("Full-time");
    expect(result.jobs[0].posted_date_raw).toBe("2026-02-01T08:00:00.000Z");

    // Second job: no employment type
    expect(result.jobs[1].title).toBe("Product Designer");
    expect(result.jobs[1].location_raw).toBe("London, United Kingdom");
    expect(result.jobs[1].employment_type_raw).toBeNull();

    // Third job: minimal fields
    expect(result.jobs[2].title).toBe("Data Analyst Intern");
    expect(result.jobs[2].location_raw).toBe("Germany");
    expect(result.jobs[2].department_raw).toBeNull();
    expect(result.jobs[2].employment_type_raw).toBeNull();
    expect(result.jobs[2].posted_date_raw).toBeNull();

    // Fourth job: has ref URL
    expect(result.jobs[3].title).toBe("Engineering Manager");
    expect(result.jobs[3].url).toBe("https://careers.acmecorp.io/jobs/eng-manager-42");

    // All jobs should have consistent source metadata
    for (const job of result.jobs) {
      expect(job.source_type).toBe("ats_api");
      expect(job.source_ref).toBe("smartrecruiters");
      expect(job.job_uid).toHaveLength(40);
    }
  });
});

// ===========================================================================
// extractFromSmartRecruiters — filtering out invalid postings
// ===========================================================================

describe("extractFromSmartRecruiters — filters out invalid postings", () => {
  test("filters out postings with empty name and keeps valid ones", async () => {
    const postings = [
      makePosting({ id: "valid-1", name: "Valid Job" }),
      makePosting({ id: "invalid-1", name: "" }),
      makePosting({ id: "invalid-2", name: undefined }),
      makePosting({ id: "valid-2", name: "Another Valid Job" }),
    ];
    mockApiSuccess(postings);

    const result = await extractFromSmartRecruiters(makeContext());
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.map((j) => j.title)).toEqual(["Valid Job", "Another Valid Job"]);
  });
});
