import { sha1 } from "../utils/hash";
import { buildJob, dedupeJobs } from "./job-normalizer";
import type { BuildJobArgs } from "../extractors/extractor-types";
import type { AllJob } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a minimal valid BuildJobArgs that buildJob() will accept. */
function makeArgs(overrides: Partial<BuildJobArgs> & { raw?: Partial<BuildJobArgs["raw"]> } = {}): BuildJobArgs {
  const { raw: rawOverrides, ...rest } = overrides;
  return {
    sourceType: "html",
    sourceRef: "greenhouse",
    baseUrl: "https://boards.greenhouse.io",
    ...rest,
    raw: {
      title: "Software Engineer",
      url: "https://boards.greenhouse.io/acme/jobs/123",
      ...rawOverrides,
    },
  };
}

/** Convenience: build a job with defaults, asserting it is not null. */
function buildValidJob(overrides: Parameters<typeof makeArgs>[0] = {}): AllJob {
  const result = buildJob(makeArgs(overrides));
  expect(result).not.toBeNull();
  return result!;
}

// ---------------------------------------------------------------------------
// buildJob()
// ---------------------------------------------------------------------------

describe("buildJob", () => {
  // -- Happy path ----------------------------------------------------------

  test("returns a valid AllJob with all required fields populated", () => {
    const job = buildValidJob();

    expect(job.title).toBe("Software Engineer");
    expect(job.url).toBe("https://boards.greenhouse.io/acme/jobs/123");
    expect(job.canonical_url).toBe(job.url);
    expect(job.source_type).toBe("html");
    expect(job.source_ref).toBe("greenhouse");
  });

  test("job_uid is the SHA1 of the canonical URL", () => {
    const job = buildValidJob();
    const expectedUid = sha1("https://boards.greenhouse.io/acme/jobs/123");
    expect(job.job_uid).toBe(expectedUid);
  });

  test("job_id falls back to the first 12 characters of job_uid when jobIdHint is absent", () => {
    const job = buildValidJob();
    expect(job.job_id).toBe(job.job_uid.slice(0, 12));
    expect(job.job_id).toHaveLength(12);
  });

  test("job_id uses jobIdHint when provided", () => {
    const job = buildValidJob({ raw: { jobIdHint: "GH-42" } });
    expect(job.job_id).toBe("GH-42");
  });

  test("normalizes whitespace in title", () => {
    const job = buildValidJob({ raw: { title: "  Senior   Software  Engineer  " } });
    expect(job.title).toBe("Senior Software Engineer");
  });

  // -- Null returns --------------------------------------------------------

  test("returns null when title is empty", () => {
    expect(buildJob(makeArgs({ raw: { title: "" } }))).toBeNull();
  });

  test("returns null when title is only whitespace", () => {
    expect(buildJob(makeArgs({ raw: { title: "   " } }))).toBeNull();
  });

  test("resolves an empty url against baseUrl (treated as relative root)", () => {
    // An empty string resolved against a valid baseUrl yields the baseUrl itself
    const job = buildJob(makeArgs({ raw: { url: "" } }));
    expect(job).not.toBeNull();
    expect(job!.url).toBe("https://boards.greenhouse.io/");
  });

  test("returns null when url is invalid and cannot be resolved against baseUrl", () => {
    expect(
      buildJob(makeArgs({
        raw: { url: "not-a-valid-url" },
        baseUrl: "also-not-valid",
      })),
    ).toBeNull();
  });

  // -- URL normalization ---------------------------------------------------

  test("resolves a relative url against baseUrl", () => {
    const job = buildValidJob({
      raw: { url: "/jobs/456" },
      baseUrl: "https://apply.workable.com/acme",
    });
    expect(job.url).toBe("https://apply.workable.com/jobs/456");
  });

  test("strips tracking parameters from url", () => {
    const job = buildValidJob({
      raw: { url: "https://boards.greenhouse.io/acme/jobs/123?utm_source=linkedin&utm_medium=social" },
    });
    expect(job.url).not.toContain("utm_source");
    expect(job.url).not.toContain("utm_medium");
  });

  test("strips trailing slash from url path", () => {
    const job = buildValidJob({
      raw: { url: "https://boards.greenhouse.io/acme/jobs/123/" },
    });
    expect(job.url).toBe("https://boards.greenhouse.io/acme/jobs/123");
  });

  // -- Optional fields: present when provided ------------------------------

  test("includes location_raw when provided", () => {
    const job = buildValidJob({ raw: { locationRaw: "  New York, NY  " } });
    expect(job.location_raw).toBe("New York, NY");
  });

  test("includes department_raw when provided", () => {
    const job = buildValidJob({ raw: { departmentRaw: "Engineering" } });
    expect(job.department_raw).toBe("Engineering");
  });

  test("includes posted_date_raw when provided", () => {
    const job = buildValidJob({ raw: { postedDateRaw: "2025-01-15" } });
    expect(job.posted_date_raw).toBe("2025-01-15");
  });

  test("includes employment_type_raw when provided", () => {
    const job = buildValidJob({ raw: { employmentTypeRaw: "Full-time" } });
    expect(job.employment_type_raw).toBe("Full-time");
  });

  test("includes salary_raw when provided", () => {
    const job = buildValidJob({ raw: { salaryRaw: "$120,000 - $150,000" } });
    expect(job.salary_raw).toBe("$120,000 - $150,000");
  });

  test("includes workplace_type when provided", () => {
    const job = buildValidJob({ raw: { workplaceType: "Remote" } });
    expect(job.workplace_type).toBe("Remote");
  });

  // -- Optional fields: omitted when null / empty --------------------------

  test("sets location_raw to null when not provided", () => {
    const job = buildValidJob();
    expect(job.location_raw).toBeNull();
  });

  test("sets department_raw to null when not provided", () => {
    const job = buildValidJob();
    expect(job.department_raw).toBeNull();
  });

  test("omits description_text when no description data is provided", () => {
    const job = buildValidJob();
    expect(job).not.toHaveProperty("description_text");
  });

  test("omits salary_raw when not provided", () => {
    const job = buildValidJob();
    expect(job).not.toHaveProperty("salary_raw");
  });

  test("omits workplace_type when not provided", () => {
    const job = buildValidJob();
    expect(job).not.toHaveProperty("workplace_type");
  });

  test("apply_url resolves to baseUrl when applyUrl is not provided (defaults to empty string)", () => {
    // The code uses `args.raw.applyUrl ?? ""` so an undefined applyUrl becomes "",
    // which normalizeUrl resolves against the baseUrl
    const job = buildValidJob();
    expect(job.apply_url).toBe("https://boards.greenhouse.io/");
  });

  test("source_detail_url resolves to baseUrl when sourceDetailUrl is not provided (defaults to empty string)", () => {
    // Same fallback logic as applyUrl
    const job = buildValidJob();
    expect(job.source_detail_url).toBe("https://boards.greenhouse.io/");
  });

  test("omits source_job_raw when not provided", () => {
    const job = buildValidJob();
    expect(job).not.toHaveProperty("source_job_raw");
  });

  test("omits detail_fetch_status when not provided", () => {
    const job = buildValidJob();
    expect(job).not.toHaveProperty("detail_fetch_status");
  });

  test("omits detail_fetch_note when not provided", () => {
    const job = buildValidJob();
    expect(job).not.toHaveProperty("detail_fetch_note");
  });

  // -- Description merging -------------------------------------------------

  test("uses descriptionText as description_text", () => {
    const job = buildValidJob({ raw: { descriptionText: "A great role." } });
    expect(job.description_text).toBe("A great role.");
  });

  test("falls back to descriptionHtml converted to text when descriptionText is absent", () => {
    const job = buildValidJob({
      raw: { descriptionHtml: "<p>Build amazing products.</p>" },
    });
    expect(job.description_text).toContain("Build amazing products.");
    // Should not contain HTML tags
    expect(job.description_text).not.toContain("<p>");
  });

  test("appends requirements section to description when not already present", () => {
    const job = buildValidJob({
      raw: {
        descriptionText: "Main description.",
        requirementsText: "5+ years experience.",
      },
    });
    expect(job.description_text).toContain("Main description.");
    expect(job.description_text).toContain("Requirements:");
    expect(job.description_text).toContain("5+ years experience.");
  });

  test("appends responsibilities section to description", () => {
    const job = buildValidJob({
      raw: {
        descriptionText: "Main description.",
        responsibilitiesText: "Lead engineering team.",
      },
    });
    expect(job.description_text).toContain("Responsibilities:");
    expect(job.description_text).toContain("Lead engineering team.");
  });

  test("appends benefits section to description", () => {
    const job = buildValidJob({
      raw: {
        descriptionText: "Main description.",
        benefitsText: "Health insurance and 401k.",
      },
    });
    expect(job.description_text).toContain("Benefits:");
    expect(job.description_text).toContain("Health insurance and 401k.");
  });

  test("does not duplicate a section that already appears in the description", () => {
    const requirements = "5+ years experience in backend development";
    const job = buildValidJob({
      raw: {
        descriptionText: `Overview\n${requirements}`,
        requirementsText: requirements,
      },
    });
    // The requirements text should appear only once (already present in description)
    const occurrences = job.description_text!.split(requirements).length - 1;
    expect(occurrences).toBe(1);
  });

  test("builds description from sections alone when descriptionText and descriptionHtml are absent", () => {
    const job = buildValidJob({
      raw: {
        requirementsText: "TypeScript",
        benefitsText: "Equity",
      },
    });
    expect(job.description_text).toContain("Requirements:");
    expect(job.description_text).toContain("TypeScript");
    expect(job.description_text).toContain("Benefits:");
    expect(job.description_text).toContain("Equity");
  });

  // -- apply_url and source_detail_url normalization -----------------------

  test("normalizes applyUrl and includes it", () => {
    const job = buildValidJob({
      raw: { applyUrl: "/apply/123?utm_source=google" },
      baseUrl: "https://boards.greenhouse.io",
    });
    expect(job.apply_url).toBe("https://boards.greenhouse.io/apply/123");
    expect(job.apply_url).not.toContain("utm_source");
  });

  test("normalizes sourceDetailUrl and includes it", () => {
    const job = buildValidJob({
      raw: { sourceDetailUrl: "https://boards.greenhouse.io/detail/123/" },
    });
    expect(job.source_detail_url).toBe("https://boards.greenhouse.io/detail/123");
  });

  // -- source_job_raw passthrough ------------------------------------------

  test("passes through source_job_raw as-is when provided", () => {
    const rawPayload = { id: 999, custom: true };
    const job = buildValidJob({ raw: { sourceJobRaw: rawPayload } });
    expect(job.source_job_raw).toEqual(rawPayload);
  });

  // -- detail_fetch_status and detail_fetch_note ---------------------------

  test("includes detail_fetch_status when provided", () => {
    const job = buildValidJob({ raw: { detailFetchStatus: "ok" } });
    expect(job.detail_fetch_status).toBe("ok");
  });

  test("includes detail_fetch_note when provided", () => {
    const job = buildValidJob({ raw: { detailFetchNote: "Fetched via API" } });
    expect(job.detail_fetch_note).toBe("Fetched via API");
  });

  // -- sourceType and sourceRef passthrough --------------------------------

  test("includes ats_api as source_type when specified", () => {
    const job = buildValidJob({ sourceType: "ats_api" });
    expect(job.source_type).toBe("ats_api");
  });

  test("includes lever as source_ref when specified", () => {
    const job = buildValidJob({ sourceRef: "lever" });
    expect(job.source_ref).toBe("lever");
  });

  // -- Determinism ---------------------------------------------------------

  test("produces the same job_uid for the same canonical URL across calls", () => {
    const job1 = buildValidJob();
    const job2 = buildValidJob();
    expect(job1.job_uid).toBe(job2.job_uid);
  });

  test("produces different job_uid for different URLs", () => {
    const job1 = buildValidJob({ raw: { url: "https://example.com/jobs/1" } });
    const job2 = buildValidJob({ raw: { url: "https://example.com/jobs/2" } });
    expect(job1.job_uid).not.toBe(job2.job_uid);
  });
});

