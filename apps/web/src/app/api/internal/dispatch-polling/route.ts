import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, lte, or, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { VENDOR_QUEUES } from "@gjs/ingestion";
import { getQueue } from "@/lib/queue";

// ─── Auth ───────────────────────────────────────────────────────────────────

const DISPATCH_SECRET = process.env.DISPATCH_SECRET?.trim() || undefined;

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isAuthorized(request: Request): boolean {
  // If no secret is configured, the route is open (local dev)
  if (!DISPATCH_SECRET) {
    return true;
  }
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;
  return constantTimeCompare(authHeader, `Bearer ${DISPATCH_SECRET}`);
}

// ─── Route ──────────────────────────────────────────────────────────────────

/**
 * POST /api/internal/dispatch-polling
 *
 * Query companies due for polling and enqueue one pg-boss job per company
 * into the appropriate vendor queue. Called by Render Cron Job or manually
 * during development.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();

    // Find companies that are active and due for polling
    const dueCompanies = await db
      .select({
        id: companies.id,
        slug: companies.slug,
        atsVendor: companies.atsVendor,
      })
      .from(companies)
      .where(
        and(
          eq(companies.isActive, true),
          or(
            lte(companies.nextPollAfter, now),
            isNull(companies.nextPollAfter)
          )
        )
      );

    const boss = await getQueue();

    let enqueued = 0;
    let skipped = 0;
    let failed = 0;

    for (const company of dueCompanies) {
      const vendorKey = company.atsVendor.toLowerCase() as keyof typeof VENDOR_QUEUES;
      const queue = VENDOR_QUEUES[vendorKey];

      if (queue) {
        try {
          await boss.send(queue, { companyId: company.id });
          enqueued++;
        } catch (sendError) {
          failed++;
          console.error(
            `[dispatch-polling] Failed to enqueue ${company.slug}:`,
            sendError
          );
        }
      } else {
        console.warn(
          `[dispatch-polling] Unknown vendor "${company.atsVendor}" for ${company.slug}, skipping`
        );
        skipped++;
      }
    }

    return NextResponse.json({
      enqueued,
      skipped,
      failed,
      total: dueCompanies.length,
    });
  } catch (error) {
    console.error("[dispatch-polling] Error:", error);
    return NextResponse.json(
      { error: "Failed to dispatch polling jobs" },
      { status: 500 }
    );
  }
}
