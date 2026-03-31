import { eq, and, desc, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  classifyJobMulti,
  extractSeniority,
  type RoleFamilyDef,
} from "@gjs/ats-core";
import type { Database } from "@/lib/db";
import {
  jobs,
  companies,
  userProfiles,
  userCompanyPreferences,
  roleFamilies,
} from "@/lib/db/schema";
import type { SearchResponse, SearchResultJob } from "./types";

/** Batch size for streaming job classification. */
const BATCH_SIZE = 5000;

/** Minimum classifier score for a job to pass the role family filter. */
const CLASSIFICATION_THRESHOLD = 0.5;

/**
 * Core search function: loads user preferences, resolves role families,
 * runs the Level 2 filter pipeline, and returns paginated results.
 *
 * The pipeline:
 * 1. SQL pre-filter (status, industry overlap, workplace type)
 * 2. In-memory role family classification via classifyJobMulti()
 * 3. Seniority extraction and filter
 * 4. Location substring filter
 * 5. Pagination on the filtered results
 */
export async function searchJobs(
  db: Database,
  userProfileId: string,
  pagination: { limit: number; offset: number },
): Promise<SearchResponse> {
  // 1. Load user profile
  const profileRows = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.id, userProfileId))
    .limit(1);

  const profile = profileRows[0];
  if (!profile) {
    return emptyResponse(pagination);
  }

  // 2. Load user company preferences
  const companyPrefRows = await db
    .select()
    .from(userCompanyPreferences)
    .where(eq(userCompanyPreferences.userId, profile.userId))
    .limit(1);

  const companyPrefs = companyPrefRows[0];
  const industries = companyPrefs?.industries ?? [];

  // 3. Load all role families from DB
  const allFamilies = await db.select().from(roleFamilies);

  if (allFamilies.length === 0) {
    return emptyResponse(pagination);
  }

  // 4. Resolve user's target titles to matching role families
  const targetTitles = profile.targetTitles ?? [];
  const matchedFamilies = resolveRoleFamilies(allFamilies, targetTitles);

  if (matchedFamilies.length === 0) {
    return buildResponse([], 0, false, pagination, {
      roleFamilies: [],
      seniority: profile.targetSeniority ?? null,
      remotePreference: profile.remotePreference ?? "any",
      locations: profile.preferredLocations ?? [],
      industries,
    });
  }

  const targetSeniority = profile.targetSeniority ?? [];
  const remotePreference = profile.remotePreference ?? "any";
  const preferredLocations = profile.preferredLocations ?? [];
  const familySlugs = matchedFamilies.map((f) => f.slug);

  // 5. Build SQL pre-filter conditions
  const conditions = buildSqlConditions(industries, remotePreference);

  // 6. Batched processing: stream jobs through the classifier
  const { results, total, hasMore } = await processInBatches(
    db,
    conditions,
    matchedFamilies,
    targetSeniority,
    remotePreference,
    preferredLocations,
    pagination,
  );

  return buildResponse(results, total, hasMore, pagination, {
    roleFamilies: familySlugs,
    seniority: targetSeniority.length > 0 ? targetSeniority : null,
    remotePreference,
    locations: preferredLocations,
    industries,
  });
}

/**
 * Resolve user's target titles to matching role families by running
 * the classifier in reverse: classify each target title against all
 * role families and collect those that score above the threshold.
 */
function resolveRoleFamilies(
  allFamilies: Array<{
    slug: string;
    strongMatch: string[];
    moderateMatch: string[];
    departmentBoost: string[];
    departmentExclude: string[];
  }>,
  targetTitles: string[],
): RoleFamilyDef[] {
  if (targetTitles.length === 0) return [];

  const matchedSlugs = new Set<string>();

  for (const title of targetTitles) {
    for (const family of allFamilies) {
      const def: RoleFamilyDef = {
        slug: family.slug,
        strongMatch: family.strongMatch,
        moderateMatch: family.moderateMatch,
        departmentBoost: family.departmentBoost,
        departmentExclude: family.departmentExclude,
      };

      const result = classifyJobMulti([def], {
        title,
        departmentRaw: null,
      });

      if (result.score >= CLASSIFICATION_THRESHOLD) {
        matchedSlugs.add(family.slug);
      }
    }
  }

  return allFamilies
    .filter((f) => matchedSlugs.has(f.slug))
    .map((f) => ({
      slug: f.slug,
      strongMatch: f.strongMatch,
      moderateMatch: f.moderateMatch,
      departmentBoost: f.departmentBoost,
      departmentExclude: f.departmentExclude,
    }));
}

/**
 * Normalize user industry preferences into tags comparable with company
 * industry values. Splits compound labels (e.g., "Web3/Blockchain/Crypto")
 * on "/" delimiter, lowercases, and trims whitespace.
 */
export function normalizeIndustryTerms(industries: string[]): string[] {
  const terms = new Set<string>();
  for (const industry of industries) {
    for (const part of industry.split("/")) {
      const normalized = part.trim().toLowerCase();
      if (normalized.length > 0) {
        terms.add(normalized);
      }
    }
  }
  return [...terms];
}

/**
 * Build SQL WHERE conditions for the pre-filter query.
 * Always filters on status = 'open'. Optionally adds industry overlap
 * and workplace type conditions.
 */
