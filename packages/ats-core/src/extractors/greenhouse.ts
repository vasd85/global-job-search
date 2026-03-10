import type { ExtractionContext, ExtractionResult } from "./extractor-types";
import { parseGreenhouseBoardToken } from "../discovery/identifiers";
import { fetchJson } from "./common";
import { buildJob, dedupeJobs } from "../normalizer/job-normalizer";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url?: string;
  location?: { name?: string };
  content?: string;
  first_published?: string;
  updated_at?: string;
  departments?: Array<{ name?: string }>;
  offices?: Array<{ name?: string }>;
}

interface GreenhouseResponse {
  jobs?: GreenhouseJob[];
}

export async function extractFromGreenhouse(context: ExtractionContext): Promise<ExtractionResult> {
  const token = parseGreenhouseBoardToken(context.careersUrl);
  if (!token) {
    return {
      jobs: [],
      errors: [`Unable to parse Greenhouse board token from ${context.careersUrl}`]
    };
  }
  const endpoint = `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`;
  const { data, error } = await fetchJson<GreenhouseResponse>(
    endpoint,
    context.diagnostics,
    context.timeoutMs,
    context.maxRetries,
    context.maxAttempts
  );
  if (!data) {
    return {
      jobs: [],
      errors: [`Greenhouse API failed (${endpoint}): ${error ?? "unknown error"}`]
    };
  }

  const jobs = (data.jobs ?? [])
    .map((raw) =>
      buildJob({
        raw: {
          title: raw.title,
          url: raw.absolute_url ?? "",
          jobIdHint: String(raw.id),
          locationRaw: raw.location?.name ?? null,
          departmentRaw:
            raw.departments?.map((d) => d.name).filter(Boolean).join(", ") ??
            raw.offices?.map((o) => o.name).filter(Boolean).join(", ") ??
            null,
          postedDateRaw: raw.first_published ?? raw.updated_at ?? null,
          descriptionHtml: raw.content ?? null,
          applyUrl: raw.absolute_url ?? null,
          sourceDetailUrl: raw.absolute_url ?? null,
          detailFetchStatus: raw.content ? "ok" : undefined
        },
        sourceType: "ats_api",
        sourceRef: "greenhouse",
        baseUrl: context.careersUrl
      })
    )
    .filter((job): job is NonNullable<typeof job> => job !== null);

  return {
    jobs: dedupeJobs(jobs),
    errors: []
  };
}
