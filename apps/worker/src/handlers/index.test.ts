import { registerHandlers } from "./index";

// ─── Module mocks ──────────────────────────────────────────────────────────

const mockPollHandler = vi.fn();

vi.mock("./poll-company", () => ({
  createPollCompanyHandler: vi.fn(() => mockPollHandler),
}));

vi.mock("./stubs", () => ({
  handleLlmScoring: vi.fn(),
  handleInternetExpansion: vi.fn(),
  handleDescriptionFetch: vi.fn(),
  handleRoleTaxonomy: vi.fn(),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────

import { createPollCompanyHandler } from "./poll-company";
import {
  handleLlmScoring,
  handleInternetExpansion,
  handleDescriptionFetch,
  handleRoleTaxonomy,
} from "./stubs";
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
    // Re-set mock return value after clearAllMocks
    (createPollCompanyHandler as ReturnType<typeof vi.fn>).mockReturnValue(mockPollHandler);
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

  test("registers all 4 future queues with their stub handlers", async () => {
    const boss = createMockBoss();
    const db = createMockDb();

    await registerHandlers(boss, db);

    const workCalls = (boss.work as ReturnType<typeof vi.fn>).mock.calls;

    // Future queue calls: boss.work(queueName, handler) -- no options object
    const futureMapping: [string, unknown][] = [
      [FUTURE_QUEUES.llmScoring, handleLlmScoring],
      [FUTURE_QUEUES.internetExpansion, handleInternetExpansion],
      [FUTURE_QUEUES.descriptionFetch, handleDescriptionFetch],
      [FUTURE_QUEUES.roleTaxonomy, handleRoleTaxonomy],
    ];

    for (const [queueName, expectedHandler] of futureMapping) {
      const call = workCalls.find(
        (c: unknown[]) => c[0] === queueName
      );
      expect(call).toBeDefined();
      // For future queues, the handler is the second argument (no options)
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
});