function buildSqlConditions(
  industries: string[],
  remotePreference: string,
): SQL[] {
  const conditions: SQL[] = [eq(jobs.status, "open")];

  // Raw SQL: Drizzle pg-core lacks an arrayOverlaps operator for text arrays.
  // Industry terms are normalized (split on "/", lowercased) to bridge the
  // vocabulary gap between chatbot labels and company industry tags.
  const normalizedIndustries = normalizeIndustryTerms(industries);
  if (normalizedIndustries.length > 0) {
    conditions.push(
      sql`${companies.industry} && ARRAY[${sql.join(
        normalizedIndustries.map((i) => sql`${i}`),
        sql`, `,
      )}]::text[]`,
    );
  }

  if (remotePreference === "remote_only") {
    conditions.push(eq(jobs.workplaceType, "remote"));
  }

  return conditions;
}

/** Row shape returned from the SQL pre-filter query. */
interface CandidateRow {
  id: string;
  title: string;
  url: string;
  applyUrl: string | null;
  locationRaw: string | null;
  departmentRaw: string | null;
  workplaceType: string | null;
  salaryRaw: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  companyName: string;
  companySlug: string;
  companyIndustry: string[] | null;
}

/**
 * Process candidate jobs in batches: fetch from DB, classify in-memory,
 * apply seniority and location filters, and accumulate until we have
 * enough results for the requested page.
 */
async function processInBatches(
  db: Database,
  conditions: SQL[],
  matchedFamilies: RoleFamilyDef[],
  targetSeniority: string[],
  remotePreference: string,
  preferredLocations: string[],
  pagination: { limit: number; offset: number },
): Promise<{ results: SearchResultJob[]; total: number; hasMore: boolean }> {
  const needed = pagination.offset + pagination.limit;
  const allPassing: SearchResultJob[] = [];
  let batchOffset = 0;
  let hasMore = false;

  while (true) {
    const batch = await fetchBatch(db, conditions, batchOffset, BATCH_SIZE);

    if (batch.length === 0) break;

    for (const row of batch) {
      const classified = classifyJobMulti(matchedFamilies, {
        title: row.title,
        departmentRaw: row.departmentRaw,
      });

      if (classified.score < CLASSIFICATION_THRESHOLD) continue;

      // Seniority extraction (reused for both filter and result metadata)
      const seniority = extractSeniority(row.title);

      // Seniority filter
      if (targetSeniority.length > 0) {
        // Pass jobs with no seniority marker (could be any level) or
        // where detected seniority overlaps with user's target
        if (seniority !== null && !targetSeniority.includes(seniority)) {
          continue;
        }
      }

      // Location filter (only when not "any" and user has location preferences)
      if (
        remotePreference !== "any" &&
        preferredLocations.length > 0 &&
        row.locationRaw !== null
      ) {
        const locationLower = row.locationRaw.toLowerCase();
        const locationMatch = preferredLocations.some((loc) =>
          locationLower.includes(loc.toLowerCase()),
        );
        if (!locationMatch) continue;
      }

      allPassing.push({
        id: row.id,
        title: row.title,
        url: row.url,
        applyUrl: row.applyUrl,
        locationRaw: row.locationRaw,
        departmentRaw: row.departmentRaw,
        workplaceType: row.workplaceType,
        salaryRaw: row.salaryRaw,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        companyName: row.companyName,
        companySlug: row.companySlug,
        companyIndustry: row.companyIndustry,
        classificationScore: classified.score,
        classificationFamily: classified.familySlug,
        classificationMatchType: classified.matchType,
        detectedSeniority: seniority,
      });

      // Once we have one more than needed, we know there are more results
      if (allPassing.length > needed) {
        hasMore = true;
        // Stop accumulating -- we have enough for the page plus proof of more
        return {
          results: allPassing.slice(pagination.offset, needed),
          total: allPassing.length,
          hasMore,
        };
      }
    }

    // If the batch was smaller than BATCH_SIZE, we've exhausted the dataset
    if (batch.length < BATCH_SIZE) break;

    batchOffset += BATCH_SIZE;
  }

  const pageResults = allPassing.slice(
    pagination.offset,
    pagination.offset + pagination.limit,
  );
  hasMore = pagination.offset + pagination.limit < allPassing.length;

  return {
    results: pageResults,
    total: allPassing.length,
    hasMore,
  };
}

/**
 * Fetch a batch of candidate jobs from the database using the pre-filter
 * conditions. Returns jobs joined with company data, ordered by recency.
 */
async function fetchBatch(
  db: Database,
  conditions: SQL[],
  offset: number,
  limit: number,
): Promise<CandidateRow[]> {
  const whereClause = and(...conditions);

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      url: jobs.url,
      applyUrl: jobs.applyUrl,
      locationRaw: jobs.locationRaw,
      departmentRaw: jobs.departmentRaw,
      workplaceType: jobs.workplaceType,
      salaryRaw: jobs.salaryRaw,
      firstSeenAt: jobs.firstSeenAt,
      lastSeenAt: jobs.lastSeenAt,
      companyName: companies.name,
      companySlug: companies.slug,
      companyIndustry: companies.industry,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(whereClause)
    .orderBy(desc(jobs.firstSeenAt))
    .limit(limit)
    .offset(offset);

  return rows;
}

/** Build a SearchResponse from the given results and metadata. */
function buildResponse(
  resultJobs: SearchResultJob[],
  total: number,
  hasMore: boolean,
  pagination: { limit: number; offset: number },
  filters: SearchResponse["filters"],
): SearchResponse {
  return {
    jobs: resultJobs,
    total,
    hasMore,
    limit: pagination.limit,
    offset: pagination.offset,
    filters,
  };
}

/** Return an empty SearchResponse (e.g., when no profile or families found). */
function emptyResponse(
  pagination: { limit: number; offset: number },
): SearchResponse {
  return buildResponse([], 0, false, pagination, {
    roleFamilies: [],
    seniority: null,
    remotePreference: "any",
    locations: [],
    industries: [],
  });
}
