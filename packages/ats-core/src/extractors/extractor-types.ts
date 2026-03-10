import type { AllJob, Diagnostics, JobSourceRef, JobSourceType } from "../types";

export interface RawJobInput {
  title: string;
  url: string;
  jobIdHint?: string | null;
  locationRaw?: string | null;
  departmentRaw?: string | null;
  postedDateRaw?: string | null;
  employmentTypeRaw?: string | null;
  descriptionHtml?: string | null;
  descriptionText?: string | null;
  requirementsText?: string | null;
  responsibilitiesText?: string | null;
  benefitsText?: string | null;
  salaryRaw?: string | null;
  workplaceType?: string | null;
  applyUrl?: string | null;
  sourceDetailUrl?: string | null;
  sourceJobRaw?: unknown | null;
  detailFetchStatus?: "ok" | "failed" | "not_supported";
  detailFetchNote?: string | null;
}

export interface ExtractionContext {
  careersUrl: string;
  timeoutMs: number;
  maxRetries: number;
  maxAttempts?: number;
  diagnostics: Diagnostics;
}

export interface ExtractionResult {
  jobs: AllJob[];
  errors: string[];
}

export interface BuildJobArgs {
  raw: RawJobInput;
  sourceType: JobSourceType;
  sourceRef: JobSourceRef;
  baseUrl: string;
}
