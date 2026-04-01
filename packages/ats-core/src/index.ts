// Types
export type {
  AtsVendor,
  AllJob,
  Diagnostics,
  FetchContext,
  JobSourceType,
  JobSourceRef,
  DetailFetchStatus
} from "./types";
export { ATS_VENDORS, DETAIL_FETCH_STATUSES, createEmptyDiagnostics } from "./types";

// Extractors
export {
  extractFromGreenhouse,
  extractFromLever,
  extractFromAshby,
  extractFromSmartRecruiters
} from "./extractors/index";
export type { ExtractionContext, ExtractionResult, BuildJobArgs } from "./extractors/index";

// Discovery
export {
  detectAtsVendor,
  isAtsHost,
  isKnownAtsVendor,
  parseGreenhouseBoardToken,
  parseLeverSite,
  parseAshbyBoard,
  parseSmartRecruitersCompanyFromCareersUrl,
  buildCareersUrl
} from "./discovery/index";

// Normalizer
export { buildJob, dedupeJobs } from "./normalizer/index";

// Classifier
export type { RoleFamilyDef, ClassificationInput, ClassificationResult, SeniorityLevel } from "./classifier/index";
export { SENIORITY_PREFIXES, normalizeTitle, classifyJob, classifyJobMulti, extractSeniority } from "./classifier/index";

// Utils
export { sha1, sha256 } from "./utils/hash";
export { normalizeUrl, canonicalizeHttpUrl, sameRegistrableHost } from "./utils/url";
export { fetchText } from "./utils/http";
export { normalizeText, htmlToText, mergeTextBlocks } from "./utils/job-text";

// Geo (location matching)
export type {
  ParsedJobLocation,
  ResolvedTierGeo,
  LocationMatchResult,
} from "./geo/index";
export {
  matchJobToTiers,
  resolveAllTiers,
  parseJobLocation,
} from "./geo/index";

// Taxonomy (synonym expansion)
export type { SynonymGroup } from "./taxonomy/index";
export { expandTerms, canonicalize } from "./taxonomy/index";
