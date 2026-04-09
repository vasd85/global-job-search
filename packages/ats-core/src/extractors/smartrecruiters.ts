import type { ExtractionContext, ExtractionResult } from "./extractor-types";
import { fetchJson } from "./common";
import { parseSmartRecruitersCompanyFromCareersUrl } from "../discovery/identifiers";
import { buildJob, dedupeJobs } from "../normalizer/job-normalizer";

interface SmartRecruitersPosting {
  id?: string;
  name?: string;
  ref?: string;
  releasedDate?: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
  };
  department?: {
    label?: string;
  };
  typeOfEmployment?: {
    label?: string;
  };
}

interface SmartRecruitersResponse {
  content?: SmartRecruitersPosting[];
}

function buildHostedUrl(careersUrl: string, company: string, posting: SmartRecruitersPosting): string {
  if (posting.ref && /^https?:\/\//i.test(posting.ref)) {
    return posting.ref;
  }
  if (posting.id) {
    return `https://jobs.smartrecruiters.com/${company}/${posting.id}`;
  }
  return careersUrl;
}

function buildDetailUrl(company: string, postingId: string | undefined): string | null {
  if (!postingId) {
    return null;
  }
  return `https://api.smartrecruiters.com/v1/companies/${company}/postings/${postingId}`;
}

function locationToString(location: SmartRecruitersPosting["location"]): string | null {
  if (!location) {
    return null;
  }
  const parts = [location.city, location.region, location.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export async function extractFromSmartRecruiters(
  context: ExtractionContext
): Promise<ExtractionResult> {
  const company = parseSmartRecruitersCompanyFromCareersUrl(context.careersUrl);
  if (!company) {
    return {
      jobs: [],
      errors: [`Unable to parse SmartRecruiters company identifier from ${context.careersUrl}`]
    };
  }
  const endpoint = `https://api.smartrecruiters.com/v1/companies/${company}/postings`;
  const { data, error } = await fetchJson<SmartRecruitersResponse>(
    endpoint,
    context.diagnostics,
    context.timeoutMs,
    context.maxRetries,
    context.maxAttempts
  );
  if (!data) {
    return {
      jobs: [],
      errors: [`SmartRecruiters API failed (${endpoint}): ${error ?? "unknown error"}`]
    };
  }

  const jobs = (data.content ?? [])
    .map((posting) =>
      buildJob({
        raw: {
          title: posting.name ?? "",
          url: buildHostedUrl(context.careersUrl, company, posting),
          jobIdHint: posting.id ?? null,
          locationRaw: locationToString(posting.location),
          departmentRaw: posting.department?.label ?? null,
          postedDateRaw: posting.releasedDate ?? null,
          employmentTypeRaw: posting.typeOfEmployment?.label ?? null,
          applyUrl: buildHostedUrl(context.careersUrl, company, posting),
          sourceDetailUrl: buildDetailUrl(company, posting.id),
          sourceJobRaw: posting
        },
        sourceType: "ats_api",
        sourceRef: "smartrecruiters",
        baseUrl: context.careersUrl
      })
    )
    .filter((job): job is NonNullable<typeof job> => job !== null);

  return { jobs: dedupeJobs(jobs), errors: [] };
}
