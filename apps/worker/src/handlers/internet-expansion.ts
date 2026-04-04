import { eq, and, inArray } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import type { Database } from "@gjs/db";
import {
  companies,
  jobs,
  jobMatches,
  userCompanyPreferences,
  userProfiles,
  roleFamilies,
} from "@gjs/db/schema";
import { pollCompany, FUTURE_QUEUES } from "@gjs/ingestion";
import {
  detectAtsVendor,
  parseGreenhouseBoardToken,
  parseLeverSite,
  parseAshbyBoard,
  parseSmartRecruitersCompanyFromCareersUrl,
  generateSlugCandidates,
  probeAtsApis,
  SUPPORTED_ATS_VENDORS,
} from "@gjs/ats-core/discovery";
import type { ProbeLogEntry } from "@gjs/ats-core/discovery";
import {
  classifyJobMulti,
  extractSeniority,
  resolveAllTiers,
  matchJobToTiers,
  type RoleFamilyDef,
  type ResolvedTierGeo,
} from "@gjs/ats-core";

import { decryptUserKey } from "../lib/decrypt-user-key";
import { getAppConfigValue } from "../lib/app-config";
import { normalizeDomain } from "../lib/normalize-domain";
import { discoverCompanies } from "../lib/discover-companies";
import { debug } from "../lib/logger";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ExpansionJobData {
  userId: string;
  userProfileId: string;
}

/** Structured log for the complete ATS detection process for a company. */
interface AtsSearchLog {
  timestamp: string;
  slugCandidates: string[];
  steps: AtsSearchStep[];
  outcome: {
    vendor: string;
    slug: string | null;
    method: "url_detection" | "api_probe" | "none";
    confidence: "high" | "medium" | "low" | null;
  };
}

/** A single step in the ATS detection process. */
type AtsSearchStep =
  | UrlDetectionStep
  | ProbeLogEntry;

interface UrlDetectionStep {
  type: "url_detection";
  timestamp: string;
  input: string;
  vendor: string;
  slug: string | null;
  result: "found" | "not_found";
  durationMs: number;
}

/** ATS vendors that have working extractors. */
const SUPPORTED_VENDORS = new Set<string>(SUPPORTED_ATS_VENDORS);

/** Minimum classifier score for a job to pass the role family filter. */
const CLASSIFICATION_THRESHOLD = 0.5;

/** Seconds between staggered scoring job starts (avoids API rate limit bursts). */
const SCORING_STAGGER_SECONDS = 5;

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

/**
 * Resolve user's target titles to matching role families by running
 * the classifier in reverse: classify each target title against all
 * role families and collect those that score above the threshold.
 *
 * Mirrors the logic in apps/web/src/lib/search/filter-pipeline.ts
 * resolveRoleFamilies (lines 133-177).
 */
