import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createLogger } from "@gjs/logger";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { SearchQuerySchema } from "@/lib/search/schemas";
import { searchJobs } from "@/lib/search/filter-pipeline";

const log = createLogger("search");

export async function GET(request: Request) {
  log.debug("GET received");

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    log.debug({ status: 401 }, "Unauthorized (no session)");
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }
  log.debug({ userId: session.user.id }, "Authenticated");

  try {
    // Load the user's profile to get the profile ID
    const profileRows = await db
      .select({ id: userProfiles.id })
      .from(userProfiles)
      .where(eq(userProfiles.userId, session.user.id))
      .limit(1);

    const profile = profileRows[0];
    if (!profile) {
      log.debug(
        { userId: session.user.id, status: 404 },
        "Profile not found",
      );
      return NextResponse.json(
        { error: "No profile found. Please complete onboarding first." },
        { status: 404 },
      );
    }
    log.debug({ profileId: profile.id }, "Profile loaded");

    // Parse and validate query params
    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get("limit");
    const rawOffset = searchParams.get("offset");
    log.debug({ rawLimit, rawOffset }, "Raw query params");

    const parsed = SearchQuerySchema.safeParse({
      limit: rawLimit ?? undefined,
      offset: rawOffset ?? undefined,
    });

    if (!parsed.success) {
      log.debug(
        { validationErrors: parsed.error.flatten(), status: 400 },
        "Query param validation failed",
      );
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { limit, offset } = parsed.data;
    log.debug({ limit, offset }, "Parsed query params");

    log.debug(
      { profileId: profile.id, limit, offset },
      "Calling searchJobs",
    );
    const result = await searchJobs(db, profile.id, { limit, offset });
    log.debug(
      {
        returned: result.jobs.length,
        total: result.total,
        hasMore: result.hasMore,
      },
      "Search completed",
    );

    return NextResponse.json(result);
  } catch (error) {
    log.error({ err: error }, "Search request failed");
    return NextResponse.json(
      { error: "An unexpected error occurred during search" },
      { status: 500 },
    );
  }
}
