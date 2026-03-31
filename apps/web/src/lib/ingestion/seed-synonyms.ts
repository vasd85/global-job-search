import type { Database } from "../db";
import { synonymGroup } from "../db/schema";

interface SeedSynonymGroup {
  dimension: string;
  canonical: string;
  synonyms: string[];
  umbrellaKey: string | null;
}

/**
 * Seed synonym groups from a data array.
 * Upserts on (dimension, canonical) so the script is idempotent --
 * re-running updates synonyms and umbrella keys for existing rows.
 */
export async function seedSynonyms(
  db: Database,
  data: SeedSynonymGroup[] = INITIAL_SYNONYM_GROUPS,
): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0;
  let skipped = 0;

  for (const entry of data) {
    try {
      await db
        .insert(synonymGroup)
        .values({
          dimension: entry.dimension,
          canonical: entry.canonical,
          synonyms: entry.synonyms,
          umbrellaKey: entry.umbrellaKey,
        })
        .onConflictDoUpdate({
          target: [synonymGroup.dimension, synonymGroup.canonical],
          set: {
            synonyms: entry.synonyms,
            umbrellaKey: entry.umbrellaKey,
          },
        });
      upserted++;
    } catch {
      skipped++;
    }
  }

  return { upserted, skipped };
}

/**
 * Initial synonym groups for industry matching.
 * Each group maps a canonical term to its synonyms. Groups sharing an
 * umbrellaKey are linked for cross-concept expansion (e.g., "crypto" and
 * "web3" are separate concepts but belong to the same ecosystem).
 */
export const INITIAL_SYNONYM_GROUPS: SeedSynonymGroup[] = [
  // Crypto ecosystem (umbrella-linked)
  {
    dimension: "industry",
    canonical: "crypto",
    synonyms: ["crypto", "cryptocurrency", "bitcoin", "digital_currency"],
    umbrellaKey: "crypto_ecosystem",
  },
  {
    dimension: "industry",
    canonical: "web3",
    synonyms: ["web3", "blockchain", "defi", "decentralized_finance"],
    umbrellaKey: "crypto_ecosystem",
  },
  {
    dimension: "industry",
    canonical: "exchange",
    synonyms: ["exchange", "crypto_exchange", "digital_exchange"],
    umbrellaKey: "crypto_ecosystem",
  },

  // Fintech
  {
    dimension: "industry",
    canonical: "fintech",
    synonyms: ["fintech", "financial_technology", "financial_tech"],
    umbrellaKey: null,
  },
  {
    dimension: "industry",
    canonical: "payments",
    synonyms: ["payments", "payment_processing", "payment_infrastructure"],
    umbrellaKey: null,
  },

  // Cloud / Infra
  {
    dimension: "industry",
    canonical: "cloud",
    synonyms: ["cloud", "cloud_computing", "cloud_infrastructure"],
    umbrellaKey: null,
  },
  {
    dimension: "industry",
    canonical: "security",
    synonyms: ["security", "cybersecurity", "infosec", "information_security"],
    umbrellaKey: null,
  },

  // AI / ML
  {
    dimension: "industry",
    canonical: "ai",
    synonyms: ["ai", "artificial_intelligence"],
    umbrellaKey: null,
  },
  {
    dimension: "industry",
    canonical: "ml",
    synonyms: ["ml", "machine_learning"],
    umbrellaKey: null,
  },

  // Developer tools
  {
    dimension: "industry",
    canonical: "developer_tools",
    synonyms: ["developer_tools", "devtools", "dev_tools", "developer_infrastructure"],
    umbrellaKey: null,
  },

  // SaaS / Productivity
  {
    dimension: "industry",
    canonical: "saas",
    synonyms: ["saas", "software_as_a_service"],
    umbrellaKey: null,
  },
  {
    dimension: "industry",
    canonical: "productivity",
    synonyms: ["productivity", "productivity_tools", "workplace_tools"],
    umbrellaKey: null,
  },

  // Verticals
  {
    dimension: "industry",
    canonical: "healthtech",
    synonyms: ["healthtech", "health_tech", "healthcare_technology", "digital_health"],
    umbrellaKey: null,
  },
  {
    dimension: "industry",
    canonical: "edtech",
    synonyms: ["edtech", "education_technology", "ed_tech"],
    umbrellaKey: null,
  },
  {
    dimension: "industry",
    canonical: "ecommerce",
    synonyms: ["ecommerce", "e_commerce", "e-commerce", "online_retail"],
    umbrellaKey: null,
  },
];
