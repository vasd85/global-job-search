import type { ExtractionContext, ExtractionResult } from "./extractor-types";
import { fetchJson } from "./common";
import { parseLeverSite } from "../discovery/identifiers";
import { buildJob, dedupeJobs } from "../normalizer/job-normalizer";
import { htmlToText, mergeTextBlocks, normalizeText } from "../utils/job-text";

interface LeverPosting {
  text: string;
  hostedUrl?: string;
  applyUrl?: string;
  categories?: {
    location?: string;
    team?: string;
    department?: string;
    commitment?: string;
  };
  workplaceType?: string;
  description?: string;
  descriptionPlain?: string;
  descriptionBody?: string;
  descriptionBodyPlain?: string;
  additional?: string;
  additionalPlain?: string;
  opening?: string;
  openingPlain?: string;
  lists?: Array<{
    text?: string;
    content?: string;
    title?: string;
    name?: string;
    items?: Array<{ text?: string; content?: string; name?: string }>;
  }>;
  createdAt?: number;
  id?: string;
}

function requirementSectionScore(sectionName: string): number {
  const normalized = sectionName.toLowerCase();
  if (/qualifications?|requirements?/.test(normalized)) {
    return 3;
  }
  if (/what you bring|what we're looking for|must have|you have/.test(normalized)) {
    return 2;
  }
  return 0;
}

function extractRequirements(posting: LeverPosting): string | null {
  const candidates: Array<{ score: number; value: string | null }> = [];
  for (const section of posting.lists ?? []) {
    const sectionName = normalizeText(section.title ?? section.name ?? section.text ?? "");
    if (!sectionName) {
      continue;
    }
    const sectionText = mergeTextBlocks([
      htmlToText(section.content ?? null),
      ...(section.items ?? []).flatMap((item) => [item.text, htmlToText(item.content ?? null), item.name])
    ]);
    const score = requirementSectionScore(sectionName);
    if (score > 0) {
      candidates.push({ score, value: sectionText });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.value ?? null;
}

export async function extractFromLever(context: ExtractionContext): Promise<ExtractionResult> {
  const siteData = parseLeverSite(context.careersUrl);
  if (!siteData) {
    return {
      jobs: [],
      errors: [`Unable to parse Lever site from ${context.careersUrl}`]
    };
  }
  const apiBase = siteData.isEu ? "https://api.eu.lever.co" : "https://api.lever.co";
  const endpoint = `${apiBase}/v0/postings/${siteData.site}?mode=json`;
  const { data, error } = await fetchJson<LeverPosting[]>(
    endpoint,
    context.diagnostics,
    context.timeoutMs,
    context.maxRetries,
    context.maxAttempts
  );
  if (!data) {
    return {
      jobs: [],
      errors: [`Lever API failed (${endpoint}): ${error ?? "unknown error"}`]
    };
  }

  const jobs = data
    .map((posting) =>
      buildJob({
        raw: {
          title: posting.text,
          url: posting.hostedUrl ?? posting.applyUrl ?? "",
          jobIdHint: posting.id ?? null,
          locationRaw: posting.categories?.location ?? null,
          departmentRaw: posting.categories?.team ?? posting.categories?.department ?? null,
          employmentTypeRaw: posting.categories?.commitment ?? null,
          postedDateRaw: posting.createdAt ? new Date(posting.createdAt).toISOString() : null,
          descriptionHtml: mergeTextBlocks([posting.descriptionBody, posting.description, posting.opening]),
          descriptionText: mergeTextBlocks([
            posting.descriptionBodyPlain,
            posting.descriptionPlain,
            posting.openingPlain
          ]),
          requirementsText: extractRequirements(posting),
          workplaceType: posting.workplaceType ?? null,
          applyUrl: posting.applyUrl ?? posting.hostedUrl ?? null,
          sourceDetailUrl: posting.hostedUrl ?? posting.applyUrl ?? null,
          sourceJobRaw: posting,
          detailFetchStatus:
            posting.descriptionBody ||
            posting.description ||
            posting.opening ||
            posting.descriptionBodyPlain ||
            posting.descriptionPlain ||
            posting.openingPlain
              ? "ok"
              : undefined
        },
        sourceType: "ats_api",
        sourceRef: "lever",
        baseUrl: context.careersUrl
      })
    )
    .filter((job): job is NonNullable<typeof job> => job !== null);

  return { jobs: dedupeJobs(jobs), errors: [] };
}
