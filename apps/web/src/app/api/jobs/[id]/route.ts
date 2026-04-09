import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobs, companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        url: jobs.url,
        canonicalUrl: jobs.canonicalUrl,
        location: jobs.location,
        department: jobs.department,
        workplaceType: jobs.workplaceType,
        salary: jobs.salary,
        employmentType: jobs.employmentType,
        postedAt: jobs.postedAt,
        descriptionText: jobs.descriptionText,
        applyUrl: jobs.applyUrl,
        status: jobs.status,
        firstSeenAt: jobs.firstSeenAt,
        lastSeenAt: jobs.lastSeenAt,
        sourceRef: jobs.sourceRef,
        companyId: jobs.companyId,
        companyName: companies.name,
        companySlug: companies.slug,
        companyWebsite: companies.website,
        atsVendor: companies.atsVendor,
      })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(eq(jobs.id, id))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json(result[0]);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
