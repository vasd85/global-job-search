import {
  type StructuredControlConfig,
  type StepInputType,
  type StructuredOption,
  TargetRolesExtractionSchema,
  CoreSkillsExtractionSchema,
  GrowthSkillsExtractionSchema,
  AvoidSkillsExtractionSchema,
  DealBreakersExtractionSchema,
  LocationExtractionSchema,
  IndustriesExtractionSchema,
  HqGeographiesExtractionSchema,
  ProductTypesExtractionSchema,
  ExclusionsExtractionSchema,
} from "./schemas";

// ─── Step Definition ───────────────────────────────────────────────────────

export interface ConversationStep {
  /** Unique identifier for the step */
  slug: string;
  /** Key(s) in PreferencesDraft this step populates */
  fields: string[];
  /** Assistant message shown to the user */
  question: string;
  /** Optional explanation to help the user */
  helpText?: string;
  /** Whether the step must be completed before finalization */
  required: boolean;
  /** Whether the user can skip this step via a Skip button */
  skippable: boolean;
  /** How the user provides input */
  inputType: StepInputType;
  /** Config for structured/hybrid controls */
  structuredConfig?: StructuredControlConfig;
  /** Zod schema for LLM extraction (free_text/hybrid steps only) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- extraction schemas are heterogeneous; validated at runtime
  extractionSchema?: any;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function toOptions(values: string[]): StructuredOption[] {
  return values.map((value) => ({
    value,
    label: value
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
  }));
}

const SENIORITY_OPTIONS = toOptions([
  "junior",
  "mid",
  "senior",
  "lead",
  "manager",
  "director",
  "vp",
]);

const COMPANY_SIZE_OPTIONS = toOptions(["startup", "scaleup", "enterprise"]);

const COMPANY_STAGE_OPTIONS = toOptions([
  "seed",
  "series_a",
  "series_b",
  "series_c",
  "late_stage",
  "public",
]);

const WORK_FORMAT_OPTIONS = toOptions(["remote_first", "hybrid", "onsite"]);

// ─── Step Definitions ──────────────────────────────────────────────────────

export const STEPS: ConversationStep[] = [
  // --- Job Preferences ---

  {
    slug: "target_roles",
    fields: ["targetTitles"],
    question:
      "What position are you looking for? Tell me the job titles you are targeting.",
    helpText:
      'For example: "Senior QA Engineer", "Test Automation Lead", "SDET". You can list multiple titles.',
    required: true,
    skippable: false,
    inputType: "free_text",
    extractionSchema: TargetRolesExtractionSchema,
  },

  {
    slug: "target_seniority",
    fields: ["targetSeniority"],
    question: "What seniority level(s) are you targeting?",
    helpText: "Select one or more levels that match your experience.",
    required: true,
    skippable: false,
    inputType: "structured",
    structuredConfig: {
      type: "multi_select",
      options: SENIORITY_OPTIONS,
    },
  },

  {
    slug: "core_skills",
    fields: ["coreSkills"],
    question:
      "What are your core skills? What are you best at and definitely want to keep using?",
    helpText:
      'For example: "Selenium, API testing, CI/CD, Python". List the skills that define your expertise.',
    required: true,
    skippable: false,
    inputType: "hybrid",
    extractionSchema: CoreSkillsExtractionSchema,
  },

  {
    slug: "growth_skills",
    fields: ["growthSkills"],
    question: "What skills would you like to learn or grow into on your next job?",
    helpText:
      'For example: "AI testing tools, performance engineering, Kubernetes". These are skills you want to develop.',
    required: false,
    skippable: true,
    inputType: "hybrid",
    extractionSchema: GrowthSkillsExtractionSchema,
  },

  {
    slug: "avoid_skills",
    fields: ["avoidSkills"],
    question:
      "Is there anything you definitely do NOT want to work with, even if you are capable of it?",
    helpText:
      'For example: "Manual regression testing, SAP, legacy PHP". These will be flagged as negative matches.',
    required: false,
    skippable: true,
    inputType: "hybrid",
    extractionSchema: AvoidSkillsExtractionSchema,
  },

  {
    slug: "deal_breakers",
    fields: ["dealBreakers"],
    question: "Are there any absolute deal-breakers for you?",
    helpText:
      'For example: "Requires security clearance", "Travel >50%", "Contract role". Jobs matching these will be scored as 0%.',
    required: false,
    skippable: true,
    inputType: "free_text",
    extractionSchema: DealBreakersExtractionSchema,
  },

  {
    slug: "salary",
    fields: ["minSalary", "targetSalary", "salaryCurrency"],
    question: "What are your salary expectations (annual, gross)?",
    helpText:
      "Enter your minimum acceptable and target annual gross salary, and the currency. Leave blank if you prefer not to specify.",
    required: false,
    skippable: true,
    inputType: "structured",
    structuredConfig: {
      type: "range",
      min: 0,
      max: 1_000_000,
    },
  },

  {
    slug: "location",
    fields: ["locationPreferences"],
    question:
      "What are your location and work arrangement preferences? Feel free to describe multiple tiers of preference — for example, your ideal scenario, what you'd also consider, and what you'd accept as a backup.",
    helpText:
      "For example: 'I'd love to relocate to NYC or London, would also consider remote for any EU company, and as a last resort I'd relocate anywhere with good tech scene.' You can mention countries, regions, timezones, remote/onsite/hybrid preferences, and any exclusions.",
    required: true,
    skippable: false,
    inputType: "free_text",
    extractionSchema: LocationExtractionSchema,
  },

  // --- Company Preferences ---

  {
    slug: "industries",
    fields: ["industries"],
    question: "What industries or domains interest you most?",
    helpText:
      'For example: "Fintech, AI/ML, healthtech, developer tools". Select or type the domains you want to work in.',
    required: true,
    skippable: false,
    inputType: "hybrid",
    extractionSchema: IndustriesExtractionSchema,
  },

  {
    slug: "company_sizes",
    fields: ["companySizes"],
    question: "What company sizes do you prefer?",
    helpText:
      "Startup (1-50 employees), Scaleup (50-500), or Enterprise (500+). Select one or more.",
    required: true,
    skippable: false,
    inputType: "structured",
    structuredConfig: {
      type: "multi_select",
      options: COMPANY_SIZE_OPTIONS,
    },
  },

  {
    slug: "company_stages",
    fields: ["companyStages"],
    question: "Do you have a preference for company funding stage?",
    helpText:
      "Seed, Series A-C, Late Stage, or Public. Select any that appeal to you.",
    required: false,
    skippable: true,
    inputType: "structured",
    structuredConfig: {
      type: "multi_select",
      options: COMPANY_STAGE_OPTIONS,
    },
  },

  {
    slug: "work_format",
    fields: ["workFormat"],
    question: "What is your preferred work format at the company level?",
    helpText:
      "Remote-first, hybrid, or onsite. This is about the company culture, separate from your personal remote preference.",
    required: false,
    skippable: true,
    inputType: "structured",
    structuredConfig: {
      type: "single_select",
      options: WORK_FORMAT_OPTIONS,
    },
  },

  {
    slug: "hq_geographies",
    fields: ["hqGeographies"],
    question:
      "Do you have preferences for where the company is headquartered?",
    helpText:
      "Company HQ location can affect timezone overlap, visa sponsorship, and work culture.",
    required: false,
    skippable: true,
    inputType: "free_text",
    extractionSchema: HqGeographiesExtractionSchema,
  },

  {
    slug: "product_types",
    fields: ["productTypes"],
    question: "What types of products interest you?",
    helpText:
      'For example: "B2B SaaS, developer tools, infrastructure, B2C mobile apps".',
    required: false,
    skippable: true,
    inputType: "hybrid",
    extractionSchema: ProductTypesExtractionSchema,
  },

  {
    slug: "exclusions",
    fields: ["exclusions"],
    question:
      "Are there any types of companies you want to explicitly exclude?",
    helpText:
      'For example: "Outsourcing companies, staffing agencies, gambling industry". These companies will be filtered out.',
    required: false,
    skippable: true,
    inputType: "free_text",
    extractionSchema: ExclusionsExtractionSchema,
  },

  // --- Finalization ---

  {
    slug: "dimension_weights",
    fields: [
      "weightRole",
      "weightSkills",
      "weightLocation",
      "weightCompensation",
      "weightDomain",
    ],
    question: "How important is each dimension to you?",
    helpText:
      "Adjust the sliders to set relative importance. The weights should add up to 1.0. Default weights are provided if you prefer to skip.",
    required: false,
    skippable: true,
    inputType: "structured",
    structuredConfig: {
      type: "slider",
      min: 0,
      max: 1,
    },
  },

  {
    slug: "review",
    fields: [],
    question:
      "Here is a summary of your preferences. Please review and confirm, or click any section to edit.",
    required: true,
    skippable: false,
    inputType: "structured",
  },
];

// ─── Lookup Helpers ────────────────────────────────────────────────────────

export function getStepBySlug(slug: string): ConversationStep | undefined {
  return STEPS.find((s) => s.slug === slug);
}

export function getStepIndex(slug: string): number {
  return STEPS.findIndex((s) => s.slug === slug);
}

export const TOTAL_STEPS = STEPS.length;
