import type { Job } from "pg-boss";
import { createLlmScoringHandler, mergeEnum } from "./llm-scoring";

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock("../lib/decrypt-user-key", () => ({
  decryptUserKey: vi.fn(),
}));

vi.mock("../lib/app-config", () => ({
  getAppConfigValue: vi.fn(),
}));

vi.mock("../lib/scoring-prompt", () => ({
  buildScoringPrompt: vi.fn(),
}));

vi.mock("../lib/compute-match-percent", () => ({
  computeMatchPercent: vi.fn(),
}));

vi.mock("../lib/fetch-description", () => ({
  fetchJobDescription: vi.fn(),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn(() => "mock-model")),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
  Output: { object: vi.fn(() => "mock-output-schema") },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _eq: val })),
}));

vi.mock("@gjs/db/schema", () => ({
  jobs: {
    id: Symbol("jobs.id"),
    companyId: Symbol("jobs.companyId"),
    descriptionHash: Symbol("jobs.descriptionHash"),
    visaSponsorship: Symbol("jobs.visaSponsorship"),
    relocationPackage: Symbol("jobs.relocationPackage"),
    workAuthRestriction: Symbol("jobs.workAuthRestriction"),
    languageRequirements: Symbol("jobs.languageRequirements"),
    travelPercent: Symbol("jobs.travelPercent"),
    securityClearance: Symbol("jobs.securityClearance"),
    shiftPattern: Symbol("jobs.shiftPattern"),
    signalsExtractedAt: Symbol("jobs.signalsExtractedAt"),
    signalsExtractedFromHash: Symbol("jobs.signalsExtractedFromHash"),
    updatedAt: Symbol("jobs.updatedAt"),
  },
  companies: { id: Symbol("companies.id") },
  userProfiles: { id: Symbol("userProfiles.id") },
  jobMatches: { userProfileId: Symbol("jobMatches.userProfileId"), jobId: Symbol("jobMatches.jobId") },
}));

vi.mock("../lib/scoring-schema", () => ({
  ScoringOutputSchema: { parse: vi.fn((v: unknown) => v) },
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────

import { decryptUserKey } from "../lib/decrypt-user-key";
import { getAppConfigValue } from "../lib/app-config";
import { buildScoringPrompt } from "../lib/scoring-prompt";
import { computeMatchPercent } from "../lib/compute-match-percent";
import { fetchJobDescription } from "../lib/fetch-description";
import { generateText } from "ai";

// ─── Helpers ───────────────────────────────────────────────────────────────

const FIXED_NOW = new Date("2025-06-15T12:00:00Z");

const mockDecryptUserKey = decryptUserKey as ReturnType<typeof vi.fn>;
const mockGetAppConfigValue = getAppConfigValue as ReturnType<typeof vi.fn>;
const mockBuildScoringPrompt = buildScoringPrompt as ReturnType<typeof vi.fn>;
const mockComputeMatchPercent = computeMatchPercent as ReturnType<typeof vi.fn>;
const mockFetchJobDescription = fetchJobDescription as ReturnType<typeof vi.fn>;
const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

interface ScoringJobData {
  jobId: string;
  userProfileId: string;
  userId: string;
}

function makeBatchJob(
  data: ScoringJobData,
  id?: string,
): Job<ScoringJobData> {
  return {
    id: id ?? `boss-${data.jobId}`,
    name: "scoring/llm",
    data,
  } as Job<ScoringJobData>;
}

function makeJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    title: "Senior Engineer",
    descriptionText: "Build products with TypeScript.",
    descriptionHash: "hash-original",
    location: "NYC",
    workplaceType: "hybrid",
    salary: "$150k",
    url: "https://example.com/job/1",
    atsJobId: "posting-1",
    sourceRef: "greenhouse",
    companyId: "company-1",
    companyName: "Acme Corp",
    companyIndustry: ["Tech"],
    companyAtsSlug: "acme",
    // Signal columns surfaced for the L3 → L2 promotion write-back
    visaSponsorship: "unknown",
    relocationPackage: "unknown",
    workAuthRestriction: "unknown",
    languageRequirements: null,
    travelPercent: null,
    securityClearance: null,
    shiftPattern: null,
    ...overrides,
  };
}

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    userId: "user-1",
    targetTitles: ["Senior Engineer"],
    targetSeniority: ["senior"],
    coreSkills: ["TypeScript"],
    growthSkills: ["Rust"],
    avoidSkills: null,
    dealBreakers: null,
    preferredLocations: ["NYC"],
    remotePreference: "hybrid_ok",
    locationPreferences: null,
    minSalary: 140000,
    targetSalary: 180000,
    salaryCurrency: "USD",
    preferredIndustries: ["Tech"],
    weightRole: 0.25,
    weightSkills: 0.25,
    weightLocation: 0.2,
    weightCompensation: 0.15,
    weightDomain: 0.15,
    ...overrides,
  };
}

