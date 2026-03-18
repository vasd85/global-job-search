import { sha1 } from "../utils/hash";
import { buildJob, dedupeJobs } from "./job-normalizer";
import type { BuildJobArgs } from "../extractors/extractor-types";
import type { AllJob } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a minimal valid BuildJobArgs that buildJob() will accept. */
function makeArgs(
  overrides: Omit<Partial<BuildJobArgs>, "raw"> & { raw?: Partial<BuildJobArgs["raw"]> } = {},
): BuildJobArgs {
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
    expect(job.job_uid).toBe(sha1("https://boards.greenhouse.io/acme/jobs/123"));
  });

  test("job_id defaults to first 12 chars of job_uid when jobIdHint is absent", () => {
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

  test.each([
    ["empty string", ""],
    ["only whitespace", "   "],
  ])("returns null when title is %s", (_label, title) => {
    expect(buildJob(makeArgs({ raw: { title } }))).toBeNull();
  });

  test("resolves an empty url against baseUrl", () => {
    const job = buildJob(makeArgs({ raw: { url: "" } }));
    expect(job).not.toBeNull();
    expect(job!.url).toBe("https://boards.greenhouse.io/");
  });

  test("returns null when url is invalid and baseUrl cannot resolve it", () => {
    expect(
      buildJob(makeArgs({ raw: { url: "not-a-valid-url" }, baseUrl: "also-not-valid" })),
    ).toBeNull();
  });

  // -- URL normalization (wiring check — details tested in url utils) ------

  test("delegates URL normalization to normalizeUrl", () => {
    // One representative case proves wiring; exhaustive URL normalization belongs in url tests
    const job = buildValidJob({
      raw: { url: "/jobs/456" },
      baseUrl: "https://apply.workable.com/acme",
    });
    expect(job.url).toBe("https://apply.workable.com/jobs/456");
  });

  // -- Optional fields: present when provided ------------------------------

  test.each<[string, Partial<BuildJobArgs["raw"]>, string]>([
    ["location_raw", { locationRaw: "  New York, NY  " }, "New York, NY"],
    ["department_raw", { departmentRaw: "Engineering" }, "Engineering"],
    ["posted_date_raw", { postedDateRaw: "2025-01-15" }, "2025-01-15"],
    ["employment_type_raw", { employmentTypeRaw: "Full-time" }, "Full-time"],
    ["salary_raw", { salaryRaw: "$120,000 - $150,000" }, "$120,000 - $150,000"],
    ["workplace_type", { workplaceType: "Remote" }, "Remote"],
  ])("includes %s when provided (trimmed)", (field, rawOverrides, expected) => {
    const job = buildValidJob({ raw: rawOverrides });
    expect(job[field as keyof AllJob]).toBe(expected);
  });

  // -- Optional fields: null or omitted when absent ------------------------

  test.each<[string]>([
    ["location_raw"],
    ["department_raw"],
    ["posted_date_raw"],
    ["employment_type_raw"],
  ])("%s defaults to null when not provided", (field) => {
    const job = buildValidJob();
    expect(job[field as keyof AllJob]).toBeNull();
  });

  test.each<[string]>([
    ["description_text"],
    ["salary_raw"],
    ["workplace_type"],
    ["source_job_raw"],
    ["detail_fetch_status"],
    ["detail_fetch_note"],
  ])("%s is omitted from result when not provided", (field) => {
    const job = buildValidJob();
    expect(job).not.toHaveProperty(field);
  });

  // TODO: When applyUrl is not provided, the normalizer falls back to "" which
  // resolves to baseUrl + "/". This means every job gets an apply_url even when
  // the source had none. Should probably be null/omitted instead.
  test("apply_url resolves to baseUrl when applyUrl is not provided", () => {
    const job = buildValidJob();
    expect(job.apply_url).toBe("https://boards.greenhouse.io/");
  });

  // TODO: Same empty-string fallback issue as applyUrl above.
  test("source_detail_url resolves to baseUrl when sourceDetailUrl is not provided", () => {
    const job = buildValidJob();
    expect(job.source_detail_url).toBe("https://boards.greenhouse.io/");
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
    expect(job.description_text).not.toContain("<p>");
  });

  test.each([
    ["requirements", { requirementsText: "5+ years experience." }, "Requirements:"],
    ["responsibilities", { responsibilitiesText: "Lead engineering team." }, "Responsibilities:"],
    ["benefits", { benefitsText: "Health insurance and 401k." }, "Benefits:"],
  ])("appends %s section to description", (_label, rawOverrides, expectedLabel) => {
    const job = buildValidJob({
      raw: { descriptionText: "Main description.", ...rawOverrides },
    });
    expect(job.description_text).toContain("Main description.");
    expect(job.description_text).toContain(expectedLabel);
    expect(job.description_text).toContain(Object.values(rawOverrides)[0]);
  });

  test("does not duplicate a section already present in the description", () => {
    const requirements = "5+ years experience in backend development";
    const job = buildValidJob({
      raw: { descriptionText: `Overview\n${requirements}`, requirementsText: requirements },
    });
    const occurrences = job.description_text!.split(requirements).length - 1;
    expect(occurrences).toBe(1);
  });

  test("builds description from sections alone when descriptionText and descriptionHtml are absent", () => {
    const job = buildValidJob({
      raw: { requirementsText: "TypeScript", benefitsText: "Equity" },
    });
    expect(job.description_text).toContain("Requirements:");
    expect(job.description_text).toContain("TypeScript");
    expect(job.description_text).toContain("Benefits:");
    expect(job.description_text).toContain("Equity");
  });

  // -- apply_url / source_detail_url normalization (wiring check) ----------

  test("normalizes applyUrl through normalizeUrl", () => {
    const job = buildValidJob({
      raw: { applyUrl: "/apply/123?utm_source=google" },
      baseUrl: "https://boards.greenhouse.io",
    });
    expect(job.apply_url).toBe("https://boards.greenhouse.io/apply/123");
  });

  test("normalizes sourceDetailUrl through normalizeUrl", () => {
    const job = buildValidJob({
      raw: { sourceDetailUrl: "https://boards.greenhouse.io/detail/123/" },
    });
    expect(job.source_detail_url).toBe("https://boards.greenhouse.io/detail/123");
  });

  // -- Passthrough fields --------------------------------------------------

  test("passes through source_job_raw as-is", () => {
    const rawPayload = { id: 999, custom: true };
    const job = buildValidJob({ raw: { sourceJobRaw: rawPayload } });
    expect(job.source_job_raw).toEqual(rawPayload);
  });

  test.each<[string, Partial<BuildJobArgs>, string, string]>([
    ["source_type", { sourceType: "ats_api" }, "source_type", "ats_api"],
    ["source_ref", { sourceRef: "lever" }, "source_ref", "lever"],
    ["detail_fetch_status", {}, "detail_fetch_status", "ok"],
    ["detail_fetch_note", {}, "detail_fetch_note", "Fetched via API"],
  ])("includes %s when provided", (_label, argsOverrides, field, expected) => {
    // detail_fetch_* fields are in raw, others are top-level
    const rawOverrides: Partial<BuildJobArgs["raw"]> = {};
    if (field === "detail_fetch_status") rawOverrides.detailFetchStatus = expected as "ok";
    if (field === "detail_fetch_note") rawOverrides.detailFetchNote = expected;

    const job = buildValidJob({ ...argsOverrides, raw: rawOverrides });
    expect(job[field as keyof AllJob]).toBe(expected);
  });

  // -- Determinism ---------------------------------------------------------

  test("produces the same job_uid for the same canonical URL across calls", () => {
    expect(buildValidJob().job_uid).toBe(buildValidJob().job_uid);
  });

  test("produces different job_uid for different URLs", () => {
    const job1 = buildValidJob({ raw: { url: "https://example.com/jobs/1" } });
    const job2 = buildValidJob({ raw: { url: "https://example.com/jobs/2" } });
    expect(job1.job_uid).not.toBe(job2.job_uid);
  });

  // -- Adversarial title inputs --------------------------------------------

  test.each([
    ["only special characters", "!!!@@@###"],
    ["emoji-only title", "\u{1F680}\u{1F4BB}\u{1F525}"],
  ])("accepts title with %s (cleanText does not reject non-alpha)", (_label, title) => {
    const job = buildValidJob({ raw: { title } });
    expect(job.title).toBe(title);
  });

  // cleanText delegates to normalizeText which only collapses whitespace — no entity decoding
  test("does not decode HTML entities in title (cleanText only normalizes whitespace)", () => {
    const job = buildValidJob({ raw: { title: "Software &amp; Data Engineer" } });
    expect(job.title).toBe("Software &amp; Data Engineer");
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
    const jobs = [1, 2, 3].map((i) =>
      makeJob({ canonical_url: `https://example.com/jobs/${i}`, url: `https://example.com/jobs/${i}` }),
    );
    expect(dedupeJobs(jobs)).toHaveLength(3);
  });

  test("returns an empty array when given an empty array", () => {
    expect(dedupeJobs([])).toEqual([]);
  });

  test("returns a single job when given a single job", () => {
    const jobs = [makeJob()];
    expect(dedupeJobs(jobs)).toEqual(jobs);
  });

  // -- Deduplication by canonical_url --------------------------------------

  test("removes duplicates with the same canonical_url", () => {
    const url = "https://example.com/jobs/42";
    const jobs = [
      makeJob({ canonical_url: url, url }),
      makeJob({ canonical_url: url, url }),
    ];
    expect(dedupeJobs(jobs)).toHaveLength(1);
  });

  test("preserves insertion order of first-seen canonical_url", () => {
    const jobs = [1, 2, 3].map((i) =>
      makeJob({
        canonical_url: `https://example.com/jobs/${i}`,
        url: `https://example.com/jobs/${i}`,
        title: `Title ${i}`,
      }),
    );
    expect(dedupeJobs(jobs).map((j) => j.title)).toEqual(["Title 1", "Title 2", "Title 3"]);
  });

  // -- Scoring: generic title penalty -------------------------------------

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
  ])("penalizes generic title '%s' in favor of descriptive title", (genericTitle) => {
    const url = "https://example.com/jobs/pattern-test";
    const generic = makeJob({ canonical_url: url, url, title: genericTitle });
    const descriptive = makeJob({ canonical_url: url, url, title: "Staff Platform Engineer" });
    const result = dedupeJobs([generic, descriptive]);
    expect(result[0].title).toBe("Staff Platform Engineer");
  });

  // -- Scoring: word count bonus -------------------------------------------

  test("prefers a multi-word title over a single-word title", () => {
    const url = "https://example.com/jobs/7";
    const oneWord = makeJob({ canonical_url: url, url, title: "Developer" });
    const multiWord = makeJob({ canonical_url: url, url, title: "Senior Full Stack Developer" });
    expect(dedupeJobs([oneWord, multiWord])[0].title).toBe("Senior Full Stack Developer");
  });

  // -- Scoring: camelCase penalty ------------------------------------------

  test("penalizes a title containing camelCase patterns", () => {
    const url = "https://example.com/jobs/8";
    const camelCase = makeJob({ canonical_url: url, url, title: "softwareEngineer" });
    const clean = makeJob({ canonical_url: url, url, title: "Software Engineer" });
    expect(dedupeJobs([camelCase, clean])[0].title).toBe("Software Engineer");
  });

  // -- Scoring: location-in-title penalty ----------------------------------

  test("penalizes a title with location keyword AND comma", () => {
    const url = "https://example.com/jobs/9";
    const withLocation = makeJob({ canonical_url: url, url, title: "Engineer, Remote, United States" });
    const clean = makeJob({ canonical_url: url, url, title: "Software Engineer" });
    expect(dedupeJobs([withLocation, clean])[0].title).toBe("Software Engineer");
  });

  // Adversarial: location keyword without comma should NOT trigger the penalty
  test("does not penalize a title with location keyword but no comma", () => {
    const url = "https://example.com/jobs/adv-1";
    const withKeyword = makeJob({ canonical_url: url, url, title: "Remote Software Engineer" });
    const plain = makeJob({ canonical_url: url, url, title: "Software Engineer" });
    // Both have same word-count bonus and non-generic bonus; "Remote Software Engineer"
    // should NOT be penalized since there's no comma
    const result = dedupeJobs([withKeyword, plain]);
    // First-seen wins when scores are equal (no penalty applied)
    expect(result[0].title).toBe("Remote Software Engineer");
  });

  // -- Scoring: ats_api source bonus ---------------------------------------

  test("prefers a job from ats_api over html source", () => {
    const url = "https://example.com/jobs/10";
    const htmlJob = makeJob({ canonical_url: url, url, title: "Engineer", source_type: "html" });
    const apiJob = makeJob({ canonical_url: url, url, title: "Engineer", source_type: "ats_api" });
    expect(dedupeJobs([htmlJob, apiJob])[0].source_type).toBe("ats_api");
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

  test("ats_api source can outweigh other factors when scores combine", () => {
    const url = "https://example.com/jobs/12";
    const htmlJob = makeJob({ canonical_url: url, url, title: "Backend Engineer", source_type: "html" });
    const apiJob = makeJob({
      canonical_url: url,
      url,
      title: "Backend Engineer",
      source_type: "ats_api",
      description_text: "A very long and detailed description of the role that provides sufficient context about the position.",
    });
    expect(dedupeJobs([htmlJob, apiJob])[0].source_type).toBe("ats_api");
  });

  // -- Edge: equal scores --------------------------------------------------

  test("keeps first-seen job when scores are equal", () => {
    const url = "https://example.com/jobs/13";
    const first = makeJob({ canonical_url: url, url, title: "Software Engineer", job_id: "first" });
    const second = makeJob({ canonical_url: url, url, title: "Software Engineer", job_id: "second" });
    const result = dedupeJobs([first, second]);
    expect(result).toHaveLength(1);
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
});
