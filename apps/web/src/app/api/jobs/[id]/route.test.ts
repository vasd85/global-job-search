// @vitest-environment node

// ---------------------------------------------------------------------------
// Mock @/lib/db — chainable Drizzle query builder
// ---------------------------------------------------------------------------
const { mockLimit, mockWhere, mockSelect } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
  const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockLimit, mockWhere, mockSelect };
});

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
}));

// Mock schema — only the column references the route uses
vi.mock("@/lib/db/schema", () => ({
  jobs: {
    id: "jobs.id",
    title: "jobs.title",
    url: "jobs.url",
    canonicalUrl: "jobs.canonicalUrl",
    locationRaw: "jobs.locationRaw",
    departmentRaw: "jobs.departmentRaw",
    workplaceType: "jobs.workplaceType",
    salaryRaw: "jobs.salaryRaw",
    employmentTypeRaw: "jobs.employmentTypeRaw",
    postedDateRaw: "jobs.postedDateRaw",
    descriptionText: "jobs.descriptionText",
    applyUrl: "jobs.applyUrl",
    status: "jobs.status",
    firstSeenAt: "jobs.firstSeenAt",
    lastSeenAt: "jobs.lastSeenAt",
    sourceRef: "jobs.sourceRef",
    companyId: "jobs.companyId",
  },
  companies: {
    id: "companies.id",
    name: "companies.name",
    slug: "companies.slug",
    website: "companies.website",
    atsVendor: "companies.atsVendor",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => `eq(${col},${val})`),
}));

import { GET } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FAKE_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const fakeJobRow = {
  id: FAKE_UUID,
  title: "Senior Engineer",
  url: "https://boards.greenhouse.io/acme/jobs/123",
  canonicalUrl: "https://boards.greenhouse.io/acme/jobs/123",
  locationRaw: "San Francisco, CA",
  departmentRaw: "Engineering",
  workplaceType: "hybrid",
  salaryRaw: "$150k-$200k",
  employmentTypeRaw: "Full-time",
  postedDateRaw: "2025-01-15",
  descriptionText: "We are looking for...",
  applyUrl: "https://boards.greenhouse.io/acme/jobs/123/apply",
  status: "open",
  firstSeenAt: "2025-01-15T00:00:00Z",
  lastSeenAt: "2025-01-20T00:00:00Z",
  sourceRef: "greenhouse:acme",
  companyId: "comp-uuid",
  companyName: "Acme Corp",
  companySlug: "acme-corp",
  companyWebsite: "https://acme.com",
  atsVendor: "greenhouse",
};

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/jobs/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns the job object with 200 when found", async () => {
    mockLimit.mockResolvedValueOnce([fakeJobRow]);

    const response = await GET(new Request("http://localhost"), makeParams(FAKE_UUID));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body: Record<string, unknown> = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(fakeJobRow);
  });

  test("returns 404 with error message when job is not found", async () => {
    mockLimit.mockResolvedValueOnce([]);

    const response = await GET(new Request("http://localhost"), makeParams(FAKE_UUID));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body: Record<string, unknown> = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Job not found" });
  });

  test.each([
    ["Error instance", new Error("connection refused"), "connection refused"],
    ["non-Error string", "some string error", "some string error"],
  ])(
    "returns 500 with error message when DB throws %s",
    async (_label, thrown, expectedMsg) => {
      mockLimit.mockRejectedValueOnce(thrown);

      const response = await GET(new Request("http://localhost"), makeParams(FAKE_UUID));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body: Record<string, unknown> = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({ error: expectedMsg });
    }
  );

  test("filters by the provided job id via eq(jobs.id, id)", async () => {
    mockLimit.mockResolvedValueOnce([fakeJobRow]);

    await GET(new Request("http://localhost"), makeParams("specific-uuid"));

    expect(mockWhere).toHaveBeenCalledWith("eq(jobs.id,specific-uuid)");
  });
});