function makeExtractedSignals(overrides: Record<string, unknown> = {}) {
  return {
    visaSponsorship: "unknown",
    relocationPackage: "unknown",
    workAuthRestriction: "unknown",
    languageRequirements: [] as string[],
    travelPercent: null,
    securityClearance: null,
    shiftPattern: null,
    ...overrides,
  };
}

function makeScoringOutput(overrides: Record<string, unknown> = {}) {
  return {
    scoreR: 8,
    scoreS: 7,
    scoreL: 9,
    scoreC: 6,
    scoreD: 5,
    matchReason: "Good fit overall",
    evidenceQuotes: ["TypeScript mentioned"],
    hasGrowthSkillMatch: false,
    dealBreakerTriggered: false,
    extractedSignals: makeExtractedSignals(),
    ...overrides,
  };
}

/**
 * Build a mock DB that supports:
 * - Multiple select invocations returning different results
 * - innerJoin chain (for job+company query)
 * - insert chain with onConflictDoUpdate (job_match upsert)
 * - update chain with set/where (job signal write-back)
 *
 * selectResults: array of results, consumed in order.
 * Each invocation of limit() returns the next result.
 */
function createMockDb(
  selectResults: unknown[][],
  insertCalls: { values: unknown; onConflict: unknown }[] = [],
  updateCalls: { set: unknown }[] = [],
) {
  let selectIndex = 0;

  const mockOnConflictDoUpdate = vi.fn().mockImplementation((conflict: unknown) => {
    if (insertCalls.length > 0) {
      insertCalls[insertCalls.length - 1].onConflict = conflict;
    }
    return Promise.resolve(undefined);
  });

  const mockValues = vi.fn().mockImplementation((vals: unknown) => {
    insertCalls.push({ values: vals, onConflict: null });
    return { onConflictDoUpdate: mockOnConflictDoUpdate };
  });

  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

  // db.update(table).set(values).where(cond) → Promise<void>
  const mockUpdateWhere = vi
    .fn()
    .mockImplementation(() => Promise.resolve(undefined));
  const mockUpdateSet = vi.fn().mockImplementation((values: unknown) => {
    updateCalls.push({ set: values });
    return { where: mockUpdateWhere };
  });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  const mockLimit = vi.fn().mockImplementation(() => {
    const result = selectResults[selectIndex] ?? [];
    selectIndex++;
    return Promise.resolve(result);
  });

  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
  const mockFrom = vi.fn().mockImplementation(() => {
    // Return innerJoin chain for first call (job query), where chain for others
    return { innerJoin: mockInnerJoin, where: mockWhere };
  });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  return {
    db: {
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
    } as unknown as Parameters<typeof createLlmScoringHandler>[0],
    mocks: {
      mockSelect,
      mockFrom,
      mockInnerJoin,
      mockWhere,
      mockLimit,
      mockInsert,
      mockValues,
      mockOnConflictDoUpdate,
      mockUpdate,
      mockUpdateSet,
      mockUpdateWhere,
    },
    insertCalls,
    updateCalls,
  };
}

