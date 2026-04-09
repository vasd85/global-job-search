import type { PreferencesDraft } from "@/lib/chatbot/schemas";
import type { ConversationStep } from "@/lib/chatbot/steps";

// ─── System Prompts ─────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a structured data extraction assistant for a job search platform.
Your ONLY job is to parse the user's free-text input into structured fields for the current onboarding step.

Rules:
- Extract ONLY what the user explicitly stated. NEVER invent, assume, or hallucinate values.
- If the user's input is ambiguous or unclear, set clarificationNeeded to true and provide a clarificationQuestion.
- If the user provides partial information, extract what you can and set confidence accordingly.
- Normalize values to clean, consistent formats (e.g., capitalize city names, standardize skill names).
- For arrays, split comma-separated or listed items into individual array elements.
- Do NOT add items the user did not mention.
- Do NOT interpret silence as a preference. Only extract what was explicitly stated.`;

const SUMMARY_SYSTEM_PROMPT = `You are a summary assistant for a job search platform.
Generate a clear, human-readable summary of the user's collected job and company preferences.
Format the summary with labeled sections. Use bullet points for lists.
Be concise but comprehensive. Include all non-empty fields.
Do NOT add commentary, suggestions, or recommendations — just summarize what was collected.`;

const CLARIFICATION_SYSTEM_PROMPT = `You are a helpful onboarding assistant for a job search platform.
The user provided input that is ambiguous or unclear for the current step.
Generate a single, focused follow-up question to clarify their intent.
Be conversational and friendly. Do NOT explain the system — just ask the question.
Keep it to one or two sentences.`;

const ROLE_FAMILY_EXPANSION_SYSTEM_PROMPT = `You are a job taxonomy expert.
Given a job title that does not match any existing role family, suggest the most appropriate new role family.
A role family is a broad category that groups related job titles (e.g., "Software Engineering", "Product Management", "Data Science").
If the title clearly fits an existing family, indicate that instead of creating a new one.`;

// ─── Prompt Builders ────────────────────────────────────────────────────────

interface LocationTier {
  rank: number;
  workFormats: string[];
  scope: { type: string; include: string[]; exclude?: string[] };
  qualitativeConstraint?: string;
}

interface LocationPrefs {
  tiers: LocationTier[];
}

function isLocationPreferences(value: unknown): value is LocationPrefs {
  return (
    typeof value === "object" &&
    value !== null &&
    "tiers" in value &&
    Array.isArray((value as LocationPrefs).tiers)
  );
}

function formatLocationTier(tier: LocationTier): string {
  const formats = tier.workFormats
    .map((f) => f.charAt(0).toUpperCase() + f.slice(1))
    .join("/");

  const scopeParts: string[] = [];
  if (tier.scope.include.length > 0) {
    const preposition = tier.scope.type === "cities" ? "in" : "to";
    scopeParts.push(`${preposition} ${tier.scope.include.join(", ")}`);
  } else if (tier.scope.type === "any") {
    scopeParts.push("anywhere");
  }
  if (tier.scope.exclude && tier.scope.exclude.length > 0) {
    scopeParts.push(`(except ${tier.scope.exclude.join(", ")})`);
  }
  if (tier.qualitativeConstraint) {
    scopeParts.push(`— ${tier.qualitativeConstraint}`);
  }

  return `${formats} ${scopeParts.join(" ")}`.trim();
}

function formatLocationPreferences(lp: LocationPrefs): string {
  const grouped = new Map<number, LocationTier[]>();
  for (const tier of lp.tiers) {
    const existing = grouped.get(tier.rank) ?? [];
    existing.push(tier);
    grouped.set(tier.rank, existing);
  }

  const ranks = Array.from(grouped.keys()).sort((a, b) => a - b);
  return ranks
    .map((rank) => {
      const tiers = grouped.get(rank) ?? [];
      const tierLines = tiers.map((t) => formatLocationTier(t)).join("; ");
      return `    Tier ${String(rank)}: ${tierLines}`;
    })
    .join("\n");
}

function formatDraftContext(draft: PreferencesDraft): string {
  const entries = Object.entries(draft).filter(
    ([, value]) => value !== undefined && value !== null,
  );

  if (entries.length === 0) {
    return "No preferences collected yet.";
  }

  return entries
    .map(([key, value]) => {
      if (key === "locationPreferences" && isLocationPreferences(value)) {
        return `- locationPreferences:\n${formatLocationPreferences(value)}`;
      }
      if (Array.isArray(value)) {
        return `- ${key}: ${value.join(", ")}`;
      }
      return `- ${key}: ${String(value)}`;
    })
    .join("\n");
}

function getStepDescription(step: ConversationStep): string {
  const parts = [
    `Step: "${step.slug}"`,
    `Question: "${step.question}"`,
  ];
  if (step.helpText) {
    parts.push(`Help text: "${step.helpText}"`);
  }
  parts.push(`Fields to extract: ${step.fields.join(", ")}`);
  return parts.join("\n");
}

const LOCATION_EXTRACTION_GUIDANCE = `
For the "location" step, decompose the user's preferences into ranked tiers.

