const MAX_DESCRIPTION_CHARS = 4000;

interface JobData {
  title: string;
  descriptionText: string | null;
  locationRaw: string | null;
  workplaceType: string | null;
  salaryRaw: string | null;
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
- If the description is missing or minimal, score based on available information (title, location, salary) and note the limitation in matchReason.`;

/**
 * Build the system and user prompts for RSLCD job scoring.
 */
export function buildScoringPrompt(params: ScoringPromptParams): { system: string; user: string } {
  const { job, company, profile } = params;

  const user = `## Job Posting
Title: ${job.title}
Company: ${company.name}
Company Industries: ${joinOrDefault(company.industry)}
Location: ${job.locationRaw ?? "Not specified"}
Work Format: ${job.workplaceType ?? "Not specified"}
Salary: ${job.salaryRaw ?? "Not specified"}
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
