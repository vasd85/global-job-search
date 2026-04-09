import type { AllJob } from "../types";
import { sha1 } from "../utils/hash";
import { htmlToText, normalizeText } from "../utils/job-text";
import { normalizeUrl } from "../utils/url";
import type { BuildJobArgs } from "../extractors/extractor-types";

const GENERIC_TITLE_REGEX =
  /^(details|view details|learn more|read more|apply now(?: for this position)?|click here|open roles?|view jobs?|job openings?|jobs?|careers?)$/i;
const LOCATION_OR_META_REGEX =
  /(remote|office|united states|usa|uk|canada|germany|france|ireland|switzerland|singapore|australia|new york|san francisco|london|paris|tokyo|hybrid|onsite|on-site)/i;

function cleanText(input: string | null | undefined): string | null {
  return normalizeText(input);
}

/**
 * Minimal ISO-8601 parser for the `posted_at` field. Returns `null` for
 * anything that isn't an ISO-shaped date string (YYYY-MM-DD or full ISO
 * timestamp). Non-ISO values (relative dates, long-form) become null and
 * will be backfilled by the next poll once a richer normalizer lands.
 * See plan.md §12 and Chunk F step 23 for the full treatment.
 */
function parseIsoDate(input: string | null | undefined): Date | null {
  const cleaned = cleanText(input);
  if (!cleaned) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    return null;
  }
  const date = new Date(cleaned);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function mergeDescriptionText(raw: BuildJobArgs["raw"]): string | null {
  let merged = cleanText(raw.descriptionText) ?? htmlToText(raw.descriptionHtml);
  const sections: Array<{ label: string; value: string | null }> = [
    { label: "Requirements", value: cleanText(raw.requirementsText) },
    { label: "Responsibilities", value: cleanText(raw.responsibilitiesText) },
    { label: "Benefits", value: cleanText(raw.benefitsText) }
  ];

  for (const section of sections) {
    if (!section.value) {
      continue;
    }
    if (!merged) {
      merged = `${section.label}:\n${section.value}`;
      continue;
    }
    const lowerMerged = merged.toLowerCase();
    const lowerSection = section.value.toLowerCase();
    if (lowerMerged.includes(lowerSection)) {
      continue;
    }
    merged = `${merged}\n\n${section.label}:\n${section.value}`;
  }

  return merged;
}

export function buildJob(args: BuildJobArgs): AllJob | null {
  const title = cleanText(args.raw.title);
  if (!title) {
    return null;
  }
  const normalizedUrl = normalizeUrl(args.raw.url, args.baseUrl);
  if (!normalizedUrl) {
    return null;
  }
  const canonicalUrl = normalizedUrl;
  const jobUid = sha1(canonicalUrl);
  const jobId = cleanText(args.raw.jobIdHint) ?? jobUid.slice(0, 12);
  const descriptionText = mergeDescriptionText(args.raw);
  const salary = cleanText(args.raw.salaryRaw);
  const workplaceType = cleanText(args.raw.workplaceType);
  const applyUrl = normalizeUrl(args.raw.applyUrl ?? "", args.baseUrl);
  const sourceDetailUrl = normalizeUrl(args.raw.sourceDetailUrl ?? "", args.baseUrl);
  const sourceJobRaw = args.raw.sourceJobRaw ?? null;
  const detailFetchStatus = args.raw.detailFetchStatus;
  const detailFetchNote = cleanText(args.raw.detailFetchNote);

  return {
    job_uid: jobUid,
    job_id: jobId,
    title,
    url: normalizedUrl,
    canonical_url: canonicalUrl,
    location: cleanText(args.raw.locationRaw),
    department: cleanText(args.raw.departmentRaw),
    posted_at: parseIsoDate(args.raw.postedDateRaw),
    employment_type: cleanText(args.raw.employmentTypeRaw),
    ...(descriptionText !== null ? { description_text: descriptionText } : {}),
    ...(salary !== null ? { salary } : {}),
    ...(workplaceType !== null ? { workplace_type: workplaceType } : {}),
    ...(applyUrl !== null ? { apply_url: applyUrl } : {}),
    ...(sourceDetailUrl !== null ? { source_detail_url: sourceDetailUrl } : {}),
    ...(sourceJobRaw !== null ? { source_job_raw: sourceJobRaw } : {}),
    ...(detailFetchStatus ? { detail_fetch_status: detailFetchStatus } : {}),
    ...(detailFetchNote !== null ? { detail_fetch_note: detailFetchNote } : {}),
    source_type: args.sourceType,
    source_ref: args.sourceRef
  };
}

export function dedupeJobs(jobs: AllJob[]): AllJob[] {
  const byCanonical = new Map<string, AllJob>();
  const order: string[] = [];

  const scoreJob = (job: AllJob): number => {
    let score = 0;
    const title = job.title.trim();
    const words = title.split(/\s+/).filter(Boolean).length;
    if (!GENERIC_TITLE_REGEX.test(title)) {
      score += 40;
    }
    if (words >= 2 && words <= 12) {
      score += 18;
    } else if (words === 1) {
      score -= 10;
    }
    if (LOCATION_OR_META_REGEX.test(title) && /,/.test(title)) {
      score -= 20;
    }
    if (/([a-z])([A-Z])/.test(title)) {
      score -= 15;
    }
    if (job.source_type === "ats_api") {
      score += 30;
    }
    if (job.description_text && job.description_text.length > 60) {
      score += 8;
    }
    return score;
  };

  for (const job of jobs) {
    const existing = byCanonical.get(job.canonical_url);
    if (!existing) {
      byCanonical.set(job.canonical_url, job);
      order.push(job.canonical_url);
      continue;
    }
    if (scoreJob(job) > scoreJob(existing)) {
      byCanonical.set(job.canonical_url, job);
    }
  }
  return order.map((canonical) => byCanonical.get(canonical)!).filter(Boolean);
}
