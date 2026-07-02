/**
 * `CANONICAL_BRANCHES` — the single source of truth for the preference
 * tree's branch taxonomy (PRD §6.3, ADR-0011).
 *
 * IMPORTANT — TS-only behaviour hooks. The following `CanonicalBranchDef`
 * fields are *compile-time semantic hooks* consumed by the matcher /
 * derivation / summarisation pipelines. They do **NOT** round-trip to the
 * `preference_branch` table — the seeder persists only the runtime-editable
 * surface (`slug`, `parentSlug`, `displayName`, `sortOrder`, `description`,
 * `active`, `config`):
 *
 *   - `kind`
 *   - `l3Section`
 *   - `l3Soft`
 *   - `l2Derivation`
 *   - `matcherScope`
 *   - `acceptsSkillIntent`
 *   - `synonymDimension`
 *   - `maxPathDepth`
 *   - `isContainer`
 *
 * To change runtime matcher behaviour, edit this file and ship a migration.
 * Editing `preference_branch.config` in the DB will NOT influence the matcher.
 */

/**
 * Matcher dispatcher key. Lock-list: nine values, one per top-level slug.
 * NOT the same as `branchSlug` (which is the stored value on leaves and the
 * PK of `preference_branch` rows). Kind is the *contract* the matcher
 * pipeline reads against.
 */
export type CanonicalBranchKind =
  | "role"
  | "skills"
  | "compensation"
  | "location"
  | "industry"
  | "attribute"
  | "exclusion"
  | "dealbreaker"
  | "other";

/**
 * L2 derivation hook — names the kind of L2 input this branch's leaves
 * contribute to. `deriveL2Inputs(tree)` switches on this. New L2 inputs
 * require a new literal here + a new case in deriveL2Inputs.
 */
export type L2DerivationKind =
  | "titles"
  | "seniority"
  | "industry-tokens"
  | "remote-flag"
  | "location-tier";

export interface CanonicalBranchDef {
  /** Stable identifier. Lives in JSONB leaves. Lives on
   * `preference_branch.slug` PK. NEVER rename without a moveLeaves
   * migration (per ADR-0011 §Composition-change playbook). */
  slug: string;

  /** Dispatcher key for the matcher pipeline. */
  kind: CanonicalBranchKind;

  /** Human-readable label shown in UI. Editable at runtime via
   * `preference_branch.display_name`; CANONICAL_BRANCHES holds the seed
   * default. */
  displayName: string;

  /** One-sentence description shown to the conversation LLM and as
   * tooltip in Profile Map. Editable at runtime via
   * `preference_branch.description`. */
  description: string;

  /** Maximum allowed `branchPath` length for leaves under this branch.
   * Top-level-only branches use 1; branches with named sub-branches
   * (skills, company-attributes) use 2. Validated by LeafSchema.superRefine.
   * Decoupled from `app_config.ui.profile_map_max_depth` (that is a UI
   * concern; this is a data-shape constraint). */
  maxPathDepth: 1 | 2;

  /** True when this branch is a container for its sub-branches (no
   * direct leaves expected). The seed installs both the container row
   * and the sub-branch rows in preference_branch; LeafSchema.superRefine
   * rejects leaves whose branchPath ends at a container slug. */
  isContainer: boolean;

  /** L2 derivation hook. Absent → this branch contributes nothing to
   * L2 filtering. `deriveL2Inputs(tree)` iterates CANONICAL_BRANCHES,
   * routes leaves under each branch through the named kind. */
  l2Derivation?: L2DerivationKind;

  /** Synonym dimension feeding canonical-token expansion (per design
   * §17 cross-cutting). Bound to `synonym_group.dimension`. */
  synonymDimension?: string;

  /** True iff this branch's leaves accept the optional `skillIntent`
   * marker. Currently true for `skills` only. */
  acceptsSkillIntent?: boolean;

  /** Matcher dispatch scope (per ADR-0011 §Context). Used by future
   * exclusions/deal-breakers split; lock now to lock the type. */
  matcherScope?: "company" | "job" | "both";

  /** True iff this branch's leaves feed the soft per-claim L3 scoring
   * path (future l3-widening). Lock now to lock the type. */
  l3Soft?: boolean;

  /** Section label `summariseTreeForL3` emits for leaves under this
   * branch. Branches without a section are not summarised. The labels
   * mirror `scoring-prompt.ts:75-95` verbatim so the L3 system prompt
   * body is unchanged. */
  l3Section?:
    | "Core Skills" // skills/keep
    | "Growth Skills" // skills/grow
    | "Avoid Skills" // skills/avoid (rendered as "Avoid Skills")
    | "Deal-Breakers" // deal-breakers
    | "Preferred Industries"; // industry (include polarity)
}

/**
 * Top-level entries (nine). PRD §6.3 locks the slug set. Order in the
 * array drives sort-order. Container-vs-leaf taxonomy locked here.
 */
