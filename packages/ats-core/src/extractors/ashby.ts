import type { ExtractionContext, ExtractionResult } from "./extractor-types";
import { fetchJson } from "./common";
import { parseAshbyBoard } from "../discovery/identifiers";
import { buildJob, dedupeJobs } from "../normalizer/job-normalizer";

interface AshbyJob {
  id?: string;
  title?: string;
  jobUrl?: string;
  applyUrl?: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string; title?: string }>;
  departmentName?: string;
  department?: string;
  team?: string;
  workplaceType?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedDate?: string;
  publishedAt?: string;
  employmentType?: string;
}

interface AshbyResponse {
  jobs?: AshbyJob[];
}

export async function extractFromAshby(context: ExtractionContext): Promise<ExtractionResult> {
  const board = parseAshbyBoard(context.careersUrl);
  if (!board) {
    return { jobs: [], errors: [`Unable to parse Ashby board from ${context.careersUrl}`] };
  }
  const endpoint = `https://api.ashbyhq.com/posting-api/job-board/${board}`;
  const { data, error } = await fetchJson<AshbyResponse>(
    endpoint,
    context.diagnostics,
    context.timeoutMs,
    context.maxRetries,
    context.maxAttempts
  );
  if (!data) {
    return {
      jobs: [],
      errors: [`Ashby API failed (${endpoint}): ${error ?? "unknown error"}`]
    };
  }

  const jobs = (data.jobs ?? [])
    .map((posting) =>
      buildJob({
        raw: {
          title: posting.title ?? "",
          url: posting.jobUrl ?? posting.applyUrl ?? "",
          jobIdHint: posting.id ?? null,
          locationRaw:
            posting.location ??
            posting.secondaryLocations?.map((item) => item.location ?? item.title).filter(Boolean).join(", ") ??
            null,
          departmentRaw: posting.departmentName ?? posting.department ?? posting.team ?? null,
          postedDateRaw: posting.publishedDate ?? posting.publishedAt ?? null,
          employmentTypeRaw: posting.employmentType ?? null,
          descriptionHtml: posting.descriptionHtml ?? null,
          descriptionText: posting.descriptionPlain ?? null,
          workplaceType: posting.workplaceType ?? null,
          applyUrl: posting.applyUrl ?? posting.jobUrl ?? null,
          sourceDetailUrl: posting.jobUrl ?? posting.applyUrl ?? null,
          sourceJobRaw: posting,
          detailFetchStatus: posting.descriptionHtml || posting.descriptionPlain ? "ok" : undefined
        },
        sourceType: "ats_api",
        sourceRef: "ashby",
        baseUrl: context.careersUrl
      })
    )
    .filter((job): job is NonNullable<typeof job> => job !== null);

  return { jobs: dedupeJobs(jobs), errors: [] };
}
