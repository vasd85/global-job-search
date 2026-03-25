import type { Database } from "../db";
import { roleFamilies } from "../db/schema";

interface SeedRoleFamily {
  slug: string;
  name: string;
  strong_match: string[];
  moderate_match: string[];
  department_boost: string[];
  department_exclude: string[];
}

/**
 * Seed role families from a data array. Skips duplicates by slug (unique constraint).
 */
export async function seedRoleFamilies(
  db: Database,
  data: SeedRoleFamily[] = ROLE_FAMILY_SEED_DATA,
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const entry of data) {
    try {
      await db
        .insert(roleFamilies)
        .values({
          slug: entry.slug,
          name: entry.name,
          strongMatch: entry.strong_match,
          moderateMatch: entry.moderate_match,
          departmentBoost: entry.department_boost,
          departmentExclude: entry.department_exclude,
          isSystemDefined: true,
        })
        .onConflictDoNothing();
      inserted++;
    } catch {
      skipped++;
    }
  }

  return { inserted, skipped };
}

/**
 * The 10 initial role families covering core tech roles.
 * All patterns are lowercase for case-insensitive substring matching.
 */
export const ROLE_FAMILY_SEED_DATA: SeedRoleFamily[] = [
  {
    slug: "qa_testing",
    name: "QA & Testing",
    strong_match: [
      "qa engineer",
      "test engineer",
      "sdet",
      "quality assurance",
      "test automation",
      "qa analyst",
      "testing engineer",
      "qa lead",
      "automation engineer",
      "software test",
      "qa manager",
    ],
    moderate_match: [
      "quality engineer",
      "release engineer",
      "test specialist",
      "qa specialist",
      "performance test",
      "security test",
      "test architect",
      "qa architect",
    ],
    department_boost: ["qa", "quality", "testing", "test"],
    department_exclude: [
      "finance",
      "legal",
      "sales",
      "marketing",
      "hr",
      "human resources",
      "recruiting",
      "talent",
    ],
  },
  {
    slug: "backend",
    name: "Backend Engineering",
    strong_match: [
      "backend engineer",
      "back-end engineer",
      "backend developer",
      "back-end developer",
      "server engineer",
      "api developer",
      "api engineer",
      "systems engineer",
      "platform engineer",
    ],
    moderate_match: [
      "software engineer",
      "software developer",
      "application engineer",
      "application developer",
      "distributed systems",
      "microservices engineer",
    ],
    department_boost: ["backend", "back-end", "platform", "infrastructure", "server"],
    department_exclude: [
      "finance",
      "legal",
      "sales",
      "marketing",
      "hr",
      "human resources",
      "recruiting",
      "talent",
    ],
  },
  {
    slug: "frontend",
    name: "Frontend Engineering",
    strong_match: [
      "frontend engineer",
      "front-end engineer",
      "frontend developer",
      "front-end developer",
      "ui engineer",
      "ui developer",
      "web developer",
      "javascript engineer",
      "react engineer",
      "react developer",
    ],
    moderate_match: [
      "software engineer",
      "software developer",
      "application engineer",
      "web engineer",
    ],
    department_boost: ["frontend", "front-end", "ui", "web", "client"],
    department_exclude: [
      "finance",
      "legal",
      "sales",
      "marketing",
      "hr",
      "human resources",
      "recruiting",
      "talent",
    ],
  },
  {
    slug: "fullstack",
    name: "Fullstack Engineering",
    strong_match: [
      "fullstack engineer",
      "full-stack engineer",
      "fullstack developer",
      "full-stack developer",
      "full stack engineer",
      "full stack developer",
    ],
    moderate_match: [
      "software engineer",
      "software developer",
      "application engineer",
      "web engineer",
      "product engineer",
    ],
    department_boost: ["engineering", "product", "fullstack", "full-stack"],
    department_exclude: [
      "finance",
      "legal",
      "sales",
      "marketing",
      "hr",
      "human resources",
      "recruiting",
      "talent",
    ],
  },
  {
    slug: "devops_infra",
    name: "DevOps & Infrastructure",
    strong_match: [
      "devops engineer",
      "site reliability engineer",
      "sre",
      "infrastructure engineer",
      "cloud engineer",
      "platform engineer",
      "reliability engineer",
      "devops",
    ],
    moderate_match: [
      "systems engineer",
      "systems administrator",
      "network engineer",
      "cloud architect",
      "solutions architect",
      "security engineer",
      "devsecops",
    ],
    department_boost: [
      "devops",
      "infrastructure",
      "platform",
      "sre",
      "reliability",
      "cloud",
      "operations",
    ],
    department_exclude: [
      "finance",
      "legal",
      "sales",
      "marketing",
      "hr",
      "human resources",
      "recruiting",
      "talent",
    ],
  },
  {
    slug: "data_engineering",
    name: "Data Engineering",
    strong_match: [
      "data engineer",
      "analytics engineer",
      "etl developer",
      "data pipeline",
      "data infrastructure",
      "data platform engineer",
    ],
    moderate_match: [
      "software engineer",
      "backend engineer",
      "database engineer",
      "database administrator",
      "dba",
      "bi developer",
      "bi engineer",
      "data architect",
    ],
    department_boost: ["data", "analytics", "data engineering", "business intelligence"],
    department_exclude: [
      "finance",
      "legal",
      "sales",
      "marketing",
      "hr",
      "human resources",
      "recruiting",
      "talent",
    ],
  },
  {
    slug: "data_science",
    name: "Data Science & ML",
    strong_match: [
      "data scientist",
      "machine learning engineer",
      "ml engineer",
      "ai engineer",
      "research scientist",
      "applied scientist",
      "deep learning",
    ],
    moderate_match: [
      "data analyst",
      "research engineer",
      "ai researcher",
      "nlp engineer",
      "computer vision engineer",
      "quantitative analyst",
    ],
    department_boost: ["data science", "machine learning", "ai", "research", "ml"],
    department_exclude: [
      "finance",
      "legal",
      "sales",
      "marketing",
      "hr",
      "human resources",
      "recruiting",
      "talent",
    ],
  },
  {
    slug: "product_management",
    name: "Product Management",
    strong_match: [
      "product manager",
      "product owner",
      "product lead",
      "group product manager",
      "technical product manager",
    ],
    moderate_match: [
      "program manager",
      "project manager",
      "product analyst",
      "product strategist",
      "product operations",
    ],
    department_boost: ["product", "product management"],
    department_exclude: [
      "finance",
      "legal",
      "sales",
      "marketing",
      "hr",
      "human resources",
      "recruiting",
      "talent",
    ],
  },
  {
    slug: "design",
    name: "Design",
    strong_match: [
      "product designer",
      "ux designer",
      "ui designer",
      "ux/ui designer",
      "interaction designer",
      "visual designer",
      "design lead",
    ],
    moderate_match: [
      "ux researcher",
      "user researcher",
      "design systems",
      "graphic designer",
      "brand designer",
      "content designer",
      "design manager",
    ],
    department_boost: ["design", "ux", "product design", "creative"],
    department_exclude: [
      "finance",
      "legal",
      "sales",
      "marketing",
      "hr",
      "human resources",
      "recruiting",
      "talent",
    ],
  },
  {
    slug: "engineering_management",
    name: "Engineering Management",
    strong_match: [
      "engineering manager",
      "software engineering manager",
      "development manager",
      "vp of engineering",
      "director of engineering",
      "head of engineering",
      "cto",
    ],
    moderate_match: [
      "technical lead",
      "tech lead",
      "team lead",
      "architect",
      "principal engineer",
      "staff engineer",
      "distinguished engineer",
    ],
    department_boost: ["engineering", "technology", "r&d", "development"],
    department_exclude: [
      "finance",
      "legal",
      "sales",
      "marketing",
      "hr",
      "human resources",
      "recruiting",
      "talent",
    ],
  },
];