function setupDefaultMocks(scoringOutput = makeScoringOutput()) {
  mockDecryptUserKey.mockResolvedValue("sk-test");
  mockGetAppConfigValue.mockResolvedValue(7);
  mockBuildScoringPrompt.mockReturnValue({
    system: "system prompt",
    user: "user prompt",
  });
  mockGenerateText.mockResolvedValue({ output: scoringOutput });
  mockComputeMatchPercent.mockReturnValue({
    matchPercent: 85,
    appliedGrowthBonus: false,
  });
  mockFetchJobDescription.mockResolvedValue(null);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("createLlmScoringHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Critical ──────────────────────────────────────────────────────────

  test("happy path -- job found, description present, profile found, key valid, LLM returns scores", async () => {
    const jobRow = makeJobRow();
    const profile = makeProfile();
    const scoringOutput = makeScoringOutput();
    const insertCalls: { values: unknown; onConflict: unknown }[] = [];

    // select 1: job+company, select 2: profile
    const { db } = createMockDb([[jobRow], [profile]], insertCalls);
    setupDefaultMocks(scoringOutput);

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
    ]);

    // buildScoringPrompt called with job data (including description text)
    expect(mockBuildScoringPrompt).toHaveBeenCalledTimes(1);
    const promptArgs = mockBuildScoringPrompt.mock.calls[0] as [{ job: Record<string, unknown>; company: Record<string, unknown> }];
    expect(promptArgs[0].job).toEqual(
      expect.objectContaining({
        title: "Senior Engineer",
        descriptionText: "Build products with TypeScript.",
      }),
    );
    expect(promptArgs[0].company).toEqual(
      expect.objectContaining({ name: "Acme Corp" }),
    );

    // generateText called
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "system prompt",
        prompt: "user prompt",
      }),
    );

    // computeMatchPercent called with scores and profile weights
    expect(mockComputeMatchPercent).toHaveBeenCalledWith(
      { scoreR: 8, scoreS: 7, scoreL: 9, scoreC: 6, scoreD: 5 },
      {
        weightRole: 0.25,
        weightSkills: 0.25,
        weightLocation: 0.2,
        weightCompensation: 0.15,
        weightDomain: 0.15,
      },
      { hasGrowthSkillMatch: false, dealBreakerTriggered: false },
      7,
    );

    // DB upsert
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].values).toEqual(
      expect.objectContaining({
        matchPercent: 85,
        userStatus: "new",
        isStale: false,
        scoreR: 8,
        scoreS: 7,
        scoreL: 9,
        scoreC: 6,
        scoreD: 5,
      }),
    );
  });

  test("job not found -- skips without error", async () => {
    // select 1 returns empty (job not found)
    const { db } = createMockDb([[]]);
    setupDefaultMocks();

    const handler = createLlmScoringHandler(db);
    await expect(
      handler([
        makeBatchJob({ jobId: "missing-job", userProfileId: "p1", userId: "u1" }),
      ]),
    ).resolves.toBeUndefined();

    expect(mockFetchJobDescription).not.toHaveBeenCalled();
    expect(mockDecryptUserKey).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  test("profile not found -- skips without error", async () => {
    const jobRow = makeJobRow();
    // select 1: job found, select 2: profile not found
    const { db } = createMockDb([[jobRow], []]);
    setupDefaultMocks();

    const handler = createLlmScoringHandler(db);
    await expect(
      handler([
        makeBatchJob({ jobId: "job-1", userProfileId: "missing-profile", userId: "u1" }),
      ]),
    ).resolves.toBeUndefined();

    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  test("no active API key -- skips without error", async () => {
    const jobRow = makeJobRow();
    const profile = makeProfile();
    const { db } = createMockDb([[jobRow], [profile]]);
    setupDefaultMocks();
    mockDecryptUserKey.mockResolvedValue(null);

    const handler = createLlmScoringHandler(db);
    await expect(
      handler([
        makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "u1" }),
      ]),
    ).resolves.toBeUndefined();

    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  test("LLM call throws -- error is caught per-job, handler completes", async () => {
    const jobRow = makeJobRow();
    const profile = makeProfile();
    const { db } = createMockDb([[jobRow], [profile]]);
    setupDefaultMocks();
    mockGenerateText.mockRejectedValue(new Error("rate limit exceeded"));

    const handler = createLlmScoringHandler(db);
    // Handler catches per-job errors and continues — does not throw
    await expect(
      handler([
        makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
      ]),
    ).resolves.toBeUndefined();

    // Upsert should not have been called since LLM failed
    expect(db.insert).not.toHaveBeenCalled();
  });

  // ── Important ─────────────────────────────────────────────────────────

  test("description is null -- calls fetchJobDescription", async () => {
    const jobRow = makeJobRow({
      descriptionText: null,
      sourceRef: "smartrecruiters",
    });
    const profile = makeProfile();
    const { db } = createMockDb([[jobRow], [profile]]);
    setupDefaultMocks();
    mockFetchJobDescription.mockResolvedValue("Fetched description");

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
    ]);

    expect(mockFetchJobDescription).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        id: "job-1",
        descriptionText: null,
        sourceRef: "smartrecruiters",
      }),
      expect.objectContaining({ atsSlug: "acme" }),
    );
  });

  test("description fetched successfully -- updated text used in prompt", async () => {
    const jobRow = makeJobRow({ descriptionText: null });
    const profile = makeProfile();
    const { db } = createMockDb([[jobRow], [profile]]);
    setupDefaultMocks();
    mockFetchJobDescription.mockResolvedValue("Fetched description");

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
    ]);

    const promptArgs2 = mockBuildScoringPrompt.mock.calls[0] as [{ job: Record<string, unknown> }];
    expect(promptArgs2[0].job).toEqual(
      expect.objectContaining({ descriptionText: "Fetched description" }),
    );
  });

  test("description was fetched (differs from original) -- reloads descriptionHash from DB", async () => {
    const jobRow = makeJobRow({
      descriptionText: null,
      descriptionHash: "old-hash",
    });
    const profile = makeProfile();
    const insertCalls: { values: unknown; onConflict: unknown }[] = [];

    // select 1: job, select 2: profile, select 3: hash reload
    const { db } = createMockDb(
      [[jobRow], [profile], [{ descriptionHash: "new-hash" }]],
      insertCalls,
    );
    setupDefaultMocks();
    mockFetchJobDescription.mockResolvedValue("new text");

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
    ]);

    // The upsert should use the reloaded hash
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].values).toEqual(
      expect.objectContaining({ jobContentHash: "new-hash" }),
    );
  });

  test("description was NOT fetched (already present) -- uses original descriptionHash, no reload", async () => {
    const jobRow = makeJobRow({
      descriptionText: "existing",
      descriptionHash: "hash-1",
    });
    const profile = makeProfile();
    const insertCalls: { values: unknown; onConflict: unknown }[] = [];

    // select 1: job, select 2: profile (no third select needed)
    const { db } = createMockDb([[jobRow], [profile]], insertCalls);
    setupDefaultMocks();

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
    ]);

    // Only 2 select calls (job + profile), not 3
    expect(db.select).toHaveBeenCalledTimes(2);

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].values).toEqual(
      expect.objectContaining({ jobContentHash: "hash-1" }),
    );
  });

  test("batch of multiple jobs -- each processed sequentially", async () => {
    const jobs = [
      makeJobRow({ id: "j1" }),
      makeJobRow({ id: "j2" }),
      makeJobRow({ id: "j3" }),
    ];
    const profile = makeProfile();
    const insertCalls: { values: unknown; onConflict: unknown }[] = [];

    // 3 jobs: each needs job+profile select = 6 selects
    const { db } = createMockDb(
      [
        [jobs[0]], [profile],
        [jobs[1]], [profile],
        [jobs[2]], [profile],
      ],
      insertCalls,
    );
    setupDefaultMocks();

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "j1", userProfileId: "p1", userId: "u1" }),
      makeBatchJob({ jobId: "j2", userProfileId: "p1", userId: "u1" }),
      makeBatchJob({ jobId: "j3", userProfileId: "p1", userId: "u1" }),
    ]);

    expect(mockGenerateText).toHaveBeenCalledTimes(3);
    expect(insertCalls).toHaveLength(3);
  });

  test("batch with mixed outcomes -- first job skipped (no profile), second succeeds", async () => {
    const jobRow1 = makeJobRow({ id: "j1" });
    const jobRow2 = makeJobRow({ id: "j2" });
    const profile = makeProfile();
    const insertCalls: { values: unknown; onConflict: unknown }[] = [];

    // j1: job found, profile not found; j2: job found, profile found
    const { db } = createMockDb(
      [[jobRow1], [], [jobRow2], [profile]],
      insertCalls,
    );
    setupDefaultMocks();

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "j1", userProfileId: "missing-p", userId: "u1" }),
      makeBatchJob({ jobId: "j2", userProfileId: "p1", userId: "u1" }),
    ]);

    // Only second job was scored
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(insertCalls).toHaveLength(1);
  });

  test("upsert uses onConflictDoUpdate -- set clause does NOT include userStatus", async () => {
    const jobRow = makeJobRow();
    const profile = makeProfile();
    const insertCalls: { values: unknown; onConflict: unknown }[] = [];

    const { db } = createMockDb([[jobRow], [profile]], insertCalls);
    setupDefaultMocks();

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
    ]);

    expect(insertCalls).toHaveLength(1);

    // values clause includes userStatus: "new" for new rows
    const values = insertCalls[0].values as Record<string, unknown>;
    expect(values.userStatus).toBe("new");

    // onConflictDoUpdate set clause should NOT include userStatus
    // (preserves user's existing status like "saved" or "applied")
    const onConflict = insertCalls[0].onConflict as {
      set: Record<string, unknown>;
    };
    expect(onConflict.set).not.toHaveProperty("userStatus");

    // But should include updated scores and timestamps
    expect(onConflict.set).toHaveProperty("scoreR");
    expect(onConflict.set).toHaveProperty("matchPercent");
    expect(onConflict.set).toHaveProperty("isStale", false);
    expect(onConflict.set).toHaveProperty("scoredAt");
    expect(onConflict.set).toHaveProperty("updatedAt");
  });

  test("description is null for non-SmartRecruiters vendor -- fetchJobDescription called but returns null, prompt receives null", async () => {
    const jobRow = makeJobRow({
      descriptionText: null,
      sourceRef: "greenhouse",
    });
    const profile = makeProfile();
    const { db } = createMockDb([[jobRow], [profile]]);
    setupDefaultMocks();
    mockFetchJobDescription.mockResolvedValue(null);

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
    ]);

    // Handler still calls fetchJobDescription when description is null
    expect(mockFetchJobDescription).toHaveBeenCalled();

    // Prompt builder receives null description
    const promptArgs3 = mockBuildScoringPrompt.mock.calls[0] as [{ job: Record<string, unknown> }];
    expect(promptArgs3[0].job).toEqual(
      expect.objectContaining({ descriptionText: null }),
    );
  });

  // ── Nice-to-have ──────────────────────────────────────────────────────

  test("empty batch array -- resolves immediately", async () => {
    const { db } = createMockDb([]);
    setupDefaultMocks();

    const handler = createLlmScoringHandler(db);
    await expect(handler([])).resolves.toBeUndefined();

    expect(db.select).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  // ── Signal write-back ─────────────────────────────────────────────────

  test("happy path writes extracted signals back to job row with stamped provenance", async () => {
    const jobRow = makeJobRow({
      descriptionHash: "hash-abc",
    });
    const profile = makeProfile();
    const insertCalls: { values: unknown; onConflict: unknown }[] = [];
    const updateCalls: { set: unknown }[] = [];

    const scoringOutput = makeScoringOutput({
      extractedSignals: makeExtractedSignals({
        visaSponsorship: "yes",
        relocationPackage: "no",
        workAuthRestriction: "residents_only",
        languageRequirements: ["en", "de"],
        travelPercent: 25,
        securityClearance: "US Secret",
        shiftPattern: "rotating on-call",
      }),
    });

    const { db } = createMockDb([[jobRow], [profile]], insertCalls, updateCalls);
    setupDefaultMocks(scoringOutput);

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
    ]);

    // Score upsert still happens.
    expect(insertCalls).toHaveLength(1);

    // Signal write-back fires exactly once.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set).toEqual(
      expect.objectContaining({
        visaSponsorship: "yes",
        relocationPackage: "no",
        workAuthRestriction: "residents_only",
        languageRequirements: ["en", "de"],
        travelPercent: 25,
        securityClearance: "US Secret",
        shiftPattern: "rotating on-call",
        signalsExtractedFromHash: "hash-abc",
      }),
    );
    // signalsExtractedAt is stamped from the FIXED_NOW system clock.
    expect(updateCalls[0].set).toHaveProperty("signalsExtractedAt");
    expect((updateCalls[0].set as Record<string, unknown>).signalsExtractedAt).toBeInstanceOf(Date);
  });

  test("incoming unknown signals do NOT downgrade existing concrete answers", async () => {
    // jobRow already has concrete persisted answers from a prior LLM run.
    const jobRow = makeJobRow({
      visaSponsorship: "yes",
      relocationPackage: "no",
      workAuthRestriction: "citizens_only",
    });
    const profile = makeProfile();
    const updateCalls: { set: unknown }[] = [];

    // The new LLM output is "unknown" for all three enums (e.g. prompt drift,
    // model uncertainty, or a description rewrite that dropped the signals).
    const scoringOutput = makeScoringOutput({
      extractedSignals: makeExtractedSignals({
        visaSponsorship: "unknown",
        relocationPackage: "unknown",
        workAuthRestriction: "unknown",
      }),
    });

    const { db } = createMockDb([[jobRow], [profile]], [], updateCalls);
    setupDefaultMocks(scoringOutput);

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
    ]);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set).toEqual(
      expect.objectContaining({
        visaSponsorship: "yes",
        relocationPackage: "no",
        workAuthRestriction: "citizens_only",
      }),
    );
  });

  test("soft signals (null / empty) do NOT overwrite existing concrete values", async () => {
    const jobRow = makeJobRow({
      languageRequirements: ["en"],
      travelPercent: 20,
      securityClearance: "US Secret",
      shiftPattern: "overnight",
    });
    const profile = makeProfile();
    const updateCalls: { set: unknown }[] = [];

    // New extraction returned no info on any soft signal.
    const scoringOutput = makeScoringOutput({
      extractedSignals: makeExtractedSignals({
        languageRequirements: [],
        travelPercent: null,
        securityClearance: null,
        shiftPattern: null,
      }),
    });

    const { db } = createMockDb([[jobRow], [profile]], [], updateCalls);
    setupDefaultMocks(scoringOutput);

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
    ]);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set).toEqual(
      expect.objectContaining({
        languageRequirements: ["en"],
        travelPercent: 20,
        securityClearance: "US Secret",
        shiftPattern: "overnight",
      }),
    );
  });

  test("incoming concrete signals DO overwrite existing concrete answers", async () => {
    // The user has updated the job description and the new extraction is
    // more accurate; the old "yes" should yield to the new "no".
    const jobRow = makeJobRow({
      visaSponsorship: "yes",
      languageRequirements: ["en"],
    });
    const profile = makeProfile();
    const updateCalls: { set: unknown }[] = [];

    const scoringOutput = makeScoringOutput({
      extractedSignals: makeExtractedSignals({
        visaSponsorship: "no",
        languageRequirements: ["fr"],
      }),
    });

    const { db } = createMockDb([[jobRow], [profile]], [], updateCalls);
    setupDefaultMocks(scoringOutput);

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
    ]);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set).toEqual(
      expect.objectContaining({
        visaSponsorship: "no",
        languageRequirements: ["fr"],
      }),
    );
  });

  test("travelPercent over 100 is clamped before persistence", async () => {
    // Anthropic structured output rejects min/max constraints; the schema
    // accepts any number and the handler clamps to 0-100 before write.
    const jobRow = makeJobRow();
    const profile = makeProfile();
    const updateCalls: { set: unknown }[] = [];

    const scoringOutput = makeScoringOutput({
      extractedSignals: makeExtractedSignals({ travelPercent: 150 }),
    });

    const { db } = createMockDb([[jobRow], [profile]], [], updateCalls);
    setupDefaultMocks(scoringOutput);

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
    ]);

    expect(updateCalls).toHaveLength(1);
    expect((updateCalls[0].set as Record<string, unknown>).travelPercent).toBe(100);
  });

  test("signalsExtractedFromHash uses the reloaded hash when description was fetched", async () => {
    const jobRow = makeJobRow({
      descriptionText: null,
      descriptionHash: "old-hash",
    });
    const profile = makeProfile();
    const insertCalls: { values: unknown; onConflict: unknown }[] = [];
    const updateCalls: { set: unknown }[] = [];

    // select 1: job, select 2: profile, select 3: hash reload after fetch
    const { db } = createMockDb(
      [[jobRow], [profile], [{ descriptionHash: "new-hash" }]],
      insertCalls,
      updateCalls,
    );
    setupDefaultMocks();
    mockFetchJobDescription.mockResolvedValue("new text");

    const handler = createLlmScoringHandler(db);
    await handler([
      makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
    ]);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set).toEqual(
      expect.objectContaining({ signalsExtractedFromHash: "new-hash" }),
    );
  });

  test("signal write failure does NOT lose the score upsert", async () => {
    const jobRow = makeJobRow();
    const profile = makeProfile();
    const insertCalls: { values: unknown; onConflict: unknown }[] = [];
    const updateCalls: { set: unknown }[] = [];

    const { db, mocks } = createMockDb(
      [[jobRow], [profile]],
      insertCalls,
      updateCalls,
    );
    setupDefaultMocks();

    // Force the signal write to fail.
    mocks.mockUpdateWhere.mockRejectedValueOnce(new Error("update boom"));

    const handler = createLlmScoringHandler(db);
    await expect(
      handler([
        makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
      ]),
    ).resolves.toBeUndefined();

    // Score was still persisted.
    expect(insertCalls).toHaveLength(1);
    // The update was attempted (and threw inside the nested try/catch).
    expect(updateCalls).toHaveLength(1);
  });
});

