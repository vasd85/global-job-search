import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const result = await db
      .select({
        id: companies.id,
        slug: companies.slug,
        name: companies.name,
        website: companies.website,
        atsVendor: companies.atsVendor,
        atsSlug: companies.atsSlug,
        isActive: companies.isActive,
        lastPolledAt: companies.lastPolledAt,
        lastPollStatus: companies.lastPollStatus,
        jobsCount: companies.jobsCount,
      })
      .from(companies)
      .orderBy(desc(companies.jobsCount));

    return NextResponse.json({ companies: result, total: result.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
