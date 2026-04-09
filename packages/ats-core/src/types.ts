export const ATS_VENDORS = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
  "teamtailor",
  "personio",
  "workday",
  "bamboohr",
  "breezy",
  "custom",
  "unknown"
] as const;
export type AtsVendor = (typeof ATS_VENDORS)[number];

export type JobSourceType = "ats_api" | "html";
export type JobSourceRef =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "smartrecruiters"
  | "teamtailor"
  | "personio"
  | "workday"
  | "bamboohr"
  | "breezy"
  | "custom";

export const DETAIL_FETCH_STATUSES = ["ok", "failed", "not_supported"] as const;
export type DetailFetchStatus = (typeof DETAIL_FETCH_STATUSES)[number];

export interface Diagnostics {
  attempted_urls: string[];
  search_queries: string[];
  last_reachable_url: string | null;
  attempts: number;
  http_status: string | null;
  errors: string[];
  notes: string[];
}

export interface AllJob {
  job_uid: string;
  job_id: string;
  title: string;
  url: string;
  canonical_url: string;
  location: string | null;
  department: string | null;
  posted_at: Date | null;
  employment_type: string | null;
  description_text?: string | null;
  salary?: string | null;
  workplace_type?: string | null;
  apply_url?: string | null;
  source_detail_url?: string | null;
  source_job_raw?: unknown | null;
  detail_fetch_status?: DetailFetchStatus;
  detail_fetch_note?: string | null;
  source_type: JobSourceType;
  source_ref: JobSourceRef;
}

export interface FetchContext {
  timeoutMs: number;
  maxRetries: number;
  maxAttempts?: number;
  diagnostics?: Diagnostics;
  userAgent?: string;
}

export function createEmptyDiagnostics(): Diagnostics {
  return {
    attempted_urls: [],
    search_queries: [],
    last_reachable_url: null,
    attempts: 0,
    http_status: null,
    errors: [],
    notes: []
  };
}
