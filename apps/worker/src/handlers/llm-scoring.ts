import { eq } from "drizzle-orm";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import type { Job } from "pg-boss";
import type { Database } from "@gjs/db";
import { jobs, companies, userProfiles, jobMatches } from "@gjs/db/schema";

import { decryptUserKey } from "../lib/decrypt-user-key";
import { getAppConfigValue } from "../lib/app-config";
import { ScoringOutputSchema, type ScoringOutput } from "../lib/scoring-schema";
import { buildScoringPrompt } from "../lib/scoring-prompt";
import { computeMatchPercent } from "../lib/compute-match-percent";
import { fetchJobDescription } from "../lib/fetch-description";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScoringJobData {
  jobId: string;
  userProfileId: string;
  userId: string;
}

const MODEL_ID = "claude-haiku-4-5-20251001";

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * pg-boss handler for LLM scoring jobs. Receives jobs with
 * `{ jobId, userProfileId, userId }` payload, loads fresh data from DB,
 * calls the LLM for RSLCD scoring, and upserts results into job_match.
 */
export function createLlmScoringHandler(db: Database) {
  return async (batchJobs: Job<ScoringJobData>[]): Promise<void> => {
    for (const batchJob of batchJobs) {
      const { jobId, userProfileId, userId } = batchJob.data;

      try {
        // 1. Load job row with company data
        const [jobRow] = await db
          .select({
            id: jobs.id,
            title: jobs.title,
            descriptionText: jobs.descriptionText,
            descriptionHash: jobs.descriptionHash,
            locationRaw: jobs.locationRaw,
            workplaceType: jobs.workplaceType,
            salaryRaw: jobs.salaryRaw,
            url: jobs.url,
            atsJobId: jobs.atsJobId,
            sourceRef: jobs.sourceRef,
            companyId: jobs.companyId,
            companyName: companies.name,
            companyIndustry: companies.industry,
            companyAtsSlug: companies.atsSlug,
          })
          .from(jobs)
          .innerJoin(companies, eq(jobs.companyId, companies.id))
          .where(eq(jobs.id, jobId))
          .limit(1);

        if (!jobRow) {
          console.warn(`[score] Job not found: ${jobId}, skipping`);
          continue;
        }

        // 2. Fetch description if missing (inline for SmartRecruiters)
        let descriptionText = jobRow.descriptionText;
        if (!descriptionText) {
          descriptionText = await fetchJobDescription(db, {
            id: jobRow.id,
            descriptionText: jobRow.descriptionText,
            atsJobId: jobRow.atsJobId,
            sourceRef: jobRow.sourceRef,
          }, {
            atsSlug: jobRow.companyAtsSlug,
          });
        }

        // 3. Load user profile
        const [profile] = await db
          .select()
          .from(userProfiles)
          .where(eq(userProfiles.id, userProfileId))
          .limit(1);

        if (!profile) {
          console.warn(`[score] User profile not found: ${userProfileId}, skipping`);
          continue;
        }

        // 4. Decrypt user API key
        const apiKey = await decryptUserKey(db, userId);
        if (!apiKey) {
          console.error(`[score] No active API key for user ${userId}, skipping job ${jobId}`);
          continue;
        }

        // 5. Load growth bonus from app config
        const growthBonusPercent = await getAppConfigValue<number>(
          db,
          "scoring.growth_bonus_percent",
          7,
        );

        // 6. Build prompt
        const promptParts = buildScoringPrompt({
          job: {
            title: jobRow.title,
            descriptionText,
            locationRaw: jobRow.locationRaw,
            workplaceType: jobRow.workplaceType,
            salaryRaw: jobRow.salaryRaw,
            url: jobRow.url,
          },
          company: {
            name: jobRow.companyName,
            industry: jobRow.companyIndustry,
          },
          profile: {
            targetTitles: profile.targetTitles,
            targetSeniority: profile.targetSeniority,
            coreSkills: profile.coreSkills,
            growthSkills: profile.growthSkills,
            avoidSkills: profile.avoidSkills,
            dealBreakers: profile.dealBreakers,
            preferredLocations: profile.preferredLocations,
            remotePreference: profile.remotePreference,
            locationPreferences: profile.locationPreferences,
            minSalary: profile.minSalary,
            targetSalary: profile.targetSalary,
            salaryCurrency: profile.salaryCurrency,
            preferredIndustries: profile.preferredIndustries,
          },
        });

        // 7. Call LLM
        const anthropic = createAnthropic({ apiKey });
        const model = anthropic(MODEL_ID);

        const result = await generateText({
          model,
          output: Output.object({ schema: ScoringOutputSchema }),
          system: promptParts.system,
          prompt: promptParts.user,
        });

        const scoringOutput = result.output as ScoringOutput;

        // 8. Compute match percent
        const { matchPercent, appliedGrowthBonus } = computeMatchPercent(
          {
            scoreR: scoringOutput.scoreR,
            scoreS: scoringOutput.scoreS,
            scoreL: scoringOutput.scoreL,
            scoreC: scoringOutput.scoreC,
            scoreD: scoringOutput.scoreD,
          },
          {
            weightRole: profile.weightRole,
            weightSkills: profile.weightSkills,
            weightLocation: profile.weightLocation,
            weightCompensation: profile.weightCompensation,
            weightDomain: profile.weightDomain,
          },
          {
            hasGrowthSkillMatch: scoringOutput.hasGrowthSkillMatch,
            dealBreakerTriggered: scoringOutput.dealBreakerTriggered,
          },
          growthBonusPercent,
        );

        // 9. Upsert into job_match table
        const now = new Date();

        // Reload the job to get potentially updated descriptionHash (after fetch)
        const currentJobHash = descriptionText !== jobRow.descriptionText
          ? (await db.select({ descriptionHash: jobs.descriptionHash }).from(jobs).where(eq(jobs.id, jobId)).limit(1))[0]?.descriptionHash
          : jobRow.descriptionHash;

        await db
          .insert(jobMatches)
          .values({
            userProfileId,
            jobId,
            scoreR: scoringOutput.scoreR,
            scoreS: scoringOutput.scoreS,
            scoreL: scoringOutput.scoreL,
            scoreC: scoringOutput.scoreC,
            scoreD: scoringOutput.scoreD,
            matchPercent,
            matchReason: scoringOutput.matchReason,
            evidenceQuotes: scoringOutput.evidenceQuotes,
            jobContentHash: currentJobHash,
            isStale: false,
            scoredAt: now,
            userStatus: "new",
          })
          .onConflictDoUpdate({
            target: [jobMatches.userProfileId, jobMatches.jobId],
            set: {
              scoreR: scoringOutput.scoreR,
              scoreS: scoringOutput.scoreS,
              scoreL: scoringOutput.scoreL,
              scoreC: scoringOutput.scoreC,
              scoreD: scoringOutput.scoreD,
              matchPercent,
              matchReason: scoringOutput.matchReason,
              evidenceQuotes: scoringOutput.evidenceQuotes,
              jobContentHash: currentJobHash,
              isStale: false,
              scoredAt: now,
              updatedAt: now,
            },
          });

        console.info(
          `[score] Scored job ${jobId} for profile ${userProfileId}: ${matchPercent}%` +
            (appliedGrowthBonus ? " (growth bonus applied)" : "") +
            (scoringOutput.dealBreakerTriggered ? " (deal-breaker triggered)" : ""),
        );
      } catch (error) {
        // LLM API errors (rate limit, auth failure, network) — let pg-boss retry
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[score] Error scoring job ${jobId} for profile ${userProfileId}: ${message}`);
        throw error;
      }
    }
  };
}
