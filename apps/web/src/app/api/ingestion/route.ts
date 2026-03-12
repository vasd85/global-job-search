import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runIngestion } from "@/lib/ingestion/run-ingestion";

interface IngestionBody {
  companyIds?: string[];
  concurrency?: number;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as IngestionBody;
    const companyIds = body.companyIds;
    const concurrency = body.concurrency ?? 5;

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
