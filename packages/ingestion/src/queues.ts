/** Per-vendor ATS polling queue names. */
export const VENDOR_QUEUES = {
  greenhouse: "poll/greenhouse",
  lever: "poll/lever",
  ashby: "poll/ashby",
  smartrecruiters: "poll/smartrecruiters",
} as const;

/** Future job queue names (stubs for upcoming phases). */
export const FUTURE_QUEUES = {
  llmScoring: "score/llm",
  internetExpansion: "expand/internet",
  descriptionFetch: "fetch/description",
  roleTaxonomy: "expand/role-taxonomy",
} as const;