// ── mergeEnum unit tests ──────────────────────────────────────────────────

describe("mergeEnum", () => {
  test("incoming concrete answer wins over existing concrete answer", () => {
    expect(mergeEnum("yes", "no", "unknown")).toBe("no");
    expect(mergeEnum("no", "yes", "unknown")).toBe("yes");
  });

  test("incoming concrete answer wins over existing unknown", () => {
    expect(mergeEnum("unknown", "yes", "unknown")).toBe("yes");
    expect(mergeEnum("unknown", "no", "unknown")).toBe("no");
  });

  test("incoming unknown does NOT downgrade an existing concrete answer", () => {
    expect(mergeEnum("yes", "unknown", "unknown")).toBe("yes");
    expect(mergeEnum("no", "unknown", "unknown")).toBe("no");
  });

  test("both unknown returns unknown", () => {
    expect(mergeEnum("unknown", "unknown", "unknown")).toBe("unknown");
  });

  test("null existing (pre-migration row) treated as unknown -- incoming concrete wins", () => {
    // The DB columns are NOT NULL with DEFAULT 'unknown', so null should
    // never appear in practice. However, if a pre-migration row somehow
    // had null, mergeEnum receives it as a non-matching unknownValue and
    // the incoming concrete value should win. This tests the runtime
    // behavior as defense-in-depth.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(mergeEnum(null as any, "yes", "unknown")).toBe("yes");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(mergeEnum(null as any, "no", "unknown")).toBe("no");
  });

  test("null existing with unknown incoming returns null (not ideal but documents behavior)", () => {
    // When existing is null and incoming is "unknown", the function returns
    // existing (null) because incoming === unknownValue. This is technically
    // a bug if null leaks from the DB, but the schema prevents it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(mergeEnum(null as any, "unknown", "unknown")).toBe(null);
  });

  test("works with the workAuthRestriction five-value enum", () => {
    // Concrete -> concrete: incoming wins.
    expect(
      mergeEnum<"none" | "citizens_only" | "residents_only" | "region_only" | "unknown">(
        "none",
        "residents_only",
        "unknown",
      ),
    ).toBe("residents_only");

    // Concrete -> unknown: existing preserved.
    expect(
      mergeEnum<"none" | "citizens_only" | "residents_only" | "region_only" | "unknown">(
        "region_only",
        "unknown",
        "unknown",
      ),
    ).toBe("region_only");
  });
});
