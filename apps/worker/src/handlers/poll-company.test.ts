import type { Job } from "pg-boss";

// ─── Module mocks ──────────────────────────────────────────────────────────

// Mock @gjs/logger at the top so the module under test binds to the mock.
// Hoist the shared mockLog so tests keep a stable reference even across
// `vi.clearAllMocks()` calls in beforeEach (which clears `mock.results`).
const { mockLog } = vi.hoisted(() => ({
  mockLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    child: vi.fn(function (this: unknown) {
      return this;
    }),
    flush: vi.fn((cb?: () => void) => cb?.()),
    level: "info",
  },
}));

vi.mock("@gjs/logger", () => ({
  createLogger: vi.fn(() => mockLog),
}));

import { createPollCompanyHandler } from "./poll-company";

vi.mock("@gjs/ingestion", () => ({
  pollCompany: vi.fn(),
  computeNextPoll: vi.fn(),
}));

vi.mock("../lib/jitter", () => ({
  jitter: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/app-config", () => ({
  getAppConfigValue: vi.fn().mockImplementation(
    (_db: unknown, _key: string, defaultValue: unknown) =>
      Promise.resolve(defaultValue),
  ),
}));

// Use a stable token for drizzle-orm `eq` so we can inspect calls
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _eq: val })),
}));

