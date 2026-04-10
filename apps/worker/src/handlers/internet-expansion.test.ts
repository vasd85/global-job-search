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
    title: Symbol("jobs.title"),
    departmentRaw: Symbol("jobs.departmentRaw"),
    locationRaw: Symbol("jobs.locationRaw"),
    workplaceType: Symbol("jobs.workplaceType"),
    visaSponsorship: Symbol("jobs.visaSponsorship"),
    relocationPackage: Symbol("jobs.relocationPackage"),
    workAuthRestriction: Symbol("jobs.workAuthRestriction"),
  },
  jobMatches: {
    jobId: Symbol("jobMatches.jobId"),
    jobContentHash: Symbol("jobMatches.jobContentHash"),
    userProfileId: Symbol("jobMatches.userProfileId"),
  },
  userCompanyPreferences: {
    userId: Symbol("userCompanyPreferences.userId"),
  },
  userProfiles: {
    userId: Symbol("userProfiles.userId"),
  },
  roleFamilies: Symbol("roleFamilies"),
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
  generateSlugCandidates: vi.fn().mockReturnValue([]),
  probeAtsApis: vi.fn().mockResolvedValue({ result: null, log: [] }),
  SUPPORTED_ATS_VENDORS: ["greenhouse", "lever", "ashby", "smartrecruiters"],
}));

