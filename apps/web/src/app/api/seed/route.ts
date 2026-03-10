import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { seedCompanies, TEST_SEED_COMPANIES } from "@/lib/ingestion/seed-companies";

export async function POST() {
  try {
    const result = await seedCompanies(db, TEST_SEED_COMPANIES);
    return NextResponse.json({
      success: true,
      ...result,
      message: `Seeded ${result.inserted} companies (${result.skipped} skipped)`,
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