export const CANONICAL_BRANCHES: readonly CanonicalBranchDef[] = [
  {
    slug: "role",
    kind: "role",
    displayName: "Role",
    description: "Target roles, titles, and seniority.",
    maxPathDepth: 1,
    isContainer: false,
    l2Derivation: "titles",
    matcherScope: "job",
  },
  {
    slug: "skills",
    kind: "skills",
    displayName: "Skills",
    description: "Skills you keep, want to grow, or want to avoid.",
    maxPathDepth: 2,
    isContainer: true,
    acceptsSkillIntent: true,
    matcherScope: "job",
    l3Soft: true,
  },
  {
    slug: "compensation",
    kind: "compensation",
    displayName: "Compensation",
    description: "Salary, equity, and total-comp expectations.",
    maxPathDepth: 1,
    isContainer: false,
    matcherScope: "job",
  },
  {
    slug: "location",
    kind: "location",
    displayName: "Location",
    description: "Geographic and remote/hybrid/onsite preferences.",
    maxPathDepth: 1,
    isContainer: false,
    l2Derivation: "location-tier",
    matcherScope: "job",
  },
  {
    slug: "industry",
    kind: "industry",
    displayName: "Industry",
    description: "Industries you prefer (or want to exclude).",
    maxPathDepth: 1,
    isContainer: false,
    l2Derivation: "industry-tokens",
    synonymDimension: "industry",
    matcherScope: "company",
    l3Soft: true,
    l3Section: "Preferred Industries",
  },
  {
    slug: "company-attributes",
    kind: "attribute",
    displayName: "Company Attributes",
    description:
      "Company size, stage, funding, HQ, brand, and culture preferences.",
    maxPathDepth: 2,
    isContainer: true,
    matcherScope: "company",
    l3Soft: true,
  },
  {
    slug: "exclusions",
    kind: "exclusion",
    displayName: "Exclusions",
    description: "Companies or characteristics you want to exclude.",
    maxPathDepth: 1,
    isContainer: false,
    matcherScope: "company",
  },
  {
    slug: "deal-breakers",
    kind: "dealbreaker",
    displayName: "Deal-Breakers",
    description: "Job characteristics that disqualify a match.",
    maxPathDepth: 1,
    isContainer: false,
    matcherScope: "job",
    l3Section: "Deal-Breakers",
  },
  {
    slug: "other",
    kind: "other",
    displayName: "Other",
    description: "Anything else that doesn't fit the canonical branches.",
    maxPathDepth: 1,
    isContainer: false,
  },
];

/** Sub-branches under `skills/*`. */
export const SKILLS_SUB_BRANCHES: readonly CanonicalBranchDef[] = [
  {
    slug: "skills/keep",
    kind: "skills",
    displayName: "Core Skills",
    description: "Skills you have and want to keep using.",
    maxPathDepth: 2,
    isContainer: false,
    acceptsSkillIntent: true,
    matcherScope: "job",
    l3Soft: true,
    l3Section: "Core Skills",
  },
  {
    slug: "skills/grow",
    kind: "skills",
    displayName: "Growth Skills",
    description: "Skills you want to grow into.",
    maxPathDepth: 2,
    isContainer: false,
    acceptsSkillIntent: true,
    matcherScope: "job",
    l3Soft: true,
    l3Section: "Growth Skills",
  },
  {
    slug: "skills/avoid",
    kind: "skills",
    displayName: "Avoid Skills",
    description: "Skills you want to avoid.",
    maxPathDepth: 2,
    isContainer: false,
    acceptsSkillIntent: true,
    matcherScope: "job",
    l3Soft: true,
    l3Section: "Avoid Skills",
  },
];

/**
 * Sub-branches under `company-attributes/*`. Full set per design §1
 * (PRD §10 locked): size, stage, funding, hq, product-or-services,
 * brand, culture.
 */
export const COMPANY_ATTRIBUTE_SUB_BRANCHES: readonly CanonicalBranchDef[] = [
  {
    slug: "company-attributes/size",
    kind: "attribute",
    displayName: "Size",
    description: "Headcount range.",
    maxPathDepth: 2,
    isContainer: false,
    matcherScope: "company",
    l3Soft: true,
  },
  {
    slug: "company-attributes/stage",
    kind: "attribute",
    displayName: "Stage",
    description: "Company growth stage (seed, Series A, etc.).",
    maxPathDepth: 2,
    isContainer: false,
    matcherScope: "company",
    l3Soft: true,
  },
  {
    slug: "company-attributes/funding",
    kind: "attribute",
    displayName: "Funding",
    description: "Funding profile (bootstrap, VC, public, etc.).",
    maxPathDepth: 2,
    isContainer: false,
    matcherScope: "company",
    l3Soft: true,
  },
  {
    slug: "company-attributes/hq",
    kind: "attribute",
    displayName: "Headquarters",
    description: "HQ geography.",
    maxPathDepth: 2,
    isContainer: false,
    matcherScope: "company",
    l3Soft: true,
  },
  {
    slug: "company-attributes/product-or-services",
    kind: "attribute",
    displayName: "Product or Services",
    description: "Product company vs services / consulting / agency.",
    maxPathDepth: 2,
    isContainer: false,
    matcherScope: "company",
    l3Soft: true,
  },
  {
    slug: "company-attributes/brand",
    kind: "attribute",
    displayName: "Brand",
    description: "Brand-recognition and reputation preferences.",
    maxPathDepth: 2,
    isContainer: false,
    matcherScope: "company",
    l3Soft: true,
  },
  {
    slug: "company-attributes/culture",
    kind: "attribute",
    displayName: "Culture",
    description: "Engineering culture, values, work style.",
    maxPathDepth: 2,
    isContainer: false,
    matcherScope: "company",
    l3Soft: true,
  },
];

/** Single iterable for the seeder, deriveL2Inputs, and validators. */
export const ALL_CANONICAL_BRANCHES: readonly CanonicalBranchDef[] = [
  ...CANONICAL_BRANCHES,
  ...SKILLS_SUB_BRANCHES,
  ...COMPANY_ATTRIBUTE_SUB_BRANCHES,
];
