import { NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userProfiles, jobMatches, jobs } from "@/lib/db/schema";
import { getActiveKeyMeta } from "@/lib/api-keys/api-key-service";
import { searchJobs } from "@/lib/search/filter-pipeline";
import { getQueue } from "@/lib/queue";
import { FUTURE_QUEUES } from "@gjs/ingestion";

/**
 * POST /api/scoring/trigger
 *
 * Triggers LLM scoring for a user's Level 2 search results.
 * For each candidate job, checks if a fresh score already exists
 * (same jobContentHash as the job's current descriptionHash).
 * Jobs that need scoring are enqueued via pg-boss.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  try {
    // 1. Load the user's profile
    const profileRows = await db
      .select({ id: userProfiles.id })
      .from(userProfiles)
      .where(eq(userProfiles.userId, session.user.id))
      .limit(1);

    const profile = profileRows[0];
    if (!profile) {
      return NextResponse.json(
        { error: "User profile not found" },
        { status: 404 },
      );
    }

    // 2. Check user has an active API key
    const keyMeta = await getActiveKeyMeta(db, session.user.id, "anthropic");
    if (!keyMeta) {
      return NextResponse.json(
        { error: "No active API key. Add your Anthropic API key in settings." },
        { status: 400 },
      );
    }

    // 3. Get candidate jobs from the Level 2 filter pipeline
    const result = await searchJobs(db, profile.id, { limit: 200, offset: 0 });
    const candidateJobs = result.jobs;

    if (candidateJobs.length === 0) {
      return NextResponse.json({
        enqueued: 0,
        cached: 0,
        total: 0,
        message: "No candidate jobs found.",
      });
    }

    // 4. Cache check: batch-fetch existing matches and current description hashes
    const jobIds = candidateJobs.map((j) => j.id);

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

    for (const job of candidateJobs) {
      const existingHash = matchByJobId.get(job.id);
      const currentHash = hashByJobId.get(job.id);

      // Cached if: match exists AND its hash matches the job's current hash
      if (existingHash != null && existingHash === currentHash) {
        cached++;
      } else {
        jobsToScore.push(job.id);
      }
    }

    // 5. Enqueue scoring jobs via pg-boss
    let enqueued = 0;
    let sendFailed = 0;

    if (jobsToScore.length > 0) {
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
        } catch (error) {
          sendFailed++;
          console.warn(
            `[scoring/trigger] Failed to enqueue job ${jobId}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }
    const total = enqueued + cached + sendFailed;

    return NextResponse.json({
      enqueued,
      cached,
      total,
      ...(sendFailed > 0 && { sendFailed }),
      message: `Scoring ${enqueued} jobs. ${cached} already scored.${sendFailed > 0 ? ` ${sendFailed} failed to enqueue.` : ""}`,
    });
  } catch (error) {
    console.error("[scoring/trigger] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
