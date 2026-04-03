import { registerHandlers } from "./index";

// ─── Module mocks ──────────────────────────────────────────────────────────

const mockPollHandler = vi.fn();
const mockScoringHandler = vi.fn();

vi.mock("./poll-company", () => ({
  createPollCompanyHandler: vi.fn(() => mockPollHandler),
}));

vi.mock("./llm-scoring", () => ({
  createLlmScoringHandler: vi.fn(() => mockScoringHandler),
}));

vi.mock("./stubs", () => ({
  handleInternetExpansion: vi.fn(),
  handleDescriptionFetch: vi.fn(),
  handleRoleTaxonomy: vi.fn(),
}));

vi.mock("../lib/app-config", () => ({
  getAppConfigValue: vi.fn().mockResolvedValue(5),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────

import { createPollCompanyHandler } from "./poll-company";
import { createLlmScoringHandler } from "./llm-scoring";
import {
  handleInternetExpansion,
  handleDescriptionFetch,
  handleRoleTaxonomy,
} from "./stubs";
import { getAppConfigValue } from "../lib/app-config";
import { VENDOR_QUEUES, FUTURE_QUEUES } from "@gjs/ingestion";

// ─── Helpers ───────────────────────────────────────────────────────────────

function createMockBoss() {
  return {
    createQueue: vi.fn().mockResolvedValue(undefined),
    work: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof registerHandlers>[0];
}

function createMockDb() {
  return {} as Parameters<typeof registerHandlers>[1];
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("registerHandlers(boss, db)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    // Re-set mock return values after clearAllMocks
    (createPollCompanyHandler as ReturnType<typeof vi.fn>).mockReturnValue(mockPollHandler);
    (createLlmScoringHandler as ReturnType<typeof vi.fn>).mockReturnValue(mockScoringHandler);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Critical ──────────────────────────────────────────────────────────

  test("creates all 8 queues (4 vendor + 4 future)", async () => {
    const boss = createMockBoss();
    const db = createMockDb();

    await registerHandlers(boss, db);

    const createQueueCalls = (boss.createQueue as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0] as string
    );

    const expectedQueues = [
      ...Object.values(VENDOR_QUEUES),
      ...Object.values(FUTURE_QUEUES),
    ];

    expect(createQueueCalls).toHaveLength(8);
    for (const queue of expectedQueues) {
      expect(createQueueCalls).toContain(queue);
    }
  });

  test("registers vendor queues with localConcurrency: 5", async () => {
    const boss = createMockBoss();
    const db = createMockDb();

    await registerHandlers(boss, db);

    const workCalls = (boss.work as ReturnType<typeof vi.fn>).mock.calls;

    for (const vendorQueue of Object.values(VENDOR_QUEUES)) {
      const call = workCalls.find(
        (c: unknown[]) => c[0] === vendorQueue
      );
      expect(call).toBeDefined();
      // Vendor queue calls: boss.work(queueName, { localConcurrency: 5 }, handler)
      expect(call![1]).toEqual({ localConcurrency: 5 });
    }
  });

  test("registers LLM scoring queue with localConcurrency: 3", async () => {
    const boss = createMockBoss();
    const db = createMockDb();

    await registerHandlers(boss, db);

    const workCalls = (boss.work as ReturnType<typeof vi.fn>).mock.calls;

    const scoringCall = workCalls.find(
      (c: unknown[]) => c[0] === FUTURE_QUEUES.llmScoring
    );
    expect(scoringCall).toBeDefined();
    // Scoring call: boss.work(queueName, { localConcurrency: 3 }, handler)
    expect(scoringCall![1]).toEqual({ localConcurrency: 3 });
    expect(scoringCall![2]).toBe(mockScoringHandler);
  });

  test("registers remaining 3 future queues with their stub handlers", async () => {
    const boss = createMockBoss();
    const db = createMockDb();

    await registerHandlers(boss, db);

    const workCalls = (boss.work as ReturnType<typeof vi.fn>).mock.calls;

    // Remaining stub queue calls: boss.work(queueName, handler) -- no options object
    const stubMapping: [string, unknown][] = [
      [FUTURE_QUEUES.internetExpansion, handleInternetExpansion],
      [FUTURE_QUEUES.descriptionFetch, handleDescriptionFetch],
      [FUTURE_QUEUES.roleTaxonomy, handleRoleTaxonomy],
    ];

    for (const [queueName, expectedHandler] of stubMapping) {
      const call = workCalls.find(
        (c: unknown[]) => c[0] === queueName
      );
      expect(call).toBeDefined();
      // For stub queues, the handler is the second argument (no options)
      expect(call![1]).toBe(expectedHandler);
    }
  });

  // ── Important ─────────────────────────────────────────────────────────

  test("queue creation failure propagates and prevents handler registration", async () => {
    const boss = createMockBoss();
    const db = createMockDb();

    let callCount = 0;
    (boss.createQueue as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 3) {
        return Promise.reject(new Error("queue creation failed"));
      }
      return Promise.resolve(undefined);
    });

    await expect(registerHandlers(boss, db)).rejects.toThrow("queue creation failed");

    // No work handlers should have been registered since queue creation
    // failed before the loop completed
    expect(boss.work).not.toHaveBeenCalled();
  });

  test("createPollCompanyHandler is called once with db, and all vendor queues share the same handler", async () => {
    const boss = createMockBoss();
    const db = createMockDb();

    await registerHandlers(boss, db);

    // Factory called exactly once
    expect(createPollCompanyHandler).toHaveBeenCalledOnce();
    expect(createPollCompanyHandler).toHaveBeenCalledWith(db);

    // All 4 vendor queues get the same handler reference
    const workCalls = (boss.work as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const vendorHandlers = Object.values(VENDOR_QUEUES).map((queueName) => {
      const call = workCalls.find(
        (c) => c[0] === queueName
      );
      // vendor calls: boss.work(queue, opts, handler) -- handler is 3rd arg
      return call![2] as unknown;
    });

    // All handler references should be the same object
    const uniqueHandlers = new Set(vendorHandlers);
    expect(uniqueHandlers.size).toBe(1);
    expect(vendorHandlers[0]).toBe(mockPollHandler);
  });

  test("createLlmScoringHandler is called once with db", async () => {
    const boss = createMockBoss();
    const db = createMockDb();

    await registerHandlers(boss, db);

    expect(createLlmScoringHandler).toHaveBeenCalledOnce();
    expect(createLlmScoringHandler).toHaveBeenCalledWith(db);
  });

  // ── Config wiring scenarios ──────────────────────────────────────────────

  describe("vendor concurrency config", () => {
    const mockGetAppConfigValue = getAppConfigValue as ReturnType<typeof vi.fn>;

    test("custom vendor concurrency from config is used for all vendor queues", async () => {
      mockGetAppConfigValue.mockResolvedValue(8);
      const boss = createMockBoss();
      const db = createMockDb();

      await registerHandlers(boss, db);

      const workCalls = (boss.work as ReturnType<typeof vi.fn>).mock.calls;
      for (const vendorQueue of Object.values(VENDOR_QUEUES)) {
        const call = workCalls.find(
          (c: unknown[]) => c[0] === vendorQueue,
        );
        expect(call).toBeDefined();
        expect(call![1]).toEqual({ localConcurrency: 8 });
      }
    });

    test("vendor concurrency clamped to minimum 1", async () => {
      mockGetAppConfigValue.mockResolvedValue(0);
      const boss = createMockBoss();
      const db = createMockDb();

      await registerHandlers(boss, db);

      const workCalls = (boss.work as ReturnType<typeof vi.fn>).mock.calls;
      for (const vendorQueue of Object.values(VENDOR_QUEUES)) {
        const call = workCalls.find(
          (c: unknown[]) => c[0] === vendorQueue,
        );
        expect(call).toBeDefined();
        expect(call![1]).toEqual({ localConcurrency: 1 });
      }
    });

    test("fractional concurrency value is floored", async () => {
      mockGetAppConfigValue.mockResolvedValue(3.7);
      const boss = createMockBoss();
      const db = createMockDb();

      await registerHandlers(boss, db);

      const workCalls = (boss.work as ReturnType<typeof vi.fn>).mock.calls;
      for (const vendorQueue of Object.values(VENDOR_QUEUES)) {
        const call = workCalls.find(
          (c: unknown[]) => c[0] === vendorQueue,
        );
        expect(call).toBeDefined();
        expect(call![1]).toEqual({ localConcurrency: 3 });
      }
    });

    test("getAppConfigValue rejects: error propagates, no handlers registered", async () => {
      mockGetAppConfigValue.mockRejectedValue(new Error("DB unavailable"));
      const boss = createMockBoss();
      const db = createMockDb();

      await expect(registerHandlers(boss, db)).rejects.toThrow("DB unavailable");

      // boss.work is called for queue creation but the vendor work registrations
      // happen after config read. The config read is between createQueue and work,
      // but createQueue calls still happen.
      // Vendor queue work() calls should NOT have happened.
      const workCalls = (boss.work as ReturnType<typeof vi.fn>).mock.calls;
      const vendorQueueNames: string[] = Object.values(VENDOR_QUEUES);
      const vendorWorkCalls = workCalls.filter((c: unknown[]) =>
        vendorQueueNames.includes(c[0] as string),
      );
      expect(vendorWorkCalls).toHaveLength(0);
    });

    test("scoring concurrency is NOT affected by vendor config", async () => {
      mockGetAppConfigValue.mockResolvedValue(10);
      const boss = createMockBoss();
      const db = createMockDb();

      await registerHandlers(boss, db);

      const workCalls = (boss.work as ReturnType<typeof vi.fn>).mock.calls;
      const scoringCall = workCalls.find(
        (c: unknown[]) => c[0] === FUTURE_QUEUES.llmScoring,
      );
      expect(scoringCall).toBeDefined();
      // Scoring queue should still use hardcoded concurrency of 3
      expect(scoringCall![1]).toEqual({ localConcurrency: 3 });
    });

    // ── NaN propagation defect ─────────────────────────────────────────────

    test("non-numeric string for vendor_concurrency: NaN propagates to boss.work()", async () => {
      // BUG: Math.max(1, Math.floor("high")) returns NaN, not 1.
      // Math.floor("high") = NaN, and Math.max(1, NaN) = NaN.
      // The clamping chain does NOT protect against non-numeric strings.
      // TODO: Add Number() coercion or typeof check before the clamp.
      mockGetAppConfigValue.mockResolvedValue("high");
      const boss = createMockBoss();
      const db = createMockDb();

      await registerHandlers(boss, db);

      const workCalls = (boss.work as ReturnType<typeof vi.fn>).mock.calls;
      for (const vendorQueue of Object.values(VENDOR_QUEUES)) {
        const call = workCalls.find(
          (c: unknown[]) => c[0] === vendorQueue,
        );
        expect(call).toBeDefined();
        // NaN is passed to pg-boss, not 1 as the clamp intends
        expect(call![1]).toEqual({ localConcurrency: NaN });
      }
    });
  });
});
