import type { Job } from "pg-boss";
import { createInternetExpansionHandler } from "./internet-expansion";

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock("../lib/decrypt-user-key", () => ({
  decryptUserKey: vi.fn(),
}));

vi.mock("../lib/app-config", () => ({
  getAppConfigValue: vi.fn(),
}));

vi.mock("../lib/normalize-domain", () => ({
  normalizeDomain: vi.fn(),
}));

vi.mock("../lib/discover-companies", () => ({
  discoverCompanies: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _eq: val })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  inArray: vi.fn((_col: unknown, vals: unknown) => ({ _inArray: vals })),
}));

vi.mock("@gjs/db/schema", () => ({
  companies: {
    name: Symbol("companies.name"),
    website: Symbol("companies.website"),
    atsVendor: Symbol("companies.atsVendor"),
    atsSlug: Symbol("companies.atsSlug"),
    isActive: Symbol("companies.isActive"),
  },
  jobs: {
    id: Symbol("jobs.id"),
    companyId: Symbol("jobs.companyId"),
    descriptionHash: Symbol("jobs.descriptionHash"),
  },
  jobMatches: {
    jobId: Symbol("jobMatches.jobId"),
    jobContentHash: Symbol("jobMatches.jobContentHash"),
    userProfileId: Symbol("jobMatches.userProfileId"),
  },
  userCompanyPreferences: {
    userId: Symbol("userCompanyPreferences.userId"),
  },
}));

vi.mock("@gjs/ingestion", () => ({
  pollCompany: vi.fn(),
  FUTURE_QUEUES: {
    llmScoring: "score/llm",
    internetExpansion: "expand/internet",
    descriptionFetch: "fetch/description",
    roleTaxonomy: "expand/role-taxonomy",
  },
}));

