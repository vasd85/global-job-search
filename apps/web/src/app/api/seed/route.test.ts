// ---- Mocks ----------------------------------------------------------------

vi.mock("@/lib/db", () => ({ db: {} }));

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  },
}));

vi.mock("@/lib/ingestion/seed-companies", () => ({
  seedCompanies: vi.fn(),
  TEST_SEED_COMPANIES: [{ name: "Mock Co", ats_vendor: "greenhouse", ats_slug: "mock" }],
}));

vi.mock("@/lib/ingestion/seed-synonyms", () => ({
  seedSynonyms: vi.fn(),
}));

// Re-import after mock registration so the module binds to the mock.
import { seedCompanies, TEST_SEED_COMPANIES } from "@/lib/ingestion/seed-companies";
import { seedSynonyms } from "@/lib/ingestion/seed-synonyms";
import { POST } from "./route";

const seedCompaniesMock = seedCompanies as ReturnType<typeof vi.fn>;
const seedSynonymsMock = seedSynonyms as ReturnType<typeof vi.fn>;

// ---- Helpers ---------------------------------------------------------------

function adminRequest(): Request {
  return new Request("http://localhost/api/seed", { method: "POST" });
}

const adminSession = { user: { id: "u1", role: "admin" }, session: {} };

// ---- Setup -----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(adminSession);
  seedSynonymsMock.mockResolvedValue({ upserted: 0, skipped: 0 });
});

// ---- Tests -----------------------------------------------------------------

describe("POST /api/seed", () => {
  test("returns 403 when not authenticated", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const res = await POST(adminRequest());

    expect(res.status).toBe(403);
  });

  test("returns 403 when user is not admin", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "u2", role: "user" }, session: {} });

    const res = await POST(adminRequest());

    expect(res.status).toBe(403);
  });

  test("calls seedCompanies and seedSynonyms with db", async () => {
    seedCompaniesMock.mockResolvedValueOnce({ inserted: 3, skipped: 1 });
    seedSynonymsMock.mockResolvedValueOnce({ upserted: 15, skipped: 0 });

    await POST(adminRequest());

    expect(seedCompaniesMock).toHaveBeenCalledWith(
      expect.anything(), // db
      TEST_SEED_COMPANIES
    );
    expect(seedSynonymsMock).toHaveBeenCalledWith(expect.anything());
  });

  test("returns 200 with success, counts, and formatted message", async () => {
    seedCompaniesMock.mockResolvedValueOnce({ inserted: 5, skipped: 2 });
    seedSynonymsMock.mockResolvedValueOnce({ upserted: 10, skipped: 5 });

    const res = await POST(adminRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json: Record<string, unknown> = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      success: true,
      companies: { inserted: 5, skipped: 2 },
      synonyms: { upserted: 10, skipped: 5 },
      message: "Seeded 5 companies (2 skipped), 10 synonym groups (5 skipped)",
    });
  });

  test("formats message correctly when zero companies are inserted", async () => {
    seedCompaniesMock.mockResolvedValueOnce({ inserted: 0, skipped: 4 });
    seedSynonymsMock.mockResolvedValueOnce({ upserted: 0, skipped: 15 });

    const res = await POST(adminRequest());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json: Record<string, unknown> = await res.json();

    expect(json.message).toBe("Seeded 0 companies (4 skipped), 0 synonym groups (15 skipped)");
  });

  test.each([
    ["Error instance", new Error("unique constraint violated"), "unique constraint violated"],
    ["non-Error value", 42, "42"],
  ])(
    "returns 500 with success: false when seedCompanies throws %s",
    async (_label, thrown, expectedMsg) => {
      seedCompaniesMock.mockRejectedValueOnce(thrown);
      seedSynonymsMock.mockResolvedValueOnce({ upserted: 0, skipped: 0 });

      const res = await POST(adminRequest());
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json: Record<string, unknown> = await res.json();

      expect(res.status).toBe(500);
      expect(json).toEqual({ success: false, error: expectedMsg });
    }
  );
});
