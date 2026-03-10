import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runIngestion } from "@/lib/ingestion/run-ingestion";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const companyIds = body.companyIds as string[] | undefined;
    const concurrency = (body.concurrency as number) ?? 5;

    const result = await runIngestion(db, {
      concurrency,
      companyIds,
    });

    return NextResponse.json({
      success: true,
      ...result,
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