vi.mock("@gjs/db/schema", () => ({
  companies: {
    id: Symbol("companies.id"),
    // schema token used by `db.update(companies)`
  },
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────

import { pollCompany, computeNextPoll } from "@gjs/ingestion";
import { jitter } from "../lib/jitter";
import { getAppConfigValue } from "../lib/app-config";
import type { PollResult, AdaptivePollOutput } from "@gjs/ingestion";

// ─── Helpers ───────────────────────────────────────────────────────────────

const FIXED_NOW = new Date("2025-06-15T12:00:00Z");

function makeJob(companyId: string, id?: string): Job<{ companyId: string }> {
  return {
    id: id ?? `job-${companyId}`,
    name: "poll/greenhouse",
    data: { companyId },
  } as Job<{ companyId: string }>;
}

function makeCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: "company-1",
    slug: "acme-co",
    name: "Acme Co",
    website: "https://acme.co",
    industry: null,
    atsVendor: "greenhouse",
    atsSlug: "acme",
    atsCareersUrl: "https://boards.greenhouse.io/acme",
    source: "seed_list",
    isActive: true,
    lastPolledAt: new Date("2025-06-14T12:00:00Z"),
    lastPollStatus: "ok",
    lastPollError: null,
    consecutiveErrors: 0,
    pollPriority: "daily",
    nextPollAfter: new Date("2025-06-15T12:00:00Z"),
    lastChangedAt: null,
    jobsCount: 42,
    createdAt: new Date("2025-01-01T12:00:00Z"),
    updatedAt: new Date("2025-06-14T12:00:00Z"),
    ...overrides,
  };
}

function makePollResult(overrides: Partial<PollResult> = {}): PollResult {
  return {
    status: "ok",
    jobsFound: 10,
    jobsNew: 2,
    jobsClosed: 1,
    jobsUpdated: 0,
    durationMs: 500,
    ...overrides,
  };
}

function makeAdaptiveOutput(
  overrides: Partial<AdaptivePollOutput> = {}
): AdaptivePollOutput {
  return {
    nextPollAfter: new Date("2025-06-16T12:00:00Z"),
    pollPriority: "daily",
    consecutiveErrors: 0,
    ...overrides,
  };
}

/**
 * Build a chainable mock for `db.select().from().where().limit()` and
 * `db.update().set().where()`.
 *
 * selectResult: what the select query returns (array of company rows).
 * setCalls: collects arguments passed to `.set()` for assertions.
 * updateWhereCalls: collects arguments passed to the update's `.where()`.
 */
function createMockDb(
  selectResult: unknown[],
  setCalls: Record<string, unknown>[] = [],
  updateWhereCalls: unknown[] = []
) {
  const mockWhere = vi.fn().mockResolvedValue(undefined);
  const mockSet = vi.fn().mockImplementation((data: Record<string, unknown>) => {
    setCalls.push(data);
    return {
      where: vi.fn().mockImplementation((clause: unknown) => {
        updateWhereCalls.push(clause);
        return Promise.resolve(undefined);
      }),
    };
  });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
  const mockLimit = vi.fn().mockResolvedValue(selectResult);
  const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  return {
    db: {
      select: mockSelect,
      update: mockUpdate,
    } as unknown as Parameters<typeof createPollCompanyHandler>[0],
    mocks: { mockSelect, mockFrom, mockSelectWhere, mockLimit, mockUpdate, mockSet, mockWhere },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("createPollCompanyHandler(db)", () => {
  const mockPollCompany = pollCompany as ReturnType<typeof vi.fn>;
  const mockComputeNextPoll = computeNextPoll as ReturnType<typeof vi.fn>;
  const mockJitter = jitter as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    // Re-set the default mock after clearAllMocks resets it
    mockJitter.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── Critical ────────────────────────────────────────────────────────────

  test("happy path: successful poll updates adaptive fields", async () => {
    const company = makeCompany();
    const pollResult = makePollResult();
    const adaptiveOutput = makeAdaptiveOutput();
    const setCalls: Record<string, unknown>[] = [];

    const { db } = createMockDb([company], setCalls);
    mockPollCompany.mockResolvedValue(pollResult);
    mockComputeNextPoll.mockReturnValue(adaptiveOutput);

    const handler = createPollCompanyHandler(db);
    await handler([makeJob("company-1")]);

    // pollCompany called with db, company, and threshold options
    expect(mockPollCompany).toHaveBeenCalledWith(db, company, {
      staleThresholdDays: 7,
      closedThresholdDays: 30,
    });

    // computeNextPoll called with correct AdaptivePollInput shape
    expect(mockComputeNextPoll).toHaveBeenCalledWith({
      lastPollStatus: "ok",
      consecutiveErrors: 0,
      lastPolledAt: company.lastPolledAt,
      createdAt: company.createdAt,
      lastChangedAt: company.lastChangedAt,
      jobsNew: 2,
      jobsClosed: 1,
    });

    // DB update called with adaptive fields + lastChangedAt (since poll had changes)
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toEqual(
      expect.objectContaining({
        nextPollAfter: adaptiveOutput.nextPollAfter,
        pollPriority: "daily",
        consecutiveErrors: 0,
        lastChangedAt: FIXED_NOW,
      })
    );
  });

  test("company not found: skips without error, does not poll", async () => {
    const { db } = createMockDb([]); // empty result = company not found
    const handler = createPollCompanyHandler(db);

    await expect(handler([makeJob("nonexistent-uuid")])).resolves.toBeUndefined();

    expect(mockPollCompany).not.toHaveBeenCalled();
    expect(mockComputeNextPoll).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  test("inactive company: skips without error, does not poll", async () => {
    const company = makeCompany({ isActive: false });
    const { db } = createMockDb([company]);
    const handler = createPollCompanyHandler(db);

    await expect(handler([makeJob("company-1")])).resolves.toBeUndefined();

    expect(mockPollCompany).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  test("pollCompany throws: error propagates, no DB update", async () => {
    const company = makeCompany();
    const { db } = createMockDb([company]);
    mockPollCompany.mockRejectedValue(new Error("ATS API timeout"));

    const handler = createPollCompanyHandler(db);

    await expect(handler([makeJob("company-1")])).rejects.toThrow("ATS API timeout");

    expect(mockComputeNextPoll).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  // ── Important ───────────────────────────────────────────────────────────

  test("multiple jobs in batch: each is processed sequentially", async () => {
    const companies = [
      makeCompany({ id: "c1", slug: "company-1" }),
      makeCompany({ id: "c2", slug: "company-2" }),
      makeCompany({ id: "c3", slug: "company-3" }),
    ];
    const setCalls: Record<string, unknown>[] = [];

    // Each select returns the matching company
    const mockLimit = vi.fn()
      .mockResolvedValueOnce([companies[0]])
      .mockResolvedValueOnce([companies[1]])
      .mockResolvedValueOnce([companies[2]]);
    const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    const mockSet = vi.fn().mockImplementation((data: Record<string, unknown>) => {
      setCalls.push(data);
      return { where: vi.fn().mockResolvedValue(undefined) };
    });
    const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

    const db = { select: mockSelect, update: mockUpdate } as unknown as
      Parameters<typeof createPollCompanyHandler>[0];

    const pollResult = makePollResult();
    const adaptiveOutput = makeAdaptiveOutput();
    mockPollCompany.mockResolvedValue(pollResult);
    mockComputeNextPoll.mockReturnValue(adaptiveOutput);

    const handler = createPollCompanyHandler(db);
    await handler([makeJob("c1"), makeJob("c2"), makeJob("c3")]);

    expect(mockPollCompany).toHaveBeenCalledTimes(3);
    expect(setCalls).toHaveLength(3);

    // Each call used the correct company
    const expectedOpts = { staleThresholdDays: 7, closedThresholdDays: 30 };
    expect(mockPollCompany).toHaveBeenNthCalledWith(1, db, companies[0], expectedOpts);
    expect(mockPollCompany).toHaveBeenNthCalledWith(2, db, companies[1], expectedOpts);
    expect(mockPollCompany).toHaveBeenNthCalledWith(3, db, companies[2], expectedOpts);
  });

  test("computeNextPoll receives correct input shape from company and poll result", async () => {
    const company = makeCompany({
      consecutiveErrors: 2,
      lastPolledAt: new Date("2025-06-14T08:00:00Z"),
      createdAt: new Date("2025-03-01T12:00:00Z"),
    });
    const pollResult = makePollResult({
      status: "error",
      jobsNew: 0,
      jobsClosed: 0,
    });
    const adaptiveOutput = makeAdaptiveOutput({ consecutiveErrors: 3 });

    const { db } = createMockDb([company]);
    mockPollCompany.mockResolvedValue(pollResult);
    mockComputeNextPoll.mockReturnValue(adaptiveOutput);

    const handler = createPollCompanyHandler(db);
    await handler([makeJob("company-1")]);

    expect(mockComputeNextPoll).toHaveBeenCalledWith({
      lastPollStatus: "error",
      consecutiveErrors: 2,
      lastPolledAt: new Date("2025-06-14T08:00:00Z"),
      createdAt: new Date("2025-03-01T12:00:00Z"),
      lastChangedAt: null,
      jobsNew: 0,
      jobsClosed: 0,
    });
  });

  test("jitter is called before pollCompany", async () => {
    const company = makeCompany();
    const { db } = createMockDb([company]);

    const callOrder: string[] = [];
    mockJitter.mockImplementation(() => {
      callOrder.push("jitter");
      return Promise.resolve(undefined);
    });
    mockPollCompany.mockImplementation(() => {
      callOrder.push("pollCompany");
      return Promise.resolve(makePollResult());
    });
    mockComputeNextPoll.mockReturnValue(makeAdaptiveOutput());

    const handler = createPollCompanyHandler(db);
    await handler([makeJob("company-1")]);

    expect(mockJitter).toHaveBeenCalledWith(5000);
    expect(callOrder).toEqual(["jitter", "pollCompany"]);
  });

  test("DB update includes updatedAt as a Date instance", async () => {
    const company = makeCompany();
    const setCalls: Record<string, unknown>[] = [];

    const { db } = createMockDb([company], setCalls);
    mockPollCompany.mockResolvedValue(makePollResult());
    mockComputeNextPoll.mockReturnValue(makeAdaptiveOutput());

    const handler = createPollCompanyHandler(db);
    await handler([makeJob("company-1")]);

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]!.updatedAt).toBeInstanceOf(Date);
    // With vi.setSystemTime, new Date() returns FIXED_NOW
    expect(setCalls[0]!.updatedAt).toEqual(FIXED_NOW);
  });

  // ── Batch with mixed outcomes (continue, not return) ──────────────────

  test("batch with not-found company: skipped job does not prevent processing of subsequent jobs", async () => {
    // This tests the CORRECT behavior: `continue` skips the current job
    // and proceeds to process the remaining jobs in the batch.
    const company3 = makeCompany({ id: "c3", slug: "company-3" });

    const mockLimit = vi.fn()
      .mockResolvedValueOnce([]) // c1: not found
      .mockResolvedValueOnce([company3]); // c3: found
    const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    const setCalls: Record<string, unknown>[] = [];
    const mockSet = vi.fn().mockImplementation((data: Record<string, unknown>) => {
      setCalls.push(data);
      return { where: vi.fn().mockResolvedValue(undefined) };
    });
    const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

    const db = { select: mockSelect, update: mockUpdate } as unknown as
      Parameters<typeof createPollCompanyHandler>[0];

    mockPollCompany.mockResolvedValue(makePollResult());
    mockComputeNextPoll.mockReturnValue(makeAdaptiveOutput());

    const handler = createPollCompanyHandler(db);
    await handler([makeJob("c1"), makeJob("c3")]);

    // pollCompany should be called once (only for c3)
    expect(mockPollCompany).toHaveBeenCalledTimes(1);
    expect(mockPollCompany).toHaveBeenCalledWith(db, company3, {
      staleThresholdDays: 7,
      closedThresholdDays: 30,
    });
    expect(setCalls).toHaveLength(1);
  });

  test("batch with inactive company: skipped job does not prevent processing of subsequent jobs", async () => {
    const inactiveCompany = makeCompany({ id: "c1", slug: "inactive", isActive: false });
    const activeCompany = makeCompany({ id: "c2", slug: "active" });

    const mockLimit = vi.fn()
      .mockResolvedValueOnce([inactiveCompany])
      .mockResolvedValueOnce([activeCompany]);
    const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    const setCalls: Record<string, unknown>[] = [];
    const mockSet = vi.fn().mockImplementation((data: Record<string, unknown>) => {
      setCalls.push(data);
      return { where: vi.fn().mockResolvedValue(undefined) };
    });
    const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

    const db = { select: mockSelect, update: mockUpdate } as unknown as
      Parameters<typeof createPollCompanyHandler>[0];

    mockPollCompany.mockResolvedValue(makePollResult());
    mockComputeNextPoll.mockReturnValue(makeAdaptiveOutput());

    const handler = createPollCompanyHandler(db);
    await handler([makeJob("c1"), makeJob("c2")]);

    expect(mockPollCompany).toHaveBeenCalledTimes(1);
    expect(mockPollCompany).toHaveBeenCalledWith(db, activeCompany, {
      staleThresholdDays: 7,
      closedThresholdDays: 30,
    });
  });

  // ── Nice-to-have ───────────────────────────────────────────────────────

  test("empty jobs array: resolves immediately with no side effects", async () => {
    const { db } = createMockDb([]);
    const handler = createPollCompanyHandler(db);

    await expect(handler([])).resolves.toBeUndefined();

    expect(db.select).not.toHaveBeenCalled();
    expect(mockPollCompany).not.toHaveBeenCalled();
  });

  // ── Negative/Failure Scenarios ────────────────────────────────────────

  test("DB select rejects: error propagates to pg-boss", async () => {
    const mockLimit = vi.fn().mockRejectedValue(new Error("connection refused"));
    const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    const mockUpdate = vi.fn();

    const db = { select: mockSelect, update: mockUpdate } as unknown as
      Parameters<typeof createPollCompanyHandler>[0];

    const handler = createPollCompanyHandler(db);

    await expect(handler([makeJob("company-1")])).rejects.toThrow("connection refused");

    expect(mockPollCompany).not.toHaveBeenCalled();
  });

  test("DB update rejects after successful poll: error is caught, job succeeds", async () => {
    // The adaptive update is wrapped in try-catch so that a failure here
    // does not cause pg-boss to retry the job (which would re-poll).
    const company = makeCompany();
    const pollResult = makePollResult();
    const adaptiveOutput = makeAdaptiveOutput();

    const mockSet = vi.fn().mockReturnValue({
      where: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
    const mockLimit = vi.fn().mockResolvedValue([company]);
    const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

    const db = { select: mockSelect, update: mockUpdate } as unknown as
      Parameters<typeof createPollCompanyHandler>[0];

    mockPollCompany.mockResolvedValue(pollResult);
    mockComputeNextPoll.mockReturnValue(adaptiveOutput);

    const handler = createPollCompanyHandler(db);

    // Should resolve (not reject) -- the error is caught and logged
    await expect(handler([makeJob("company-1")])).resolves.toBeUndefined();

    // pollCompany was still called (the poll itself succeeded)
    expect(mockPollCompany).toHaveBeenCalledOnce();
    // The error was logged with structured fields and the adaptive-update
    // failure message. Preserving this assertion confirms the update error
    // was swallowed (caught + logged, not re-thrown).
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: company.slug,
        companyId: "company-1",
        err: expect.any(Error) as unknown,
      }),
      expect.stringContaining("Failed to update adaptive poll fields"),
    );
  });

  test("job data with undefined companyId: falls into company-not-found branch", async () => {
    const { db } = createMockDb([]); // no company found for undefined
    const handler = createPollCompanyHandler(db);

    // Simulate a malformed job payload
    const malformedJob = {
      id: "job-bad",
      name: "poll/greenhouse",
      data: {},
    } as Job<{ companyId: string }>;

    await expect(handler([malformedJob])).resolves.toBeUndefined();

    expect(mockPollCompany).not.toHaveBeenCalled();
  });

  // ── Config wiring scenarios ──────────────────────────────────────────────

  describe("config wiring", () => {
    const mockGetAppConfigValue = getAppConfigValue as ReturnType<typeof vi.fn>;

    test("custom config values are passed through to jitter() and pollCompany()", async () => {
      mockGetAppConfigValue.mockImplementation(
        (_db: unknown, key: string) => {
          const configMap: Record<string, unknown> = {
            "polling.jitter_max_ms": 3000,
            "polling.stale_threshold_days": 5,
            "polling.closed_threshold_days": 20,
          };
          return Promise.resolve(configMap[key]);
        },
      );

      const company = makeCompany();
      const { db } = createMockDb([company]);
      mockPollCompany.mockResolvedValue(makePollResult());
      mockComputeNextPoll.mockReturnValue(makeAdaptiveOutput());

      const handler = createPollCompanyHandler(db);
      await handler([makeJob("company-1")]);

      expect(mockJitter).toHaveBeenCalledWith(3000);
      expect(mockPollCompany).toHaveBeenCalledWith(db, company, {
        staleThresholdDays: 5,
        closedThresholdDays: 20,
      });
    });

    test("config values are loaded once per batch, not per job", async () => {
      const companies = [
        makeCompany({ id: "c1", slug: "co-1" }),
        makeCompany({ id: "c2", slug: "co-2" }),
        makeCompany({ id: "c3", slug: "co-3" }),
      ];

      const mockLimit = vi.fn()
        .mockResolvedValueOnce([companies[0]])
        .mockResolvedValueOnce([companies[1]])
        .mockResolvedValueOnce([companies[2]]);
      const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
      const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
      const mockSet = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

      const db = { select: mockSelect, update: mockUpdate } as unknown as
        Parameters<typeof createPollCompanyHandler>[0];

      mockPollCompany.mockResolvedValue(makePollResult());
      mockComputeNextPoll.mockReturnValue(makeAdaptiveOutput());

      const handler = createPollCompanyHandler(db);
      await handler([makeJob("c1"), makeJob("c2"), makeJob("c3")]);

      // 3 config keys read once per batch = 3 calls total, NOT 9 (3 x 3)
      expect(mockGetAppConfigValue).toHaveBeenCalledTimes(3);
      expect(mockPollCompany).toHaveBeenCalledTimes(3);
    });

    test("negative jitter value is clamped to 0", async () => {
      mockGetAppConfigValue.mockImplementation(
        (_db: unknown, key: string, defaultValue: unknown) => {
          if (key === "polling.jitter_max_ms") return Promise.resolve(-100);
          return Promise.resolve(defaultValue);
        },
      );

      const company = makeCompany();
      const { db } = createMockDb([company]);
      mockPollCompany.mockResolvedValue(makePollResult());
      mockComputeNextPoll.mockReturnValue(makeAdaptiveOutput());

      const handler = createPollCompanyHandler(db);
      await handler([makeJob("company-1")]);

      // Math.max(0, -100) = 0
      expect(mockJitter).toHaveBeenCalledWith(0);
    });

    test("stale threshold is clamped to minimum 1", async () => {
      mockGetAppConfigValue.mockImplementation(
        (_db: unknown, key: string, defaultValue: unknown) => {
          if (key === "polling.stale_threshold_days") return Promise.resolve(0);
          return Promise.resolve(defaultValue);
        },
      );

      const company = makeCompany();
      const { db } = createMockDb([company]);
      mockPollCompany.mockResolvedValue(makePollResult());
      mockComputeNextPoll.mockReturnValue(makeAdaptiveOutput());

      const handler = createPollCompanyHandler(db);
      await handler([makeJob("company-1")]);

      expect(mockPollCompany).toHaveBeenCalledWith(db, company, {
        staleThresholdDays: 1,
        closedThresholdDays: 30,
      });
    });

    test("closed threshold is clamped to minimum 1", async () => {
      mockGetAppConfigValue.mockImplementation(
        (_db: unknown, key: string, defaultValue: unknown) => {
          if (key === "polling.closed_threshold_days") return Promise.resolve(0);
          return Promise.resolve(defaultValue);
        },
      );

      const company = makeCompany();
      const { db } = createMockDb([company]);
      mockPollCompany.mockResolvedValue(makePollResult());
      mockComputeNextPoll.mockReturnValue(makeAdaptiveOutput());

      const handler = createPollCompanyHandler(db);
      await handler([makeJob("company-1")]);

      expect(mockPollCompany).toHaveBeenCalledWith(db, company, {
        staleThresholdDays: 7,
        closedThresholdDays: 1,
      });
    });

    test("empty jobs array: config values are still loaded", async () => {
      const { db } = createMockDb([]);
      const handler = createPollCompanyHandler(db);

      await expect(handler([])).resolves.toBeUndefined();

      // getAppConfigValue is called 3 times even for empty batch
      // (the reads happen before the for loop)
      expect(mockGetAppConfigValue).toHaveBeenCalledTimes(3);
      expect(mockPollCompany).not.toHaveBeenCalled();
    });

    test("getAppConfigValue rejects during batch: handler rejects", async () => {
      mockGetAppConfigValue.mockRejectedValue(new Error("DB unavailable"));

      const { db } = createMockDb([]);
      const handler = createPollCompanyHandler(db);

      await expect(handler([makeJob("company-1")])).rejects.toThrow(
        "DB unavailable",
      );

      expect(mockPollCompany).not.toHaveBeenCalled();
    });

    // ── NaN propagation defect scenarios ───────────────────────────────────

    test("non-numeric string for jitter_max_ms: falls back to default 5000", async () => {
      // Number("fast") = NaN, so the coercion guard falls back to the
      // hardcoded default of 5000 ms.
      mockGetAppConfigValue.mockImplementation(
        (_db: unknown, key: string, defaultValue: unknown) => {
          if (key === "polling.jitter_max_ms") return Promise.resolve("fast");
          return Promise.resolve(defaultValue);
        },
      );

      const company = makeCompany();
      const { db } = createMockDb([company]);
      mockPollCompany.mockResolvedValue(makePollResult());
      mockComputeNextPoll.mockReturnValue(makeAdaptiveOutput());

      const handler = createPollCompanyHandler(db);
      await handler([makeJob("company-1")]);

      expect(mockJitter).toHaveBeenCalledWith(5000);
    });

    test("non-numeric string for threshold values: falls back to defaults", async () => {
      // Number("long") = NaN, so the coercion guard falls back to the
      // hardcoded defaults: stale=7, closed=30.
      mockGetAppConfigValue.mockImplementation(
        (_db: unknown, key: string, defaultValue: unknown) => {
          const overrides: Record<string, unknown> = {
            "polling.stale_threshold_days": "long",
            "polling.closed_threshold_days": "very-long",
          };
          if (key in overrides) return Promise.resolve(overrides[key]);
          return Promise.resolve(defaultValue);
        },
      );

      const company = makeCompany();
      const { db } = createMockDb([company]);
      mockPollCompany.mockResolvedValue(makePollResult());
      mockComputeNextPoll.mockReturnValue(makeAdaptiveOutput());

      const handler = createPollCompanyHandler(db);
      await handler([makeJob("company-1")]);

      expect(mockPollCompany).toHaveBeenCalledWith(db, company, {
        staleThresholdDays: 7,
        closedThresholdDays: 30,
      });
    });
  });
});
