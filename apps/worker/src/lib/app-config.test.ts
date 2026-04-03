import { getAppConfigValue } from "./app-config";

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _eq: val })),
}));

vi.mock("@gjs/db/schema", () => ({
  appConfig: {
    key: Symbol("appConfig.key"),
    value: Symbol("appConfig.value"),
  },
}));

// ─── Helpers ───────────────────────────────────────────────────────────────

function createMockDb(rows: Array<{ value: unknown }>) {
  const mockLimit = vi.fn().mockResolvedValue(rows);
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  return {
    db: { select: mockSelect } as unknown as Parameters<
      typeof getAppConfigValue
    >[0],
    mocks: { mockSelect, mockFrom, mockWhere, mockLimit },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("getAppConfigValue(db, key, defaultValue)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Critical ──────────────────────────────────────────────────────────

  test("key exists in DB -- returns stored value", async () => {
    const { db } = createMockDb([{ value: 10 }]);

    const result = await getAppConfigValue<number>(
      db,
      "polling.vendor_concurrency",
      5,
    );

    expect(result).toBe(10);
  });

  test("key does not exist -- returns default value", async () => {
    const { db } = createMockDb([]);

    const result = await getAppConfigValue<number>(db, "nonexistent", 42);

    expect(result).toBe(42);
  });

  test("row exists but value is null -- returns default value", async () => {
    const { db } = createMockDb([{ value: null }]);

    const result = await getAppConfigValue<number>(
      db,
      "polling.jitter_max_ms",
      5000,
    );

    expect(result).toBe(5000);
  });

  // ── Important ─────────────────────────────────────────────────────────

  test("value is a string where number is expected -- returns the raw cast (no type validation)", async () => {
    // The function performs `value as T` with no runtime type check.
    // Consumers must defend themselves against type mismatches.
    const { db } = createMockDb([{ value: "not-a-number" }]);

    const result = await getAppConfigValue<number>(
      db,
      "polling.vendor_concurrency",
      5,
    );

    // Returns "not-a-number" even though T is number -- the cast is unsafe
    expect(result).toBe("not-a-number");
  });

  test("value is a JSON object -- returns the raw jsonb value without unwrapping", async () => {
    const storedObj = { concurrency: 5 };
    const { db } = createMockDb([{ value: storedObj }]);

    const result = await getAppConfigValue<{ concurrency: number }>(
      db,
      "polling.custom",
      { concurrency: 1 },
    );

    expect(result).toEqual({ concurrency: 5 });
  });

  // ── Nice-to-have ──────────────────────────────────────────────────────

  test("DB query rejects -- error propagates (no silent catch)", async () => {
    const mockLimit = vi
      .fn()
      .mockRejectedValue(new Error("connection refused"));
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    const db = { select: mockSelect } as unknown as Parameters<
      typeof getAppConfigValue
    >[0];

    await expect(
      getAppConfigValue<number>(db, "polling.vendor_concurrency", 5),
    ).rejects.toThrow("connection refused");
  });
});
