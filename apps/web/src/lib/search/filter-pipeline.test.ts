// @vitest-environment node

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const {
  classifyJobMultiMock,
  extractSeniorityMock,
  resolveAllTiersMock,
  matchJobToTiersMock,
  queryResults,
  batchResults,
  selectCallCount,
} = vi.hoisted(() => {
  const classifyJobMultiMock = vi.fn();
  const extractSeniorityMock = vi.fn();
  const resolveAllTiersMock = vi.fn();
  const matchJobToTiersMock = vi.fn();
  // Queue for simple select queries (profile, companyPrefs, roleFamilies).
  const queryResults: unknown[][] = [];
  // Queue for batch-fetch queries.
  const batchResults: unknown[][] = [];
  // Mutable counter to track select() call order.
  const selectCallCount = { value: 0 };

  return {
    classifyJobMultiMock,
    extractSeniorityMock,
    resolveAllTiersMock,
    matchJobToTiersMock,
    queryResults,
    batchResults,
    selectCallCount,
  };
});

vi.mock("drizzle-orm", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const sqlFn = Object.assign(vi.fn((..._args: unknown[]) => "sql-tag"), {
    join: vi.fn(() => "sql-join"),
  });
  return {
    eq: vi.fn((col, val) => `eq(${String(col)},${String(val)})`),
    and: vi.fn((...args: unknown[]) => args),
    desc: vi.fn((col) => `desc(${String(col)})`),
    sql: sqlFn,
  };
});

vi.mock("@/lib/db/schema", () => ({
  jobs: {
    id: "jobs.id",
    title: "jobs.title",
    url: "jobs.url",
    applyUrl: "jobs.applyUrl",
    locationRaw: "jobs.locationRaw",
    departmentRaw: "jobs.departmentRaw",
    workplaceType: "jobs.workplaceType",
    salaryRaw: "jobs.salaryRaw",
    firstSeenAt: "jobs.firstSeenAt",
    lastSeenAt: "jobs.lastSeenAt",
    companyId: "jobs.companyId",
    status: "jobs.status",
  },
  companies: {
    id: "companies.id",
    name: "companies.name",
    slug: "companies.slug",
    industry: "companies.industry",
  },
  userProfiles: {
    id: "userProfiles.id",
    userId: "userProfiles.userId",
  },
  userCompanyPreferences: {
    userId: "userCompanyPreferences.userId",
  },
  roleFamilies: "roleFamilies-table-token",
}));

// Synonym cache passthrough: returns the input terms deduplicated (matching the
// real expandTerms contract) so existing tests keep asserting on the
// split/lowercase behavior without needing DB data.
vi.mock("@/lib/search/synonym-cache", () => ({
  expandTerms: vi.fn((_dimension: string, terms: string[]) =>
    Promise.resolve([...new Set(terms)]),
  ),
}));

vi.mock("@gjs/ats-core", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  classifyJobMulti: (...args: unknown[]) => classifyJobMultiMock(...args),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  extractSeniority: (...args: unknown[]) => extractSeniorityMock(...args),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  resolveAllTiers: (...args: unknown[]) => resolveAllTiersMock(...args),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  matchJobToTiers: (...args: unknown[]) => matchJobToTiersMock(...args),
}));

// ---------------------------------------------------------------------------
// DB mock: dispatches by call order.
//
// Queries 1-2: db.select().from(table).where(...).limit(1)
// Query 3:     db.select().from(roleFamilies)        -- direct await, no .where()
// Query 4+:    db.select({}).from(jobs).innerJoin().where().orderBy().limit().offset()
//
// The from() return is a thenable that also has .where() and .innerJoin(),
// so it works for all three patterns.
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      selectCallCount.value++;
      const callNum = selectCallCount.value;

      if (callNum <= 3) {
        // Simple queries: profile, companyPrefs, roleFamilies
        const result = queryResults.shift() ?? [];
        return {
          from: vi.fn(() => {
            // Thenable + chainable: supports both `await from()` and `from().where().limit()`
            return {
              where: vi.fn(() => ({
                limit: vi.fn(() => Promise.resolve(result)),
              })),
              then: (
                resolve: (v: unknown) => void,
                reject: (e: unknown) => void,
              ) => Promise.resolve(result).then(resolve, reject),
            };
          }),
        };
      }

      // Batch query: select({}).from(jobs).innerJoin().where().orderBy().limit().offset()
      return {
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn(() => ({
                  offset: vi.fn(() => {
                    const r = batchResults.shift();
                    return Promise.resolve(r ?? []);
                  }),
                })),
              })),
            })),
          })),
        })),
      };
    }),
  },
}));

import { searchJobs, normalizeIndustryTerms } from "./filter-pipeline";
import type { Database } from "@/lib/db";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultPagination = { limit: 50, offset: 0 };

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    userId: "user-1",
    targetTitles: ["QA Engineer"],
    targetSeniority: ["senior"],
    remotePreference: "hybrid_ok",
    preferredLocations: ["United States"],
    ...overrides,
  };
}

function makeRoleFamily(overrides: Record<string, unknown> = {}) {
  return {
    id: "family-1",
    slug: "qa_testing",
    name: "QA / Testing",
    strongMatch: ["qa engineer", "test engineer", "sdet"],
    moderateMatch: ["quality assurance"],
    departmentBoost: ["engineering", "quality"],
    departmentExclude: ["finance", "legal"],
    isSystemDefined: true,
    ...overrides,
  };
}

