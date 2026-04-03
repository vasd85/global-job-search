import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { getActiveKeyMeta } from "@/lib/api-keys/api-key-service";
import { getQueue } from "@/lib/queue";
import { FUTURE_QUEUES } from "@gjs/ingestion";

/**
 * POST /api/search/expand
 *
 * Triggers internet search expansion for the authenticated user.
 * Enqueues a pg-boss job on the `expand/internet` queue that will
 * discover new companies via AI web search, detect their ATS vendor,
 * poll their jobs, and queue LLM scoring.
 *
 * Uses a singletonKey per user to ensure only one expansion runs at a time.
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

    // 3. Enqueue expansion job via pg-boss
    const boss = await getQueue();
    await boss.createQueue(FUTURE_QUEUES.internetExpansion);

    const jobId = await boss.send(
      FUTURE_QUEUES.internetExpansion,
      { userId: session.user.id, userProfileId: profile.id },
      { singletonKey: `expand:${session.user.id}` },
    );

    // pg-boss returns null when singletonKey conflicts (job already queued)
    if (jobId === null) {
      return NextResponse.json(
        { error: "Search expansion already in progress" },
        { status: 409 },
      );
    }

    return NextResponse.json({
      status: "queued",
      message: "Expanding search...",
    });
  } catch (error) {
    console.error("[search/expand] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
