// ---- Mocks ----------------------------------------------------------------

const mockStart = vi.fn().mockResolvedValue(undefined);

// Track instances created by the PgBoss mock constructor
const mockInstances: Array<{ start: typeof mockStart; _connectionString: string }> = [];

vi.mock("pg-boss", () => {
  return {
    PgBoss: vi.fn().mockImplementation(function (this: Record<string, unknown>, connStr: string) {
      this.start = mockStart;
      this._connectionString = connStr;
      mockInstances.push(this as unknown as (typeof mockInstances)[0]);
      return this;
    }),
  };
});

import { PgBoss } from "pg-boss";

const PgBossCtor = PgBoss as unknown as ReturnType<typeof vi.fn>;

// ---- Helpers ---------------------------------------------------------------

/**
 * Each test must dynamically import queue.ts after resetting modules,
 * because the singleton is stored in module-level state (_bossPromise).
 */
async function importGetQueue() {
  const mod = await import("./queue");
  return mod.getQueue;
}

// ---- Setup -----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
  mockStart.mockResolvedValue(undefined);
  mockInstances.length = 0;
});

// ---- Tests -----------------------------------------------------------------

describe("getQueue()", () => {
  // --- Critical ---

  test("returns a started pg-boss instance when DATABASE_URL is set", async () => {
    const getQueue = await importGetQueue();

    const boss = await getQueue();

    expect(PgBossCtor).toHaveBeenCalledWith("postgresql://localhost/test");
    expect(mockStart).toHaveBeenCalledOnce();
    expect(boss).toBe(mockInstances[0]);
  });

  test("throws when DATABASE_URL is missing", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const getQueue = await importGetQueue();

    await expect(getQueue()).rejects.toThrow(
      "DATABASE_URL is required for pg-boss"
    );
  });

  test("returns the same instance on subsequent calls (singleton)", async () => {
    const getQueue = await importGetQueue();

    const first = await getQueue();
    const second = await getQueue();

    expect(PgBossCtor).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledOnce();
    expect(first).toBe(second);
  });

  // --- Important ---

  test("propagates pg-boss start() failure", async () => {
    mockStart.mockRejectedValueOnce(new Error("connection refused"));

    const getQueue = await importGetQueue();

    await expect(getQueue()).rejects.toThrow("connection refused");
  });

  test("concurrent calls share the same promise (no race condition)", async () => {
    // The promise-based singleton means both concurrent callers get
    // the same promise, so only one PgBoss instance is created.
    let resolveStart!: () => void;
    mockStart.mockReturnValueOnce(
      new Promise<void>((r) => {
        resolveStart = r;
      })
    );

    const getQueue = await importGetQueue();

    const p1 = getQueue();
    const p2 = getQueue();

    resolveStart();

    const [boss1, boss2] = await Promise.all([p1, p2]);

    expect(PgBossCtor).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledOnce();
    expect(boss1).toBe(boss2);
  });

  test("failed start clears the cached promise, allowing retry", async () => {
    mockStart
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(undefined);

    const getQueue = await importGetQueue();

    // First call: fails
    await expect(getQueue()).rejects.toThrow("connection refused");

    // Second call: retries with fresh construction and succeeds
    const boss = await getQueue();

    expect(PgBossCtor).toHaveBeenCalledTimes(2);
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(boss).toBeDefined();
  });

  // --- Nice-to-have ---

  test("empty string DATABASE_URL is treated as missing", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const getQueue = await importGetQueue();

    await expect(getQueue()).rejects.toThrow(
      "DATABASE_URL is required for pg-boss"
    );
    expect(PgBossCtor).not.toHaveBeenCalled();
  });

  test("undefined DATABASE_URL is treated as missing", async () => {
    // Remove the env var entirely
    delete process.env.DATABASE_URL;

    const getQueue = await importGetQueue();

    await expect(getQueue()).rejects.toThrow(
      "DATABASE_URL is required for pg-boss"
    );
    expect(PgBossCtor).not.toHaveBeenCalled();
  });
});