vi.mock("@gjs/ats-core/discovery", () => ({
  detectAtsVendor: vi.fn(),
  parseGreenhouseBoardToken: vi.fn(),
  parseLeverSite: vi.fn(),
  parseAshbyBoard: vi.fn(),
  parseSmartRecruitersCompanyFromCareersUrl: vi.fn(),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────

import { decryptUserKey } from "../lib/decrypt-user-key";
import { getAppConfigValue } from "../lib/app-config";
import { normalizeDomain } from "../lib/normalize-domain";
import { discoverCompanies } from "../lib/discover-companies";
import { pollCompany, FUTURE_QUEUES } from "@gjs/ingestion";
import {
  detectAtsVendor,
  parseGreenhouseBoardToken,
  parseLeverSite,
  parseAshbyBoard,
  parseSmartRecruitersCompanyFromCareersUrl,
} from "@gjs/ats-core/discovery";

// ─── Typed mocks ───────────────────────────────────────────────────────────

const mockDecryptUserKey = decryptUserKey as ReturnType<typeof vi.fn>;
const mockGetAppConfigValue = getAppConfigValue as ReturnType<typeof vi.fn>;
const mockNormalizeDomain = normalizeDomain as ReturnType<typeof vi.fn>;
const mockDiscoverCompanies = discoverCompanies as ReturnType<typeof vi.fn>;
const mockPollCompany = pollCompany as ReturnType<typeof vi.fn>;
const mockDetectAtsVendor = detectAtsVendor as ReturnType<typeof vi.fn>;
const mockParseGreenhouseBoardToken =
  parseGreenhouseBoardToken as ReturnType<typeof vi.fn>;
const mockParseLeverSite = parseLeverSite as ReturnType<typeof vi.fn>;
const mockParseAshbyBoard = parseAshbyBoard as ReturnType<typeof vi.fn>;
const mockParseSmartRecruitersCompany =
  parseSmartRecruitersCompanyFromCareersUrl as ReturnType<typeof vi.fn>;

// ─── Types ─────────────────────────────────────────────────────────────────

interface ExpansionJobData {
  userId: string;
  userProfileId: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeBatchJob(
  data: ExpansionJobData,
  id?: string,
): Job<ExpansionJobData> {
  return {
    id: id ?? `boss-${data.userId}`,
    name: "expand/internet",
    data,
  } as Job<ExpansionJobData>;
}

function makePrefsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pref-1",
    userId: "user-1",
    industries: ["saas"],
    companySizes: ["50-200"],
    companyStages: ["series_b"],
    productTypes: ["b2b"],
    exclusions: [],
    hqGeographies: ["US"],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDiscoveredCompany(overrides: Record<string, unknown> = {}) {
  return {
    name: "NewCo",
    website: "https://newco.com",
    careersUrl: "https://boards.greenhouse.io/newco",
    industry: ["saas"],
    reasoning: "good match",
    ...overrides,
  };
}

function makeCompanyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "company-1",
    slug: "greenhouse-newco",
    name: "NewCo",
    website: "https://newco.com",
    industry: ["saas"],
    atsVendor: "greenhouse",
    atsSlug: "newco",
    source: "auto_discovered",
    isActive: true,
    ...overrides,
  };
}

/**
 * Build a mock DB that supports the handler's query patterns:
 *
 * 1. select().from(userCompanyPreferences).where().limit() -> preferences
 * 2. select({...}).from(companies).where()                 -> existing companies
 * 3. insert(companies).values().onConflictDoNothing().returning() -> inserted row
 * 4. select({id,descriptionHash}).from(jobs).where()       -> jobs from new companies
 * 5. select({jobId,jobContentHash}).from(jobMatches).where() -> existing scores
 *
 * selectResults: consumed in order. Each terminal call returns the next result.
 * insertResults: consumed in order for .returning() calls.
 */
function createMockDb(
  selectResults: unknown[][],
  insertResults: unknown[][] = [],
) {
  let selectIndex = 0;
  let insertIndex = 0;
  const insertCalls: { values: unknown }[] = [];

  const mockReturning = vi.fn().mockImplementation(() => {
    const result = insertResults[insertIndex] ?? [];
    insertIndex++;
    return Promise.resolve(result);
  });

  const mockOnConflictDoNothing = vi.fn().mockReturnValue({
    returning: mockReturning,
  });

  const mockInsertValues = vi.fn().mockImplementation((vals: unknown) => {
    insertCalls.push({ values: vals });
    return { onConflictDoNothing: mockOnConflictDoNothing };
  });

  const mockInsert = vi.fn().mockReturnValue({
    values: mockInsertValues,
  });

  // Terminal calls: .limit() or direct await on .where()
  const mockLimit = vi.fn().mockImplementation(() => {
    const result = selectResults[selectIndex] ?? [];
    selectIndex++;
    return Promise.resolve(result);
  });

  // For the existing companies query, .where() is the terminal call (no .limit())
  // For preferences query, the chain is .where().limit()
  const mockWhere = vi.fn().mockImplementation(() => {
    // Return object that supports both .limit() chaining AND direct await
    // Direct await (then-able) for the companies query
    const result = selectResults[selectIndex] ?? [];
    const wrapper = {
      limit: mockLimit,
      // Make it thenable for direct await
      then: (resolve: (val: unknown) => void) => {
        selectIndex++;
        resolve(result);
      },
    };
    return wrapper;
  });

  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });

  const mockSelect = vi.fn().mockImplementation(() => ({
    from: mockFrom,
  }));

  return {
    db: {
      select: mockSelect,
      insert: mockInsert,
    } as unknown as Parameters<typeof createInternetExpansionHandler>[0],
    mocks: {
      mockSelect,
      mockFrom,
      mockWhere,
      mockLimit,
      mockInsert,
      mockInsertValues,
      mockOnConflictDoNothing,
      mockReturning,
    },
    insertCalls,
  };
}

function createMockBoss() {
  return {
    send: vi.fn().mockResolvedValue("job-id"),
  } as unknown as Parameters<typeof createInternetExpansionHandler>[1];
}

/**
 * Set up the most common mock chain for a fully successful flow.
 */
