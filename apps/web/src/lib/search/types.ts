/** A single job result with classification metadata. */
export interface SearchResultJob {
  // Job fields from DB
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
  // Company fields
  companyName: string;
  companySlug: string;
  companyIndustry: string[] | null;
  // Classification metadata
  classificationScore: number;
  classificationFamily: string;
  classificationMatchType: string;
  detectedSeniority: string | null;
  /** Rank of the location preference tier this job matched, or null if no tier-based matching was used. */
  matchedLocationTier: number | null;
}

/** Shape of the search API response. */
export interface SearchResponse {
  jobs: SearchResultJob[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  filters: {
    roleFamilies: string[];
    seniority: string[] | null;
    remotePreference: string;
    locations: string[];
    industries: string[];
  };
}
