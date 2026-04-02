import type { Job } from "pg-boss";
import { createLlmScoringHandler } from "./llm-scoring";

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
  jobs: { id: Symbol("jobs.id"), companyId: Symbol("jobs.companyId"), descriptionHash: Symbol("jobs.descriptionHash") },
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
    locationRaw: "NYC",
    workplaceType: "hybrid",
    salaryRaw: "$150k",
    url: "https://example.com/job/1",
    atsJobId: "posting-1",
    sourceRef: "greenhouse",
    companyId: "company-1",
    companyName: "Acme Corp",
    companyIndustry: ["Tech"],
    companyAtsSlug: "acme",
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
    ...overrides,
  };
}

/**
 * Build a mock DB that supports:
 * - Multiple select invocations returning different results
 * - innerJoin chain (for job+company query)
 * - insert chain with onConflictDoUpdate
 *
 * selectResults: array of results, consumed in order.
 * Each invocation of limit() returns the next result.
 */
function createMockDb(
  selectResults: unknown[][],
  insertCalls: { values: unknown; onConflict: unknown }[] = [],
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
    },
    insertCalls,
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  test("LLM call throws -- error propagates for pg-boss retry", async () => {
    const jobRow = makeJobRow();
    const profile = makeProfile();
    const { db } = createMockDb([[jobRow], [profile]]);
    setupDefaultMocks();
    mockGenerateText.mockRejectedValue(new Error("rate limit exceeded"));

    const handler = createLlmScoringHandler(db);
    await expect(
      handler([
        makeBatchJob({ jobId: "job-1", userProfileId: "profile-1", userId: "user-1" }),
      ]),
    ).rejects.toThrow("rate limit exceeded");
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
});