function setupHappyPath(opts: {
  existingCompanies?: unknown[];
  discovered?: unknown[];
  insertResults?: unknown[][];
} = {}) {
  mockDecryptUserKey.mockResolvedValue("sk-test-key");
  mockGetAppConfigValue.mockResolvedValue(20);
  mockNormalizeDomain.mockImplementation((url: string) => {
    try {
      const parsed = new URL(url);
      let hostname = parsed.hostname.toLowerCase();
      if (hostname.startsWith("www.")) hostname = hostname.slice(4);
      return hostname || null;
    } catch {
      return null;
    }
  });
  mockDiscoverCompanies.mockResolvedValue(
    opts.discovered ?? [makeDiscoveredCompany()],
  );
  mockDetectAtsVendor.mockReturnValue("greenhouse");
  mockParseGreenhouseBoardToken.mockReturnValue("newco");
  mockPollCompany.mockResolvedValue({ jobsFound: 5, jobsNew: 5 });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("createInternetExpansionHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Critical ──────────────────────────────────────────────────────────

  test("happy path -- single company discovered, inserted, polled, scoring enqueued", async () => {
    setupHappyPath();

    const companyRow = makeCompanyRow();
    const jobRows = [
      { id: "job-1", descriptionHash: "hash-1" },
      { id: "job-2", descriptionHash: "hash-2" },
    ];
    // select 1: preferences, select 2: existing companies (empty),
    // select 3: jobs from new companies, select 4: existing scores (empty)
    const { db, insertCalls } = createMockDb(
      [[makePrefsRow()], [], jobRows, []],
      [[companyRow]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // DB insert called with correct values
    expect(insertCalls).toHaveLength(1);
    const insertedValues = insertCalls[0].values as Record<string, unknown>;
    expect(insertedValues).toEqual(
      expect.objectContaining({
        source: "auto_discovered",
        slug: "greenhouse-newco",
        name: "NewCo",
        atsVendor: "greenhouse",
        atsSlug: "newco",
      }),
    );

    // pollCompany called with the inserted row
    expect(mockPollCompany).toHaveBeenCalledWith(db, companyRow);

    // boss.send called for individual scoring jobs (one per job)
    expect(boss.send).toHaveBeenCalledTimes(2);
    expect(boss.send).toHaveBeenCalledWith(
      FUTURE_QUEUES.llmScoring,
      { jobId: "job-1", userProfileId: "profile-1", userId: "user-1" },
      { singletonKey: "profile-1:job-1" },
    );
    expect(boss.send).toHaveBeenCalledWith(
      FUTURE_QUEUES.llmScoring,
      { jobId: "job-2", userProfileId: "profile-1", userId: "user-1" },
      { singletonKey: "profile-1:job-2" },
    );
  });

  test("no API key -- skips entire job without error", async () => {
    mockDecryptUserKey.mockResolvedValue(null);

    const { db } = createMockDb([]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await expect(
      handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]),
    ).resolves.toBeUndefined();

    // No DB queries for preferences or companies
    expect(db.select).not.toHaveBeenCalled();
    expect(mockDiscoverCompanies).not.toHaveBeenCalled();
  });

  test("no company preferences -- skips entire job without error", async () => {
    mockDecryptUserKey.mockResolvedValue("sk-test-key");

    // select 1: preferences (empty)
    const { db } = createMockDb([[]]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await expect(
      handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]),
    ).resolves.toBeUndefined();

    expect(mockDiscoverCompanies).not.toHaveBeenCalled();
  });

  test("discovery returns empty -- no DB inserts, no polls, no scoring", async () => {
    setupHappyPath({ discovered: [] });

    const { db } = createMockDb([[makePrefsRow()], []]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    expect(db.insert).not.toHaveBeenCalled();
    expect(mockPollCompany).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
  });

  test("domain dedup -- discovered company domain already in DB is skipped", async () => {
    setupHappyPath();
    // normalizeDomain returns "stripe.com" for both existing and discovered
    mockNormalizeDomain.mockReturnValue("stripe.com");

    const existingCompanies = [
      { name: "Stripe", website: "https://stripe.com", atsVendor: "greenhouse", atsSlug: "stripe" },
    ];
    // select 1: prefs, select 2: existing companies with stripe
    const { db } = createMockDb([[makePrefsRow()], existingCompanies]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    expect(db.insert).not.toHaveBeenCalled();
    expect(mockPollCompany).not.toHaveBeenCalled();
  });

  test("ATS vendor unsupported -- company skipped", async () => {
    setupHappyPath();
    mockDetectAtsVendor.mockReturnValue("workday");

    const { db } = createMockDb([[makePrefsRow()], []]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    expect(db.insert).not.toHaveBeenCalled();
  });

  test("no careersUrl (null) -- company skipped", async () => {
    setupHappyPath({
      discovered: [makeDiscoveredCompany({ careersUrl: null })],
    });

    const { db } = createMockDb([[makePrefsRow()], []]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    expect(mockDetectAtsVendor).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  test("ATS slug extraction fails -- company skipped", async () => {
    setupHappyPath();
    mockParseGreenhouseBoardToken.mockReturnValue(null);

    const { db } = createMockDb([[makePrefsRow()], []]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    expect(db.insert).not.toHaveBeenCalled();
  });

  test("ATS pair already in DB -- company skipped", async () => {
    setupHappyPath();
    // Existing company has greenhouse:newco
    const existingCompanies = [
      { name: "Existing", website: "https://existing.com", atsVendor: "greenhouse", atsSlug: "newco" },
    ];
    // normalizeDomain returns different domains so we don't hit domain dedup
    mockNormalizeDomain
      .mockReturnValueOnce("existing.com")  // existing company
      .mockReturnValueOnce("newco.com");    // discovered company

    const { db } = createMockDb([[makePrefsRow()], existingCompanies]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    expect(db.insert).not.toHaveBeenCalled();
  });

  test("DB insert conflict (onConflictDoNothing returns empty) -- company skipped, no poll", async () => {
    setupHappyPath();

    // select 1: prefs, select 2: existing (empty)
    // insert returns empty array (conflict)
    const { db } = createMockDb([[makePrefsRow()], []], [[]]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    expect(mockPollCompany).not.toHaveBeenCalled();
  });

  test("per-company error isolation -- one company throws, next succeeds", async () => {
    const company1 = makeDiscoveredCompany({
      name: "FailCo",
      website: "https://failco.com",
      careersUrl: "https://boards.greenhouse.io/failco",
    });
    const company2 = makeDiscoveredCompany({
      name: "SuccessCo",
      website: "https://successco.com",
      careersUrl: "https://boards.greenhouse.io/successco",
    });

    setupHappyPath({ discovered: [company1, company2] });

    // First company: detectAtsVendor throws
    mockDetectAtsVendor
      .mockImplementationOnce(() => {
        throw new Error("unexpected vendor error");
      })
      .mockReturnValue("greenhouse");

    mockParseGreenhouseBoardToken.mockReturnValue("successco");

    const companyRow = makeCompanyRow({ name: "SuccessCo", slug: "greenhouse-successco" });
    // select 1: prefs, select 2: existing (empty)
    // insert: only second company succeeds
    const { db } = createMockDb(
      [[makePrefsRow()], []],
      [[companyRow]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // First company errored, second company inserted and polled
    expect(mockPollCompany).toHaveBeenCalledOnce();
    expect(mockPollCompany).toHaveBeenCalledWith(db, companyRow);
  });

  // ── Important ─────────────────────────────────────────────────────────

  test("poll failure -- company inserted but poll errors, handler continues", async () => {
    setupHappyPath();
    mockPollCompany.mockRejectedValue(new Error("timeout"));

    const companyRow = makeCompanyRow();
    const jobRows = [{ id: "job-1", descriptionHash: "hash-1" }];
    // select 1: prefs, select 2: existing companies (empty),
    // select 3: jobs from new companies, select 4: existing scores (empty)
    const { db } = createMockDb(
      [[makePrefsRow()], [], jobRows, []],
      [[companyRow]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // Company was inserted (insert was called)
    expect(db.insert).toHaveBeenCalled();

    // Scoring still enqueued because inserted > 0
    expect(boss.send).toHaveBeenCalledWith(
      FUTURE_QUEUES.llmScoring,
      { jobId: "job-1", userProfileId: "profile-1", userId: "user-1" },
      { singletonKey: "profile-1:job-1" },
    );
  });

  test("budget clamps discovered companies -- only processes budget count", async () => {
    const companies5 = Array.from({ length: 5 }, (_, i) =>
      makeDiscoveredCompany({
        name: `Co${i}`,
        website: `https://co${i}.com`,
        careersUrl: `https://boards.greenhouse.io/co${i}`,
      }),
    );

    setupHappyPath({ discovered: companies5 });
    mockGetAppConfigValue.mockResolvedValue(2);

    mockParseGreenhouseBoardToken
      .mockReturnValueOnce("co0")
      .mockReturnValueOnce("co1");

    const row0 = makeCompanyRow({ id: "c0", slug: "greenhouse-co0", name: "Co0" });
    const row1 = makeCompanyRow({ id: "c1", slug: "greenhouse-co1", name: "Co1" });
    const { db } = createMockDb(
      [[makePrefsRow()], []],
      [[row0], [row1]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // Only 2 companies processed despite 5 discovered
    expect(mockPollCompany).toHaveBeenCalledTimes(2);
  });

  test("budget config NaN fallback -- falls back to 20", async () => {
    setupHappyPath({ discovered: [] });
    mockGetAppConfigValue.mockResolvedValue("not-a-number");

    const { db } = createMockDb([[makePrefsRow()], []]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // discoverCompanies was called with budget: 20 (the NaN fallback)
    expect(mockDiscoverCompanies).toHaveBeenCalledWith(
      expect.objectContaining({ budget: 20 }),
    );
  });

  test("budget config fractional value -- Math.floor applied", async () => {
    setupHappyPath({ discovered: [] });
    mockGetAppConfigValue.mockResolvedValue(3.7);

    const { db } = createMockDb([[makePrefsRow()], []]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    expect(mockDiscoverCompanies).toHaveBeenCalledWith(
      expect.objectContaining({ budget: 3 }),
    );
  });

  test("budget config zero -- clamped to 1", async () => {
    setupHappyPath({ discovered: [] });
    mockGetAppConfigValue.mockResolvedValue(0);

    const { db } = createMockDb([[makePrefsRow()], []]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    expect(mockDiscoverCompanies).toHaveBeenCalledWith(
      expect.objectContaining({ budget: 1 }),
    );
  });

  test("budget config negative -- clamped to 1", async () => {
    setupHappyPath({ discovered: [] });
    mockGetAppConfigValue.mockResolvedValue(-5);

    const { db } = createMockDb([[makePrefsRow()], []]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    expect(mockDiscoverCompanies).toHaveBeenCalledWith(
      expect.objectContaining({ budget: 1 }),
    );
  });

  test("scoring not enqueued when no companies were inserted", async () => {
    // All companies skipped (unsupported ATS)
    setupHappyPath();
    mockDetectAtsVendor.mockReturnValue("workday");

    const { db } = createMockDb([[makePrefsRow()], []]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    expect(boss.send).not.toHaveBeenCalled();
  });

  test("scoring enqueue fails -- handler still completes", async () => {
    setupHappyPath();

    const companyRow = makeCompanyRow();
    const jobRows = [{ id: "job-1", descriptionHash: "hash-1" }];
    // select 1: prefs, select 2: existing companies (empty),
    // select 3: jobs from new companies, select 4: existing scores (empty)
    const { db } = createMockDb(
      [[makePrefsRow()], [], jobRows, []],
      [[companyRow]],
    );
    const boss = createMockBoss();
    (boss.send as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("queue connection lost"),
    );

    const handler = createInternetExpansionHandler(db, boss);
    await expect(
      handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]),
    ).resolves.toBeUndefined();
  });

  test("batch of multiple jobs -- processed sequentially, independent preferences", async () => {
    setupHappyPath({ discovered: [] });

    // Two jobs, each with different prefs
    const prefs1 = makePrefsRow({ userId: "user-1", industries: ["fintech"] });
    const prefs2 = makePrefsRow({ userId: "user-2", industries: ["healthtech"] });

    // select sequence: prefs1, existing1, prefs2, existing2
    const { db } = createMockDb([[prefs1], [], [prefs2], []]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "p1" }),
      makeBatchJob({ userId: "user-2", userProfileId: "p2" }),
    ]);

    // Both users' preferences loaded
    expect(mockDecryptUserKey).toHaveBeenCalledTimes(2);
    expect(mockDiscoverCompanies).toHaveBeenCalledTimes(2);
  });

  test("existing companies dedup set updated during iteration -- second duplicate skipped", async () => {
    // Two companies with the same domain (acme.com and www.acme.com)
    const company1 = makeDiscoveredCompany({
      name: "Acme Inc",
      website: "https://acme.com",
      careersUrl: "https://boards.greenhouse.io/acme",
    });
    const company2 = makeDiscoveredCompany({
      name: "Acme Corp",
      website: "https://www.acme.com",
      careersUrl: "https://boards.greenhouse.io/acme-corp",
    });

    setupHappyPath({ discovered: [company1, company2] });
    // Both normalize to "acme.com"
    mockNormalizeDomain.mockReturnValue("acme.com");
    mockParseGreenhouseBoardToken
      .mockReturnValueOnce("acme")
      .mockReturnValueOnce("acme-corp");

    const row1 = makeCompanyRow({ id: "c1", slug: "greenhouse-acme" });
    const { db, insertCalls } = createMockDb(
      [[makePrefsRow()], []],
      [[row1]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // First company inserted, second skipped by domain dedup (set updated after first)
    expect(insertCalls).toHaveLength(1);
    expect(mockPollCompany).toHaveBeenCalledOnce();
  });

  test("existing companies dedup set updated for ATS keys -- second same ATS pair skipped", async () => {
    // Two companies with different domains but same ATS pair
    const company1 = makeDiscoveredCompany({
      name: "Acme Alpha",
      website: "https://acme-alpha.com",
      careersUrl: "https://boards.greenhouse.io/acme",
    });
    const company2 = makeDiscoveredCompany({
      name: "Acme Beta",
      website: "https://acme-beta.com",
      careersUrl: "https://boards.greenhouse.io/acme",
    });

    mockDecryptUserKey.mockResolvedValue("sk-test-key");
    mockGetAppConfigValue.mockResolvedValue(20);
    mockDiscoverCompanies.mockResolvedValue([company1, company2]);
    mockDetectAtsVendor.mockReturnValue("greenhouse");
    mockPollCompany.mockResolvedValue({ jobsFound: 5, jobsNew: 5 });
    // Both resolve to the same ATS slug
    mockParseGreenhouseBoardToken.mockReturnValue("acme");

    // Explicit domain mock: different domains for each company
    const domainMap: Record<string, string> = {
      "https://acme-alpha.com": "acme-alpha.com",
      "https://acme-beta.com": "acme-beta.com",
    };
    mockNormalizeDomain.mockImplementation(
      (url: string) => domainMap[url] ?? null,
    );

    const row1 = makeCompanyRow({ id: "c1", slug: "greenhouse-acme" });
    const { db, insertCalls } = createMockDb(
      [[makePrefsRow()], []],
      [[row1]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // First inserted, second skipped by ATS key dedup
    expect(insertCalls).toHaveLength(1);
    expect(mockPollCompany).toHaveBeenCalledTimes(1);
  });

  test("company slug sanitization -- special characters replaced with hyphens", async () => {
    setupHappyPath();
    mockParseGreenhouseBoardToken.mockReturnValue("acme_corp.123");

    const companyRow = makeCompanyRow({ slug: "greenhouse-acme-corp-123" });
    const { db, insertCalls } = createMockDb(
      [[makePrefsRow()], []],
      [[companyRow]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    const insertedValues = insertCalls[0].values as Record<string, unknown>;
    // Underscore and dot replaced by hyphens, lowercased
    expect(insertedValues.slug).toBe("greenhouse-acme-corp-123");
  });

  test("industry tags lowercased in insert", async () => {
    setupHappyPath({
      discovered: [
        makeDiscoveredCompany({ industry: ["FinTech", "SAAS"] }),
      ],
    });

    const companyRow = makeCompanyRow();
    const { db, insertCalls } = createMockDb(
      [[makePrefsRow()], []],
      [[companyRow]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    const insertedValues = insertCalls[0].values as Record<string, unknown>;
    expect(insertedValues.industry).toEqual(["fintech", "saas"]);
  });

  test("preferences with null arrays default to empty", async () => {
    setupHappyPath({ discovered: [] });

    const nullPrefs = makePrefsRow({
      industries: null,
      companySizes: null,
      companyStages: null,
      productTypes: null,
      exclusions: null,
      hqGeographies: null,
    });

    const { db } = createMockDb([[nullPrefs], []]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    expect(mockDiscoverCompanies).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: {
          industries: [],
          companySizes: [],
          companyStages: [],
          productTypes: [],
          exclusions: [],
          hqGeographies: [],
        },
      }),
    );
  });

  describe("each vendor dispatches to the correct slug parser", () => {
    test.each<[string, ReturnType<typeof vi.fn>, unknown]>([
      ["greenhouse", mockParseGreenhouseBoardToken, "acme"],
      ["lever", mockParseLeverSite, { site: "acme", isEu: false }],
      ["ashby", mockParseAshbyBoard, "acme"],
      ["smartrecruiters", mockParseSmartRecruitersCompany, "acme"],
    ])(
      "vendor %s calls its parser and extracts slug",
      async (vendor, parser, returnVal) => {
        vi.clearAllMocks();
        vi.spyOn(console, "info").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});

        setupHappyPath();
        mockDetectAtsVendor.mockReturnValue(vendor);

        // Reset all parsers then set the one we care about
        mockParseGreenhouseBoardToken.mockReturnValue(null);
        mockParseLeverSite.mockReturnValue(null);
        mockParseAshbyBoard.mockReturnValue(null);
        mockParseSmartRecruitersCompany.mockReturnValue(null);

        parser.mockReturnValue(returnVal);

        const expectedSlug = vendor === "lever"
          ? (returnVal as { site: string }).site
          : (returnVal as string);

        const companyRow = makeCompanyRow({
          atsVendor: vendor,
          atsSlug: expectedSlug,
          slug: `${vendor}-${expectedSlug}`,
        });
        const { db, insertCalls } = createMockDb(
          [[makePrefsRow()], []],
          [[companyRow]],
        );
        const boss = createMockBoss();

        const handler = createInternetExpansionHandler(db, boss);
        await handler([
          makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
        ]);

        expect(parser).toHaveBeenCalled();
        if (insertCalls.length > 0) {
          const insertedValues = insertCalls[0].values as Record<
            string,
            unknown
          >;
          expect(insertedValues.atsSlug).toBe(expectedSlug);
        }
      },
    );
  });

  test("Lever slug extraction uses .site property", async () => {
    setupHappyPath();
    mockDetectAtsVendor.mockReturnValue("lever");
    mockParseLeverSite.mockReturnValue({ site: "acme-lever", isEu: false });

    const companyRow = makeCompanyRow({ atsVendor: "lever", atsSlug: "acme-lever" });
    const { db, insertCalls } = createMockDb(
      [[makePrefsRow()], []],
      [[companyRow]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    expect(insertCalls).toHaveLength(1);
    const insertedValues = insertCalls[0].values as Record<string, unknown>;
    // .site was extracted from the { site, isEu } object
    expect(insertedValues.atsSlug).toBe("acme-lever");
  });

  // ── Nice-to-have ──────────────────────────────────────────────────────

  test("empty batch array -- resolves immediately, no DB calls", async () => {
    const { db } = createMockDb([]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await expect(handler([])).resolves.toBeUndefined();

    expect(mockDecryptUserKey).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  test("normalizeDomain returns null but company has valid careersUrl -- ATS detection proceeds", async () => {
    setupHappyPath({
      discovered: [
        makeDiscoveredCompany({ website: "not-a-valid-url" }),
      ],
    });
    mockNormalizeDomain.mockReturnValue(null);

    const companyRow = makeCompanyRow();
    const { db, insertCalls } = createMockDb(
      [[makePrefsRow()], []],
      [[companyRow]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // Null domain passes domain dedup guard. ATS detection proceeds.
    expect(mockDetectAtsVendor).toHaveBeenCalled();
    expect(insertCalls).toHaveLength(1);
  });

  test("top-level error catch -- DB query for preferences throws, handler continues to next job", async () => {
    mockDecryptUserKey.mockResolvedValue("sk-test-key");

    // First job: prefs query throws. Second job: works normally.
    const prefs2 = makePrefsRow({ userId: "user-2" });

    // Build a DB where the first select chain throws
    let selectCallCount = 0;
    const mockLimit = vi.fn().mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return Promise.reject(new Error("DB connection lost"));
      }
      if (selectCallCount === 2) {
        return Promise.resolve([prefs2]);
      }
      return Promise.resolve([]);
    });

    const mockWhere = vi.fn().mockImplementation(() => {
      const idx = selectCallCount;
      return {
        limit: mockLimit,
        then: (resolve: (val: unknown) => void, reject: (err: Error) => void) => {
          selectCallCount++;
          if (idx === 0 && selectCallCount === 1) {
            reject(new Error("DB connection lost"));
          } else {
            resolve([]);
          }
        },
      };
    });

    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

    const db = {
      select: mockSelect,
      insert: vi.fn(),
    } as unknown as Parameters<typeof createInternetExpansionHandler>[0];
    const boss = createMockBoss();

    setupHappyPath({ discovered: [] });

    const handler = createInternetExpansionHandler(db, boss);
    // Two jobs: first should catch error and continue to second
    await expect(
      handler([
        makeBatchJob({ userId: "user-1", userProfileId: "p1" }),
        makeBatchJob({ userId: "user-2", userProfileId: "p2" }),
      ]),
    ).resolves.toBeUndefined();

    // Both users had their keys decrypted (handler continued past first error)
    expect(mockDecryptUserKey).toHaveBeenCalledTimes(2);
  });

  // ── Negative/Failure scenarios ────────────────────────────────────────

  test("decryptUserKey throws -- caught by outer try-catch, handler continues", async () => {
    mockDecryptUserKey
      .mockRejectedValueOnce(new Error("encryption service unavailable"))
      .mockResolvedValueOnce(null);

    const { db } = createMockDb([]);
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await expect(
      handler([
        makeBatchJob({ userId: "user-1", userProfileId: "p1" }),
        makeBatchJob({ userId: "user-2", userProfileId: "p2" }),
      ]),
    ).resolves.toBeUndefined();

    // Both jobs attempted
    expect(mockDecryptUserKey).toHaveBeenCalledTimes(2);
  });

  test("DB insert throws (not conflict) -- per-company error catch fires, handler continues", async () => {
    setupHappyPath();

    const mockReturning = vi.fn().mockRejectedValue(
      new Error("constraint violation"),
    );
    const mockOnConflict = vi.fn().mockReturnValue({
      returning: mockReturning,
    });
    const mockInsertValues = vi.fn().mockReturnValue({
      onConflictDoNothing: mockOnConflict,
    });

    const db = {
      select: createMockDb([[makePrefsRow()], []]).db.select,
      insert: vi.fn().mockReturnValue({ values: mockInsertValues }),
    } as unknown as Parameters<typeof createInternetExpansionHandler>[0];
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await expect(
      handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]),
    ).resolves.toBeUndefined();

    // Poll not called because insert threw
    expect(mockPollCompany).not.toHaveBeenCalled();
  });

  test("boss.send for scoring throws -- warning logged, handler completes", async () => {
    setupHappyPath();

    const companyRow = makeCompanyRow();
    const jobRows = [{ id: "job-1", descriptionHash: "hash-1" }];
    // select 1: prefs, select 2: existing companies (empty),
    // select 3: jobs from new companies, select 4: existing scores (empty)
    const { db } = createMockDb(
      [[makePrefsRow()], [], jobRows, []],
      [[companyRow]],
    );
    const boss = createMockBoss();
    (boss.send as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("queue connection lost"),
    );

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // Handler did not throw
    expect(mockPollCompany).toHaveBeenCalled();
  });

  // ── Corner cases ──────────────────────────────────────────────────────

  test("two companies with same domain but different ATS -- second skipped by domain dedup", async () => {
    const company1 = makeDiscoveredCompany({
      name: "Acme GH",
      website: "https://acme.com",
      careersUrl: "https://boards.greenhouse.io/acme",
    });
    const company2 = makeDiscoveredCompany({
      name: "Acme Lever",
      website: "https://acme.com",
      careersUrl: "https://jobs.lever.co/acme",
    });

    setupHappyPath({ discovered: [company1, company2] });
    mockNormalizeDomain.mockReturnValue("acme.com");

    mockParseGreenhouseBoardToken.mockReturnValue("acme");

    const row1 = makeCompanyRow();
    const { db, insertCalls } = createMockDb(
      [[makePrefsRow()], []],
      [[row1]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // Only first company inserted; second caught by domain dedup
    expect(insertCalls).toHaveLength(1);
  });

  test("two different vendors with same slug -- both inserted (vendor prefix prevents collision)", async () => {
    const company1 = makeDiscoveredCompany({
      name: "Acme GH",
      website: "https://acme-gh.com",
      careersUrl: "https://boards.greenhouse.io/acme",
    });
    const company2 = makeDiscoveredCompany({
      name: "Acme Lever",
      website: "https://acme-lever.com",
      careersUrl: "https://jobs.lever.co/acme",
    });

    setupHappyPath({ discovered: [company1, company2] });
    mockNormalizeDomain
      .mockReturnValueOnce("acme-gh.com")
      .mockReturnValueOnce("acme-lever.com");

    mockDetectAtsVendor
      .mockReturnValueOnce("greenhouse")
      .mockReturnValueOnce("lever");

    mockParseGreenhouseBoardToken.mockReturnValue("acme");
    mockParseLeverSite.mockReturnValue({ site: "acme", isEu: false });

    const row1 = makeCompanyRow({
      id: "c1",
      atsVendor: "greenhouse",
      atsSlug: "acme",
      slug: "greenhouse-acme",
    });
    const row2 = makeCompanyRow({
      id: "c2",
      atsVendor: "lever",
      atsSlug: "acme",
      slug: "lever-acme",
    });
    const { db, insertCalls } = createMockDb(
      [[makePrefsRow()], []],
      [[row1], [row2]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // Both inserted: greenhouse:acme and lever:acme are different ATS keys
    expect(insertCalls).toHaveLength(2);
    expect(mockPollCompany).toHaveBeenCalledTimes(2);
  });

  test("ATS slug with uppercase and special characters -- regex sanitization", async () => {
    setupHappyPath();
    mockParseGreenhouseBoardToken.mockReturnValue("AcMe_Corp.123");

    const companyRow = makeCompanyRow();
    const { db, insertCalls } = createMockDb(
      [[makePrefsRow()], []],
      [[companyRow]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    const insertedValues = insertCalls[0].values as Record<string, unknown>;
    // "greenhouse-AcMe_Corp.123" -> lowercased -> "greenhouse-acme_corp.123"
    // -> /[^a-z0-9-]/g replaces _ and . with hyphens -> "greenhouse-acme-corp-123"
    expect(insertedValues.slug).toBe("greenhouse-acme-corp-123");
  });
});
