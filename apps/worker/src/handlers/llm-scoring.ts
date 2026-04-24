import { eq } from "drizzle-orm";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import type { Job } from "pg-boss";
import type { Database } from "@gjs/db";
import { jobs, companies, userProfiles, jobMatches } from "@gjs/db/schema";
import { createLogger } from "@gjs/logger";

import { decryptUserKey } from "../lib/decrypt-user-key";
import { getAppConfigValue } from "../lib/app-config";
import { ScoringOutputSchema, type ScoringOutput } from "../lib/scoring-schema";
import { buildScoringPrompt } from "../lib/scoring-prompt";
import { computeMatchPercent } from "../lib/compute-match-percent";
import { fetchJobDescription } from "../lib/fetch-description";

const log = createLogger("score");

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScoringJobData {
  jobId: string;
  userProfileId: string;
  userId: string;
}

const MODEL_ID = "claude-haiku-4-5-20251001";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Merge a newly-extracted enum signal value with the existing DB value.
 *
 * Rule: never downgrade a concrete answer (any value other than
 * `unknownValue`) to `unknownValue`. A concrete `incoming` value always
 * wins. If `incoming` is `unknownValue`, we preserve `existing` so prompt
 * drift or temporary LLM uncertainty cannot wipe a previously-recorded
 * answer.
 */
