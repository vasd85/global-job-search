export type {
  RoleFamilyDef,
  ClassificationInput,
  ClassificationResult,
  SeniorityLevel,
} from "./role-family-classifier";

export {
  SENIORITY_PREFIXES,
  normalizeTitle,
  classifyJob,
  classifyJobMulti,
  extractSeniority,
} from "./role-family-classifier";