function makeCompanyPrefs(overrides: Record<string, unknown> = {}) {
  return {
    id: "pref-1",
    userId: "user-1",
    industries: ["fintech", "AI/ML"],
    ...overrides,
  };
}

function makeCandidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    title: "QA Engineer",
    url: "https://boards.greenhouse.io/company/jobs/123",
    applyUrl: "https://boards.greenhouse.io/company/jobs/123/apply",
    locationRaw: "San Francisco, CA, United States",
    departmentRaw: "Engineering",
    workplaceType: "remote",
    salaryRaw: "$120k-$150k",
    firstSeenAt: new Date("2025-06-15T12:00:00Z"),
    lastSeenAt: new Date("2025-06-20T12:00:00Z"),
    companyName: "Acme Corp",
    companySlug: "acme-corp",
    companyIndustry: ["fintech"],
    ...overrides,
  };
}

/**
 * Setup the DB mocks for a standard search flow.
 * Pushes profile, company prefs, role families, and batch results
 * into the mock queues in the correct order.
 */
function setupStandardFlow(opts: {
  profile?: Record<string, unknown> | null;
  companyPrefs?: Record<string, unknown> | null;
  roleFamilies?: Array<Record<string, unknown>>;
  batches?: Array<Array<Record<string, unknown>>>;
}) {
  selectCallCount.value = 0;
  queryResults.length = 0;
  batchResults.length = 0;

  // Query 1: profile
  if (opts.profile === null) {
    queryResults.push([]);
  } else {
    queryResults.push([makeProfile(opts.profile ?? {})]);
  }

  // Query 2: company preferences
  if (opts.companyPrefs === null) {
    queryResults.push([]);
  } else {
    queryResults.push([makeCompanyPrefs(opts.companyPrefs ?? {})]);
  }

  // Query 3: role families (direct await on from())
  const families = opts.roleFamilies ?? [makeRoleFamily()];
  queryResults.push(families);

  // Batch results
  const batches = opts.batches ?? [];
  for (const batch of batches) {
    batchResults.push(batch);
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  selectCallCount.value = 0;
  queryResults.length = 0;
  batchResults.length = 0;

  // Default classifier: return score 1.0 strong match
  classifyJobMultiMock.mockReturnValue({
    score: 1.0,
    familySlug: "qa_testing",
    matchType: "strong",
    matchedPattern: "qa engineer",
  });

  // Default seniority: null (no seniority marker)
  extractSeniorityMock.mockReturnValue(null);

  // Default geo mocks: no tiers resolved (location filter skipped)
  resolveAllTiersMock.mockReturnValue([]);
  // Default: all jobs pass location filter
  matchJobToTiersMock.mockReturnValue({ passes: true, matchedTier: null });
});

// ---------------------------------------------------------------------------
// Profile and Preference Loading
// ---------------------------------------------------------------------------

