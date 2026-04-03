import { eq, and, inArray } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import type { Database } from "@gjs/db";
import { companies, jobs, jobMatches, userCompanyPreferences } from "@gjs/db/schema";
import { pollCompany, FUTURE_QUEUES } from "@gjs/ingestion";
import {
  detectAtsVendor,
  parseGreenhouseBoardToken,
  parseLeverSite,
  parseAshbyBoard,
  parseSmartRecruitersCompanyFromCareersUrl,
} from "@gjs/ats-core/discovery";

import { decryptUserKey } from "../lib/decrypt-user-key";
import { getAppConfigValue } from "../lib/app-config";
import { normalizeDomain } from "../lib/normalize-domain";
import { discoverCompanies } from "../lib/discover-companies";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ExpansionJobData {
  userId: string;
  userProfileId: string;
}

/** ATS vendors that have working extractors. */
const SUPPORTED_VENDORS = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the ATS-specific slug from a careers URL given the detected vendor.
 * Returns null if slug extraction fails.
 */
function extractAtsSlug(
  vendor: string,
  careersUrl: string,
): string | null {
  switch (vendor) {
    case "greenhouse":
      return parseGreenhouseBoardToken(careersUrl);
    case "lever":
      return parseLeverSite(careersUrl)?.site ?? null;
    case "ashby":
      return parseAshbyBoard(careersUrl);
    case "smartrecruiters":
      return parseSmartRecruitersCompanyFromCareersUrl(careersUrl);
    default:
      return null;
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * pg-boss handler for internet expansion jobs. Discovers new companies
 * via AI web search, detects their ATS vendor, inserts them into the DB,
 * polls all their jobs, and enqueues LLM scoring.
 */
export function createInternetExpansionHandler(db: Database, boss: PgBoss) {
  return async (batchJobs: Job<ExpansionJobData>[]): Promise<void> => {
    for (const batchJob of batchJobs) {
      const { userId, userProfileId } = batchJob.data;

      try {
        // 1. Decrypt user API key
        const apiKey = await decryptUserKey(db, userId);
        if (!apiKey) {
          console.error(
            `[expand] No active API key for user ${userId}, skipping`,
          );
          continue;
        }

        // 2. Load user company preferences
        const [prefs] = await db
          .select()
          .from(userCompanyPreferences)
          .where(eq(userCompanyPreferences.userId, userId))
          .limit(1);

        if (!prefs) {
          console.warn(
            `[expand] No company preferences for user ${userId}, skipping`,
          );
          continue;
        }

        // 3. Load budget from config
        const rawBudget = Number(
          await getAppConfigValue<number>(
            db,
            "search.max_new_companies_per_request",
            20,
          ),
        );
        const budget = Number.isNaN(rawBudget)
          ? 20
          : Math.max(1, Math.floor(rawBudget));

        // 4. Load existing companies for dedup
        // NOTE: Loads all active companies into memory for domain/ATS dedup.
        // Acceptable for MVP but should be paginated or use a domain-only
        // index if the company count grows significantly (>1000).
        const existingCompanies = await db
          .select({
            name: companies.name,
            website: companies.website,
            atsVendor: companies.atsVendor,
            atsSlug: companies.atsSlug,
          })
          .from(companies)
          .where(eq(companies.isActive, true));

        const existingDomains = new Set<string>();
        const existingNames = new Set<string>();
        const existingAtsKeys = new Set<string>();

        for (const c of existingCompanies) {
          existingNames.add(c.name.toLowerCase());
          if (c.website) {
            const domain = normalizeDomain(c.website);
            if (domain) existingDomains.add(domain);
          }
          existingAtsKeys.add(`${c.atsVendor}:${c.atsSlug}`);
        }

        // 5. Discover companies via AI web search
        console.info(
          `[expand] Discovering companies for user ${userId} (budget: ${budget})`,
        );
        const discovered = await discoverCompanies({
          apiKey,
          preferences: {
            industries: prefs.industries ?? [],
            companySizes: prefs.companySizes ?? [],
            companyStages: prefs.companyStages ?? [],
            productTypes: prefs.productTypes ?? [],
            exclusions: prefs.exclusions ?? [],
            hqGeographies: prefs.hqGeographies ?? [],
          },
          existingCompanyNames: [...existingNames],
          budget,
        });

        if (discovered.length === 0) {
          console.info(`[expand] No companies discovered for user ${userId}`);
          continue;
        }

        // 6. Process each discovered company
        const insertedCompanyIds: string[] = [];
        let inserted = 0;
        let polled = 0;
        let skippedDomain = 0;
        let skippedAts = 0;
        let skippedSlug = 0;
        let skippedDuplicateAts = 0;
        let pollErrors = 0;

        for (const disc of discovered.slice(0, budget)) {
          try {
            // 6a. Domain dedup
            const domain = normalizeDomain(disc.website);
            if (domain && existingDomains.has(domain)) {
              console.info(
                `[expand] Skipping ${disc.name}: domain ${domain} already in DB`,
              );
              skippedDomain++;
              continue;
            }

            // 6b. ATS detection
            if (!disc.careersUrl) {
              console.info(
                `[expand] Skipping ${disc.name}: no careers URL discovered`,
              );
              skippedAts++;
              continue;
            }

            const vendor = detectAtsVendor(disc.careersUrl);
            if (!SUPPORTED_VENDORS.has(vendor)) {
              console.info(
                `[expand] Skipping ${disc.name}: unsupported ATS vendor "${vendor}"`,
              );
              skippedAts++;
              continue;
            }

            // 6c. Extract ATS slug
            const atsSlug = extractAtsSlug(vendor, disc.careersUrl);
            if (!atsSlug) {
              console.info(
                `[expand] Skipping ${disc.name}: could not extract ATS slug from ${disc.careersUrl}`,
              );
              skippedSlug++;
              continue;
            }

            // 6d. ATS dedup (check vendor+slug pair)
            const atsKey = `${vendor}:${atsSlug}`;
            if (existingAtsKeys.has(atsKey)) {
              console.info(
                `[expand] Skipping ${disc.name}: ATS pair ${atsKey} already in DB`,
              );
              skippedDuplicateAts++;
              continue;
            }

            // 6e. Insert company
            const companySlug = `${vendor}-${atsSlug}`
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, "-");

            const [companyRow] = await db
              .insert(companies)
              .values({
                slug: companySlug,
                name: disc.name,
                website: disc.website,
                industry: disc.industry.map((i) => i.toLowerCase()),
                atsVendor: vendor,
                atsSlug,
                source: "auto_discovered",
              })
              .onConflictDoNothing()
              .returning();

            if (!companyRow) {
              // Conflict means it was already in DB (race or missed by our check)
              console.info(
                `[expand] Skipping ${disc.name}: insert conflict (already exists)`,
              );
              skippedDuplicateAts++;
              continue;
            }

            inserted++;
            insertedCompanyIds.push(companyRow.id as string);
            if (domain) existingDomains.add(domain);
            existingAtsKeys.add(atsKey);

            // 6f. Immediate poll (no jitter for expansion)
            try {
              const result = await pollCompany(db, companyRow);
              console.info(
                `[expand] Polled ${disc.name}: found=${result.jobsFound} new=${result.jobsNew}`,
              );
              polled++;
            } catch (pollError) {
              const msg =
                pollError instanceof Error
                  ? pollError.message
                  : String(pollError);
              console.error(
                `[expand] Poll failed for ${disc.name}: ${msg}`,
              );
              pollErrors++;
            }
          } catch (companyError) {
            const msg =
              companyError instanceof Error
                ? companyError.message
                : String(companyError);
            console.error(
              `[expand] Error processing ${disc.name}: ${msg}`,
            );
          }
        }

        console.info(
          `[expand] Summary for user ${userId}: ` +
            `discovered=${discovered.length} inserted=${inserted} polled=${polled} ` +
            `skipped_domain=${skippedDomain} skipped_ats=${skippedAts} ` +
            `skipped_slug=${skippedSlug} skipped_dup=${skippedDuplicateAts} ` +
            `poll_errors=${pollErrors}`,
        );

        // 7. Enqueue LLM scoring for newly inserted companies' jobs
        if (insertedCompanyIds.length > 0) {
          try {
            // Query jobs belonging to the companies we just inserted
            const newJobs = await db
              .select({ id: jobs.id, descriptionHash: jobs.descriptionHash })
              .from(jobs)
              .where(inArray(jobs.companyId, insertedCompanyIds));

            if (newJobs.length > 0) {
              const newJobIds = newJobs.map((j) => j.id);

              // Check which jobs already have a fresh score for this profile
              const existingScores = await db
                .select({
                  jobId: jobMatches.jobId,
                  jobContentHash: jobMatches.jobContentHash,
                })
                .from(jobMatches)
                .where(
                  and(
                    eq(jobMatches.userProfileId, userProfileId),
                    inArray(jobMatches.jobId, newJobIds),
                  ),
                );

              const scoreByJobId = new Map(
                existingScores.map((m) => [m.jobId, m.jobContentHash]),
              );
              const hashByJobId = new Map(
                newJobs.map((j) => [j.id, j.descriptionHash]),
              );

              // Enqueue individual scoring jobs for unscored/stale jobs
              let enqueued = 0;
              for (const job of newJobs) {
                const existingHash = scoreByJobId.get(job.id);
                const currentHash = hashByJobId.get(job.id);

                // Skip if already scored with the current content hash
                if (existingHash != null && existingHash === currentHash) {
                  continue;
                }

                try {
                  await boss.send(
                    FUTURE_QUEUES.llmScoring,
                    { jobId: job.id, userProfileId, userId },
                    { singletonKey: `${userProfileId}:${job.id}` },
                  );
                  enqueued++;
                } catch (sendError) {
                  const msg =
                    sendError instanceof Error
                      ? sendError.message
                      : String(sendError);
                  console.warn(
                    `[expand] Failed to enqueue scoring for job ${job.id}: ${msg}`,
                  );
                }
              }

              console.info(
                `[expand] Enqueued ${enqueued} scoring jobs for profile ${userProfileId}`,
              );
            }
          } catch (scoreError) {
            // Non-fatal: scoring can be triggered manually later
            const msg =
              scoreError instanceof Error
                ? scoreError.message
                : String(scoreError);
            console.warn(
              `[expand] Failed to enqueue scoring: ${msg}`,
            );
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        console.error(
          `[expand] Error in expansion job for user ${userId}: ${message}`,
        );
      }
    }
  };
}