export function mergeEnum<T extends string>(
  existing: T,
  incoming: T,
  unknownValue: T,
): T {
  if (incoming !== unknownValue) return incoming;
  if (existing !== unknownValue) return existing;
  return unknownValue;
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * pg-boss handler for LLM scoring jobs. Receives jobs with
 * `{ jobId, userProfileId, userId }` payload, loads fresh data from DB,
 * calls the LLM for RSLCD scoring, and upserts results into job_match.
 */
export function createLlmScoringHandler(db: Database) {
  return async (batchJobs: Job<ScoringJobData>[]): Promise<void> => {
    for (const batchJob of batchJobs) {
      const data = batchJob.data;
      const { jobId, userProfileId, userId } = data;

      try {
        // 1. Load job row with company data
        //    The signal columns are read so the post-score write-back
        //    can call mergeEnum and avoid downgrading concrete answers
        //    to "unknown" on prompt drift.
        const [jobRow] = await db
          .select({
            id: jobs.id,
            title: jobs.title,
            descriptionText: jobs.descriptionText,
            descriptionHash: jobs.descriptionHash,
            location: jobs.location,
            workplaceType: jobs.workplaceType,
            salary: jobs.salary,
            url: jobs.url,
            atsJobId: jobs.atsJobId,
            sourceRef: jobs.sourceRef,
            companyId: jobs.companyId,
            companyName: companies.name,
            companyIndustry: companies.industry,
            companyAtsSlug: companies.atsSlug,
            visaSponsorship: jobs.visaSponsorship,
            relocationPackage: jobs.relocationPackage,
            workAuthRestriction: jobs.workAuthRestriction,
            languageRequirements: jobs.languageRequirements,
            travelPercent: jobs.travelPercent,
            securityClearance: jobs.securityClearance,
            shiftPattern: jobs.shiftPattern,
          })
          .from(jobs)
          .innerJoin(companies, eq(jobs.companyId, companies.id))
          .where(eq(jobs.id, jobId))
          .limit(1);

        if (!jobRow) {
          log.warn({ jobId }, "Job not found, skipping");
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
          log.warn(
            { userProfileId, jobId },
            "User profile not found, skipping",
          );
          continue;
        }

        // 4. Decrypt user API key
        const apiKey = await decryptUserKey(db, userId);
        if (!apiKey) {
          log.error(
            { userId, jobId },
            "No active API key, skipping",
          );
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
            location: jobRow.location,
            workplaceType: jobRow.workplaceType,
            salary: jobRow.salary,
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

        const scoringOutput = result.output as ScoringOutput | null;
        if (!scoringOutput) {
          log.warn(
            { jobId: data.jobId, userProfileId, userId },
            "LLM returned no structured output, skipping",
          );
          continue;
        }

        // 8. Clamp and round scores (Anthropic structured output does not
        //    support min/max/int constraints — enforced here instead)
        const clamp = (v: number) => Math.round(Math.max(0, Math.min(10, v)));
        const scoreR = clamp(scoringOutput.scoreR);
        const scoreS = clamp(scoringOutput.scoreS);
        const scoreL = clamp(scoringOutput.scoreL);
        const scoreC = clamp(scoringOutput.scoreC);
        const scoreD = clamp(scoringOutput.scoreD);

        // 9. Compute match percent
        const { matchPercent, appliedGrowthBonus } = computeMatchPercent(
          { scoreR, scoreS, scoreL, scoreC, scoreD },
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
            scoreR,
            scoreS,
            scoreL,
            scoreC,
            scoreD,
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
              scoreR,
              scoreS,
              scoreL,
              scoreC,
              scoreD,
              matchPercent,
              matchReason: scoringOutput.matchReason,
              evidenceQuotes: scoringOutput.evidenceQuotes,
              jobContentHash: currentJobHash,
              isStale: false,
              scoredAt: now,
              updatedAt: now,
            },
          });

        // 10. Persist extracted signals on the job row.
        //
        //     The same L3 LLM call extracted these signals from the
        //     description text. Writing them back warms an L2 cache so
        //     future users' filter pipelines can consume them without
        //     re-invoking the LLM (plan §8 — L3 → L2 promotion).
        //
        //     Invariants:
        //       - mergeEnum never downgrades a concrete answer to "unknown"
        //         (preserves prior LLM confidence on prompt drift).
        //       - Soft signals (language/travel/clearance/shift) never
        //         overwrite a concrete prior value with null / empty array.
        //       - signalsExtractedAt and signalsExtractedFromHash are
        //         always stamped so a future content change can detect
        //         staleness via descriptionHash rotation.
        //
        //     Wrapped in its own try/catch so a signal-write failure does
        //     not lose the score that was just persisted.
        try {
          const signals = scoringOutput.extractedSignals;

          // Clamp travelPercent: Anthropic structured output rejects
          // min/max/int Zod constraints, so the schema accepts any number.
          // Clamp here to the persisted column's expected 0-100 integer.
          const travelPercentClamped =
            signals.travelPercent == null
              ? null
              : Math.round(Math.max(0, Math.min(100, signals.travelPercent)));

          await db
            .update(jobs)
            .set({
              visaSponsorship: mergeEnum(
                jobRow.visaSponsorship,
                signals.visaSponsorship,
                "unknown",
              ),
              relocationPackage: mergeEnum(
                jobRow.relocationPackage,
                signals.relocationPackage,
                "unknown",
              ),
              workAuthRestriction: mergeEnum(
                jobRow.workAuthRestriction,
                signals.workAuthRestriction,
                "unknown",
              ),
              languageRequirements:
                signals.languageRequirements.length > 0
                  ? signals.languageRequirements
                  : jobRow.languageRequirements,
              travelPercent: travelPercentClamped ?? jobRow.travelPercent,
              securityClearance:
                signals.securityClearance ?? jobRow.securityClearance,
              shiftPattern: signals.shiftPattern ?? jobRow.shiftPattern,
              signalsExtractedAt: now,
              signalsExtractedFromHash: currentJobHash,
              updatedAt: now,
            })
            .where(eq(jobs.id, jobRow.id));
        } catch (signalError) {
          // Score is already persisted; log the signal write failure but do
          // not propagate so the per-job success path continues.
          log.error(
            { jobId, userProfileId, userId, err: signalError },
            "Failed to write extracted signals",
          );
        }

        log.info(
          {
            jobId,
            userProfileId,
            userId,
            matchPercent,
            appliedGrowthBonus,
            dealBreakerTriggered: scoringOutput.dealBreakerTriggered,
          },
          "Scored job",
        );
      } catch (error) {
        // Per-job error isolation: log and continue with remaining jobs.
        // Failed jobs will be re-enqueued on the next scoring trigger
        // (they won't have a fresh cache entry).
        log.error(
          { jobId, userProfileId, userId, err: error },
          "Error scoring job",
        );
      }
    }
  };
}