GENERAL TIER STRUCTURE
- Each tier has a rank (1 = most preferred), an array of work formats, an
  optional immigrationFlags object, and a geographic scope.
- Scope types: "countries" (specific countries), "regions" (broad like EU, Asia),
  "timezones" (timezone-range based), "cities" (specific cities), "any"
  (anywhere with optional qualitative constraints).
- If the user mentions exclusions ("EU except Cyprus"), put them in scope.exclude.
- If the user mentions qualitative criteria ("countries with good living
  standards"), put them in qualitativeConstraint.
- Preserve the user's prioritization order as rank values.
- If the user doesn't specify explicit priority, assign rank 1 to all (equal
  preference).
- Split different scope types at the same priority into separate tiers
  (e.g., "USA, Canada, EU except Cyprus" -> two tiers at rank 1: one for
  countries [USA, Canada], one for regions [EU] with exclude [Cyprus]).

WORK FORMATS (workFormats)
- workFormats may ONLY contain values from this set:
  "remote", "hybrid", "onsite". The string "relocation" is NOT a valid
  work format and must NEVER appear in workFormats.
- "remote", "remotely" -> workFormats: ["remote"]
- "hybrid" -> workFormats: ["hybrid"]
- "on-site", "onsite", "in office" -> workFormats: ["onsite"]
- If the user mentions willingness to relocate, the relocation intent goes
  in immigrationFlags.wantsRelocationPackage (see below). The workFormats
  array still describes which physical formats they accept — usually all
  three when they say "I'd relocate", unless they restrict it themselves
  ("I'd relocate but only for a hybrid role" -> workFormats: ["hybrid"]).