// ---------------------------------------------------------------------------
// dedupeJobs()
// ---------------------------------------------------------------------------

describe("dedupeJobs", () => {
  /** Build a minimal AllJob for deduplication tests. */
  function makeJob(overrides: Partial<AllJob> = {}): AllJob {
    const url = overrides.canonical_url ?? overrides.url ?? "https://example.com/jobs/1";
    return {
      job_uid: sha1(url),
      job_id: "test-id",
      title: "Software Engineer",
      url,
      canonical_url: url,
      location_raw: null,
      department_raw: null,
      posted_date_raw: null,
      employment_type_raw: null,
      source_type: "html",
      source_ref: "greenhouse",
      ...overrides,
    };
  }

  // -- No duplicates -------------------------------------------------------

  test("returns all jobs when there are no duplicates", () => {
    const jobs = [
      makeJob({ canonical_url: "https://example.com/jobs/1", url: "https://example.com/jobs/1" }),
      makeJob({ canonical_url: "https://example.com/jobs/2", url: "https://example.com/jobs/2" }),
      makeJob({ canonical_url: "https://example.com/jobs/3", url: "https://example.com/jobs/3" }),
    ];
    const result = dedupeJobs(jobs);
    expect(result).toHaveLength(3);
  });

  test("returns an empty array when given an empty array", () => {
    expect(dedupeJobs([])).toEqual([]);
  });

  test("returns a single job when given a single job", () => {
    const jobs = [makeJob()];
    const result = dedupeJobs(jobs);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(jobs[0]);
  });

  // -- Deduplication by canonical_url --------------------------------------

  test("removes duplicates with the same canonical_url", () => {
    const url = "https://example.com/jobs/42";
    const jobs = [
      makeJob({ canonical_url: url, url, title: "Engineer" }),
      makeJob({ canonical_url: url, url, title: "Engineer" }),
    ];
    const result = dedupeJobs(jobs);
    expect(result).toHaveLength(1);
  });

  test("preserves insertion order of first-seen canonical_url", () => {
    const jobs = [
      makeJob({ canonical_url: "https://example.com/jobs/1", url: "https://example.com/jobs/1", title: "First" }),
      makeJob({ canonical_url: "https://example.com/jobs/2", url: "https://example.com/jobs/2", title: "Second" }),
      makeJob({ canonical_url: "https://example.com/jobs/3", url: "https://example.com/jobs/3", title: "Third" }),
    ];
    const result = dedupeJobs(jobs);
    expect(result.map((j) => j.title)).toEqual(["First", "Second", "Third"]);
  });

  // -- Scoring: non-generic title bonus ------------------------------------

  test("prefers a job with a non-generic title over a generic title", () => {
    const url = "https://example.com/jobs/42";
    const generic = makeJob({ canonical_url: url, url, title: "View Details" });
    const descriptive = makeJob({ canonical_url: url, url, title: "Senior Backend Engineer" });
    const result = dedupeJobs([generic, descriptive]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Senior Backend Engineer");
  });

  test("treats 'Apply Now' as a generic title", () => {
    const url = "https://example.com/jobs/55";
    const generic = makeJob({ canonical_url: url, url, title: "Apply Now" });
    const descriptive = makeJob({ canonical_url: url, url, title: "Product Manager" });
    const result = dedupeJobs([generic, descriptive]);
    expect(result[0].title).toBe("Product Manager");
  });

  test("treats 'Learn More' as a generic title", () => {
    const url = "https://example.com/jobs/55";
    const generic = makeJob({ canonical_url: url, url, title: "Learn More" });
    const descriptive = makeJob({ canonical_url: url, url, title: "Data Scientist" });
    const result = dedupeJobs([generic, descriptive]);
    expect(result[0].title).toBe("Data Scientist");
  });

  // -- Scoring: word count bonus -------------------------------------------

  test("prefers a title with 2-12 words over a single-word title", () => {
    const url = "https://example.com/jobs/7";
    const oneWord = makeJob({ canonical_url: url, url, title: "Developer" });
    const multiWord = makeJob({ canonical_url: url, url, title: "Senior Full Stack Developer" });
    const result = dedupeJobs([oneWord, multiWord]);
    expect(result[0].title).toBe("Senior Full Stack Developer");
  });

  // -- Scoring: camelCase penalty ------------------------------------------

  test("penalizes a title containing camelCase patterns", () => {
    const url = "https://example.com/jobs/8";
    const camelCase = makeJob({ canonical_url: url, url, title: "softwareEngineer" });
    const clean = makeJob({ canonical_url: url, url, title: "Software Engineer" });
    const result = dedupeJobs([camelCase, clean]);
    expect(result[0].title).toBe("Software Engineer");
  });

  // -- Scoring: location-in-title penalty ----------------------------------

  test("penalizes a title that looks like it contains location metadata with a comma", () => {
    const url = "https://example.com/jobs/9";
    const withLocation = makeJob({
      canonical_url: url,
      url,
      title: "Engineer, Remote, United States",
    });
    const clean = makeJob({ canonical_url: url, url, title: "Software Engineer" });
    const result = dedupeJobs([withLocation, clean]);
    expect(result[0].title).toBe("Software Engineer");
  });

  // -- Scoring: ats_api source bonus ---------------------------------------

  test("prefers a job from ats_api over html source", () => {
    const url = "https://example.com/jobs/10";
    const htmlJob = makeJob({ canonical_url: url, url, title: "Engineer", source_type: "html" });
    const apiJob = makeJob({ canonical_url: url, url, title: "Engineer", source_type: "ats_api" });
    const result = dedupeJobs([htmlJob, apiJob]);
    expect(result[0].source_type).toBe("ats_api");
  });

  // -- Scoring: description length bonus -----------------------------------

  test("prefers a job with a description longer than 60 characters", () => {
    const url = "https://example.com/jobs/11";
    const noDesc = makeJob({ canonical_url: url, url, title: "Engineer" });
    const withDesc = makeJob({
      canonical_url: url,
      url,
      title: "Engineer",
      description_text: "This is a detailed job description that exceeds sixty characters in total length easily.",
    });
    const result = dedupeJobs([noDesc, withDesc]);
    expect(result[0].description_text).toBeDefined();
    expect(result[0].description_text!.length).toBeGreaterThan(60);
  });

  // -- Scoring: combined factors -------------------------------------------

  test("ats_api source can outweigh a slightly better title when scores combine", () => {
    const url = "https://example.com/jobs/12";
    // The html job has a slightly better title (2 words vs 1) but the api job has ats_api bonus (+30)
    const htmlJob = makeJob({
      canonical_url: url,
      url,
      title: "Backend Engineer",
      source_type: "html",
    });
    const apiJob = makeJob({
      canonical_url: url,
      url,
      title: "Backend Engineer",
      source_type: "ats_api",
      description_text: "A very long and detailed description of the role that provides sufficient context about the position.",
    });
    const result = dedupeJobs([htmlJob, apiJob]);
    expect(result[0].source_type).toBe("ats_api");
  });

  // -- Edge: keeps the first if scores are equal ---------------------------

  test("keeps the first-seen job when two duplicates have equal scores", () => {
    const url = "https://example.com/jobs/13";
    const first = makeJob({ canonical_url: url, url, title: "Software Engineer", job_id: "first" });
    const second = makeJob({ canonical_url: url, url, title: "Software Engineer", job_id: "second" });
    const result = dedupeJobs([first, second]);
    expect(result).toHaveLength(1);
    // Equal scores means the second does NOT beat the first (strictly greater required)
    expect(result[0].job_id).toBe("first");
  });

  // -- Multiple groups of duplicates ---------------------------------------

  test("deduplicates independently across different canonical URLs", () => {
    const url1 = "https://example.com/jobs/a";
    const url2 = "https://example.com/jobs/b";

    const jobs = [
      makeJob({ canonical_url: url1, url: url1, title: "View Details", source_type: "html" }),
      makeJob({ canonical_url: url2, url: url2, title: "View Details", source_type: "html" }),
      makeJob({ canonical_url: url1, url: url1, title: "Frontend Engineer", source_type: "ats_api" }),
      makeJob({ canonical_url: url2, url: url2, title: "Backend Engineer", source_type: "ats_api" }),
    ];

    const result = dedupeJobs(jobs);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Frontend Engineer");
    expect(result[1].title).toBe("Backend Engineer");
  });

  // -- Generic title patterns exhaustive -----------------------------------

  test.each([
    "details",
    "View Details",
    "learn more",
    "Read More",
    "Apply Now",
    "Apply Now for this position",
    "Click Here",
    "Open Role",
    "Open Roles",
    "View Job",
    "View Jobs",
    "Job Opening",
    "Job Openings",
    "Jobs",
    "Job",
    "Careers",
    "careers",
  ])("recognizes '%s' as a generic title that is penalized in scoring", (genericTitle) => {
    const url = "https://example.com/jobs/pattern-test";
    const generic = makeJob({ canonical_url: url, url, title: genericTitle });
    const descriptive = makeJob({ canonical_url: url, url, title: "Staff Platform Engineer" });
    const result = dedupeJobs([generic, descriptive]);
    expect(result[0].title).toBe("Staff Platform Engineer");
  });
});