describe("searchJobs -- profile and preference loading", () => {
  test("profile not found returns empty response", async () => {
    setupStandardFlow({ profile: null });

    const result = await searchJobs(
      db as unknown as Database,
      "nonexistent-id",
      defaultPagination,
    );

    expect(result.jobs).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.filters.roleFamilies).toEqual([]);
    expect(result.filters.seniority).toBeNull();
    expect(result.filters.remotePreference).toBe("any");
    expect(result.filters.locations).toEqual([]);
    expect(result.filters.industries).toEqual([]);
  });

  test("no role families in DB returns empty response", async () => {
    setupStandardFlow({ roleFamilies: [] });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  test("missing user company preferences uses empty industries", async () => {
    setupStandardFlow({
      companyPrefs: null,
      batches: [[makeCandidateRow()]],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs.length).toBe(1);
    expect(result.filters.industries).toEqual([]);
  });

  test("null-safe fallbacks for all profile fields", async () => {
    setupStandardFlow({
      profile: {
        targetTitles: null,
        targetSeniority: null,
        remotePreference: null,
        preferredLocations: null,
      },
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    // Empty target titles => no families => empty results
    expect(result.jobs).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.filters.seniority).toBeNull();
    expect(result.filters.remotePreference).toBe("any");
    expect(result.filters.locations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveRoleFamilies (tested indirectly through searchJobs)
// ---------------------------------------------------------------------------

describe("searchJobs -- role family resolution", () => {
  test("user target title matches one role family", async () => {
    setupStandardFlow({
      profile: { targetTitles: ["QA Engineer"] },
      batches: [[makeCandidateRow()]],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.filters.roleFamilies).toContain("qa_testing");
    expect(result.jobs.length).toBe(1);
  });

  test("user target title matches multiple role families", async () => {
    const backendFamily = makeRoleFamily({
      slug: "backend",
      strongMatch: ["software engineer", "backend engineer"],
      moderateMatch: [],
    });
    const fullstackFamily = makeRoleFamily({
      slug: "fullstack",
      strongMatch: ["software engineer", "full stack"],
      moderateMatch: [],
    });

    setupStandardFlow({
      profile: { targetTitles: ["Software Engineer"] },
      roleFamilies: [backendFamily, fullstackFamily],
      batches: [[makeCandidateRow({ title: "Software Engineer" })]],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.filters.roleFamilies).toContain("backend");
    expect(result.filters.roleFamilies).toContain("fullstack");
  });

  test("empty targetTitles returns empty results with filter metadata from profile", async () => {
    setupStandardFlow({
      profile: {
        targetTitles: [],
        targetSeniority: ["senior"],
        remotePreference: "hybrid_ok",
        preferredLocations: ["Berlin"],
      },
      companyPrefs: { industries: ["fintech"] },
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.filters.roleFamilies).toEqual([]);
    expect(result.filters.seniority).toEqual(["senior"]);
    expect(result.filters.remotePreference).toBe("hybrid_ok");
    expect(result.filters.locations).toEqual(["Berlin"]);
    expect(result.filters.industries).toEqual(["fintech"]);
  });

  test("target title with no family match returns empty results", async () => {
    setupStandardFlow({
      profile: { targetTitles: ["Underwater Basket Weaver"] },
    });
    // classifyJobMulti returns below threshold for all families
    classifyJobMultiMock.mockReturnValue({
      score: 0.2,
      familySlug: "qa_testing",
      matchType: "none",
      matchedPattern: null,
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs).toEqual([]);
    expect(result.filters.roleFamilies).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// In-Memory Classification Filter
// ---------------------------------------------------------------------------

describe("searchJobs -- in-memory classification filter", () => {
  test("jobs scoring below 0.5 are excluded", async () => {
    setupStandardFlow({
      batches: [[makeCandidateRow()]],
    });

    // First call(s): resolveRoleFamilies -> score 1.0 (family resolves)
    // Batch processing call: score 0.49 -> below threshold
    classifyJobMultiMock
      .mockReturnValueOnce({
        score: 1.0,
        familySlug: "qa_testing",
        matchType: "strong",
        matchedPattern: "qa engineer",
      })
      .mockReturnValueOnce({
        score: 0.49,
        familySlug: "qa_testing",
        matchType: "none",
        matchedPattern: null,
      });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs).toEqual([]);
    expect(result.total).toBe(0);
  });

  test("jobs scoring exactly 0.5 pass the filter", async () => {
    setupStandardFlow({
      batches: [[makeCandidateRow()]],
    });

    classifyJobMultiMock
      .mockReturnValueOnce({
        score: 1.0,
        familySlug: "qa_testing",
        matchType: "strong",
        matchedPattern: "qa engineer",
      })
      .mockReturnValueOnce({
        score: 0.5,
        familySlug: "qa_testing",
        matchType: "moderate",
        matchedPattern: "qa",
      });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs.length).toBe(1);
    expect(result.jobs[0].classificationScore).toBe(0.5);
  });

  test("classification metadata is correctly propagated to results", async () => {
    setupStandardFlow({
      batches: [[makeCandidateRow()]],
    });

    classifyJobMultiMock
      .mockReturnValueOnce({
        score: 1.0,
        familySlug: "qa_testing",
        matchType: "strong",
        matchedPattern: "qa engineer",
      })
      .mockReturnValueOnce({
        score: 0.8,
        familySlug: "qa_testing",
        matchType: "strong",
        matchedPattern: "qa engineer",
      });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs[0].classificationScore).toBe(0.8);
    expect(result.jobs[0].classificationFamily).toBe("qa_testing");
    expect(result.jobs[0].classificationMatchType).toBe("strong");
    // No location tiers configured in default profile, so matchedLocationTier is null
    expect(result.jobs[0].matchedLocationTier).toBeNull();
  });

  test("department exclusion causes score 0 -- job is excluded", async () => {
    setupStandardFlow({
      batches: [[makeCandidateRow({ departmentRaw: "Finance" })]],
    });

    classifyJobMultiMock
      .mockReturnValueOnce({
        score: 1.0,
        familySlug: "qa_testing",
        matchType: "strong",
        matchedPattern: "qa engineer",
      })
      .mockReturnValueOnce({
        score: 0,
        familySlug: "qa_testing",
        matchType: "none",
        matchedPattern: null,
      });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Seniority Filter
// ---------------------------------------------------------------------------

describe("searchJobs -- seniority filter", () => {
  test("job with matching seniority passes", async () => {
    setupStandardFlow({
      profile: { targetSeniority: ["senior"] },
      batches: [[makeCandidateRow({ title: "Senior QA Engineer" })]],
    });

    extractSeniorityMock.mockReturnValue("senior");

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs.length).toBe(1);
  });

  test("job with non-matching seniority is excluded", async () => {
    setupStandardFlow({
      profile: { targetSeniority: ["senior"] },
      batches: [[makeCandidateRow({ title: "Junior QA Engineer" })]],
    });

    extractSeniorityMock.mockReturnValue("junior");

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs).toEqual([]);
  });

  test("job with no seniority marker passes (permissive default)", async () => {
    setupStandardFlow({
      profile: { targetSeniority: ["senior"] },
      batches: [[makeCandidateRow({ title: "QA Engineer" })]],
    });

    extractSeniorityMock.mockReturnValue(null);

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs.length).toBe(1);
  });

  test("empty targetSeniority skips the seniority filter entirely", async () => {
    setupStandardFlow({
      profile: { targetSeniority: [] },
      batches: [[makeCandidateRow({ title: "Junior QA Engineer" })]],
    });

    extractSeniorityMock.mockReturnValue("junior");

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs.length).toBe(1);
  });

  test("multiple target seniorities -- job matches one of them", async () => {
    setupStandardFlow({
      profile: { targetSeniority: ["senior", "lead"] },
      batches: [[makeCandidateRow({ title: "Lead QA Engineer" })]],
    });

    extractSeniorityMock.mockReturnValue("lead");

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Location Filter (structured geo matching via resolveAllTiers / matchJobToTiers)
// ---------------------------------------------------------------------------

describe("searchJobs -- location tier resolution", () => {
  test("profile with valid locationPreferences resolves tiers via resolveAllTiers", async () => {
    const tiers = [
      {
        rank: 1,
        workFormats: ["remote"],
        scope: { type: "countries", include: ["US"] },
      },
    ];
    const resolvedTier = { rank: 1, countries: new Set(["US"]) };
    resolveAllTiersMock.mockReturnValue([resolvedTier]);
    matchJobToTiersMock.mockReturnValue({ passes: true, matchedTier: 1 });

    setupStandardFlow({
      profile: { locationPreferences: { tiers } },
      batches: [[makeCandidateRow()]],
    });

    await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(resolveAllTiersMock).toHaveBeenCalledWith(tiers);
  });

  test("profile with null locationPreferences skips resolveAllTiers", async () => {
    setupStandardFlow({
      profile: { locationPreferences: null },
      batches: [[makeCandidateRow()]],
    });

    await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(resolveAllTiersMock).not.toHaveBeenCalled();
  });

  test("profile with undefined locationPreferences skips resolveAllTiers", async () => {
    setupStandardFlow({
      // locationPreferences key is absent from the profile object
      batches: [[makeCandidateRow()]],
    });

    await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(resolveAllTiersMock).not.toHaveBeenCalled();
  });

  test("locationPreferences with unexpected shape (no tiers key) degrades gracefully", async () => {
    setupStandardFlow({
      profile: { locationPreferences: { wrongKey: [] } },
      batches: [[makeCandidateRow()]],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(resolveAllTiersMock).not.toHaveBeenCalled();
    // No location filtering -- job passes through
    expect(result.jobs.length).toBe(1);
  });

  test("locationPreferences with empty tiers array calls resolveAllTiers", async () => {
    resolveAllTiersMock.mockReturnValue([]);

    setupStandardFlow({
      profile: { locationPreferences: { tiers: [] } },
      batches: [[makeCandidateRow()]],
    });

    await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(resolveAllTiersMock).toHaveBeenCalledWith([]);
    // Empty resolved tiers means no location filter
    expect(matchJobToTiersMock).not.toHaveBeenCalled();
  });

  test("locationPreferences with null tiers skips resolveAllTiers", async () => {
    setupStandardFlow({
      profile: { locationPreferences: { tiers: null } },
      batches: [[makeCandidateRow()]],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(resolveAllTiersMock).not.toHaveBeenCalled();
    expect(result.jobs.length).toBe(1);
  });

  test("locationPreferences is a string (non-object JSONB) degrades gracefully", async () => {
    setupStandardFlow({
      profile: { locationPreferences: "remote" },
      batches: [[makeCandidateRow()]],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    // "remote".tiers is undefined, so resolvedTiers is []
    expect(resolveAllTiersMock).not.toHaveBeenCalled();
    expect(result.jobs.length).toBe(1);
  });

  test("locationPreferences is an array (non-object JSONB) degrades gracefully", async () => {
    setupStandardFlow({
      profile: {
        locationPreferences: [
          { rank: 1, workFormats: [], scope: { type: "any", include: [] } },
        ],
      },
      batches: [[makeCandidateRow()]],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    // Array.tiers is undefined, so resolvedTiers is []
    expect(resolveAllTiersMock).not.toHaveBeenCalled();
    expect(result.jobs.length).toBe(1);
  });
});

describe("searchJobs -- location filter (processInBatches)", () => {
  const resolvedTier = { rank: 1, countries: new Set(["US"]) };

  function setupWithLocationTiers(
    overrides: {
      profile?: Record<string, unknown>;
      batches?: Array<Array<Record<string, unknown>>>;
    } = {},
  ) {
    const tiers = [
      {
        rank: 1,
        workFormats: ["remote"],
        scope: { type: "countries", include: ["US"] },
      },
    ];
    resolveAllTiersMock.mockReturnValue([resolvedTier]);

    setupStandardFlow({
      profile: { locationPreferences: { tiers }, ...overrides.profile },
      batches: overrides.batches ?? [[makeCandidateRow()]],
    });
  }

  test("matchJobToTiers returns passes:true -- job is included with tier rank", async () => {
    setupWithLocationTiers();
    matchJobToTiersMock.mockReturnValue({ passes: true, matchedTier: 1 });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs.length).toBe(1);
    expect(result.jobs[0].matchedLocationTier).toBe(1);
  });

  test("matchJobToTiers returns passes:false -- job is excluded", async () => {
    setupWithLocationTiers();
    matchJobToTiersMock.mockReturnValue({ passes: false, matchedTier: null });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs).toEqual([]);
    expect(result.total).toBe(0);
  });

  test("empty resolvedTiers skips location filter -- matchJobToTiers not called", async () => {
    resolveAllTiersMock.mockReturnValue([]);
    setupStandardFlow({
      profile: { locationPreferences: { tiers: [] } },
      batches: [[makeCandidateRow()]],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(matchJobToTiersMock).not.toHaveBeenCalled();
    expect(result.jobs.length).toBe(1);
    expect(result.jobs[0].matchedLocationTier).toBeNull();
  });

  test("matchJobToTiers receives correct arguments from the row", async () => {
    setupWithLocationTiers({
      batches: [
        [
          makeCandidateRow({
            locationRaw: "Berlin, Germany",
            workplaceType: "hybrid",
          }),
        ],
      ],
    });
    matchJobToTiersMock.mockReturnValue({ passes: true, matchedTier: 1 });

    await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(matchJobToTiersMock).toHaveBeenCalledWith(
      "Berlin, Germany",
      "hybrid",
      [resolvedTier],
    );
  });

  test("job with null locationRaw -- matchJobToTiers receives null", async () => {
    setupWithLocationTiers({
      batches: [[makeCandidateRow({ locationRaw: null })]],
    });
    matchJobToTiersMock.mockReturnValue({ passes: true, matchedTier: null });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(matchJobToTiersMock).toHaveBeenCalledWith(
      null,
      "remote",
      [resolvedTier],
    );
    expect(result.jobs.length).toBe(1);
    expect(result.jobs[0].matchedLocationTier).toBeNull();
  });

  test("job with null workplaceType -- pipeline passes null to matchJobToTiers", async () => {
    setupWithLocationTiers({
      batches: [
        [
          makeCandidateRow({
            locationRaw: "London, UK",
            workplaceType: null,
          }),
        ],
      ],
    });
    matchJobToTiersMock.mockReturnValue({ passes: true, matchedTier: 1 });

    await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(matchJobToTiersMock).toHaveBeenCalledWith(
      "London, UK",
      null,
      [resolvedTier],
    );
  });

  test("multiple tiers -- matchedTier reflects the matching tier rank", async () => {
    const tier1 = { rank: 1, countries: new Set(["DE"]) };
    const tier2 = { rank: 2, countries: new Set(["GB"]) };
    const tier3 = { rank: 3, countries: new Set(["US"]) };
    resolveAllTiersMock.mockReturnValue([tier1, tier2, tier3]);

    setupStandardFlow({
      profile: {
        locationPreferences: {
          tiers: [
            {
              rank: 1,
              workFormats: ["onsite"],
              scope: { type: "countries", include: ["DE"] },
            },
            {
              rank: 2,
              workFormats: ["hybrid"],
              scope: { type: "countries", include: ["GB"] },
            },
            {
              rank: 3,
              workFormats: ["remote"],
              scope: { type: "countries", include: ["US"] },
            },
          ],
        },
      },
      batches: [[makeCandidateRow()]],
    });
    // Matched tier 2, not tier 1
    matchJobToTiersMock.mockReturnValue({ passes: true, matchedTier: 2 });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs[0].matchedLocationTier).toBe(2);
  });

  test("matchedLocationTier can be any positive integer (tier rank 5)", async () => {
    resolveAllTiersMock.mockReturnValue([{ rank: 5 }]);

    setupStandardFlow({
      profile: {
        locationPreferences: {
          tiers: [
            {
              rank: 5,
              workFormats: ["remote"],
              scope: { type: "any", include: [] },
            },
          ],
        },
      },
      batches: [[makeCandidateRow()]],
    });
    matchJobToTiersMock.mockReturnValue({ passes: true, matchedTier: 5 });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs[0].matchedLocationTier).toBe(5);
  });

  test("matchedLocationTier is present in all result jobs (never undefined)", async () => {
    setupStandardFlow({
      batches: [
        [
          makeCandidateRow({ id: "job-1" }),
          makeCandidateRow({ id: "job-2" }),
        ],
      ],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    for (const job of result.jobs) {
      expect(job).toHaveProperty("matchedLocationTier");
      // Must be number | null, never undefined
      expect(
        job.matchedLocationTier === null ||
          typeof job.matchedLocationTier === "number",
      ).toBe(true);
    }
  });
});

describe("searchJobs -- location filter error handling", () => {
  test("resolveAllTiers throws -- error propagates from searchJobs", async () => {
    resolveAllTiersMock.mockImplementation(() => {
      throw new Error("invalid tier structure");
    });

    setupStandardFlow({
      profile: {
        locationPreferences: {
          tiers: [
            {
              rank: 1,
              workFormats: ["remote"],
              scope: { type: "countries", include: ["US"] },
            },
          ],
        },
      },
      batches: [[makeCandidateRow()]],
    });

    await expect(
      searchJobs(db as unknown as Database, "profile-1", defaultPagination),
    ).rejects.toThrow("invalid tier structure");
  });

  test("matchJobToTiers throws -- error propagates from processInBatches", async () => {
    resolveAllTiersMock.mockReturnValue([{ rank: 1 }]);
    matchJobToTiersMock.mockImplementation(() => {
      throw new Error("unexpected location format");
    });

    setupStandardFlow({
      profile: {
        locationPreferences: {
          tiers: [
            {
              rank: 1,
              workFormats: ["remote"],
              scope: { type: "countries", include: ["US"] },
            },
          ],
        },
      },
      batches: [[makeCandidateRow()]],
    });

    await expect(
      searchJobs(db as unknown as Database, "profile-1", defaultPagination),
    ).rejects.toThrow("unexpected location format");
  });
});

describe("searchJobs -- preferredLocations vs locationPreferences", () => {
  test("both present -- only locationPreferences drives filtering; preferredLocations used in response", async () => {
    const resolvedTier = { rank: 1, countries: new Set(["DE", "GB"]) };
    resolveAllTiersMock.mockReturnValue([resolvedTier]);
    matchJobToTiersMock.mockReturnValue({ passes: true, matchedTier: 1 });

    setupStandardFlow({
      profile: {
        preferredLocations: ["Berlin", "London"],
        locationPreferences: {
          tiers: [
            {
              rank: 1,
              workFormats: ["remote"],
              scope: { type: "countries", include: ["DE", "GB"] },
            },
          ],
        },
      },
      batches: [[makeCandidateRow()]],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    // Filter was driven by locationPreferences (matchJobToTiers called)
    expect(matchJobToTiersMock).toHaveBeenCalled();
    // Response reflects preferredLocations, not resolved tiers
    expect(result.filters.locations).toEqual(["Berlin", "London"]);
  });

  test("no locationPreferences and no preferredLocations -- all jobs pass", async () => {
    setupStandardFlow({
      profile: {
        locationPreferences: null,
        preferredLocations: [],
      },
      batches: [[makeCandidateRow()]],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs.length).toBe(1);
    expect(result.filters.locations).toEqual([]);
  });

  test("location filter rejects all jobs -- produces clean empty response", async () => {
    resolveAllTiersMock.mockReturnValue([{ rank: 1 }]);
    matchJobToTiersMock.mockReturnValue({ passes: false, matchedTier: null });

    setupStandardFlow({
      profile: {
        locationPreferences: {
          tiers: [
            {
              rank: 1,
              workFormats: ["onsite"],
              scope: { type: "countries", include: ["JP"] },
            },
          ],
        },
      },
      batches: [[makeCandidateRow()]],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Batched Processing and Pagination
// ---------------------------------------------------------------------------

describe("searchJobs -- batched processing and pagination", () => {
  test("first page of results with exact limit", async () => {
    const jobs = Array.from({ length: 5 }, (_, i) =>
      makeCandidateRow({ id: `job-${i}`, title: `QA Engineer ${i}` }),
    );

    setupStandardFlow({
      batches: [jobs],
    });

    const result = await searchJobs(db as unknown as Database, "profile-1", {
      limit: 3,
      offset: 0,
    });

    expect(result.jobs.length).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(4);
  });

  test("second page via offset", async () => {
    const jobs = Array.from({ length: 5 }, (_, i) =>
      makeCandidateRow({ id: `job-${i}`, title: `QA Engineer ${i}` }),
    );

    setupStandardFlow({
      batches: [jobs],
    });

    const result = await searchJobs(db as unknown as Database, "profile-1", {
      limit: 2,
      offset: 2,
    });

    expect(result.jobs.length).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(5);
  });

  test("last page -- hasMore is false", async () => {
    const jobs = Array.from({ length: 3 }, (_, i) =>
      makeCandidateRow({ id: `job-${i}` }),
    );

    setupStandardFlow({
      batches: [jobs],
    });

    const result = await searchJobs(db as unknown as Database, "profile-1", {
      limit: 50,
      offset: 0,
    });

    expect(result.jobs.length).toBe(3);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  test("empty results -- no jobs pass any filter", async () => {
    setupStandardFlow({
      batches: [[makeCandidateRow()]],
    });

    // Resolve step passes, batch classification fails
    classifyJobMultiMock
      .mockReturnValueOnce({
        score: 1.0,
        familySlug: "qa_testing",
        matchType: "strong",
        matchedPattern: "qa engineer",
      })
      .mockReturnValue({
        score: 0.3,
        familySlug: "qa_testing",
        matchType: "none",
        matchedPattern: null,
      });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  test("offset beyond total results returns empty page", async () => {
    const jobs = Array.from({ length: 3 }, (_, i) =>
      makeCandidateRow({ id: `job-${i}` }),
    );

    setupStandardFlow({
      batches: [jobs],
    });

    const result = await searchJobs(db as unknown as Database, "profile-1", {
      limit: 50,
      offset: 100,
    });

    expect(result.jobs).toEqual([]);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  test("early termination when enough results accumulated", async () => {
    const jobs = Array.from({ length: 100 }, (_, i) =>
      makeCandidateRow({ id: `job-${i}` }),
    );

    setupStandardFlow({
      batches: [jobs],
    });

    const result = await searchJobs(db as unknown as Database, "profile-1", {
      limit: 2,
      offset: 0,
    });

    expect(result.jobs.length).toBe(2);
    expect(result.hasMore).toBe(true);
    // total is allPassing.length at early termination = needed + 1 = 3
    // Comment: total is an approximation when hasMore is true -- it counts
    // passing jobs seen before early termination, not the full corpus.
    expect(result.total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// buildResponse and emptyResponse (tested indirectly)
// ---------------------------------------------------------------------------

describe("searchJobs -- response building", () => {
  test("emptyResponse returns correct structure with defaults", async () => {
    setupStandardFlow({ profile: null });

    const result = await searchJobs(db as unknown as Database, "profile-1", {
      limit: 25,
      offset: 50,
    });

    expect(result).toEqual({
      jobs: [],
      total: 0,
      hasMore: false,
      limit: 25,
      offset: 50,
      filters: {
        roleFamilies: [],
        seniority: null,
        remotePreference: "any",
        locations: [],
        industries: [],
      },
    });
  });

  test("buildResponse propagates non-empty seniority", async () => {
    setupStandardFlow({
      profile: { targetSeniority: ["senior"] },
      batches: [[makeCandidateRow()]],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.filters.seniority).toEqual(["senior"]);
  });

  test("buildResponse -- empty targetSeniority produces null", async () => {
    setupStandardFlow({
      profile: { targetSeniority: [] },
      batches: [[makeCandidateRow()]],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.filters.seniority).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Filter Interaction Scenarios
// ---------------------------------------------------------------------------

describe("searchJobs -- filter interactions", () => {
  test("job passes classification but fails seniority filter", async () => {
    setupStandardFlow({
      profile: { targetSeniority: ["senior"] },
      batches: [[makeCandidateRow({ title: "Junior QA Engineer" })]],
    });

    classifyJobMultiMock.mockReturnValue({
      score: 1.0,
      familySlug: "qa_testing",
      matchType: "strong",
      matchedPattern: "qa engineer",
    });
    extractSeniorityMock.mockReturnValue("junior");

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs).toEqual([]);
  });

  test("job passes classification and seniority but fails location", async () => {
    resolveAllTiersMock.mockReturnValue([
      { rank: 1, countries: new Set(["DE"]) },
    ]);
    matchJobToTiersMock.mockReturnValue({ passes: false, matchedTier: null });

    setupStandardFlow({
      profile: {
        targetSeniority: ["senior"],
        locationPreferences: {
          tiers: [
            {
              rank: 1,
              workFormats: ["hybrid"],
              scope: { type: "countries", include: ["DE"] },
            },
          ],
        },
      },
      batches: [
        [
          makeCandidateRow({
            title: "Senior QA Engineer",
            locationRaw: "San Francisco, CA, United States",
          }),
        ],
      ],
    });

    extractSeniorityMock.mockReturnValue("senior");

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs).toEqual([]);
  });

  test("job passes all in-memory filters including location", async () => {
    resolveAllTiersMock.mockReturnValue([
      { rank: 1, countries: new Set(["US"]) },
    ]);
    matchJobToTiersMock.mockReturnValue({ passes: true, matchedTier: 1 });

    setupStandardFlow({
      profile: {
        targetSeniority: ["senior"],
        locationPreferences: {
          tiers: [
            {
              rank: 1,
              workFormats: ["remote"],
              scope: { type: "countries", include: ["US"] },
            },
          ],
        },
        preferredLocations: ["United States"],
      },
      batches: [
        [
          makeCandidateRow({
            title: "Senior QA Engineer",
            locationRaw: "San Francisco, CA, United States",
          }),
        ],
      ],
    });

    extractSeniorityMock.mockReturnValue("senior");

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs.length).toBe(1);
    expect(result.jobs[0].title).toBe("Senior QA Engineer");
    expect(result.jobs[0].classificationScore).toBe(1.0);
    expect(result.jobs[0].detectedSeniority).toBe("senior");
    expect(result.jobs[0].matchedLocationTier).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Pagination Corner Cases
// ---------------------------------------------------------------------------

describe("searchJobs -- pagination corner cases", () => {
  test("offset=0, limit=1 -- single result page", async () => {
    const jobs = Array.from({ length: 3 }, (_, i) =>
      makeCandidateRow({ id: `job-${i}` }),
    );

    setupStandardFlow({ batches: [jobs] });

    const result = await searchJobs(db as unknown as Database, "profile-1", {
      limit: 1,
      offset: 0,
    });

    expect(result.jobs.length).toBe(1);
    expect(result.hasMore).toBe(true);
  });

  test("last single item at offset = total - 1", async () => {
    const jobs = Array.from({ length: 5 }, (_, i) =>
      makeCandidateRow({ id: `job-${i}` }),
    );

    setupStandardFlow({ batches: [jobs] });

    const result = await searchJobs(db as unknown as Database, "profile-1", {
      limit: 1,
      offset: 4,
    });

    expect(result.jobs.length).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  test("offset equals total count returns empty page", async () => {
    const jobs = Array.from({ length: 5 }, (_, i) =>
      makeCandidateRow({ id: `job-${i}` }),
    );

    setupStandardFlow({ batches: [jobs] });

    const result = await searchJobs(db as unknown as Database, "profile-1", {
      limit: 50,
      offset: 5,
    });

    expect(result.jobs).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.total).toBe(5);
  });

  test("exactly needed+1 passing jobs triggers early termination with hasMore=true", async () => {
    const jobs = Array.from({ length: 4 }, (_, i) =>
      makeCandidateRow({ id: `job-${i}` }),
    );

    setupStandardFlow({ batches: [jobs] });

    const result = await searchJobs(db as unknown as Database, "profile-1", {
      limit: 3,
      offset: 0,
    });

    expect(result.hasMore).toBe(true);
    expect(result.jobs.length).toBe(3);
    expect(result.total).toBe(4);
  });

  test("exactly needed passing jobs -- hasMore is false", async () => {
    const jobs = Array.from({ length: 3 }, (_, i) =>
      makeCandidateRow({ id: `job-${i}` }),
    );

    setupStandardFlow({ batches: [jobs] });

    const result = await searchJobs(db as unknown as Database, "profile-1", {
      limit: 3,
      offset: 0,
    });

    expect(result.hasMore).toBe(false);
    expect(result.jobs.length).toBe(3);
    expect(result.total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Total Count Semantics
// ---------------------------------------------------------------------------

describe("searchJobs -- total count semantics", () => {
  test("total reflects only processed results during early termination", async () => {
    const jobs = Array.from({ length: 4 }, (_, i) =>
      makeCandidateRow({ id: `job-${i}` }),
    );

    setupStandardFlow({ batches: [jobs] });

    const result = await searchJobs(db as unknown as Database, "profile-1", {
      limit: 2,
      offset: 0,
    });

    // total = 3 (allPassing.length at early termination = needed + 1)
    // Not 4 (the actual passing count in the batch).
    // This is a known trade-off: total is an approximation when hasMore: true.
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.jobs.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Data Shape Edge Cases
// ---------------------------------------------------------------------------

describe("searchJobs -- data shape edge cases", () => {
  test("job with all nullable fields as null", async () => {
    setupStandardFlow({
      profile: {
        remotePreference: "any",
        preferredLocations: [],
      },
      batches: [
        [
          makeCandidateRow({
            applyUrl: null,
            locationRaw: null,
            departmentRaw: null,
            workplaceType: null,
            salaryRaw: null,
            companyIndustry: null,
          }),
        ],
      ],
    });

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs.length).toBe(1);
    const job = result.jobs[0];
    expect(job.applyUrl).toBeNull();
    expect(job.locationRaw).toBeNull();
    expect(job.departmentRaw).toBeNull();
    expect(job.workplaceType).toBeNull();
    expect(job.salaryRaw).toBeNull();
    expect(job.companyIndustry).toBeNull();
    expect(job.matchedLocationTier).toBeNull();
  });

  test("profile with single-element arrays", async () => {
    setupStandardFlow({
      profile: {
        targetTitles: ["QA"],
        targetSeniority: ["mid"],
        preferredLocations: ["Berlin"],
        remotePreference: "hybrid_ok",
      },
      companyPrefs: { industries: ["SaaS"] },
      batches: [
        [
          makeCandidateRow({
            locationRaw: "Berlin, Germany",
          }),
        ],
      ],
    });

    extractSeniorityMock.mockReturnValue("mid");

    const result = await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    expect(result.jobs.length).toBe(1);
    expect(result.filters.seniority).toEqual(["mid"]);
    expect(result.filters.locations).toEqual(["Berlin"]);
    expect(result.filters.industries).toEqual(["SaaS"]);
  });
});

// ---------------------------------------------------------------------------
// Database Failure Scenarios
// ---------------------------------------------------------------------------

describe("searchJobs -- database failures", () => {
  test("DB error during profile load propagates", async () => {
    setupStandardFlow({
      batches: [],
    });
    // Override the batch to reject
    batchResults.push([] as never);
    // We need to make the 4th select() call's chain reject.
    // The simplest way: remove the batch result and add a rejecting one.
    batchResults.length = 0;

    // We need a fresh setup where the batch query rejects.
    // Since our mock creates new chains on each select() call, we'll use
    // a different approach: make the db.select mock throw for call 4+.
    selectCallCount.value = 0;
    queryResults.length = 0;
    batchResults.length = 0;

    queryResults.push([makeProfile()]);
    queryResults.push([makeCompanyPrefs()]);
    queryResults.push([makeRoleFamily()]);

    // The 4th call creates a fresh chain. The offset mock at the end
    // of the chain will try to shift from batchResults. With nothing there
    // it returns []. That's not an error -- it just means no jobs found.
    // To actually test a DB error, we need to override the select mock
    // for the 4th call. Since vi.mock factories run once, we need a
    // different strategy.

    // The batch fetch just returns [] when batchResults is empty.
    // A DB error test requires the batch chain to reject, which we
    // cannot easily do with the current mock architecture.
    // Instead, verify that searchJobs propagates errors from the simple queries.

    // For simplicity, test that the pipeline handles the error by testing
    // at the route handler level (where the catch block lives).
    // This test verifies the pipeline doesn't silently swallow the error.
    // We'll test it by making profile query reject.
    selectCallCount.value = 0;
    queryResults.length = 0;

    // Override select to reject on first call
    const originalSelect = (db as unknown as { select: ReturnType<typeof vi.fn> }).select;
    const selectMock = vi.mocked(originalSelect);
    selectMock.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.reject(new Error("connection refused"))),
        })),
        then: (
          _resolve: (v: unknown) => void,
          reject: (e: unknown) => void,
        ) => Promise.reject(new Error("connection refused")).catch(reject),
      })),
    }));

    await expect(
      searchJobs(db as unknown as Database, "profile-1", defaultPagination),
    ).rejects.toThrow("connection refused");
  });
});

// ---------------------------------------------------------------------------
// extractSeniority called once per passing job (result reused)
// ---------------------------------------------------------------------------

describe("searchJobs -- seniority extraction calls", () => {
  test("extractSeniority is called once per passing job (result reused for filter and metadata)", async () => {
    setupStandardFlow({
      profile: { targetSeniority: ["senior"] },
      batches: [[makeCandidateRow()]],
    });

    extractSeniorityMock.mockReturnValue(null);

    await searchJobs(
      db as unknown as Database,
      "profile-1",
      defaultPagination,
    );

    // Single call: result is reused for both the seniority filter and result metadata
    expect(extractSeniorityMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// normalizeIndustryTerms
// ---------------------------------------------------------------------------

describe("normalizeIndustryTerms", () => {
  test("splits compound labels on '/' and lowercases", async () => {
    const result = await normalizeIndustryTerms(["Web3/Blockchain/Crypto"]);
    expect(result).toEqual(
      expect.arrayContaining(["web3", "blockchain", "crypto"]),
    );
    expect(result).toHaveLength(3);
  });

  test("lowercases simple terms", async () => {
    expect(await normalizeIndustryTerms(["Fintech"])).toEqual(["fintech"]);
  });

  test("deduplicates across multiple inputs", async () => {
    const result = await normalizeIndustryTerms([
      "Web3/Crypto",
      "Crypto/DeFi",
    ]);
    expect(result.filter((t) => t === "crypto")).toHaveLength(1);
    expect(result).toEqual(
      expect.arrayContaining(["web3", "crypto", "defi"]),
    );
  });

  test("trims whitespace around parts", async () => {
    const result = await normalizeIndustryTerms(["AI / ML / Data"]);
    expect(result).toEqual(expect.arrayContaining(["ai", "ml", "data"]));
  });

  test("skips empty segments", async () => {
    const result = await normalizeIndustryTerms(["/Fintech/", ""]);
    expect(result).toEqual(["fintech"]);
  });

  test("returns empty array for empty input", async () => {
    expect(await normalizeIndustryTerms([])).toEqual([]);
  });
});
