import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { seedCompanies, TEST_SEED_COMPANIES } from "@/lib/ingestion/seed-companies";
import { seedSynonyms } from "@/lib/ingestion/seed-synonyms";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const [companyResult, synonymResult] = await Promise.all([
      seedCompanies(db, TEST_SEED_COMPANIES),
      seedSynonyms(db),
    ]);
    return NextResponse.json({
      success: true,
      companies: {
        inserted: companyResult.inserted,
        skipped: companyResult.skipped,
      },
      synonyms: {
        upserted: synonymResult.upserted,
        skipped: synonymResult.skipped,
      },
      message: `Seeded ${companyResult.inserted} companies (${companyResult.skipped} skipped), ${synonymResult.upserted} synonym groups (${synonymResult.skipped} skipped)`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
