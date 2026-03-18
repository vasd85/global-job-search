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
    industry: "companies.industry",
    atsVendor: "companies.atsVendor",
    isActive: "companies.isActive",
    lastPolledAt: "companies.lastPolledAt",
    lastPollStatus: "companies.lastPollStatus",
    jobsCount: "companies.jobsCount",
  },
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((col: unknown) => `desc(${col})`),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { render, screen, within } from "@testing-library/react";
import { desc } from "drizzle-orm";
import CompaniesPage from "./page";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
function makeCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: "uuid-1",
    slug: "acme-corp",
    name: "Acme Corp",
    website: "https://acme.com",
    industry: ["SaaS", "DevTools", "AI", "Extra"],
    atsVendor: "greenhouse",
    isActive: true,
    lastPolledAt: "2025-01-20T12:30:00Z",
    lastPollStatus: "ok",
    jobsCount: 42,
    ...overrides,
  };
}

async function renderPage() {
  const jsx = await CompaniesPage();
  return render(jsx);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("CompaniesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Header stats ----

  test("shows correct company count and total jobs", async () => {
    mockOrderBy.mockResolvedValueOnce([
      makeCompany({ jobsCount: 42 }),
      makeCompany({ id: "uuid-2", slug: "globex", name: "Globex", jobsCount: 17 }),
    ]);

    await renderPage();

    expect(screen.getByText(/2 companies/)).toBeInTheDocument();
    expect(screen.getByText(/59 open jobs/)).toBeInTheDocument();
  });

  test("formats large job totals with locale separators", async () => {
    mockOrderBy.mockResolvedValueOnce([makeCompany({ jobsCount: 1234 })]);

    await renderPage();

    expect(screen.getByText(/1,234 open jobs/)).toBeInTheDocument();
  });

  // ---- Company name rendering ----

  test("renders company name as external link when website exists", async () => {
    mockOrderBy.mockResolvedValueOnce([makeCompany()]);

    await renderPage();

    const link = screen.getByRole("link", { name: "Acme Corp" });
    expect(link).toHaveAttribute("href", "https://acme.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("renders company name as plain text when website is null", async () => {
    mockOrderBy.mockResolvedValueOnce([makeCompany({ website: null })]);

    await renderPage();

    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    // The name should NOT be inside a link (only the breadcrumb "← Jobs" link exists)
    const rows = screen.getAllByRole("row");
    const dataRow = rows[1]; // first data row (row 0 is header)
    const nameCell = within(dataRow).getAllByRole("cell")[0];
    expect(within(nameCell).queryByRole("link")).not.toBeInTheDocument();
  });

  // ---- Industries display ----

  test("shows first 3 industries joined by middle dot", async () => {
    mockOrderBy.mockResolvedValueOnce([
      makeCompany({ industry: ["SaaS", "DevTools", "AI", "Extra"] }),
    ]);

    await renderPage();

    expect(screen.getByText("SaaS · DevTools · AI")).toBeInTheDocument();
    expect(screen.queryByText(/Extra/)).not.toBeInTheDocument();
  });

  test.each([
    ["empty array", []],
    ["null", null],
  ])("hides industries when %s", async (_label, industry) => {
    mockOrderBy.mockResolvedValueOnce([makeCompany({ industry })]);

    await renderPage();

    // The industry sub-div should not render
    const rows = screen.getAllByRole("row");
    const dataRow = rows[1];
    const nameCell = within(dataRow).getAllByRole("cell")[0];
    // Industry text would be in an xs-sized div; with no industry there's only the name div
    expect(nameCell.querySelectorAll("div").length).toBe(1);
  });

  // ---- ATS vendor badges ----

  test.each([
    ["greenhouse", "bg-green-100"],
    ["lever", "bg-purple-100"],
    ["ashby", "bg-orange-100"],
    ["smartrecruiters", "bg-sky-100"],
  ])("shows %s badge with correct color class", async (vendor, expectedClass) => {
    mockOrderBy.mockResolvedValueOnce([makeCompany({ atsVendor: vendor })]);

    await renderPage();

    const badge = screen.getByText(vendor);
    expect(badge.className).toContain(expectedClass);
  });

  test("unknown vendor falls back to gray styling", async () => {
    mockOrderBy.mockResolvedValueOnce([makeCompany({ atsVendor: "workday" })]);

    await renderPage();

    const badge = screen.getByText("workday");
    expect(badge.className).toContain("bg-zinc-100");
  });

  // ---- Job count links ----

  test("renders job count as link to filtered search when > 0", async () => {
    mockOrderBy.mockResolvedValueOnce([makeCompany()]);

    await renderPage();

    const link = screen.getByRole("link", { name: "42" });
    expect(link).toHaveAttribute(
      "href",
      "/?company=acme-corp&companyName=Acme%20Corp",
    );
  });

  test("renders plain 0 when jobsCount is 0", async () => {
    mockOrderBy.mockResolvedValueOnce([makeCompany({ jobsCount: 0 })]);

    await renderPage();

    const rows = screen.getAllByRole("row");
    const dataRow = rows[1];
    const jobsCell = within(dataRow).getAllByRole("cell")[2];
    expect(jobsCell.textContent).toBe("0");
    expect(within(jobsCell).queryByRole("link")).not.toBeInTheDocument();
  });

  // ---- Last polled display ----

  test("formats last polled date", async () => {
    mockOrderBy.mockResolvedValueOnce([
      makeCompany({ lastPolledAt: "2025-01-20T12:30:00Z" }),
    ]);

    await renderPage();

    // Locale-dependent, but month and day should be present
    expect(screen.getByText(/Jan 20/)).toBeInTheDocument();
  });

  test("shows Never when lastPolledAt is null", async () => {
    mockOrderBy.mockResolvedValueOnce([makeCompany({ lastPolledAt: null })]);

    await renderPage();

    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  // ---- Status badges ----

  test.each([
    ["ok", "bg-emerald-100"],
    ["error", "bg-red-100"],
    ["empty", "bg-yellow-100"],
    ["not_found", "bg-red-100"],
  ])("renders %s status badge with correct color", async (status, expectedClass) => {
    mockOrderBy.mockResolvedValueOnce([makeCompany({ lastPollStatus: status })]);

    await renderPage();

    const badge = screen.getByText(status);
    expect(badge.className).toContain(expectedClass);
  });

  test("shows pending with fallback style when lastPollStatus is null", async () => {
    mockOrderBy.mockResolvedValueOnce([makeCompany({ lastPollStatus: null })]);

    await renderPage();

    const badge = screen.getByText("pending");
    expect(badge.className).toContain("bg-zinc-100");
  });

  // ---- Empty state ----

  test("shows 0 companies and 0 open jobs with empty table", async () => {
    mockOrderBy.mockResolvedValueOnce([]);

    await renderPage();

    expect(screen.getByText(/0 companies/)).toBeInTheDocument();
    expect(screen.getByText(/0 open jobs/)).toBeInTheDocument();
    // Only the header row should exist
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(1);
  });

  // ---- Query ordering ----

  test("orders results by jobsCount descending", async () => {
    mockOrderBy.mockResolvedValueOnce([]);

    await renderPage();

    expect(desc).toHaveBeenCalledWith("companies.jobsCount");
    expect(mockOrderBy).toHaveBeenCalledWith("desc(companies.jobsCount)");
  });
});
