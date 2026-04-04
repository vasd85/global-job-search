import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobs, companies } from "@/lib/db/schema";
import { eq, desc, and, ilike, or, sql, isNotNull, inArray } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const status = searchParams.get("status") ?? "open";
    const workplaceType = searchParams.get("workplaceType"); // remote | hybrid | onsite
    const vendor = searchParams.get("vendor"); // greenhouse | lever | ashby | smartrecruiters
    const companySlug = searchParams.get("company");
    const hasDescription = searchParams.get("hasDescription"); // "true" to filter jobs with descriptions
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
    const offset = parseInt(searchParams.get("offset") ?? "0");

    const jobConditions = [eq(jobs.status, status)];
    const SUPPORTED_ATS_VENDORS = ["greenhouse", "lever", "ashby", "smartrecruiters"];
    const companyConditions: ReturnType<typeof eq>[] = [
      inArray(companies.atsVendor, SUPPORTED_ATS_VENDORS),
    ];

    if (search) {
      jobConditions.push(
        or(
          ilike(jobs.title, `%${search}%`),
          ilike(jobs.departmentRaw, `%${search}%`)
        )!
      );
    }

    if (workplaceType) {
      jobConditions.push(eq(jobs.workplaceType, workplaceType));
    }

    if (hasDescription === "true") {
      jobConditions.push(isNotNull(jobs.descriptionText));
    }

    if (vendor) {
      companyConditions.push(eq(companies.atsVendor, vendor));
    }

    if (companySlug) {
      companyConditions.push(eq(companies.slug, companySlug));
    }

    const whereClause = and(...jobConditions, ...companyConditions);

    const result = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        url: jobs.url,
        locationRaw: jobs.locationRaw,
        departmentRaw: jobs.departmentRaw,
        workplaceType: jobs.workplaceType,
        salaryRaw: jobs.salaryRaw,
        firstSeenAt: jobs.firstSeenAt,
        lastSeenAt: jobs.lastSeenAt,
        applyUrl: jobs.applyUrl,
        sourceRef: jobs.sourceRef,
        companyName: companies.name,
        companySlug: companies.slug,
      })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(whereClause)
      .orderBy(desc(jobs.firstSeenAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(whereClause);

    return NextResponse.json({
      jobs: result,
      total: countResult[0]?.count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
