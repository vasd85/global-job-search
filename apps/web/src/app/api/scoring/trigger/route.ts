import { NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { createLogger } from "@gjs/logger";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userProfiles, jobMatches, jobs } from "@/lib/db/schema";
import { getActiveKeyMeta } from "@/lib/api-keys/api-key-service";
import { searchJobs } from "@/lib/search/filter-pipeline";
import { getQueue } from "@/lib/queue";
import { FUTURE_QUEUES } from "@gjs/ingestion";

const log = createLogger("scoring/trigger");

/**
 * POST /api/scoring/trigger
 *
 * Triggers LLM scoring for a user's Level 2 search results.
 * For each candidate job, checks if a fresh score already exists
 * (same jobContentHash as the job's current descriptionHash).
 * Jobs that need scoring are enqueued via pg-boss.
 */
export async function POST(request: Request) {
  log.debug("POST received");

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    log.debug({ status: 401 }, "Unauthorized (no session)");
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }
  log.debug({ userId: session.user.id }, "Authenticated");

  let profile: { id: string } | undefined;
  try {
    // 1. Load the user's profile
    const profileRows = await db
      .select({ id: userProfiles.id })
      .from(userProfiles)
      .where(eq(userProfiles.userId, session.user.id))
      .limit(1);

    profile = profileRows[0];
    if (!profile) {
      log.debug(
        { userId: session.user.id, status: 404 },
        "Profile not found",
      );
      return NextResponse.json(
        { error: "User profile not found" },
        { status: 404 },
      );
    }
    log.debug({ profileId: profile.id }, "Profile loaded");

    // 2. Check user has an active API key
    const keyMeta = await getActiveKeyMeta(db, session.user.id, "anthropic");
    if (!keyMeta) {
      log.debug(
        { provider: "anthropic", status: 400 },
        "No active API key",
      );
      return NextResponse.json(
        { error: "No active API key. Add your Anthropic API key in settings." },
        { status: 400 },
      );
    }
    log.debug({ provider: "anthropic" }, "Active API key present");

    // 3. Get candidate jobs from the Level 2 filter pipeline
    log.debug(
      { limit: 200, offset: 0 },
      "Calling searchJobs for candidates",
    );
    const result = await searchJobs(db, profile.id, { limit: 200, offset: 0 });
    const candidateJobs = result.jobs;
    log.debug(
      {
        candidates: candidateJobs.length,
        pipelineTotal: result.total,
        hasMore: result.hasMore,
      },
      "Candidates from pipeline",
    );

    if (candidateJobs.length === 0) {
      log.debug("No candidates → returning empty result");
      return NextResponse.json({
        enqueued: 0,
        cached: 0,
        total: 0,
        message: "No candidate jobs found.",
      });
    }

    // 4. Cache check: batch-fetch existing matches and current description hashes
    const jobIds = candidateJobs.map((j) => j.id);
    log.debug(
      { count: jobIds.length },
      "Cache lookup: fetching matches and hashes",
    );

    const [existingMatches, jobHashes] = await Promise.all([
      db
        .select({
          jobId: jobMatches.jobId,
          jobContentHash: jobMatches.jobContentHash,
        })
        .from(jobMatches)
        .where(
          and(
            eq(jobMatches.userProfileId, profile.id),
            inArray(jobMatches.jobId, jobIds),
          ),
        ),
      db
        .select({
          id: jobs.id,
          descriptionHash: jobs.descriptionHash,
        })
        .from(jobs)
        .where(inArray(jobs.id, jobIds)),
    ]);
    log.debug(
      {
        existingMatches: existingMatches.length,
        jobHashes: jobHashes.length,
      },
      "Cache lookup result",
    );

    // Build lookup maps
    const matchByJobId = new Map(
      existingMatches.map((m) => [m.jobId, m.jobContentHash]),
    );
    const hashByJobId = new Map(
      jobHashes.map((j) => [j.id, j.descriptionHash]),
    );

    // Determine which jobs need scoring
    const jobsToScore: string[] = [];
    let cached = 0;
    let staleHash = 0;
    let noPriorMatch = 0;

    for (const job of candidateJobs) {
      const existingHash = matchByJobId.get(job.id);
      const currentHash = hashByJobId.get(job.id);

      // Cached if: match exists AND its hash matches the job's current hash
      if (existingHash != null && existingHash === currentHash) {
        cached++;
      } else {
        if (existingHash == null) {
          noPriorMatch++;
        } else {
          staleHash++;
        }
        jobsToScore.push(job.id);
      }
    }
    log.debug(
      {
        cached,
        toScore: jobsToScore.length,
        noPriorMatch,
        staleHash,
      },
      "Cache decisions",
    );

    // 5. Enqueue scoring jobs via pg-boss
    let enqueued = 0;
    let sendFailed = 0;

    if (jobsToScore.length > 0) {
      log.debug(
        { count: jobsToScore.length, queue: FUTURE_QUEUES.llmScoring },
        "Enqueueing jobs",
      );
      const boss = await getQueue();
      await boss.createQueue(FUTURE_QUEUES.llmScoring);

      for (const jobId of jobsToScore) {
        try {
          await boss.send(
            FUTURE_QUEUES.llmScoring,
            {
              jobId,
              userProfileId: profile.id,
              userId: session.user.id,
            },
            {
              singletonKey: `${profile.id}:${jobId}`,
            },
          );
          enqueued++;
        } catch (err) {
          sendFailed++;
          log.warn(
            {
              userId: session.user.id,
              profileId: profile.id,
              jobId,
              err,
            },
            "Failed to enqueue job",
          );
        }
      }
      log.debug({ ok: enqueued, failed: sendFailed }, "Enqueue complete");
    } else {
      log.debug("All candidates cached → skipping enqueue");
    }
    const total = enqueued + cached + sendFailed;

    log.debug(
      { enqueued, cached, sendFailed, total },
      "Scoring trigger result",
    );
    return NextResponse.json({
      enqueued,
      cached,
      total,
      ...(sendFailed > 0 && { sendFailed }),
      message: `Scoring ${enqueued} jobs. ${cached} already scored.${sendFailed > 0 ? ` ${sendFailed} failed to enqueue.` : ""}`,
    });
  } catch (error) {
    log.error(
      { userId: session.user.id, profileId: profile?.id, err: error },
      "Scoring trigger failed",
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
