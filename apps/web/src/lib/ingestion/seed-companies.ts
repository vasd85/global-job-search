import type { Database } from "../db";
import { companies } from "../db/schema";

interface SeedCompany {
  name: string;
  ats_vendor: string;
  ats_slug: string;
  website?: string;
  industry?: string[];
}

/**
 * Seed companies from a JSON array. Skips duplicates by (ats_vendor, ats_slug).
 */
export async function seedCompanies(
  db: Database,
  data: SeedCompany[]
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const entry of data) {
    const slug = `${entry.ats_vendor}-${entry.ats_slug}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    try {
      await db.insert(companies).values({
        slug,
        name: entry.name,
        website: entry.website ?? null,
        industry: entry.industry ?? null,
        atsVendor: entry.ats_vendor,
        atsSlug: entry.ats_slug,
        source: "seed_list",
      }).onConflictDoNothing();
      inserted++;
    } catch {
      skipped++;
    }
  }

  return { inserted, skipped };
}

/**
 * A small set of well-known companies for initial testing.
 */
export const TEST_SEED_COMPANIES: SeedCompany[] = [
  { name: "Stripe", ats_vendor: "greenhouse", ats_slug: "stripe", website: "https://stripe.com", industry: ["fintech", "payments"] },
  { name: "Figma", ats_vendor: "greenhouse", ats_slug: "figma", website: "https://figma.com", industry: ["design", "developer_tools"] },
  { name: "Notion", ats_vendor: "ashby", ats_slug: "notion", website: "https://notion.so", industry: ["productivity", "saas"] },
  { name: "Vercel", ats_vendor: "greenhouse", ats_slug: "vercel", website: "https://vercel.com", industry: ["developer_tools", "cloud"] },
  { name: "Linear", ats_vendor: "ashby", ats_slug: "linear", website: "https://linear.app", industry: ["developer_tools", "project_management"] },
  { name: "Kraken", ats_vendor: "ashby", ats_slug: "kraken.com", website: "https://kraken.com", industry: ["web3", "crypto", "exchange"] },
  { name: "Coinbase", ats_vendor: "greenhouse", ats_slug: "coinbase", website: "https://coinbase.com", industry: ["web3", "crypto", "exchange"] },
  { name: "Ramp", ats_vendor: "ashby", ats_slug: "ramp", website: "https://ramp.com", industry: ["fintech", "spend_management"] },
  { name: "Plaid", ats_vendor: "lever", ats_slug: "plaid", website: "https://plaid.com", industry: ["fintech", "open_banking"] },
  { name: "Cloudflare", ats_vendor: "greenhouse", ats_slug: "cloudflare", website: "https://cloudflare.com", industry: ["cloud", "security", "networking"] },
];
