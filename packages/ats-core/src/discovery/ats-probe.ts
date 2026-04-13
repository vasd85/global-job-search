export type ProbeConfidence = "high" | "medium" | "low";

export interface ProbeResult {
  vendor: "greenhouse" | "lever" | "ashby" | "smartrecruiters";
  slug: string;
  confidence: ProbeConfidence;
  matchedName: string | null;
}

export interface ProbeOptions {
  /** Per-request timeout in milliseconds. Default: 5000 */
  timeoutMs?: number;
  /** Delay between requests in milliseconds. Default: 200 */
  perRequestDelayMs?: number;
  /** Total deadline in milliseconds. Default: 30000 */
  maxTotalMs?: number;
  /** Vendors to skip probing. */
  skipVendors?: Set<string>;
}

/** Structured log entry for a single probe attempt. */
export interface ProbeLogEntry {
  timestamp: string;
  vendor: string;
  slug: string;
  endpoint: string;
  httpStatus: number | null;
  result: "found" | "not_found" | "error" | "name_mismatch" | "timeout";
  matchedName?: string | null;
  nameVerified?: boolean;
  confidence?: ProbeConfidence;
  error?: string;
  durationMs: number;
}

/** Full result including the log of all attempts. */
export interface ProbeOutcome {
  result: ProbeResult | null;
  log: ProbeLogEntry[];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type ProbeVendor = "greenhouse" | "smartrecruiters" | "ashby" | "lever";

interface FetchResponse {
  status: number;
  body: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_PER_REQUEST_DELAY_MS = 200;
const DEFAULT_MAX_TOTAL_MS = 30000;

const PROBE_ORDER: ProbeVendor[] = [
  "greenhouse",
  "smartrecruiters",
  "ashby",
  "lever",
];

const COMMON_SUFFIXES_RE =
  /\b(inc\.?|llc|ltd\.?|corp\.?|co\.?|gmbh|ag|s\.a\.|plc)\s*$/i;

// ---------------------------------------------------------------------------
// Lightweight fetch helper
// ---------------------------------------------------------------------------

/**
 * Minimal fetch wrapper with AbortController timeout.
 * Returns null on any error (network, timeout, etc.) — never throws.
 */
async function probeFetch(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<FetchResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const body = await response.text();
    return { status: response.status, body };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[probe] fetch failed: ${url} — ${reason}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

/**
 * Normalised containment check: returns true when one name contains the other
 * after lowercasing, stripping suffixes, and removing punctuation.
 */
export function isNameMatch(expected: string, actual: string): boolean {
  const normalize = (s: string): string =>
    s
      .toLowerCase()
      .replace(COMMON_SUFFIXES_RE, "")
      .replace(/[^a-z0-9]/g, "")
      .trim();

  const a = normalize(expected);
  const b = normalize(actual);

  if (!a || !b) {
    return false;
  }

  // Short names are collision-prone — require exact match
  if (a.length < 3 || b.length < 3) {
    return a === b;
  }

  return a === b || a.includes(b) || b.includes(a);
}

// ---------------------------------------------------------------------------
// Per-vendor probe functions (private)
// ---------------------------------------------------------------------------

interface VendorProbeResult {
  found: boolean;
  httpStatus: number | null;
  matchedName: string | null;
  confidence: ProbeConfidence;
  error?: string;
}

async function probeGreenhouse(
  slug: string,
  timeoutMs: number,
): Promise<{ endpoint: string; result: VendorProbeResult }> {
  const endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`;
  const resp = await probeFetch(endpoint, undefined, timeoutMs);

  if (!resp) {
    return {
      endpoint,
      result: { found: false, httpStatus: null, matchedName: null, confidence: "high", error: "timeout_or_network" },
    };
  }

  if (resp.status === 404) {
    return {
      endpoint,
      result: { found: false, httpStatus: 404, matchedName: null, confidence: "high" },
    };
  }

  if (resp.status === 200) {
    try {
      const data = JSON.parse(resp.body) as { name?: string };
      return {
        endpoint,
        result: { found: true, httpStatus: 200, matchedName: data.name ?? null, confidence: "high" },
      };
    } catch (error) {
      console.error(`[probe:greenhouse] JSON parse failed for slug "${slug}": ${error instanceof Error ? error.message : String(error)}`);
      return {
        endpoint,
        result: { found: false, httpStatus: 200, matchedName: null, confidence: "high", error: "invalid_json" },
      };
    }
  }

  return {
    endpoint,
    result: { found: false, httpStatus: resp.status, matchedName: null, confidence: "high", error: `http_${resp.status}` },
  };
}

async function probeSmartRecruiters(
  slug: string,
  timeoutMs: number,
): Promise<{ endpoint: string; result: VendorProbeResult }> {
  const endpoint = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=1`;
  const resp = await probeFetch(endpoint, undefined, timeoutMs);

  if (!resp) {
    return {
      endpoint,
      result: { found: false, httpStatus: null, matchedName: null, confidence: "high", error: "timeout_or_network" },
    };
  }

  if (resp.status === 404) {
    return {
      endpoint,
      result: { found: false, httpStatus: 404, matchedName: null, confidence: "high" },
    };
  }

  if (resp.status === 200) {
    // SmartRecruiters returns 200 with totalFound:0 for slugs that exist but
    // have no jobs. This includes abandoned accounts and pre-registered
    // identifiers — treat as "not found" to avoid false positives.
    try {
      const data = JSON.parse(resp.body) as { totalFound?: number };
      if (!data.totalFound || data.totalFound === 0) {
        return {
          endpoint,
          result: { found: false, httpStatus: 200, matchedName: null, confidence: "high", error: "empty_postings" },
        };
      }
    } catch (error) {
      console.error(`[probe:smartrecruiters] JSON parse failed for slug "${slug}": ${error instanceof Error ? error.message : String(error)}`);
      return {
        endpoint,
        result: { found: false, httpStatus: 200, matchedName: null, confidence: "high", error: "invalid_json" },
      };
    }
    const confidence: ProbeConfidence = slug.length > 5 ? "high" : "medium";
    return {
      endpoint,
      result: { found: true, httpStatus: 200, matchedName: null, confidence },
    };
  }

  return {
    endpoint,
    result: { found: false, httpStatus: resp.status, matchedName: null, confidence: "high", error: `http_${resp.status}` },
  };
}

async function probeAshby(
  slug: string,
  timeoutMs: number,
): Promise<{ endpoint: string; result: VendorProbeResult }> {
  const endpoint = `https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiOrganizationFromHostedJobsPageName`;
  const body = JSON.stringify({
    operationName: "ApiOrganizationFromHostedJobsPageName",
    variables: { organizationHostedJobsPageName: slug },
    query:
      "query ApiOrganizationFromHostedJobsPageName($organizationHostedJobsPageName: String!) { organization: organizationFromHostedJobsPageName(organizationHostedJobsPageName: $organizationHostedJobsPageName) { name } }",
  });

  const resp = await probeFetch(
    endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
    timeoutMs,
  );

  if (!resp) {
    return {
      endpoint,
      result: { found: false, httpStatus: null, matchedName: null, confidence: "high", error: "timeout_or_network" },
    };
  }

  if (resp.status !== 200) {
    return {
      endpoint,
      result: { found: false, httpStatus: resp.status, matchedName: null, confidence: "high", error: `http_${resp.status}` },
    };
  }

  try {
    const data = JSON.parse(resp.body) as {
      data?: { organization?: { name?: string } | null };
      errors?: Array<{ message?: string }>;
    };

    // GraphQL errors — log them so broken queries don't hide silently
    if (data.errors && data.errors.length > 0) {
      const messages = data.errors.map((e) => e.message ?? "unknown").join("; ");
      console.error(`[probe:ashby] GraphQL errors for slug "${slug}": ${messages}`);
      return {
        endpoint,
        result: { found: false, httpStatus: 200, matchedName: null, confidence: "high", error: `graphql_error: ${messages}` },
      };
    }

    const org = data.data?.organization;
    if (!org) {
      return {
        endpoint,
        result: { found: false, httpStatus: 200, matchedName: null, confidence: "high" },
      };
    }
    return {
      endpoint,
      result: { found: true, httpStatus: 200, matchedName: org.name ?? null, confidence: "high" },
    };
  } catch (error) {
    console.error(`[probe:ashby] JSON parse failed for slug "${slug}": ${error instanceof Error ? error.message : String(error)}`);
    return {
      endpoint,
      result: { found: false, httpStatus: 200, matchedName: null, confidence: "high", error: "invalid_json" },
    };
  }
}

async function probeLever(
  slug: string,
  timeoutMs: number,
): Promise<{ endpoint: string; result: VendorProbeResult }> {
  const endpoint = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json&limit=1`;
  const resp = await probeFetch(endpoint, undefined, timeoutMs);

  if (!resp) {
    return {
      endpoint,
      result: { found: false, httpStatus: null, matchedName: null, confidence: "low", error: "timeout_or_network" },
    };
  }

  if (resp.status !== 200) {
    return {
      endpoint,
      result: { found: false, httpStatus: resp.status, matchedName: null, confidence: "low", error: `http_${resp.status}` },
    };
  }

  try {
    const data = JSON.parse(resp.body) as unknown[];
    if (!Array.isArray(data) || data.length === 0) {
      return {
        endpoint,
        result: { found: false, httpStatus: 200, matchedName: null, confidence: "low" },
      };
    }
    return {
      endpoint,
      result: { found: true, httpStatus: 200, matchedName: null, confidence: "low" },
    };
  } catch (error) {
    console.error(`[probe:lever] JSON parse failed for slug "${slug}": ${error instanceof Error ? error.message : String(error)}`);
    return {
      endpoint,
      result: { found: false, httpStatus: 200, matchedName: null, confidence: "low", error: "invalid_json" },
    };
  }
}

// ---------------------------------------------------------------------------
// Vendor dispatch map
// ---------------------------------------------------------------------------

const VENDOR_PROBES: Record<
  ProbeVendor,
  (slug: string, timeoutMs: number) => Promise<{ endpoint: string; result: VendorProbeResult }>
> = {
  greenhouse: probeGreenhouse,
  smartrecruiters: probeSmartRecruiters,
  ashby: probeAshby,
  lever: probeLever,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasNameVerification(vendor: ProbeVendor): boolean {
  return vendor === "greenhouse" || vendor === "ashby";
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

/**
 * Probe ATS vendor APIs to detect which ATS a company uses.
 *
 * Tries each vendor in priority order (Greenhouse, SmartRecruiters, Ashby,
 * Lever) with every slug candidate. Returns the first verified match along
 * with a complete log of all probe attempts.
 *
 * Never throws — all errors are captured in the log.
 */
export async function probeAtsApis(
  companyName: string,
  slugCandidates: string[],
  options?: ProbeOptions,
): Promise<ProbeOutcome> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const perRequestDelayMs = options?.perRequestDelayMs ?? DEFAULT_PER_REQUEST_DELAY_MS;
  const maxTotalMs = options?.maxTotalMs ?? DEFAULT_MAX_TOTAL_MS;
  const skipVendors = options?.skipVendors ?? new Set<string>();

  const log: ProbeLogEntry[] = [];
  const startTime = Date.now();

  for (const vendor of PROBE_ORDER) {
    if (skipVendors.has(vendor)) {
      continue;
    }

    for (const slug of slugCandidates) {
      // Check total deadline
      if (Date.now() - startTime >= maxTotalMs) {
        return { result: null, log };
      }

      const stepTimestamp = new Date().toISOString();
      const stepStart = Date.now();

      const { endpoint, result: probeResult } = await VENDOR_PROBES[vendor](slug, timeoutMs);

      const durationMs = Date.now() - stepStart;

      if (probeResult.found) {
        // Vendors with name verification require a name match
        if (hasNameVerification(vendor) && probeResult.matchedName) {
          const nameMatches = isNameMatch(companyName, probeResult.matchedName);
          log.push({
            timestamp: stepTimestamp,
            vendor,
            slug,
            endpoint,
            httpStatus: probeResult.httpStatus,
            result: nameMatches ? "found" : "name_mismatch",
            matchedName: probeResult.matchedName,
            nameVerified: nameMatches,
            confidence: probeResult.confidence,
            durationMs,
          });

          if (nameMatches) {
            return {
              result: {
                vendor,
                slug,
                confidence: probeResult.confidence,
                matchedName: probeResult.matchedName,
              },
              log,
            };
          }

          // Name mismatch — try next slug
        } else {
          // No name verification (SmartRecruiters, Lever) or name not in response
          log.push({
            timestamp: stepTimestamp,
            vendor,
            slug,
            endpoint,
            httpStatus: probeResult.httpStatus,
            result: "found",
            matchedName: probeResult.matchedName,
            nameVerified: !hasNameVerification(vendor) ? undefined : false,
            confidence: probeResult.confidence,
            durationMs,
          });

          return {
            result: {
              vendor,
              slug,
              confidence: probeResult.confidence,
              matchedName: probeResult.matchedName,
            },
            log,
          };
        }
      } else {
        // Not found or error
        const isTimeout = probeResult.error === "timeout_or_network" && probeResult.httpStatus === null;
        log.push({
          timestamp: stepTimestamp,
          vendor,
          slug,
          endpoint,
          httpStatus: probeResult.httpStatus,
          result: isTimeout ? "timeout" : probeResult.error ? "error" : "not_found",
          error: probeResult.error,
          durationMs,
        });
      }

      // Delay between requests to respect rate limits
      if (perRequestDelayMs > 0) {
        await delay(perRequestDelayMs);
      }
    }
  }

  return { result: null, log };
}
