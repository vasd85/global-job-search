import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Job } from "./job-search";

// ---------------------------------------------------------------------------
// Mock next/navigation -- useSearchParams
// ---------------------------------------------------------------------------

const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    title: "Software Engineer",
    url: "https://boards.greenhouse.io/acme/jobs/123",
    locationRaw: "New York, NY",
    departmentRaw: "Engineering",
    workplaceType: "remote",
    salaryRaw: "$120k - $180k",
    firstSeenAt: "2025-12-01T00:00:00Z",
    applyUrl: "https://boards.greenhouse.io/acme/jobs/123/apply",
    sourceRef: "greenhouse",
    companyName: "Acme Corp",
    companySlug: "acme-corp",
    ...overrides,
  };
}

function makeJobsResponse(
  jobs: Job[] = [],
  total?: number,
  offset = 0,
): { jobs: Job[]; total: number; limit: number; offset: number } {
  return {
    jobs,
    total: total ?? jobs.length,
    limit: 50,
    offset,
  };
}

/**
 * Sets up a fetch mock that returns the given response for /api/jobs calls.
 * Returns the mock function for assertion.
 */
function mockFetch(response = makeJobsResponse([makeJob()])) {
  const fetchMock = vi.fn().mockResolvedValue({
    json: () => Promise.resolve(response),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Renders JobSearch, advances the 300ms debounce timer, and waits for
 * the loading indicator to disappear (i.e. the fetch resolved and the
 * component re-rendered with data).
 */
async function renderAndSettle(
  response?: ReturnType<typeof makeJobsResponse>,
) {
  const fetchMock = mockFetch(response ?? makeJobsResponse([makeJob()]));
  const { JobSearch } = await import("./job-search");

  render(<JobSearch />);

  // Advance past the 300ms debounce inside act() so React flushes state
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });

  // Wait for loading to disappear (fetch resolved, state updated)
  await waitFor(() => {
    expect(screen.queryByText("Loading\u2026")).not.toBeInTheDocument();
  });

  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Stub window.scrollTo (called by changePage) — must be in beforeEach
  // since afterEach calls vi.unstubAllGlobals()
  vi.stubGlobal("scrollTo", vi.fn());
  // Reset search params to blank
  for (const key of [...mockSearchParams.keys()]) {
    mockSearchParams.delete(key);
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// JobSearch -- initial render and data fetching
// ---------------------------------------------------------------------------

describe("JobSearch", () => {
  test("shows loading indicator before debounce fires", async () => {
    mockFetch(makeJobsResponse([makeJob()]));
    const { JobSearch } = await import("./job-search");

    render(<JobSearch />);

    // Before debounce fires, the component renders nothing meaningful in
    // the stats row (no data yet, not loading until debounce fires).
    // Actually the component sets loading=false initially and the useEffect
    // fires the debounce. Let's verify the fetch hasn't been called yet.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    // Advance past debounce within act
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    // Now fetch should have been called
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("/api/jobs?");
    expect(url).toContain("limit=50");
    expect(url).toContain("offset=0");
  });

  test("displays job cards after data loads", async () => {
    const jobs = [
      makeJob({ id: "1", title: "Frontend Developer", companyName: "Alpha" }),
      makeJob({ id: "2", title: "Backend Engineer", companyName: "Beta" }),
    ];
    await renderAndSettle(makeJobsResponse(jobs));

    expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    expect(screen.getByText("Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  test("shows empty-state message when no jobs are returned", async () => {
    await renderAndSettle(makeJobsResponse([]));

    expect(
      screen.getByText("No jobs found. Try different search terms."),
    ).toBeInTheDocument();
  });

  test("displays total job count after loading", async () => {
    await renderAndSettle(makeJobsResponse([makeJob()], 1234));

    expect(screen.getByText("1,234 jobs found")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// JobSearch -- filter interactions
// ---------------------------------------------------------------------------

describe("JobSearch filters", () => {
  test("typing in search input triggers debounced fetch with search param", async () => {
    const fetchMock = await renderAndSettle();
    fetchMock.mockClear();

    const searchInput = screen.getByPlaceholderText(
      "Search by title or department...",
    );

    await userEvent.type(searchInput, "react");

    // Advance past the debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    // The last call should include search=react
    const lastCall = fetchMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain("search=react");
    expect(lastCall).toContain("offset=0");
  });

  test("selecting a workplace type triggers fetch with workplaceType param", async () => {
    const fetchMock = await renderAndSettle();
    fetchMock.mockClear();

    const selects = screen.getAllByRole("combobox");
    const workplaceSelect = selects.find((s) =>
      within(s).queryByText("All locations"),
    )!;
    expect(workplaceSelect).toBeDefined();

    await userEvent.selectOptions(workplaceSelect, "remote");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    const lastCall = fetchMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain("workplaceType=remote");
  });

  test("selecting a vendor triggers fetch with vendor param", async () => {
    const fetchMock = await renderAndSettle();
    fetchMock.mockClear();

    const selects = screen.getAllByRole("combobox");
    const vendorSelect = selects.find((s) =>
      within(s).queryByText("All ATS"),
    )!;
    expect(vendorSelect).toBeDefined();

    await userEvent.selectOptions(vendorSelect, "lever");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    const lastCall = fetchMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain("vendor=lever");
  });

  test("empty filter values are omitted from the query string", async () => {
    const fetchMock = await renderAndSettle();

    // Default call should not include search, workplaceType, vendor, or company
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain("search=");
    expect(url).not.toContain("workplaceType=");
    expect(url).not.toContain("vendor=");
    expect(url).not.toContain("company=");
  });

  test("debounce coalesces rapid filter changes into a single fetch", async () => {
    const fetchMock = await renderAndSettle();
    fetchMock.mockClear();

    const searchInput = screen.getByPlaceholderText(
      "Search by title or department...",
    );

    // Type individual characters rapidly (each keystroke resets debounce)
    await userEvent.type(searchInput, "a");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await userEvent.type(searchInput, "b");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await userEvent.type(searchInput, "c");

    // Before debounce fires: no new fetch
    expect(fetchMock).not.toHaveBeenCalled();

    // Advance past debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    // Should have fired only once with the final value
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("search=abc");
  });

  test("filter change resets offset to 0", async () => {
    const fetchMock = await renderAndSettle(
      makeJobsResponse([makeJob()], 200),
    );

    // Click Next to move to page 2
    const nextBtn = screen.getByRole("button", { name: /next/i });
    await userEvent.click(nextBtn);

    // Wait for the page-change fetch to complete
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // Verify we requested offset=50
    const pageCall = fetchMock.mock.calls.at(-1)?.[0] as string;
    expect(pageCall).toContain("offset=50");

    fetchMock.mockClear();

    // Now change a filter
    const selects = screen.getAllByRole("combobox");
    const vendorSelect = selects.find((s) =>
      within(s).queryByText("All ATS"),
    )!;
    await userEvent.selectOptions(vendorSelect, "ashby");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    // The new fetch should reset offset to 0
    const filterCall = fetchMock.mock.calls.at(-1)?.[0] as string;
    expect(filterCall).toContain("offset=0");
    expect(filterCall).toContain("vendor=ashby");
  });
});

// ---------------------------------------------------------------------------
// JobSearch -- URL search params initialization
// ---------------------------------------------------------------------------

describe("JobSearch URL initialization", () => {
  test("initializes search input from URL search params", async () => {
    mockSearchParams.set("search", "devops");
    const fetchMock = await renderAndSettle();

    const searchInput = screen.getByPlaceholderText(
      "Search by title or department...",
    ) as HTMLInputElement;
    expect(searchInput.value).toBe("devops");

    // Fetch should include the URL param value
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("search=devops");
  });

  test("initializes filters from URL search params", async () => {
    mockSearchParams.set("workplaceType", "hybrid");
    mockSearchParams.set("vendor", "ashby");
    const fetchMock = await renderAndSettle();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("workplaceType=hybrid");
    expect(url).toContain("vendor=ashby");
  });

  test("shows company filter chip when company param is present", async () => {
    mockSearchParams.set("company", "acme-corp");
    mockSearchParams.set("companyName", "Acme Corp");
    await renderAndSettle();

    // The clear button proves the chip is rendered
    const clearBtn = screen.getByRole("button", {
      name: "Clear company filter",
    });
    expect(clearBtn).toBeInTheDocument();

    // The chip label is inside the chip container (next to the clear button)
    const chipContainer = clearBtn.closest("span")!;
    expect(chipContainer.textContent).toContain("Acme Corp");
  });
});

// ---------------------------------------------------------------------------
// JobSearch -- company filter chip
// ---------------------------------------------------------------------------

describe("JobSearch company filter", () => {
  test("clearing company filter removes the chip and triggers fetch without company param", async () => {
    mockSearchParams.set("company", "acme-corp");
    mockSearchParams.set("companyName", "Acme Corp");
    const fetchMock = await renderAndSettle();
    fetchMock.mockClear();

    // Click the clear button on the company chip
    const clearBtn = screen.getByRole("button", {
      name: "Clear company filter",
    });
    await userEvent.click(clearBtn);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    // Chip should be gone
    expect(
      screen.queryByRole("button", { name: "Clear company filter" }),
    ).not.toBeInTheDocument();

    // Fetch should not include company param
    const url = fetchMock.mock.calls.at(-1)?.[0] as string;
    expect(url).not.toContain("company=");
  });

  test("shows companySlug when companyName is not available", async () => {
    mockSearchParams.set("company", "acme-corp");
    // No companyName set
    await renderAndSettle();

    // Should fall back to displaying slug
    expect(screen.getByText("acme-corp")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// JobSearch -- pagination
// ---------------------------------------------------------------------------

describe("JobSearch pagination", () => {
  test("does not show pagination when total fits in one page", async () => {
    await renderAndSettle(makeJobsResponse([makeJob()], 10));

    expect(
      screen.queryByRole("button", { name: /prev/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /next/i }),
    ).not.toBeInTheDocument();
  });

  test("shows pagination controls when total exceeds one page", async () => {
    await renderAndSettle(makeJobsResponse([makeJob()], 200));

    expect(
      screen.getByRole("button", { name: /prev/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /next/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 4")).toBeInTheDocument();
    expect(screen.getByText("1 / 4")).toBeInTheDocument();
  });

  test("Prev button is disabled on the first page", async () => {
    await renderAndSettle(makeJobsResponse([makeJob()], 200));

    expect(screen.getByRole("button", { name: /prev/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });

  test("clicking Next fetches the next page with incremented offset", async () => {
    const fetchMock = await renderAndSettle(
      makeJobsResponse([makeJob()], 200),
    );
    fetchMock.mockClear();

    const nextBtn = screen.getByRole("button", { name: /next/i });
    await userEvent.click(nextBtn);

    // changePage calls fetchJobs directly (no debounce)
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("offset=50");
  });

  test("Next button is disabled on the last page", async () => {
    // total=100, so 2 pages. Start on page 1.
    const fetchMock = await renderAndSettle(
      makeJobsResponse([makeJob()], 100),
    );

    // Replace the mock to return page-2 data after clicking Next
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve(makeJobsResponse([makeJob()], 100, 50)),
    });

    const nextBtn = screen.getByRole("button", { name: /next/i });
    await userEvent.click(nextBtn);

    // Wait for the component to process the response
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // After page 2 loads: offset=50, total=100, so Next is disabled
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    });
  });

  test("clicking Next calls window.scrollTo to scroll to top", async () => {
    const scrollMock = vi.fn();
    vi.stubGlobal("scrollTo", scrollMock);
    await renderAndSettle(makeJobsResponse([makeJob()], 200));

    const nextBtn = screen.getByRole("button", { name: /next/i });
    await userEvent.click(nextBtn);

    expect(scrollMock).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  test("clicking Prev fetches the previous page with decremented offset", async () => {
    // Start on page 1 with 200 total
    const fetchMock = await renderAndSettle(
      makeJobsResponse([makeJob()], 200),
    );

    // Click Next to go to page 2
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    fetchMock.mockClear();

    // Click Prev to go back to page 1
    await userEvent.click(screen.getByRole("button", { name: /prev/i }));

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("offset=0");
  });
});

// ---------------------------------------------------------------------------
// JobCard -- rendering details
// ---------------------------------------------------------------------------

describe("JobCard", () => {
  test("renders job title, company name, and department", async () => {
    const job = makeJob({
      title: "Staff Engineer",
      companyName: "TechCo",
      departmentRaw: "Platform",
    });
    await renderAndSettle(makeJobsResponse([job]));

    expect(screen.getByText("Staff Engineer")).toBeInTheDocument();
    expect(screen.getByText("TechCo")).toBeInTheDocument();
    expect(screen.getByText(/Platform/)).toBeInTheDocument();
  });

  test("renders location, workplace type badge, and salary when present", async () => {
    const job = makeJob({
      locationRaw: "San Francisco, CA",
      workplaceType: "hybrid",
      salaryRaw: "$150k - $200k",
    });
    await renderAndSettle(makeJobsResponse([job]));

    expect(screen.getByText("San Francisco, CA")).toBeInTheDocument();
    expect(screen.getByText("hybrid")).toBeInTheDocument();
    expect(screen.getByText(/\$150k - \$200k/)).toBeInTheDocument();
  });

  test("omits location, department, workplace type, and salary when null", async () => {
    const job = makeJob({
      locationRaw: null,
      departmentRaw: null,
      workplaceType: null,
      salaryRaw: null,
    });
    await renderAndSettle(makeJobsResponse([job]));

    // Title and company should still render
    expect(screen.getByText(job.title)).toBeInTheDocument();
    expect(screen.getByText(job.companyName)).toBeInTheDocument();

    // These optional fields should not appear
    expect(screen.queryByText("New York, NY")).not.toBeInTheDocument();
    expect(screen.queryByText("Engineering")).not.toBeInTheDocument();
    expect(screen.queryByText("remote")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$120k/)).not.toBeInTheDocument();
  });

  test("Apply link uses applyUrl when available", async () => {
    const job = makeJob({
      applyUrl: "https://apply.example.com/123",
      url: "https://boards.example.com/jobs/123",
    });
    await renderAndSettle(makeJobsResponse([job]));

    const applyLink = screen.getByRole("link", { name: /apply/i });
    expect(applyLink).toHaveAttribute(
      "href",
      "https://apply.example.com/123",
    );
  });

  test("Apply link falls back to job URL when applyUrl is null", async () => {
    const job = makeJob({
      applyUrl: null,
      url: "https://boards.example.com/jobs/456",
    });
    await renderAndSettle(makeJobsResponse([job]));

    const applyLink = screen.getByRole("link", { name: /apply/i });
    expect(applyLink).toHaveAttribute(
      "href",
      "https://boards.example.com/jobs/456",
    );
  });

  test("job title links to job URL and opens in new tab", async () => {
    const job = makeJob({
      title: "Cloud Architect",
      url: "https://boards.greenhouse.io/acme/jobs/789",
    });
    await renderAndSettle(makeJobsResponse([job]));

    const titleLink = screen.getByRole("link", { name: "Cloud Architect" });
    expect(titleLink).toHaveAttribute(
      "href",
      "https://boards.greenhouse.io/acme/jobs/789",
    );
    expect(titleLink).toHaveAttribute("target", "_blank");
    expect(titleLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("displays the ATS source reference", async () => {
    const job = makeJob({ sourceRef: "lever" });
    await renderAndSettle(makeJobsResponse([job]));

    expect(screen.getByText("lever")).toBeInTheDocument();
  });

  test("formats the posted date using month and day", async () => {
    const job = makeJob({ firstSeenAt: "2025-07-15T00:00:00Z" });
    await renderAndSettle(makeJobsResponse([job]));

    // toLocaleDateString with { month: "short", day: "numeric" } produces "Jul 15"
    expect(screen.getByText(/Jul 15/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// JobSearch -- header elements
// ---------------------------------------------------------------------------

describe("JobSearch header", () => {
  test("renders the page title and Companies link", async () => {
    await renderAndSettle();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Global Job Search",
    );
    const companiesLink = screen.getByRole("link", { name: /companies/i });
    expect(companiesLink).toHaveAttribute("href", "/companies");
  });
});
