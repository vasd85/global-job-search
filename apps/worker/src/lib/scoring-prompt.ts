const MAX_DESCRIPTION_CHARS = 4000;

interface JobData {
  title: string;
  descriptionText: string | null;
  location: string | null;
  workplaceType: string | null;
  salary: string | null;
  url: string;
}

interface CompanyData {
  name: string;
  industry: string[] | null;
}

interface UserProfileData {
  targetTitles: string[] | null;
  targetSeniority: string[] | null;
  coreSkills: string[] | null;
  growthSkills: string[] | null;
  avoidSkills: string[] | null;
  dealBreakers: string[] | null;
  preferredLocations: string[] | null;
  remotePreference: string | null;
  locationPreferences: unknown;
  minSalary: number | null;
  targetSalary: number | null;
  salaryCurrency: string | null;
  preferredIndustries: string[] | null;
}

export interface ScoringPromptParams {
  job: JobData;
  company: CompanyData;
  profile: UserProfileData;
}

function joinOrDefault(values: string[] | null | undefined, fallback = "None specified"): string {
  if (!values || values.length === 0) return fallback;
  return values.join(", ");
}

function truncateDescription(text: string | null): string {
  if (!text) return "No description available";
  if (text.length <= MAX_DESCRIPTION_CHARS) return text;
  return text.slice(0, MAX_DESCRIPTION_CHARS) + "... [truncated]";
}

function formatSalaryRange(
  minSalary: number | null,
  targetSalary: number | null,
  currency: string | null,
): string {
  if (minSalary == null && targetSalary == null) return "Not specified";
  const curr = currency ?? "USD";
  if (minSalary != null && targetSalary != null) return `${minSalary}-${targetSalary} ${curr}`;
  if (targetSalary != null) return `Up to ${targetSalary} ${curr}`;
  return `At least ${minSalary} ${curr}`;
}

function summarizeLocationPreferences(
  locationPreferences: unknown,
  preferredLocations: string[] | null,
): string {
  if (preferredLocations && preferredLocations.length > 0) {
    return preferredLocations.join(", ");
  }
  if (locationPreferences && typeof locationPreferences === "object") {
    return JSON.stringify(locationPreferences);
  }
  return "None specified";
}