IMMIGRATION FLAGS (immigrationFlags)
- An optional object with three optional boolean fields. Set a flag ONLY
  when the user explicitly mentions the underlying concept. Silence is NOT
  a preference.
  - needsVisaSponsorship: true when the user says they need the employer to
    sponsor a visa or work permit ("visa sponsorship", "H1B", "sponsored visa",
    "need visa", "work permit needed").
  - wantsRelocationPackage: true when the user mentions willingness to
    relocate, moving for the role, or wanting a relocation/housing package
    ("relocate", "willing to move", "I'll move", "relocation package",
    "relocation support"). This is SCORE-ONLY and never filters jobs out.
  - needsUnrestrictedWorkAuth: true when the user is not a local citizen of
    the target region and the job must NOT restrict to "locals only" /
    "citizens only" / "must have right to work in [country]" ("I'm not an
    EU citizen", "I don't have the right to work in the US").

DO NOT INTERPRET SILENCE
- Do NOT set needsVisaSponsorship: true unless the user explicitly mentioned
  visa, sponsorship, or work permit.
- Do NOT set wantsRelocationPackage: true unless they mentioned relocation
  or willingness to move.
- Do NOT set needsUnrestrictedWorkAuth: true unless they explicitly stated
  they are not local to the target region or that they need the employer to
  not require local citizenship.

WORKED EXAMPLES

Example 1: "I'd love to relocate to NYC or London, would also consider remote
anywhere in the EU, and as a last resort I'd relocate anywhere with a good
tech scene."
Result tiers:
  Tier rank 1: workFormats=["remote","hybrid","onsite"],
               immigrationFlags={ wantsRelocationPackage: true },
               scope type="cities", include=["NYC", "London"]
  Tier rank 2: workFormats=["remote"],
               scope type="regions", include=["EU"]
  Tier rank 3: workFormats=["remote","hybrid","onsite"],
               immigrationFlags={ wantsRelocationPackage: true },
               scope type="any", include=[],
               qualitativeConstraint="good tech scene"

Example 2: "Remote only, anywhere with English-speaking team."
Result tiers:
  Tier rank 1: workFormats=["remote"],
               scope type="any", include=[],
               qualitativeConstraint="English-speaking team"

Example 3: "Berlin or Amsterdam, hybrid preferred. I need visa sponsorship
since I'm not an EU citizen."
Result tiers:
  Tier rank 1: workFormats=["hybrid"],
               immigrationFlags={ needsVisaSponsorship: true,
                                  needsUnrestrictedWorkAuth: true },
               scope type="cities", include=["Berlin", "Amsterdam"]
`;

/** Build the prompt for extracting structured data from user free-text input. */
export function buildExtractionPrompt(
  userText: string,
  step: ConversationStep,
  currentDraft: PreferencesDraft,
): { system: string; prompt: string } {
  const stepGuidance =
    step.slug === "location" ? `\n${LOCATION_EXTRACTION_GUIDANCE}\n` : "";

  const prompt = `Current onboarding step:
${getStepDescription(step)}
${stepGuidance}
Previously collected preferences:
${formatDraftContext(currentDraft)}

User input:
"${userText}"

Extract the relevant fields from the user's input for this step.
If the input references previously collected data (e.g., "same as before"), resolve it using the context above.
Set clarificationNeeded to true if the input is too vague to extract meaningful values.`;

  return { system: EXTRACTION_SYSTEM_PROMPT, prompt };
}

/** Build the prompt for summarizing the collected preferences draft. */
export function buildSummaryPrompt(currentDraft: PreferencesDraft): {
  system: string;
  prompt: string;
} {
  const prompt = `Here are the user's collected job and company preferences:

${formatDraftContext(currentDraft)}

Generate a clear, readable summary organized by category (Job Preferences, Company Preferences, Dimension Weights).
Only include sections that have data. Use bullet points for list values.`;

  return { system: SUMMARY_SYSTEM_PROMPT, prompt };
}

/** Build the prompt for generating a clarification follow-up question. */
export function buildClarificationPrompt(
  userText: string,
  step: ConversationStep,
  currentDraft: PreferencesDraft,
): { system: string; prompt: string } {
  const prompt = `Current onboarding step:
${getStepDescription(step)}

Previously collected preferences:
${formatDraftContext(currentDraft)}

User's unclear input:
"${userText}"

Generate a friendly follow-up question to clarify what the user means for this step.`;

  return { system: CLARIFICATION_SYSTEM_PROMPT, prompt };
}

/** Build the prompt for suggesting a role family for an unknown job title. */
export function buildRoleFamilyExpansionPrompt(
  targetRole: string,
  existingFamilies: string[],
): { system: string; prompt: string } {
  const prompt = `Job title: "${targetRole}"

Existing role families in the system:
${existingFamilies.map((f) => `- ${f}`).join("\n")}

Does this job title fit into one of the existing role families above?
If yes, indicate which one. If no, suggest a new role family name that would encompass this and similar titles.`;

  return { system: ROLE_FAMILY_EXPANSION_SYSTEM_PROMPT, prompt };
}
