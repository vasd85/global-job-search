import { act, render, screen, waitFor } from "@testing-library/react";
import type { Job } from "./job-search";

export type { Job };

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    title: "Software Engineer",
    url: "https://boards.greenhouse.io/acme/jobs/123",
    location: "New York, NY",
    department: "Engineering",
    workplaceType: "remote",
    salary: "$120k - $180k",
    firstSeenAt: "2025-12-01T12:00:00Z",
    applyUrl: "https://boards.greenhouse.io/acme/jobs/123/apply",
    sourceRef: "greenhouse",
    companyName: "Acme Corp",
    companySlug: "acme-corp",
    ...overrides,
  };
}

export function makeJobsResponse(
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
export function mockFetch(response = makeJobsResponse([makeJob()])) {
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
export async function renderAndSettle(
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
