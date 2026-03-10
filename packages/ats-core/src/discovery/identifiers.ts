function parseUrl(value: string | null | undefined): URL | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function pathSegments(value: string | null | undefined): string[] {
  const parsed = parseUrl(value);
  if (!parsed) {
    return [];
  }
  return parsed.pathname.split("/").filter(Boolean);
}

export function parseGreenhouseBoardToken(careersUrl: string | null | undefined): string | null {
  const parsed = parseUrl(careersUrl);
  if (!parsed) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);

  const tokenFromQuery = parsed.searchParams.get("for");
  if (tokenFromQuery) {
    return tokenFromQuery.trim() || null;
  }

  if (host.includes("boards-api.greenhouse.io") || host.includes("api.greenhouse.io")) {
    const boardsIndex = segments.findIndex((segment) => segment.toLowerCase() === "boards");
    if (boardsIndex >= 0 && segments[boardsIndex + 1]) {
      return segments[boardsIndex + 1] ?? null;
    }
    return null;
  }

  if (!host.includes("greenhouse.io")) {
    return null;
  }

  return segments[0] ?? null;
}

export function parseLeverSite(
  careersUrl: string | null | undefined
): { site: string; isEu: boolean } | null {
  const parsed = parseUrl(careersUrl);
  if (!parsed) {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  return {
    site: segments[0],
    isEu: parsed.hostname.toLowerCase().startsWith("jobs.eu.")
  };
}

export function parseAshbyBoard(careersUrl: string | null | undefined): string | null {
  const parsed = parseUrl(careersUrl);
  if (!parsed) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);

  const queryBoard = parsed.searchParams.get("for")?.trim();
  if (queryBoard) {
    return queryBoard;
  }

  if (!host.includes("ashbyhq.com")) {
    return null;
  }

  const firstSegment = segments[0]?.trim() ?? "";
  if (!firstSegment) {
    return null;
  }
  if (/^(jobs?|careers?|apply|posting|postings|embed)$/i.test(firstSegment)) {
    return null;
  }
  return firstSegment;
}

export function parseSmartRecruitersCompanyFromCareersUrl(
  careersUrl: string | null | undefined
): string | null {
  const segments = pathSegments(careersUrl);
  return segments[0] ?? null;
}

/**
 * Build the standard ATS careers URL from vendor + slug.
 */
export function buildCareersUrl(vendor: string, slug: string): string {
  switch (vendor) {
    case "greenhouse":
      return `https://boards.greenhouse.io/${slug}`;
    case "lever":
      return `https://jobs.lever.co/${slug}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${slug}`;
    case "smartrecruiters":
      return `https://jobs.smartrecruiters.com/${slug}`;
    default:
      throw new Error(`Unsupported ATS vendor: ${vendor}`);
  }
}
