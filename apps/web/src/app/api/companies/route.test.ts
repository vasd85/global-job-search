// @vitest-environment node

// ---------------------------------------------------------------------------
// Mock @/lib/db — chainable Drizzle query builder
// ---------------------------------------------------------------------------
const { mockOrderBy, mockSelect } = vi.hoisted(() => {
  const mockOrderBy = vi.fn();
  const mockFrom = vi.fn(() => ({ orderBy: mockOrderBy }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockOrderBy, mockSelect };
});

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
}));

vi.mock("@/lib/db/schema", () => ({
  companies: {
    id: "companies.id",
    slug: "companies.slug",
    name: "companies.name",
    website: "companies.website",
    atsVendor: "companies.atsVendor",
    atsSlug: "companies.atsSlug",
    isActive: "companies.isActive",
    lastPolledAt: "companies.lastPolledAt",
    lastPollStatus: "companies.lastPollStatus",
    jobsCount: "companies.jobsCount",
  },
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((col: unknown) => `desc(${col})`),
}));

import { desc } from "drizzle-orm";
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const fakeCompanies = [
  {
    id: "uuid-1",
    slug: "acme-corp",
    name: "Acme Corp",
    website: "https://acme.com",
    atsVendor: "greenhouse",
    atsSlug: "acme",
    isActive: true,
    lastPolledAt: "2025-01-20T00:00:00Z",
    lastPollStatus: "ok",
    jobsCount: 42,
  },
  {
    id: "uuid-2",
    slug: "globex",
    name: "Globex Inc",
    website: "https://globex.com",
    atsVendor: "lever",
    atsSlug: "globex",
    isActive: true,
    lastPolledAt: "2025-01-19T00:00:00Z",
    lastPollStatus: "ok",
    jobsCount: 17,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/companies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns companies array and total count on success", async () => {
    mockOrderBy.mockResolvedValueOnce(fakeCompanies);

    const response = await GET();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body: Record<string, unknown> = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      companies: fakeCompanies,
      total: 2,
    });
  });

  test("returns empty array with total 0 when no companies exist", async () => {
    mockOrderBy.mockResolvedValueOnce([]);

    const response = await GET();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body: Record<string, unknown> = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ companies: [], total: 0 });
  });

  test("orders results by jobsCount descending", async () => {
    mockOrderBy.mockResolvedValueOnce([]);

    await GET();

    expect(desc).toHaveBeenCalledWith("companies.jobsCount");
    expect(mockOrderBy).toHaveBeenCalledWith("desc(companies.jobsCount)");
  });

  test.each([
    ["Error instance", new Error("connection timeout"), "connection timeout"],
    ["string throw", "unexpected failure", "unexpected failure"],
    ["number throw", 42, "42"],
  ])(
    "returns 500 with serialized message when DB throws a %s",
    async (_label, thrown, expectedMsg) => {
      mockOrderBy.mockRejectedValueOnce(thrown);

      const response = await GET();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body: Record<string, unknown> = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({ error: expectedMsg });
    }
  );
});
