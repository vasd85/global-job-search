import { eq } from "drizzle-orm";
import type { Database } from "@gjs/db";
import { jobs } from "@gjs/db/schema";
import { htmlToText, sha256 } from "@gjs/ats-core";
import { createLogger } from "@gjs/logger";

const log = createLogger("fetch-description");

interface JobRow {
  id: string;
  descriptionText: string | null;
  atsJobId: string;
  sourceRef: string;
}

interface CompanyRow {
  atsSlug: string | null;
}

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch a job description for vendors that don't include it in the list API.
 * Currently only SmartRecruiters needs a detail fetch.
 *
 * Returns the description text (from DB or freshly fetched) or null.
 */
export async function fetchJobDescription(
  db: Database,
  jobRow: JobRow,
  companyRow: CompanyRow,
): Promise<string | null> {
  // Already have description — return it
  if (jobRow.descriptionText) return jobRow.descriptionText;

  // Only SmartRecruiters needs a detail fetch; other vendors provide descriptions in the list API
  if (jobRow.sourceRef !== "smartrecruiters") return null;

  if (!companyRow.atsSlug) return null;

  const detailUrl = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyRow.atsSlug)}/postings/${encodeURIComponent(jobRow.atsJobId)}`;

  try {
    const response = await fetch(detailUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      log.warn(
        { jobId: jobRow.id, status: response.status },
        "SmartRecruiters detail non-OK",
      );
      return null;
    }

    const data: unknown = await response.json();
    const descriptionHtml = extractSmartRecruitersDescription(data);
    if (!descriptionHtml) {
      log.warn(
        { jobId: jobRow.id },
        "No description found in SmartRecruiters detail",
      );
      return null;
    }

    const descriptionText = htmlToText(descriptionHtml);
    if (!descriptionText) return null;

    const descriptionHash = sha256(descriptionText);

    // Update job row with the fetched description
    await db
      .update(jobs)
      .set({
        descriptionText,
        descriptionHash,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobRow.id));

    log.debug(
      { jobId: jobRow.id, chars: descriptionText.length },
      "Fetched SmartRecruiters description",
    );
    return descriptionText;
  } catch (error) {
    log.warn(
      { jobId: jobRow.id, err: error },
      "Failed to fetch description",
    );
    return null;
  }
}

/**
 * Defensively extract description HTML from the SmartRecruiters posting detail response.
 * Expected path: jobAd.sections.jobDescription.text
 */
function extractSmartRecruitersDescription(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const record = data as Record<string, unknown>;
  const jobAd = record.jobAd;
  if (!jobAd || typeof jobAd !== "object") return null;

  const sections = (jobAd as Record<string, unknown>).sections;
  if (!sections || typeof sections !== "object") return null;

  const jobDescription = (sections as Record<string, unknown>).jobDescription;
  if (!jobDescription || typeof jobDescription !== "object") return null;

  const text = (jobDescription as Record<string, unknown>).text;
  if (typeof text !== "string" || text.length === 0) return null;

  return text;
}