function resolveRoleFamilies(
  allFamilies: Array<{
    slug: string;
    strongMatch: string[];
    moderateMatch: string[];
    departmentBoost: string[];
    departmentExclude: string[];
  }>,
  targetTitles: string[],
): RoleFamilyDef[] {
  if (targetTitles.length === 0) return [];

  const matchedSlugs = new Set<string>();

  for (const title of targetTitles) {
    for (const family of allFamilies) {
      const def: RoleFamilyDef = {
        slug: family.slug,
        strongMatch: family.strongMatch,
        moderateMatch: family.moderateMatch,
        departmentBoost: family.departmentBoost,
        departmentExclude: family.departmentExclude,
      };

      const result = classifyJobMulti([def], {
        title,
        departmentRaw: null,
      });

      if (result.score >= CLASSIFICATION_THRESHOLD) {
        matchedSlugs.add(family.slug);
      }
    }
  }

  return allFamilies
    .filter((f) => matchedSlugs.has(f.slug))
    .map((f) => ({
      slug: f.slug,
      strongMatch: f.strongMatch,
      moderateMatch: f.moderateMatch,
      departmentBoost: f.departmentBoost,
      departmentExclude: f.departmentExclude,
    }));
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * pg-boss handler for internet expansion jobs. Discovers new companies
 * via AI web search, detects their ATS vendor (URL fast-path then API probe),
 * inserts ALL companies into the DB (including unknown ATS), polls supported-ATS
 * companies, runs Level 2 filtering inline, and enqueues LLM scoring.
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

        debug("expand", "Loaded user preferences", {
          industries: prefs.industries,
          companySizes: prefs.companySizes,
          companyStages: prefs.companyStages,
          productTypes: prefs.productTypes,
          exclusions: prefs.exclusions,
          hqGeographies: prefs.hqGeographies,
        });

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

        debug("expand", "Loaded budget config", {
          rawBudget,
          clampedBudget: budget,
        });

        // 4. Load existing companies for dedup
        // NOTE: Loads all companies (active and inactive) into memory for domain/ATS dedup.
        // Includes inactive/unknown-ATS companies so we don't re-discover and re-probe them.
        const existingCompanies = await db
          .select({
            name: companies.name,
            website: companies.website,
            atsVendor: companies.atsVendor,
            atsSlug: companies.atsSlug,
          })
          .from(companies);

        const existingDomains = new Set<string>();
        const existingNames = new Set<string>();
        const existingAtsKeys = new Set<string>();

        for (const c of existingCompanies) {
          existingNames.add(c.name.toLowerCase());
          if (c.website) {
            const domain = normalizeDomain(c.website);
            if (domain) existingDomains.add(domain);
          }
          if (c.atsSlug) {
            existingAtsKeys.add(`${c.atsVendor}:${c.atsSlug}`);
          }
        }

        debug("expand", "Loaded existing companies for dedup", {
          totalCompanies: existingCompanies.length,
          domainCount: existingDomains.size,
          atsKeyCount: existingAtsKeys.size,
          sampleNames: [...existingNames].slice(0, 10),
        });

        // 5. Discover companies via AI web search
        console.info(
          `[expand] Discovering companies for user ${userId} (budget: ${budget})`,
        );
        debug("expand", "Calling discoverCompanies", {
          industriesCount: (prefs.industries ?? []).length,
          existingNamesCount: existingNames.size,
          budget,
        });
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

        // 5b. Load Level 2 filter context upfront (reused for every company)
        const [profile] = await db
          .select()
          .from(userProfiles)
          .where(eq(userProfiles.userId, userId))
          .limit(1);

        const allFamilies = await db.select().from(roleFamilies);

        const targetTitles = profile?.targetTitles ?? [];
        const matchedFamilies = resolveRoleFamilies(
          allFamilies,
          targetTitles,
        );

        debug("expand:l2", "Role family resolution", {
          targetTitles,
          matchedFamilySlugs: matchedFamilies.map((f) => f.slug),
          totalRoleFamilies: allFamilies.length,
        });

        const locationPreferences = profile?.locationPreferences as {
          tiers?: unknown;
        } | null;
        const rawTiers = locationPreferences?.tiers;
        const resolvedTiers: ResolvedTierGeo[] = Array.isArray(rawTiers)
          ? resolveAllTiers(rawTiers)
          : [];

        const targetSeniority = profile?.targetSeniority ?? [];

        debug("expand:l2", "Location tier resolution", {
          rawLocationPreferences: locationPreferences,
          resolvedTierCount: resolvedTiers.length,
        });

        // 6. Process each discovered company
        let inserted = 0;
        let insertedUnknown = 0;
        let polled = 0;
        let probeHits = 0;
        let skippedDomain = 0;
        let skippedDup = 0;
        let pollErrors = 0;
        let scoredEnqueued = 0;
        let scoredFiltered = 0;

        for (const disc of discovered.slice(0, budget)) {
          try {
            debug("expand", "Processing discovered company", {
              name: disc.name,
              website: disc.website,
              careersUrl: disc.careersUrl,
              industry: disc.industry,
              reasoning: disc.reasoning,
            });

            // 6a. Domain dedup
            const domain = normalizeDomain(disc.website);
            if (domain && existingDomains.has(domain)) {
              console.info(
                `[expand] Skipping ${disc.name}: domain ${domain} already in DB`,
              );
              skippedDomain++;
              continue;
            }

            // 6b. ATS detection: probe-first with URL fast-path
            const detectionStart = new Date();
            const searchSteps: AtsSearchStep[] = [];
            let detectedVendor: string = "unknown";
            let detectedSlug: string | null = null;
            let detectionMethod: AtsSearchLog["outcome"]["method"] = "none";
            let detectionConfidence: AtsSearchLog["outcome"]["confidence"] = null;
            const slugCandidates = generateSlugCandidates(disc.name);

            // Fast-path: URL-based detection
            if (disc.careersUrl) {
              const urlStart = Date.now();
              const urlVendor = detectAtsVendor(disc.careersUrl);
              const urlDuration = Date.now() - urlStart;

              debug("expand", "URL detection result", {
                company: disc.name,
                vendor: urlVendor,
                careersUrl: disc.careersUrl,
              });

              if (SUPPORTED_VENDORS.has(urlVendor)) {
                const urlSlug = extractAtsSlug(urlVendor, disc.careersUrl);
                searchSteps.push({
                  type: "url_detection",
                  timestamp: detectionStart.toISOString(),
                  input: disc.careersUrl,
                  vendor: urlVendor,
                  slug: urlSlug,
                  result: urlSlug ? "found" : "not_found",
                  durationMs: urlDuration,
                });

                if (urlSlug) {
                  detectedVendor = urlVendor;
                  detectedSlug = urlSlug;
                  detectionMethod = "url_detection";
                  detectionConfidence = "high";

                  debug("expand", "URL fast-path succeeded", {
                    company: disc.name,
                    vendor: urlVendor,
                    slug: urlSlug,
                  });
                }
              } else {
                searchSteps.push({
                  type: "url_detection",
                  timestamp: detectionStart.toISOString(),
                  input: disc.careersUrl,
                  vendor: urlVendor,
                  slug: null,
                  result: "not_found",
                  durationMs: urlDuration,
                });
              }
            }

            // Primary: API probing (only if URL detection did not succeed)
            if (detectionMethod === "none" && slugCandidates.length > 0) {
              debug("expand", "Starting API probe", {
                company: disc.name,
                slugCandidateCount: slugCandidates.length,
                slugCandidates: slugCandidates.slice(0, 6),
              });

              const probeOutcome = await probeAtsApis(
                disc.name,
                slugCandidates,
              );

              // Add probe log entries to search steps
              for (const entry of probeOutcome.log) {
                searchSteps.push(entry);
              }

              if (probeOutcome.result) {
                detectedVendor = probeOutcome.result.vendor;
                detectedSlug = probeOutcome.result.slug;
                detectionMethod = "api_probe";
                detectionConfidence = probeOutcome.result.confidence;
                probeHits++;

                debug("expand", "API probe matched", {
                  company: disc.name,
                  vendor: probeOutcome.result.vendor,
                  slug: probeOutcome.result.slug,
                  confidence: probeOutcome.result.confidence,
                  matchedName: probeOutcome.result.matchedName,
                });
              } else {
                debug("expand", "API probe found no match", {
                  company: disc.name,
                  probeAttempts: probeOutcome.log.length,
                });
              }
            }

            // Build the complete search log
            const atsSearchLog: AtsSearchLog = {
              timestamp: detectionStart.toISOString(),
              slugCandidates,
              steps: searchSteps,
              outcome: {
                vendor: detectedVendor,
                slug: detectedSlug,
                method: detectionMethod,
                confidence: detectionConfidence,
              },
            };

            // 6c. ATS dedup (check vendor+slug pair, only for known vendors with a slug)
            if (detectedSlug) {
              const atsKey = `${detectedVendor}:${detectedSlug}`;
              if (existingAtsKeys.has(atsKey)) {
                console.info(
                  `[expand] Skipping ${disc.name}: ATS pair ${atsKey} already in DB`,
                );
                skippedDup++;
                continue;
              }
            }

            // 6d. Insert company (ALL companies, including unknown ATS)
            const isKnownAts = SUPPORTED_VENDORS.has(detectedVendor) && detectedSlug !== null;
            const companySlug = detectedSlug
              ? `${detectedVendor}-${detectedSlug}`.toLowerCase().replace(/[^a-z0-9-]/g, "-")
              : `unknown-${(domain ?? disc.name).toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;

            const [companyRow] = await db
              .insert(companies)
              .values({
                slug: companySlug,
                name: disc.name,
                website: disc.website,
                industry: disc.industry.map((i) => i.toLowerCase()),
                atsVendor: detectedVendor,
                atsSlug: detectedSlug,
                atsCareersUrl: disc.careersUrl ?? null,
                atsSearchLog,
                source: "auto_discovered",
                isActive: isKnownAts,
              })
              .onConflictDoNothing()
              .returning();

            if (!companyRow) {
              // Conflict means it was already in DB (race or missed by our check)
              console.info(
                `[expand] Skipping ${disc.name}: insert conflict (already exists)`,
              );
              skippedDup++;
              continue;
            }

            debug("expand", "Company inserted", {
              id: companyRow.id as string,
              slug: companySlug,
              name: companyRow.name,
              website: companyRow.website,
              atsVendor: companyRow.atsVendor,
              atsSlug: companyRow.atsSlug,
              isActive: companyRow.isActive,
            });

            inserted++;
            if (domain) existingDomains.add(domain);
            if (detectedSlug) {
              existingAtsKeys.add(`${detectedVendor}:${detectedSlug}`);
            }

            // Unknown ATS companies: saved for audit but not polled
            if (!isKnownAts) {
              console.info(
                `[expand] Saved ${disc.name} with unknown ATS (method: ${detectionMethod})`,
              );
              insertedUnknown++;
              continue;
            }

            // 6e. Immediate poll for supported-ATS companies
            const companyId = companyRow.id as string;
            let pollSucceeded = false;
            try {
              const pollResult = await pollCompany(db, companyRow);
              debug("expand", "Poll result", {
                company: disc.name,
                ...pollResult,
              });
              console.info(
                `[expand] Polled ${disc.name}: found=${pollResult.jobsFound} new=${pollResult.jobsNew}`,
              );
              polled++;
              pollSucceeded = pollResult.jobsFound > 0;
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

            // 6f. Inline Level 2 filtering and scoring enqueue
            if (pollSucceeded) {
              try {
                const companyJobs = await db
                  .select({
                    id: jobs.id,
                    descriptionHash: jobs.descriptionHash,
                    title: jobs.title,
                    departmentRaw: jobs.departmentRaw,
                    locationRaw: jobs.locationRaw,
                    workplaceType: jobs.workplaceType,
                  })
                  .from(jobs)
                  .where(eq(jobs.companyId, companyId));

                if (companyJobs.length > 0) {
                  const jobIds = companyJobs.map((j) => j.id);

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
                        inArray(jobMatches.jobId, jobIds),
                      ),
                    );

                  const scoreByJobId = new Map(
                    existingScores.map((m) => [m.jobId, m.jobContentHash]),
                  );

                  for (const job of companyJobs) {
                    const existingHash = scoreByJobId.get(job.id);
                    const currentHash = job.descriptionHash;

                    // Skip if already scored with the current content hash
                    if (existingHash != null && existingHash === currentHash) {
                      continue;
                    }

                    debug("expand:l2", "Evaluating job", {
                      jobId: job.id,
                      title: job.title,
                      departmentRaw: job.departmentRaw,
                      locationRaw: job.locationRaw,
                      workplaceType: job.workplaceType,
                    });

                    // Level 2 filter: role family classification
                    if (matchedFamilies.length > 0) {
                      const classified = classifyJobMulti(matchedFamilies, {
                        title: job.title,
                        departmentRaw: job.departmentRaw,
                      });
                      debug("expand:l2", "Classification result", {
                        jobId: job.id,
                        familySlug: classified.familySlug,
                        score: classified.score,
                        matchType: classified.matchType,
                      });
                      if (classified.score < CLASSIFICATION_THRESHOLD) {
                        debug(
                          "expand:l2",
                          `Filtered: role family score ${classified.score} < ${CLASSIFICATION_THRESHOLD}`,
                          { jobId: job.id, title: job.title },
                        );
                        scoredFiltered++;
                        continue;
                      }
                    }

                    // Level 2 filter: seniority
                    if (targetSeniority.length > 0) {
                      const seniority = extractSeniority(job.title);
                      if (
                        seniority !== null &&
                        !targetSeniority.includes(seniority)
                      ) {
                        debug(
                          "expand:l2",
                          `Filtered: seniority "${seniority}" not in target`,
                          {
                            jobId: job.id,
                            title: job.title,
                            detectedSeniority: seniority,
                            targetSeniority,
                          },
                        );
                        scoredFiltered++;
                        continue;
                      }
                    }

                    // Level 2 filter: location matching
                    if (resolvedTiers.length > 0) {
                      const locationResult = matchJobToTiers(
                        job.locationRaw,
                        job.workplaceType,
                        resolvedTiers,
                      );
                      if (!locationResult.passes) {
                        debug(
                          "expand:l2",
                          `Filtered: location did not match tiers`,
                          {
                            jobId: job.id,
                            title: job.title,
                            locationRaw: job.locationRaw,
                            workplaceType: job.workplaceType,
                          },
                        );
                        scoredFiltered++;
                        continue;
                      }
                    }

                    debug("expand:l2", "Passed L2 filter, enqueuing scoring", {
                      jobId: job.id,
                      title: job.title,
                    });

                    try {
                      await boss.send(
                        FUTURE_QUEUES.llmScoring,
                        { jobId: job.id, userProfileId, userId },
                        {
                          singletonKey: `${userProfileId}:${job.id}`,
                          startAfter: SCORING_STAGGER_SECONDS * scoredEnqueued,
                        },
                      );
                      scoredEnqueued++;
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
                }
              } catch (scoreError) {
                // Non-fatal: scoring can be triggered manually later
                const msg =
                  scoreError instanceof Error
                    ? scoreError.message
                    : String(scoreError);
                console.warn(
                  `[expand] Failed to enqueue scoring for ${disc.name}: ${msg}`,
                );
              }
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
            `discovered=${discovered.length} inserted=${inserted} inserted_unknown=${insertedUnknown} ` +
            `polled=${polled} probe_hits=${probeHits} ` +
            `skipped_domain=${skippedDomain} skipped_dup=${skippedDup} ` +
            `poll_errors=${pollErrors} scored_enqueued=${scoredEnqueued} scored_filtered=${scoredFiltered}`,
        );
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
