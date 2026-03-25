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

function formatDraftContext(draft: PreferencesDraft): string {
  const entries = Object.entries(draft).filter(
    ([, value]) => value !== undefined && value !== null,
  );

  if (entries.length === 0) {
    return "No preferences collected yet.";
  }

  return entries
    .map(([key, value]) => {
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

/** Build the prompt for extracting structured data from user free-text input. */
export function buildExtractionPrompt(
  userText: string,
  step: ConversationStep,
  currentDraft: PreferencesDraft,
): { system: string; prompt: string } {
  const prompt = `Current onboarding step:
${getStepDescription(step)}

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
