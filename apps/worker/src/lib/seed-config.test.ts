import { seedPollingConfig } from "./seed-config";

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock("@gjs/db/schema", () => ({
  appConfig: Symbol("appConfig"),
}));

// ─── Helpers ───────────────────────────────────────────────────────────────

function createMockDb() {
  const mockOnConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const mockValues = vi.fn().mockReturnValue({
    onConflictDoNothing: mockOnConflictDoNothing,
  });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

  return {
    db: { insert: mockInsert } as unknown as Parameters<
      typeof seedPollingConfig
    >[0],
    mocks: { mockInsert, mockValues, mockOnConflictDoNothing },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("seedPollingConfig(db)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Critical ──────────────────────────────────────────────────────────

  test("seeds all five config rows with correct keys, values, and descriptions", async () => {
    const { db, mocks } = createMockDb();

    await seedPollingConfig(db);

    expect(mocks.mockInsert).toHaveBeenCalledOnce();
    expect(mocks.mockValues).toHaveBeenCalledOnce();

    const rows = mocks.mockValues.mock.calls[0][0] as Array<{
      key: string;
      value: unknown;
      description: string;
    }>;

    expect(rows).toHaveLength(5);

    // Verify each expected config row
    const byKey = new Map(rows.map((r) => [r.key, r]));

    expect(byKey.get("polling.vendor_concurrency")).toEqual(
      expect.objectContaining({ value: 5 }),
    );
    expect(byKey.get("polling.jitter_max_ms")).toEqual(
      expect.objectContaining({ value: 5000 }),
    );
    expect(byKey.get("polling.stale_threshold_days")).toEqual(
      expect.objectContaining({ value: 7 }),
    );
    expect(byKey.get("polling.closed_threshold_days")).toEqual(
      expect.objectContaining({ value: 30 }),
    );
    expect(byKey.get("search.max_new_companies_per_request")).toEqual(
      expect.objectContaining({ value: 20 }),
    );

    // All rows should have a description
    for (const row of rows) {
      expect(row.description).toBeTruthy();
    }
  });

  test("uses onConflictDoNothing to preserve manual edits", async () => {
    const { db, mocks } = createMockDb();

    await seedPollingConfig(db);

    expect(mocks.mockOnConflictDoNothing).toHaveBeenCalledOnce();
  });

  // ── Important ─────────────────────────────────────────────────────────

  test("DB insert rejects -- error propagates to caller", async () => {
    const mockInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi
          .fn()
          .mockRejectedValue(new Error("permission denied")),
      }),
    });
    const db = { insert: mockInsert } as unknown as Parameters<
      typeof seedPollingConfig
    >[0];

    await expect(seedPollingConfig(db)).rejects.toThrow("permission denied");
  });
});