const SYSTEM_PROMPT = `You are a job matching evaluator. Score a job posting against a candidate's profile on 5 dimensions, each 0-10. Provide evidence from the job description. Be precise and objective.

## Scoring Dimensions

**Role Fit (scoreR)**: How well does the job title and responsibilities match the candidate's target roles and seniority level? 10 = perfect title + seniority match, 0 = completely unrelated role.

**Skills Fit (scoreS)**: How much overlap between job requirements and candidate's core skills? Does the job require any of their growth skills (positive signal)? Does it require any of their avoid skills (negative signal)? 10 = strong overlap with core skills, 0 = no overlap or heavy avoid-skill presence.

**Location Fit (scoreL)**: Does the job's location and work format (remote/hybrid/onsite) match the candidate's preferences? 10 = perfect match, 0 = incompatible location/format.

**Compensation Fit (scoreC)**: Is the salary (if stated) within the candidate's acceptable range? If no salary information is provided in the job posting, score 5 (neutral). 10 = at or above target, 0 = far below minimum.

**Domain Fit (scoreD)**: Does the company's industry match the candidate's preferred industries? 10 = exact industry match, 0 = completely unrelated industry.

## Instructions

- If the job triggers any of the candidate's deal-breakers, set dealBreakerTriggered to true and explain in dealBreakerReason.
- If the job requires any of the candidate's growth skills, set hasGrowthSkillMatch to true.
- Provide 1-2 sentence matchReason summarizing the overall fit.
- Include up to 5 short evidenceQuotes from the job description that support your scoring.
- If the description is missing or minimal, score based on available information (title, location, salary) and note the limitation in matchReason.

## Signal Extraction

In addition to the dimension scores above, extract the following structured signals from the job description into the \`extractedSignals\` field. These signals are persisted per-job and reused for filtering future users without re-invoking the LLM, so accuracy matters even when the field does not affect the current candidate's score.

CRITICAL RULES:
- Silence is NOT a "no" answer. If the description does not clearly address a question, emit \`"unknown"\` (for enums) or \`null\` / \`[]\` (for optional fields). Do not guess from "vibes".
- Only emit \`"yes"\` / \`"no"\` / a concrete value when the text contains explicit supporting language.
- Extract from the job description and any "requirements" / "qualifications" / "perks" / "benefits" sections. Do not hallucinate from company-level knowledge.
- Evidence for any non-default value should already appear in your \`evidenceQuotes\` for traceability.

Fields and their rules:

- \`visaSponsorship\`:
  - \`"yes"\` if the description explicitly offers visa sponsorship, mentions H1B, blue card, skilled worker visa, or "we sponsor work visas".
  - \`"no"\` if the description says "no sponsorship", "unable to sponsor", "must have existing work authorization", "cannot sponsor at this time".
  - Otherwise \`"unknown"\`.

- \`relocationPackage\`:
  - \`"yes"\` if the description explicitly offers relocation assistance, relocation package, paid relocation, housing allowance, moving expenses, or temporary housing.
  - \`"no"\` if the description explicitly says no relocation support.
  - Otherwise \`"unknown"\`.

- \`workAuthRestriction\`:
  - \`"citizens_only"\` for "must be a US citizen", "UK nationals only", citizenship-specific requirements (often tied to clearance or regulation).
  - \`"residents_only"\` for "must have existing US work authorization", "must be authorized to work for any US employer without sponsorship", "must hold a valid residence permit" — the candidate needs their own permit, the employer will not help.
  - \`"region_only"\` for broader regional bundles: "EU citizens or residents", "EEA nationals", "NATO nationals", "North American candidates only", "UK and Ireland".
  - \`"none"\` if the description does not restrict.
  - \`"unknown"\` if there is no statement either way.
  - Note: \`"residents_only"\` and \`"citizens_only"\` are mutually exclusive with \`"yes"\` on \`visaSponsorship\` (you cannot simultaneously sponsor a visa AND require existing authorization). If the description is ambiguous, lean to \`"unknown"\`.

- \`languageRequirements\`: array of language tags from explicit requirements only. "Native English" → \`["en"]\`. "Fluent German" → \`["de"]\`. "English and German required" → \`["en","de"]\`. Silence → \`[]\`. BCP-47 tags preferred; you may include proficiency suffix when explicit (e.g. \`"en-native"\`, \`"de-b2"\`).

- \`travelPercent\`: integer 0-100 if the description states "X% travel" or similar. \`null\` if silence. A vague statement like "some travel expected" without a percentage → \`null\`.

- \`securityClearance\`: free-text string of the explicit clearance name, or \`null\`. Examples: \`"US Secret"\`, \`"UK SC"\`, \`"TS/SCI"\`, \`"NATO Cosmic"\`. Silence → \`null\`.

- \`shiftPattern\`: free-text if the description mentions shifts, on-call, night work, or 24/7 operations. Examples: \`"rotating on-call"\`, \`"overnight shift"\`, \`"24/7 ops"\`. Silence → \`null\`.`;

/**
 * Build the system and user prompts for RSLCD job scoring.
 */
export function buildScoringPrompt(params: ScoringPromptParams): { system: string; user: string } {
  const { job, company, profile } = params;

  const user = `## Job Posting
Title: ${job.title}
Company: ${company.name}
Company Industries: ${joinOrDefault(company.industry)}
Location: ${job.location ?? "Not specified"}
Work Format: ${job.workplaceType ?? "Not specified"}
Salary: ${job.salary ?? "Not specified"}
URL: ${job.url}

### Description
${truncateDescription(job.descriptionText)}

## Candidate Profile
Target Roles: ${joinOrDefault(profile.targetTitles)}
Target Seniority: ${joinOrDefault(profile.targetSeniority)}
Core Skills: ${joinOrDefault(profile.coreSkills)}
Growth Skills (wants to learn): ${joinOrDefault(profile.growthSkills)}
Avoid Skills (does not want): ${joinOrDefault(profile.avoidSkills)}
Deal-Breakers: ${joinOrDefault(profile.dealBreakers)}
Location Preferences: ${summarizeLocationPreferences(profile.locationPreferences, profile.preferredLocations)}
Remote Preference: ${profile.remotePreference ?? "any"}
Salary Range: ${formatSalaryRange(profile.minSalary, profile.targetSalary, profile.salaryCurrency)}
Preferred Industries: ${joinOrDefault(profile.preferredIndustries)}`;

  return { system: SYSTEM_PROMPT, user };
}