vi.mock("@gjs/ats-core", () => ({
  classifyJobMulti: vi.fn(),
  extractSeniority: vi.fn(),
  resolveAllTiers: vi.fn(),
  matchJobToTiers: vi.fn(),
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
  generateSlugCandidates,
  probeAtsApis,
} from "@gjs/ats-core/discovery";
import {
  classifyJobMulti,
  extractSeniority,
  resolveAllTiers,
  matchJobToTiers,
} from "@gjs/ats-core";

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
const mockGenerateSlugCandidates = generateSlugCandidates as ReturnType<typeof vi.fn>;
const mockProbeAtsApis = probeAtsApis as ReturnType<typeof vi.fn>;
const mockClassifyJobMulti = classifyJobMulti as ReturnType<typeof vi.fn>;
const mockExtractSeniority = extractSeniority as ReturnType<typeof vi.fn>;
const mockResolveAllTiers = resolveAllTiers as ReturnType<typeof vi.fn>;
const mockMatchJobToTiers = matchJobToTiers as ReturnType<typeof vi.fn>;

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

function makeProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    userId: "user-1",
    targetTitles: ["Software Engineer"],
    targetSeniority: [],
    locationPreferences: null,
    preferredLocations: [],
    remotePreference: "any",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRoleFamilyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rf-1",
    slug: "engineering",
    name: "Engineering",
    strongMatch: ["engineer", "developer"],
    moderateMatch: ["programmer"],
    departmentBoost: ["engineering"],
    departmentExclude: ["sales"],
    isSystemDefined: true,
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
 * 2. select({...}).from(companies)                         -> existing companies (no .where(), thenable from .from())
 * 3. select().from(userProfiles).where().limit()           -> user profile (L2 context, loaded before company loop)
 * 4. select().from(roleFamilies)                           -> role families (no .where(), thenable from .from())
 * 5. insert(companies).values().onConflictDoNothing().returning() -> inserted row (per company)
 * 6. select({...}).from(jobs).where()                      -> jobs for a company (per company, only if polled)
 * 7. select({jobId,jobContentHash}).from(jobMatches).where() -> existing scores (per company, only if jobs found)
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

  // .from() returns { where } for filtered queries or is directly thenable
  // for unfiltered queries like `db.select().from(roleFamilies)`.
  const mockFrom = vi.fn().mockImplementation(() => {
    const result = selectResults[selectIndex] ?? [];
    return {
      where: mockWhere,
      // Make it thenable for direct await (roleFamilies query has no .where())
      then: (resolve: (val: unknown) => void) => {
        selectIndex++;
        resolve(result);
      },
    };
  });

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
  mockGenerateSlugCandidates.mockReturnValue(["newco", "new-co"]);
  mockProbeAtsApis.mockResolvedValue({ result: null, log: [] });
  mockPollCompany.mockResolvedValue({ jobsFound: 5, jobsNew: 5 });

  // Level 2 filter defaults: all jobs pass
  mockClassifyJobMulti.mockReturnValue({
    familySlug: "engineering",
    score: 0.9,
    matchType: "strong",
    matchedPattern: "engineer",
  });
  mockExtractSeniority.mockReturnValue(null);
  mockResolveAllTiers.mockReturnValue([]);
  mockMatchJobToTiers.mockReturnValue({ passes: true, matchedTier: 1 });
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
      { id: "job-1", descriptionHash: "hash-1", title: "Software Engineer", department: "Engineering", location: "Remote", workplaceType: "remote", visaSponsorship: "unknown", relocationPackage: "unknown", workAuthRestriction: "unknown" },
      { id: "job-2", descriptionHash: "hash-2", title: "Backend Engineer", department: "Engineering", location: "NYC", workplaceType: "onsite", visaSponsorship: "unknown", relocationPackage: "unknown", workAuthRestriction: "unknown" },
    ];
    // select 1: preferences, select 2: existing companies (empty),
    // select 3: user profile, select 4: role families,
    // select 5: jobs from new companies, select 6: existing scores (empty)
    const { db, insertCalls } = createMockDb(
      [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], jobRows, []],
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

    // boss.send called for individual scoring jobs (one per job) with stagger
    expect(boss.send).toHaveBeenCalledTimes(2);
    expect(boss.send).toHaveBeenCalledWith(
      FUTURE_QUEUES.llmScoring,
      { jobId: "job-1", userProfileId: "profile-1", userId: "user-1" },
      { singletonKey: "profile-1:job-1", startAfter: 0 },
    );
    expect(boss.send).toHaveBeenCalledWith(
      FUTURE_QUEUES.llmScoring,
      { jobId: "job-2", userProfileId: "profile-1", userId: "user-1" },
      { singletonKey: "profile-1:job-2", startAfter: 5 },
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

  test("ATS vendor unsupported, probe finds nothing -- company saved as unknown", async () => {
    setupHappyPath();
    mockDetectAtsVendor.mockReturnValue("workday");
    mockProbeAtsApis.mockResolvedValue({ result: null, log: [] });

    const companyRow = makeCompanyRow({
      atsVendor: "unknown",
      atsSlug: null,
      isActive: false,
      slug: "unknown-newco-com",
    });
    // select 1: prefs, select 2: existing companies (empty),
    // select 3: user profile, select 4: role families
    const { db, insertCalls } = createMockDb(
      [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()]],
      [[companyRow]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // Company IS inserted (not skipped), with unknown ATS
    expect(db.insert).toHaveBeenCalled();
    expect(insertCalls).toHaveLength(1);
    const insertedValues = insertCalls[0].values as Record<string, unknown>;
    expect(insertedValues.atsVendor).toBe("unknown");
    expect(insertedValues.atsSlug).toBeNull();
    expect(insertedValues.isActive).toBe(false);
    // Unknown ATS company is NOT polled
    expect(mockPollCompany).not.toHaveBeenCalled();
    // Probe WAS called
    expect(mockProbeAtsApis).toHaveBeenCalled();
  });

  test("no careersUrl (null), probe finds match -- company inserted with probe result", async () => {
    setupHappyPath({
      discovered: [makeDiscoveredCompany({ careersUrl: null })],
    });
    mockProbeAtsApis.mockResolvedValue({
      result: { vendor: "greenhouse", slug: "newco", confidence: "high", matchedName: "NewCo" },
      log: [],
    });

    const companyRow = makeCompanyRow({
      atsVendor: "greenhouse",
      atsSlug: "newco",
      isActive: true,
    });
    // select 1: prefs, select 2: existing (empty),
    // select 3: user profile, select 4: role families,
    // select 5: jobs (empty), no select 6 needed
    const { db, insertCalls } = createMockDb(
      [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], []],
      [[companyRow]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // detectAtsVendor NOT called (no careersUrl), but probeAtsApis IS called
    expect(mockDetectAtsVendor).not.toHaveBeenCalled();
    expect(mockProbeAtsApis).toHaveBeenCalled();
    // Company IS inserted
    expect(insertCalls).toHaveLength(1);
    const insertedValues = insertCalls[0].values as Record<string, unknown>;
    expect(insertedValues.atsVendor).toBe("greenhouse");
    expect(insertedValues.atsSlug).toBe("newco");
    expect(insertedValues.isActive).toBe(true);
  });

  test("ATS slug extraction fails -- falls through to probe, company inserted", async () => {
    setupHappyPath();
    mockParseGreenhouseBoardToken.mockReturnValue(null);
    mockProbeAtsApis.mockResolvedValue({
      result: { vendor: "greenhouse", slug: "newco", confidence: "medium", matchedName: "NewCo" },
      log: [],
    });

    const companyRow = makeCompanyRow({
      atsVendor: "greenhouse",
      atsSlug: "newco",
      isActive: true,
    });
    // select 1: prefs, select 2: existing (empty),
    // select 3: user profile, select 4: role families,
    // select 5: jobs (empty)
    const { db, insertCalls } = createMockDb(
      [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], []],
      [[companyRow]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // URL detection found greenhouse but slug extraction returned null,
    // so probe runs and finds a match
    expect(mockProbeAtsApis).toHaveBeenCalled();
    expect(insertCalls).toHaveLength(1);
    const insertedValues = insertCalls[0].values as Record<string, unknown>;
    expect(insertedValues.atsVendor).toBe("greenhouse");
    expect(insertedValues.atsSlug).toBe("newco");
    expect(insertedValues.isActive).toBe(true);
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

    // select 1: prefs, select 2: existing (empty),
    // select 3: user profile, select 4: role families
    // insert returns empty array (conflict)
    const { db } = createMockDb(
      [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()]],
      [[]],
    );
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
    // select 1: prefs, select 2: existing (empty),
    // select 3: user profile, select 4: role families,
    // select 5: jobs for second company (empty)
    // insert: only second company succeeds
    const { db } = createMockDb(
      [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], []],
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

  test("poll failure -- company inserted but poll errors, no scoring enqueued, handler continues", async () => {
    setupHappyPath();
    mockPollCompany.mockRejectedValue(new Error("timeout"));

    const companyRow = makeCompanyRow();
    // select 1: prefs, select 2: existing companies (empty),
    // select 3: user profile, select 4: role families
    // No jobs/scores selects needed: poll fails so pollSucceeded=false, L2 block skipped
    const { db } = createMockDb(
      [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()]],
      [[companyRow]],
    );
    const boss = createMockBoss();

    const handler = createInternetExpansionHandler(db, boss);
    await handler([
      makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
    ]);

    // Company was inserted
    expect(db.insert).toHaveBeenCalled();

    // Poll was called but failed -- pollSucceeded stays false
    expect(mockPollCompany).toHaveBeenCalled();

    // No scoring enqueued: when poll fails, the inline L2 filtering block is skipped
    expect(boss.send).not.toHaveBeenCalled();
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
    // select 1: prefs, select 2: existing (empty),
    // select 3: user profile, select 4: role families,
    // select 5: jobs for co0 (empty), select 6: jobs for co1 (empty)
    const { db } = createMockDb(
      [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], [], []],
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

    // select 1: prefs, select 2: existing (empty),
    // select 3: user profile, select 4: role families
    const { db } = createMockDb(
      [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()]],
    );
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
    const jobRows = [{ id: "job-1", descriptionHash: "hash-1", title: "Software Engineer", departmentRaw: "Engineering", locationRaw: "Remote", workplaceType: "remote" }];
    // select 1: prefs, select 2: existing companies (empty),
    // select 3: user profile, select 4: role families,
    // select 5: jobs from new companies, select 6: existing scores (empty)
    const { db } = createMockDb(
      [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], jobRows, []],
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
    const jobRows = [{ id: "job-1", descriptionHash: "hash-1", title: "Software Engineer", departmentRaw: "Engineering", locationRaw: "Remote", workplaceType: "remote" }];
    // select 1: prefs, select 2: existing companies (empty),
    // select 3: user profile, select 4: role families,
    // select 5: jobs from new companies, select 6: existing scores (empty)
    const { db } = createMockDb(
      [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], jobRows, []],
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

  // ── ATS detection: probe-first with URL fast-path ─────────────────────

  describe("ATS detection logic", () => {
    test("URL fast-path succeeds -- probe NOT called", async () => {
      setupHappyPath();
      // URL detection returns supported vendor + valid slug
      mockDetectAtsVendor.mockReturnValue("greenhouse");
      mockParseGreenhouseBoardToken.mockReturnValue("acme");

      const companyRow = makeCompanyRow({
        atsVendor: "greenhouse",
        atsSlug: "acme",
        isActive: true,
      });
      // select 1: prefs, select 2: existing (empty),
      // select 3: user profile, select 4: role families,
      // select 5: jobs (empty)
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // probeAtsApis must NOT be called when URL fast-path succeeds
      expect(mockProbeAtsApis).not.toHaveBeenCalled();
      expect(insertCalls).toHaveLength(1);
      const insertedValues = insertCalls[0].values as Record<string, unknown>;
      expect(insertedValues.atsVendor).toBe("greenhouse");
      expect(insertedValues.atsSlug).toBe("acme");
      expect(insertedValues.isActive).toBe(true);
    });

    test("URL fast-path fails (unsupported vendor) -- probe called, finds match", async () => {
      setupHappyPath();
      mockDetectAtsVendor.mockReturnValue("workday");
      mockProbeAtsApis.mockResolvedValue({
        result: { vendor: "greenhouse", slug: "acme", confidence: "high", matchedName: "Acme Corp" },
        log: [{ type: "api_probe", vendor: "greenhouse", slug: "acme", result: "found", durationMs: 100, timestamp: "2026-01-01T12:00:00Z", endpoint: "https://boards-api.greenhouse.io/v1/boards/acme", httpStatus: 200 }],
      });

      const companyRow = makeCompanyRow({
        atsVendor: "greenhouse",
        atsSlug: "acme",
        isActive: true,
      });
      // select 1: prefs, select 2: existing (empty),
      // select 3: user profile, select 4: role families,
      // select 5: jobs (empty)
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      expect(mockProbeAtsApis).toHaveBeenCalled();
      expect(insertCalls).toHaveLength(1);
      const insertedValues = insertCalls[0].values as Record<string, unknown>;
      expect(insertedValues.atsVendor).toBe("greenhouse");
      expect(insertedValues.atsSlug).toBe("acme");
      expect(insertedValues.isActive).toBe(true);
    });

    test("URL fast-path fails, probe finds nothing -- company saved as unknown", async () => {
      setupHappyPath();
      mockDetectAtsVendor.mockReturnValue("unknown");
      mockProbeAtsApis.mockResolvedValue({ result: null, log: [] });

      const companyRow = makeCompanyRow({
        atsVendor: "unknown",
        atsSlug: null,
        isActive: false,
        slug: "unknown-newco-com",
      });
      // select 1: prefs, select 2: existing (empty),
      // select 3: user profile, select 4: role families
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()]],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      expect(insertCalls).toHaveLength(1);
      const insertedValues = insertCalls[0].values as Record<string, unknown>;
      expect(insertedValues.atsVendor).toBe("unknown");
      expect(insertedValues.atsSlug).toBeNull();
      expect(insertedValues.isActive).toBe(false);
      // Unknown ATS: not polled
      expect(mockPollCompany).not.toHaveBeenCalled();
    });

    test("no careersUrl and no slug candidates -- company still saved as unknown", async () => {
      setupHappyPath({
        discovered: [makeDiscoveredCompany({ careersUrl: null })],
      });
      mockGenerateSlugCandidates.mockReturnValue([]);
      mockProbeAtsApis.mockResolvedValue({ result: null, log: [] });

      const companyRow = makeCompanyRow({
        atsVendor: "unknown",
        atsSlug: null,
        isActive: false,
      });
      // select 1: prefs, select 2: existing (empty),
      // select 3: user profile, select 4: role families
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()]],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // No URL detection, no probe (empty candidates)
      expect(mockDetectAtsVendor).not.toHaveBeenCalled();
      expect(mockProbeAtsApis).not.toHaveBeenCalled();
      // Company still saved as unknown
      expect(insertCalls).toHaveLength(1);
      const insertedValues = insertCalls[0].values as Record<string, unknown>;
      expect(insertedValues.atsVendor).toBe("unknown");
      expect(insertedValues.atsSlug).toBeNull();
      expect(insertedValues.isActive).toBe(false);
    });

    test("URL detection finds supported vendor but slug extraction returns null -- falls through to probe", async () => {
      setupHappyPath();
      mockDetectAtsVendor.mockReturnValue("greenhouse");
      mockParseGreenhouseBoardToken.mockReturnValue(null);
      mockProbeAtsApis.mockResolvedValue({
        result: { vendor: "lever", slug: "newco", confidence: "medium", matchedName: null },
        log: [],
      });

      const companyRow = makeCompanyRow({
        atsVendor: "lever",
        atsSlug: "newco",
        isActive: true,
      });
      // select 1: prefs, select 2: existing (empty),
      // select 3: user profile, select 4: role families,
      // select 5: jobs (empty)
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // URL detection attempted but slug was null -> probe ran
      expect(mockProbeAtsApis).toHaveBeenCalled();
      expect(insertCalls).toHaveLength(1);
      const insertedValues = insertCalls[0].values as Record<string, unknown>;
      expect(insertedValues.atsVendor).toBe("lever");
      expect(insertedValues.atsSlug).toBe("newco");
    });

    test("probe returns low-confidence result (Lever) -- company still inserted and polled", async () => {
      setupHappyPath();
      mockDetectAtsVendor.mockReturnValue("unknown");
      mockProbeAtsApis.mockResolvedValue({
        result: { vendor: "lever", slug: "acme", confidence: "low", matchedName: null },
        log: [],
      });

      const companyRow = makeCompanyRow({
        atsVendor: "lever",
        atsSlug: "acme",
        isActive: true,
      });
      // select 1: prefs, select 2: existing (empty),
      // select 3: user profile, select 4: role families,
      // select 5: jobs (empty)
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      expect(insertCalls).toHaveLength(1);
      const insertedValues = insertCalls[0].values as Record<string, unknown>;
      expect(insertedValues.atsVendor).toBe("lever");
      expect(insertedValues.isActive).toBe(true);
      expect(mockPollCompany).toHaveBeenCalled();
    });
  });

  // ── atsSearchLog structure ────────────────────────────────────────────

  describe("atsSearchLog structure", () => {
    test("URL fast-path success -- log contains URL detection step only, no probe entries", async () => {
      setupHappyPath();
      mockDetectAtsVendor.mockReturnValue("greenhouse");
      mockParseGreenhouseBoardToken.mockReturnValue("acme");

      const companyRow = makeCompanyRow();
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      const insertedValues = insertCalls[0].values as Record<string, unknown>;
      const log = insertedValues.atsSearchLog as {
        steps: Array<{ type: string; result: string }>;
        outcome: { method: string; vendor: string; slug: string };
      };
      expect(log.steps).toHaveLength(1);
      expect(log.steps[0].type).toBe("url_detection");
      expect(log.steps[0].result).toBe("found");
      expect(log.outcome.method).toBe("url_detection");
      expect(log.outcome.vendor).toBe("greenhouse");
      expect(log.outcome.slug).toBe("acme");
    });

    test("URL fast-path fails, probe succeeds -- log contains both steps", async () => {
      setupHappyPath();
      mockDetectAtsVendor.mockReturnValue("workday");
      const probeLogEntry = {
        timestamp: "2026-01-01T12:00:00Z",
        vendor: "greenhouse",
        slug: "newco",
        endpoint: "https://boards-api.greenhouse.io/v1/boards/newco",
        httpStatus: 200,
        result: "found" as const,
        durationMs: 120,
      };
      mockProbeAtsApis.mockResolvedValue({
        result: { vendor: "greenhouse", slug: "newco", confidence: "high", matchedName: "NewCo" },
        log: [probeLogEntry],
      });

      const companyRow = makeCompanyRow();
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      const insertedValues = insertCalls[0].values as Record<string, unknown>;
      const log = insertedValues.atsSearchLog as {
        steps: Array<{ type?: string; vendor: string; result: string }>;
        outcome: { method: string };
      };
      // First step is url_detection (not_found), followed by probe entry
      expect(log.steps.length).toBeGreaterThanOrEqual(2);
      expect(log.steps[0].type).toBe("url_detection");
      expect(log.steps[0].result).toBe("not_found");
      // Last step is the probe entry
      expect(log.steps[log.steps.length - 1].vendor).toBe("greenhouse");
      expect(log.outcome.method).toBe("api_probe");
    });

    test("no careersUrl, probe finds nothing -- log contains only probe steps, no URL detection", async () => {
      setupHappyPath({
        discovered: [makeDiscoveredCompany({ careersUrl: null })],
      });
      const probeLogEntries = [
        { timestamp: "t1", vendor: "greenhouse", slug: "newco", endpoint: "e1", httpStatus: 404, result: "not_found" as const, durationMs: 50 },
        { timestamp: "t2", vendor: "lever", slug: "newco", endpoint: "e2", httpStatus: null, result: "not_found" as const, durationMs: 60 },
      ];
      mockProbeAtsApis.mockResolvedValue({ result: null, log: probeLogEntries });

      const companyRow = makeCompanyRow({ atsVendor: "unknown", atsSlug: null, isActive: false });
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()]],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      const insertedValues = insertCalls[0].values as Record<string, unknown>;
      const log = insertedValues.atsSearchLog as {
        steps: Array<{ type?: string; vendor: string }>;
        outcome: { vendor: string; slug: string | null; method: string; confidence: string | null };
      };
      // No url_detection step
      expect(log.steps.every((s) => s.type !== "url_detection")).toBe(true);
      expect(log.steps).toHaveLength(2);
      expect(log.outcome).toEqual({
        vendor: "unknown",
        slug: null,
        method: "none",
        confidence: null,
      });
    });

    test("atsSearchLog.slugCandidates populated from generateSlugCandidates", async () => {
      setupHappyPath();
      mockGenerateSlugCandidates.mockReturnValue(["acmecorp", "acme-corp", "acme"]);

      const companyRow = makeCompanyRow();
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      const insertedValues = insertCalls[0].values as Record<string, unknown>;
      const log = insertedValues.atsSearchLog as { slugCandidates: string[] };
      expect(log.slugCandidates).toEqual(["acmecorp", "acme-corp", "acme"]);
    });
  });

  // ── Company insertion details ─────────────────────────────────────────

  describe("company insertion details", () => {
    test("unknown-ATS company slug uses domain", async () => {
      setupHappyPath();
      mockDetectAtsVendor.mockReturnValue("unknown");
      mockProbeAtsApis.mockResolvedValue({ result: null, log: [] });
      mockNormalizeDomain.mockReturnValue("acme.com");

      const companyRow = makeCompanyRow({ atsVendor: "unknown", atsSlug: null, isActive: false });
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()]],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      const insertedValues = insertCalls[0].values as Record<string, unknown>;
      expect(insertedValues.slug).toBe("unknown-acme-com");
    });

    test("unknown-ATS company slug uses name when domain is null", async () => {
      setupHappyPath({
        discovered: [makeDiscoveredCompany({ name: "Acme Corp", website: "invalid" })],
      });
      mockDetectAtsVendor.mockReturnValue("unknown");
      mockProbeAtsApis.mockResolvedValue({ result: null, log: [] });
      mockNormalizeDomain.mockReturnValue(null);

      const companyRow = makeCompanyRow({ atsVendor: "unknown", atsSlug: null, isActive: false });
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()]],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      const insertedValues = insertCalls[0].values as Record<string, unknown>;
      expect(insertedValues.slug).toBe("unknown-acme-corp");
    });

    test("isKnownAts is false when vendor is supported but slug is null", async () => {
      setupHappyPath();
      mockDetectAtsVendor.mockReturnValue("greenhouse");
      mockParseGreenhouseBoardToken.mockReturnValue(null);
      // Probe also returns null
      mockProbeAtsApis.mockResolvedValue({ result: null, log: [] });

      const companyRow = makeCompanyRow({ atsVendor: "unknown", atsSlug: null, isActive: false });
      // select 1: prefs, select 2: existing (empty),
      // select 3: user profile, select 4: role families
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()]],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      const insertedValues = insertCalls[0].values as Record<string, unknown>;
      expect(insertedValues.isActive).toBe(false);
      expect(mockPollCompany).not.toHaveBeenCalled();
    });
  });

  // ── Dedup logic ───────────────────────────────────────────────────────

  describe("dedup logic", () => {
    test("ATS dedup skipped for unknown-ATS companies (null slug)", async () => {
      setupHappyPath();
      mockDetectAtsVendor.mockReturnValue("unknown");
      mockProbeAtsApis.mockResolvedValue({ result: null, log: [] });

      const companyRow = makeCompanyRow({ atsVendor: "unknown", atsSlug: null, isActive: false });
      // select 1: prefs, select 2: existing with a company that has "unknown:null" ATS key
      // The unknown company must NOT be deduped against existing "unknown" entries
      const existingCompanies = [
        { name: "OldUnknown", website: "https://oldunknown.com", atsVendor: "unknown", atsSlug: null },
      ];
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], existingCompanies, [makeProfileRow()], [makeRoleFamilyRow()]],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // Company inserted despite existing "unknown:null" in DB
      expect(insertCalls).toHaveLength(1);
    });

    test("DB insert conflict (race condition) -- counted as skippedDup, no poll", async () => {
      setupHappyPath();

      // select 1: prefs, select 2: existing (empty),
      // select 3: user profile, select 4: role families
      // insert returns empty array (conflict)
      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()]],
        [[]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      expect(mockPollCompany).not.toHaveBeenCalled();
    });

    test("in-batch ATS key dedup -- second company with same vendor:slug skipped", async () => {
      // Two companies that both resolve to greenhouse:acme via different paths
      const company1 = makeDiscoveredCompany({
        name: "Acme Via URL",
        website: "https://acme-url.com",
        careersUrl: "https://boards.greenhouse.io/acme",
      });
      const company2 = makeDiscoveredCompany({
        name: "Acme Via Probe",
        website: "https://acme-probe.com",
        careersUrl: "https://acme-probe.com/careers",
      });

      setupHappyPath({ discovered: [company1, company2] });
      mockNormalizeDomain
        .mockReturnValueOnce("acme-url.com")
        .mockReturnValueOnce("acme-probe.com");

      // First: URL detection succeeds
      mockDetectAtsVendor
        .mockReturnValueOnce("greenhouse")
        .mockReturnValueOnce("unknown");
      mockParseGreenhouseBoardToken.mockReturnValue("acme");

      // Second: probe returns same result
      mockProbeAtsApis.mockResolvedValue({
        result: { vendor: "greenhouse", slug: "acme", confidence: "high", matchedName: "Acme" },
        log: [],
      });

      const row1 = makeCompanyRow({ id: "c1", atsVendor: "greenhouse", atsSlug: "acme" });
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], []],
        [[row1]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // First inserted, second caught by ATS key dedup
      expect(insertCalls).toHaveLength(1);
    });
  });

  // ── Inline Level 2 Filtering ──────────────────────────────────────────

  describe("inline Level 2 filtering", () => {
    test("role family filter rejects job below threshold -- not enqueued for scoring", async () => {
      setupHappyPath();
      // First call: resolveRoleFamilies classifies target title -> high score (family is resolved)
      // Second call: L2 filter classifies actual job -> low score (filtered out)
      mockClassifyJobMulti
        .mockReturnValueOnce({ familySlug: "engineering", score: 0.9, matchType: "strong", matchedPattern: "engineer" })
        .mockReturnValue({ familySlug: "engineering", score: 0.3, matchType: "none", matchedPattern: null });

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "hash-1", title: "Sales Rep", departmentRaw: "Sales", locationRaw: "Remote", workplaceType: "remote" },
      ];
      // select 1: prefs, select 2: existing (empty),
      // select 3: user profile, select 4: role families,
      // select 5: jobs, select 6: existing scores (empty)
      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], jobRows, []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      expect(boss.send).not.toHaveBeenCalled();
    });

    test("seniority filter rejects job -- not enqueued for scoring", async () => {
      setupHappyPath();
      // Profile has targetSeniority ["senior"]
      const profile = makeProfileRow({ targetSeniority: ["senior"] });
      // extractSeniority returns "junior" (not in target list)
      mockExtractSeniority.mockReturnValue("junior");

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "hash-1", title: "Junior Engineer", departmentRaw: "Engineering", locationRaw: "Remote", workplaceType: "remote" },
      ];
      // No matched families (empty targetTitles would skip role filter)
      // but profile has targetTitles that produce matchedFamilies, so role filter
      // runs first. Make it pass so seniority filter is reached.
      mockClassifyJobMulti.mockReturnValue({
        familySlug: "engineering",
        score: 0.9,
        matchType: "strong",
        matchedPattern: "engineer",
      });

      const { db } = createMockDb(
        [[makePrefsRow()], [], [profile], [makeRoleFamilyRow()], jobRows, []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      expect(boss.send).not.toHaveBeenCalled();
    });

    test("location filter rejects job -- not enqueued for scoring", async () => {
      setupHappyPath();
      const profile = makeProfileRow({
        locationPreferences: { tiers: [{ name: "US", geos: ["US"] }] },
      });
      mockResolveAllTiers.mockReturnValue([{ name: "US", geos: ["US"] }]);
      mockMatchJobToTiers.mockReturnValue({ passes: false, matchedTier: null });

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "hash-1", title: "Software Engineer", department: "Engineering", location: "London, UK", workplaceType: "onsite", visaSponsorship: "unknown", relocationPackage: "unknown", workAuthRestriction: "unknown" },
      ];

      const { db } = createMockDb(
        [[makePrefsRow()], [], [profile], [makeRoleFamilyRow()], jobRows, []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      expect(boss.send).not.toHaveBeenCalled();
    });

    test("job with existing fresh score (same content hash) -- skipped, not re-scored", async () => {
      setupHappyPath();

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "hash-same", title: "Software Engineer", departmentRaw: "Engineering", locationRaw: "Remote", workplaceType: "remote" },
      ];
      const existingScores = [
        { jobId: "job-1", jobContentHash: "hash-same" },
      ];
      // select 1: prefs, select 2: existing (empty),
      // select 3: user profile, select 4: role families,
      // select 5: jobs, select 6: existing scores (with matching hash)
      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], jobRows, existingScores],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // Job skipped entirely -- content hash matches existing score
      expect(boss.send).not.toHaveBeenCalled();
      // Note: classifyJobMulti IS called during resolveRoleFamilies (for target titles),
      // but should NOT be called for the job itself (it's skipped before L2 filters run).
      // resolveRoleFamilies calls it once for the target title; L2 filter for the job is skipped.
      // Total calls = 1 (from resolveRoleFamilies), not 2.
      expect(mockClassifyJobMulti).toHaveBeenCalledTimes(1);
    });

    test("job with stale score (different content hash) -- L2 filtering runs, may be enqueued", async () => {
      setupHappyPath();

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "new-hash", title: "Software Engineer", departmentRaw: "Engineering", locationRaw: "Remote", workplaceType: "remote" },
      ];
      const existingScores = [
        { jobId: "job-1", jobContentHash: "old-hash" },
      ];

      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], jobRows, existingScores],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // Content changed, so L2 filters run and job gets enqueued
      expect(boss.send).toHaveBeenCalledTimes(1);
    });

    test("no matched families (empty targetTitles) -- role family filter skipped", async () => {
      setupHappyPath();
      const profile = makeProfileRow({ targetTitles: [] });

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "hash-1", title: "Software Engineer", departmentRaw: "Engineering", locationRaw: "Remote", workplaceType: "remote" },
      ];

      const { db } = createMockDb(
        [[makePrefsRow()], [], [profile], [makeRoleFamilyRow()], jobRows, []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // classifyJobMulti NOT called (empty matchedFamilies)
      expect(mockClassifyJobMulti).not.toHaveBeenCalled();
      // Job proceeds to scoring
      expect(boss.send).toHaveBeenCalledTimes(1);
    });

    test("seniority is null (undetectable) -- seniority filter passes", async () => {
      setupHappyPath();
      const profile = makeProfileRow({ targetSeniority: ["senior"] });
      mockExtractSeniority.mockReturnValue(null);

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "hash-1", title: "Engineer", departmentRaw: "Engineering", locationRaw: "Remote", workplaceType: "remote" },
      ];

      const { db } = createMockDb(
        [[makePrefsRow()], [], [profile], [makeRoleFamilyRow()], jobRows, []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // Null seniority passes the filter (not rejected)
      expect(boss.send).toHaveBeenCalledTimes(1);
    });

    test("empty targetSeniority -- seniority filter skipped entirely", async () => {
      setupHappyPath();
      const profile = makeProfileRow({ targetSeniority: [] });

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "hash-1", title: "Junior Engineer", departmentRaw: "Engineering", locationRaw: "Remote", workplaceType: "remote" },
      ];

      const { db } = createMockDb(
        [[makePrefsRow()], [], [profile], [makeRoleFamilyRow()], jobRows, []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // Job passes regardless of seniority
      expect(boss.send).toHaveBeenCalledTimes(1);
    });

    test("empty resolvedTiers -- location filter skipped entirely", async () => {
      setupHappyPath();
      // locationPreferences null -> resolvedTiers empty
      const profile = makeProfileRow({ locationPreferences: null });

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "hash-1", title: "Software Engineer", departmentRaw: "Engineering", locationRaw: "Anywhere", workplaceType: "remote" },
      ];

      const { db } = createMockDb(
        [[makePrefsRow()], [], [profile], [makeRoleFamilyRow()], jobRows, []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // matchJobToTiers NOT called
      expect(mockMatchJobToTiers).not.toHaveBeenCalled();
      expect(boss.send).toHaveBeenCalledTimes(1);
    });

    test("role family score exactly at threshold (0.5) -- job passes", async () => {
      setupHappyPath();
      mockClassifyJobMulti.mockReturnValue({
        familySlug: "engineering",
        score: 0.5,
        matchType: "moderate",
        matchedPattern: "engineer",
      });

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "hash-1", title: "Software Engineer", departmentRaw: "Engineering", locationRaw: "Remote", workplaceType: "remote" },
      ];

      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], jobRows, []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // Score >= 0.5 passes (boundary condition)
      expect(boss.send).toHaveBeenCalledTimes(1);
    });
  });

  // ── Scoring enqueue ───────────────────────────────────────────────────

  describe("scoring enqueue", () => {
    test("stagger counter persists across companies -- second company's jobs start after first's", async () => {
      const company1 = makeDiscoveredCompany({
        name: "CompanyA",
        website: "https://companya.com",
        careersUrl: "https://boards.greenhouse.io/companya",
      });
      const company2 = makeDiscoveredCompany({
        name: "CompanyB",
        website: "https://companyb.com",
        careersUrl: "https://boards.greenhouse.io/companyb",
      });

      setupHappyPath({ discovered: [company1, company2] });
      mockNormalizeDomain
        .mockReturnValueOnce("companya.com")
        .mockReturnValueOnce("companyb.com");
      mockParseGreenhouseBoardToken
        .mockReturnValueOnce("companya")
        .mockReturnValueOnce("companyb");

      const row1 = makeCompanyRow({ id: "c1", slug: "greenhouse-companya", name: "CompanyA" });
      const row2 = makeCompanyRow({ id: "c2", slug: "greenhouse-companyb", name: "CompanyB" });

      const jobsA = [
        { id: "j1", descriptionHash: "h1", title: "Engineer", departmentRaw: "Eng", locationRaw: "Remote", workplaceType: "remote" },
        { id: "j2", descriptionHash: "h2", title: "Designer", departmentRaw: "Design", locationRaw: "Remote", workplaceType: "remote" },
        { id: "j3", descriptionHash: "h3", title: "PM", departmentRaw: "Product", locationRaw: "Remote", workplaceType: "remote" },
      ];
      const jobsB = [
        { id: "j4", descriptionHash: "h4", title: "Backend", departmentRaw: "Eng", locationRaw: "NYC", workplaceType: "onsite" },
        { id: "j5", descriptionHash: "h5", title: "Frontend", departmentRaw: "Eng", locationRaw: "SF", workplaceType: "onsite" },
      ];

      // select sequence:
      // 1: prefs, 2: existing (empty), 3: profile, 4: families,
      // 5: jobs for c1, 6: scores for c1 (empty),
      // 7: jobs for c2, 8: scores for c2 (empty)
      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], jobsA, [], jobsB, []],
        [[row1], [row2]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // 5 total scoring jobs across both companies
      expect(boss.send).toHaveBeenCalledTimes(5);

      // Company A: startAfter 0, 5, 10
      expect(boss.send).toHaveBeenCalledWith(
        FUTURE_QUEUES.llmScoring,
        expect.objectContaining({ jobId: "j1" }),
        expect.objectContaining({ startAfter: 0 }),
      );
      expect(boss.send).toHaveBeenCalledWith(
        FUTURE_QUEUES.llmScoring,
        expect.objectContaining({ jobId: "j2" }),
        expect.objectContaining({ startAfter: 5 }),
      );
      expect(boss.send).toHaveBeenCalledWith(
        FUTURE_QUEUES.llmScoring,
        expect.objectContaining({ jobId: "j3" }),
        expect.objectContaining({ startAfter: 10 }),
      );
      // Company B: startAfter 15, 20 (continues from where A left off)
      expect(boss.send).toHaveBeenCalledWith(
        FUTURE_QUEUES.llmScoring,
        expect.objectContaining({ jobId: "j4" }),
        expect.objectContaining({ startAfter: 15 }),
      );
      expect(boss.send).toHaveBeenCalledWith(
        FUTURE_QUEUES.llmScoring,
        expect.objectContaining({ jobId: "j5" }),
        expect.objectContaining({ startAfter: 20 }),
      );
    });

    test("scoring enqueue failure for one job -- handler continues to next job", async () => {
      setupHappyPath();

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "hash-1", title: "Engineer 1", departmentRaw: "Eng", locationRaw: "Remote", workplaceType: "remote" },
        { id: "job-2", descriptionHash: "hash-2", title: "Engineer 2", departmentRaw: "Eng", locationRaw: "Remote", workplaceType: "remote" },
      ];

      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], jobRows, []],
        [[companyRow]],
      );
      const boss = createMockBoss();
      (boss.send as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error("queue full"))
        .mockResolvedValueOnce("ok");

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // Both jobs attempted
      expect(boss.send).toHaveBeenCalledTimes(2);
      // Second job enqueued despite first failing
      expect(boss.send).toHaveBeenCalledWith(
        FUTURE_QUEUES.llmScoring,
        expect.objectContaining({ jobId: "job-2" }),
        expect.objectContaining({ singletonKey: "profile-1:job-2" }),
      );
    });

    test("singletonKey format is {userProfileId}:{jobId}", async () => {
      setupHappyPath();

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-42", descriptionHash: "hash-1", title: "Engineer", departmentRaw: "Eng", locationRaw: "Remote", workplaceType: "remote" },
      ];

      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], jobRows, []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "p1" }),
      ]);

      expect(boss.send).toHaveBeenCalledWith(
        FUTURE_QUEUES.llmScoring,
        { jobId: "job-42", userProfileId: "p1", userId: "user-1" },
        { singletonKey: "p1:job-42", startAfter: 0 },
      );
    });

    test("poll succeeds but returns zero jobs found -- no scoring enqueue", async () => {
      setupHappyPath();
      mockPollCompany.mockResolvedValue({ jobsFound: 0, jobsNew: 0 });

      const companyRow = makeCompanyRow();
      // select 1: prefs, select 2: existing (empty),
      // select 3: user profile, select 4: role families
      // No jobs query since pollSucceeded = false (jobsFound = 0)
      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()]],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      expect(boss.send).not.toHaveBeenCalled();
    });

    test("scoring enqueue failure does NOT increment stagger counter", async () => {
      setupHappyPath();

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "h1", title: "E1", departmentRaw: "Eng", locationRaw: "R", workplaceType: "remote" },
        { id: "job-2", descriptionHash: "h2", title: "E2", departmentRaw: "Eng", locationRaw: "R", workplaceType: "remote" },
      ];

      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], jobRows, []],
        [[companyRow]],
      );
      const boss = createMockBoss();
      // First job fails, second succeeds
      (boss.send as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce("ok");

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // First job: startAfter = 5 * 0 = 0 (counter is 0)
      // First job fails -> counter NOT incremented (remains 0)
      // Second job: startAfter = 5 * 0 = 0 (same slot)
      expect(boss.send).toHaveBeenNthCalledWith(
        1,
        FUTURE_QUEUES.llmScoring,
        expect.objectContaining({ jobId: "job-1" }),
        expect.objectContaining({ startAfter: 0 }),
      );
      expect(boss.send).toHaveBeenNthCalledWith(
        2,
        FUTURE_QUEUES.llmScoring,
        expect.objectContaining({ jobId: "job-2" }),
        expect.objectContaining({ startAfter: 0 }),
      );
    });
  });

  // ── Polling logic ─────────────────────────────────────────────────────

  describe("polling logic", () => {
    test("unknown-ATS company NOT polled", async () => {
      setupHappyPath();
      mockDetectAtsVendor.mockReturnValue("unknown");
      mockProbeAtsApis.mockResolvedValue({ result: null, log: [] });

      const companyRow = makeCompanyRow({ atsVendor: "unknown", atsSlug: null, isActive: false });
      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()]],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      expect(mockPollCompany).not.toHaveBeenCalled();
    });

    test("known-ATS company polled immediately after insert", async () => {
      setupHappyPath();

      const companyRow = makeCompanyRow({
        id: "company-new",
        atsVendor: "greenhouse",
        atsSlug: "newco",
        isActive: true,
      });
      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      expect(mockPollCompany).toHaveBeenCalledWith(db, companyRow);
    });

    test("poll throws -- handler logs error, increments pollErrors, continues", async () => {
      const company1 = makeDiscoveredCompany({
        name: "FailCo",
        website: "https://failco.com",
        careersUrl: "https://boards.greenhouse.io/failco",
      });
      const company2 = makeDiscoveredCompany({
        name: "OkCo",
        website: "https://okco.com",
        careersUrl: "https://boards.greenhouse.io/okco",
      });

      setupHappyPath({ discovered: [company1, company2] });
      mockNormalizeDomain
        .mockReturnValueOnce("failco.com")
        .mockReturnValueOnce("okco.com");
      mockParseGreenhouseBoardToken
        .mockReturnValueOnce("failco")
        .mockReturnValueOnce("okco");

      // First poll fails, second succeeds
      mockPollCompany
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValueOnce({ jobsFound: 3, jobsNew: 3 });

      const row1 = makeCompanyRow({ id: "c1", slug: "greenhouse-failco" });
      const row2 = makeCompanyRow({ id: "c2", slug: "greenhouse-okco" });
      // select 1: prefs, select 2: existing (empty),
      // select 3: user profile, select 4: role families,
      // (c1 poll fails -> no jobs query)
      // select 5: jobs for c2, select 6: scores for c2 (empty)
      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], [], []],
        [[row1], [row2]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // Both companies polled (second still proceeds)
      expect(mockPollCompany).toHaveBeenCalledTimes(2);
    });
  });

  // ── L2 context loading ────────────────────────────────────────────────

  describe("L2 context loading", () => {
    test("L2 context loaded once, reused for all companies", async () => {
      const company1 = makeDiscoveredCompany({
        name: "Co1",
        website: "https://co1.com",
        careersUrl: "https://boards.greenhouse.io/co1",
      });
      const company2 = makeDiscoveredCompany({
        name: "Co2",
        website: "https://co2.com",
        careersUrl: "https://boards.greenhouse.io/co2",
      });

      setupHappyPath({ discovered: [company1, company2] });
      mockNormalizeDomain
        .mockReturnValueOnce("co1.com")
        .mockReturnValueOnce("co2.com");
      mockParseGreenhouseBoardToken
        .mockReturnValueOnce("co1")
        .mockReturnValueOnce("co2");

      const row1 = makeCompanyRow({ id: "c1", slug: "greenhouse-co1" });
      const row2 = makeCompanyRow({ id: "c2", slug: "greenhouse-co2" });
      const jobs1 = [{ id: "j1", descriptionHash: "h1", title: "Eng", departmentRaw: "Eng", locationRaw: "R", workplaceType: "remote" }];
      const jobs2 = [{ id: "j2", descriptionHash: "h2", title: "PM", departmentRaw: "Product", locationRaw: "R", workplaceType: "remote" }];

      // select: prefs, existing, profile, families, jobs1, scores1, jobs2, scores2
      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], jobs1, [], jobs2, []],
        [[row1], [row2]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // classifyJobMulti called: 1 time during resolveRoleFamilies (for target title "Software Engineer")
      // + 1 time for j1 (L2 filter) + 1 time for j2 (L2 filter) = 3 total
      expect(mockClassifyJobMulti).toHaveBeenCalledTimes(3);
      // Both companies scored
      expect(boss.send).toHaveBeenCalledTimes(2);
    });

    test("no user profile found -- L2 filters use safe defaults, all jobs pass", async () => {
      setupHappyPath();

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "hash-1", title: "Engineer", departmentRaw: "Eng", locationRaw: "Remote", workplaceType: "remote" },
      ];
      // select 1: prefs, select 2: existing (empty),
      // select 3: user profile (empty -- no profile),
      // select 4: role families,
      // select 5: jobs, select 6: existing scores (empty)
      const { db } = createMockDb(
        [[makePrefsRow()], [], [], [makeRoleFamilyRow()], jobRows, []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // No profile -> targetTitles=[], matchedFamilies=[], targetSeniority=[], resolvedTiers=[]
      // All L2 filters skipped -> job passes to scoring
      expect(mockClassifyJobMulti).not.toHaveBeenCalled();
      expect(boss.send).toHaveBeenCalledTimes(1);
    });

    test("profile has locationPreferences without tiers property -- location filter skipped", async () => {
      setupHappyPath();
      const profile = makeProfileRow({
        locationPreferences: { remoteOk: true },
      });

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "hash-1", title: "Engineer", departmentRaw: "Eng", locationRaw: "Remote", workplaceType: "remote" },
      ];

      const { db } = createMockDb(
        [[makePrefsRow()], [], [profile], [makeRoleFamilyRow()], jobRows, []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // matchJobToTiers NOT called (resolvedTiers is empty since tiers is undefined)
      expect(mockMatchJobToTiers).not.toHaveBeenCalled();
      expect(boss.send).toHaveBeenCalledTimes(1);
    });

    test("profile has locationPreferences as null -- location filter skipped", async () => {
      setupHappyPath();
      const profile = makeProfileRow({ locationPreferences: null });

      const companyRow = makeCompanyRow();
      const jobRows = [
        { id: "job-1", descriptionHash: "hash-1", title: "Engineer", departmentRaw: "Eng", locationRaw: "Remote", workplaceType: "remote" },
      ];

      const { db } = createMockDb(
        [[makePrefsRow()], [], [profile], [makeRoleFamilyRow()], jobRows, []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      expect(mockMatchJobToTiers).not.toHaveBeenCalled();
      expect(boss.send).toHaveBeenCalledTimes(1);
    });
  });

  // ── Negative/Failure scenarios ────────────────────────────────────────

  describe("negative/failure scenarios", () => {
    test("discoverCompanies throws (AI service down) -- caught, handler continues", async () => {
      setupHappyPath();
      mockDiscoverCompanies.mockRejectedValue(new Error("AI service unavailable"));

      const { db } = createMockDb([[makePrefsRow()], []]);
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await expect(
        handler([
          makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
        ]),
      ).resolves.toBeUndefined();
    });

    test("probeAtsApis throws unexpectedly -- per-company catch, handler continues", async () => {
      setupHappyPath();
      mockDetectAtsVendor.mockReturnValue("unknown");
      mockProbeAtsApis.mockRejectedValue(new Error("unexpected probe failure"));

      const { db } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await expect(
        handler([
          makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
        ]),
      ).resolves.toBeUndefined();
    });

    test("discovered company with empty industry array -- insert proceeds", async () => {
      setupHappyPath({
        discovered: [makeDiscoveredCompany({ industry: [] })],
      });

      const companyRow = makeCompanyRow();
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      expect(insertCalls).toHaveLength(1);
      const insertedValues = insertCalls[0].values as Record<string, unknown>;
      expect(insertedValues.industry).toEqual([]);
    });

    test("discovered company with undefined careersUrl -- treated as null", async () => {
      setupHappyPath({
        discovered: [makeDiscoveredCompany({ careersUrl: undefined })],
      });
      // Probe finds a match
      mockProbeAtsApis.mockResolvedValue({
        result: { vendor: "greenhouse", slug: "newco", confidence: "high", matchedName: "NewCo" },
        log: [],
      });

      const companyRow = makeCompanyRow();
      const { db, insertCalls } = createMockDb(
        [[makePrefsRow()], [], [makeProfileRow()], [makeRoleFamilyRow()], []],
        [[companyRow]],
      );
      const boss = createMockBoss();

      const handler = createInternetExpansionHandler(db, boss);
      await handler([
        makeBatchJob({ userId: "user-1", userProfileId: "profile-1" }),
      ]);

      // URL detection skipped, probe ran instead
      expect(mockDetectAtsVendor).not.toHaveBeenCalled();
      expect(mockProbeAtsApis).toHaveBeenCalled();
      expect(insertCalls).toHaveLength(1);
    });
  });
});
