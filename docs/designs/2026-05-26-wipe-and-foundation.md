# Design — wipe-and-foundation cutover

Format A (Feature Plan). Status: Draft v1. Date: 2026-05-27. Slug:
`2026-05-26-wipe-and-foundation`. Operates inside the envelope locked
by ADR-0009/0010/0011 and the PRD at
`docs/product/2026-05-26-wipe-and-foundation.md`.

> **Reader.** This document concretises the design at cutover-PR
> level — function signatures, JSONB shapes, DDL ordering, seeder
> layout. The architectural choices (JSONB tree, wipe-no-coexistence,
> TS-canonical branch registry) are already locked upstream.

---

## Summary

Land the legacy preference substrate wipe and the new tree-shaped
substrate in a single PR. One Drizzle migration drops five flat
columns on `user_profile`, drops `user_company_preference`, drops
`conversation_state` + `conversation_message`, adds
`user_profile.preference_tree` JSONB, adds `job_match.claim_scores`
JSONB, creates `preference_branch`, and wipes `job_match`. Code
introduces `apps/web/src/lib/profile-tree/` (pure functions over
the tree shape + `CANONICAL_BRANCHES` constant + `migrate-leaves`
utility), rewires `filter-pipeline.ts` and the L3 prompt-input
layer, neuters the chatbot module, and disables
`internet-expansion.ts` as a warn-logged no-op.

---

## Business Context

Solo project; no end users. Substrate must be clean and substrate-
shaped before `conversation-runtime`, `profile-map-ui`, and
`l3-widening` open. PRD §1, §2, §6.3 establish the "next-PR author"
as the user this cutover serves. Acceptance gates are mechanical
(grep cleanliness, HEAD green, 501 stubs, exact `preference_branch`
row count).

---

## Approach

The locked decisions (ADR-0009/0010/0011 plus PRD §11.2) leave only
"how" decisions to this design:

1. The leaf Zod schema and `preferenceTree` JSONB shape are sketched
   in design §4 at concept level; this design locks the exact field
   list and types so `/implement-task` can ship the schema file
   without re-deciding.
2. `CANONICAL_BRANCHES` content (top-level entries + first-cut
   `company-attributes/*` sub-branches) is sketched in design §5 as
   a "first cut"; PRD §10 routes the final list here.
3. Function signatures (`mutateLeaf`, `moveLeaves`, `deriveL2Inputs`,
   `summariseTreeForL3`, `migrate-leaves`) are not yet locked anywhere
   above; this design locks them.
4. Migration 0010 SQL operation order is design-level (drop before
   add is wrong; DELETE FROM is DML and needs a manual ordering).
5. Seeder shape (rename vs sibling vs combine) is PRD §11.1 owner's
   choice — this design picks.
6. PR-boundary count is PRD §11.1 owner's choice — this design picks.

Chosen approach across these: **minimum-diff, minimum-coupling, one
PR** — every design choice below follows that rule. Rationale per
section.

---

## Affected Files

| File | Action | Description |
|------|--------|-------------|
| `packages/db/src/schema.ts` | modify | Drop 5 `userProfiles` cols; drop `userCompanyPreferences`, `conversationStates`, `conversationMessages`; add `userProfiles.preferenceTree`, `jobMatches.claimScores`; add `preferenceBranch` table |
| `apps/web/drizzle/0010_wipe_and_foundation.sql` | create | Hand-edited Drizzle migration, single TX |
| `apps/web/drizzle/meta/_journal.json` | modify | Drizzle bookkeeping (autogen) |
| `apps/web/src/lib/profile-tree/leaf-schema.ts` | create | Zod `LeafSchema`, `PreferenceTreeSchema`, type exports |
| `apps/web/src/lib/profile-tree/canonical-branches.ts` | create | `CANONICAL_BRANCHES` const, `CanonicalBranchDef` type |
| `apps/web/src/lib/profile-tree/mutate-leaf.ts` | create | `mutateLeaf(tree, leafId, mutator): Tree` |
| `apps/web/src/lib/profile-tree/move-leaves.ts` | create | `moveLeaves(tree, predicate, target): Tree` (pure TS) |
| `apps/web/src/lib/profile-tree/derive-l2.ts` | create | `deriveL2Inputs(tree): L2Inputs` |
| `apps/web/src/lib/profile-tree/summarise-l3.ts` | create | `summariseTreeForL3(tree): string` |
| `apps/web/src/lib/profile-tree/migrate-leaves.ts` | create | `migrateLeaves(db, opts): Promise<MigrationResult>` (DB-level wrapper around `moveLeaves` + the JSONB R/W round-trip) |
| `apps/web/src/lib/profile-tree/index.ts` | create | Re-export public surface |
| `apps/web/src/lib/profile-tree/*.test.ts` | create | 8+ fixtures per PRD §11.5 |
| `apps/web/src/lib/search/filter-pipeline.ts` | modify | Drop `userCompanyPreferences` JOIN; consume `deriveL2Inputs(profile.preferenceTree)` |
| `apps/web/src/lib/search/filter-pipeline.test.ts` | modify | Re-shape fixtures from flat columns to tree |
| `apps/web/src/app/api/chatbot/message/route.ts` | rewrite | 501 stub |
| `apps/web/src/app/api/chatbot/state/route.ts` | rewrite | 501 stub |
| `apps/web/src/app/api/chatbot/save/route.ts` | rewrite | 501 stub (see §11.2 of PRD) |
| `apps/web/src/lib/chatbot/` (entire dir) | delete | Full removal |
| `apps/web/src/lib/llm/preference-llm.ts` | delete | Chatbot-only consumer |
| `apps/web/src/lib/llm/prompts.ts` | delete | Chatbot-only consumer |
| `apps/web/src/lib/llm/preference-llm.test.ts` | delete | Tests for deleted code |
| `apps/web/src/lib/llm/prompts.test.ts` | delete | Tests for deleted code |
| `apps/web/src/components/chatbot/` (entire dir) | delete | Full UI removal |
| `apps/web/src/app/onboarding/page.tsx` | delete | Forbidden label + deleted dependency |
| `apps/worker/src/handlers/llm-scoring.ts` | modify | Replace 13-field profile pass with `treeSummary: string` |
| `apps/worker/src/lib/scoring-prompt.ts` | modify | Replace `UserProfileData` interface with `{ treeSummary: string }`; template change in 1 line |
| `apps/worker/src/handlers/internet-expansion.ts` | modify | Skip DB read, warn-log once, return 0 |
| `apps/worker/src/lib/seed-config.ts` | modify | Extend (don't rename) — see §8 |
| `apps/worker/src/lib/seed-config.test.ts` | modify | Cover the new seed shape |
| `packages/ats-core/src/geo/resolve-user-location.ts` | modify | Update stale comment lines 8-17 |

---

## 1. `CANONICAL_BRANCHES` shape

Location: `apps/web/src/lib/profile-tree/canonical-branches.ts`
(confirmed per PRD §0; this is the file ADR-0011 §Decision pins).
Re-exported from `apps/web/src/lib/profile-tree/index.ts`.

Shape:

```ts
// CanonicalBranchKind = matcher dispatcher key. Lock-list: nine values,
// one per top-level slug. NOT the same as `branchSlug` (which is the
// stored value on leaves and the PK of preference_branch rows). Kind
// is the *contract* the matcher pipeline reads against.
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

// L2 derivation hook — names the kind of L2 input this branch's leaves
// contribute to. `deriveL2Inputs(tree)` switches on this. New L2 inputs
// require a new literal here + a new case in deriveL2Inputs.
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
   * (skills, company-attributes) use 2. Validated by LeafSchema.refine.
   * Decoupled from `app_config.ui.profile_map_max_depth` (that is a UI
   * concern; this is a data-shape constraint). */
  maxPathDepth: 1 | 2;

  /** True when this branch is a container for its sub-branches (no
   * direct leaves expected). The seed installs both the container row
   * and the sub-branch rows in preference_branch; LeafSchema.refine
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
    | "Core Skills"        // skills/keep
    | "Growth Skills"      // skills/grow
    | "Avoid Skills"       // skills/avoid (rendered as "Avoid Skills")
    | "Deal-Breakers"      // deal-breakers
    | "Preferred Industries"; // industry (include polarity)
}
```

### Top-level entries (nine)

PRD §6.3 (umbrella) locks the slug set. Order in the array drives
sort-order; same order as PRD §6.3. Container-vs-leaf taxonomy locked
here.

```ts
export const CANONICAL_BRANCHES: readonly CanonicalBranchDef[] = [
  { slug: "role",              kind: "role",        displayName: "Role",
    description: "Target roles, titles, and seniority.",
    maxPathDepth: 1, isContainer: false,
    l2Derivation: "titles", matcherScope: "job" },
  { slug: "skills",            kind: "skills",      displayName: "Skills",
    description: "Skills you keep, want to grow, or want to avoid.",
    maxPathDepth: 2, isContainer: true,
    acceptsSkillIntent: true, matcherScope: "job", l3Soft: true },
  { slug: "compensation",      kind: "compensation",displayName: "Compensation",
    description: "Salary, equity, and total-comp expectations.",
    maxPathDepth: 1, isContainer: false, matcherScope: "job" },
  { slug: "location",          kind: "location",    displayName: "Location",
    description: "Geographic and remote/hybrid/onsite preferences.",
    maxPathDepth: 1, isContainer: false,
    l2Derivation: "location-tier", matcherScope: "job" },
  { slug: "industry",          kind: "industry",    displayName: "Industry",
    description: "Industries you prefer (or want to exclude).",
    maxPathDepth: 1, isContainer: false,
    l2Derivation: "industry-tokens", synonymDimension: "industry",
    matcherScope: "company", l3Soft: true,
    l3Section: "Preferred Industries" },
  { slug: "company-attributes",kind: "attribute",   displayName: "Company Attributes",
    description: "Company size, stage, funding, HQ, brand, and culture preferences.",
    maxPathDepth: 2, isContainer: true,
    matcherScope: "company", l3Soft: true },
  { slug: "exclusions",        kind: "exclusion",   displayName: "Exclusions",
    description: "Companies or characteristics you want to exclude.",
    maxPathDepth: 1, isContainer: false,
    matcherScope: "company" },
  { slug: "deal-breakers",     kind: "dealbreaker", displayName: "Deal-Breakers",
    description: "Job characteristics that disqualify a match.",
    maxPathDepth: 1, isContainer: false,
    matcherScope: "job", l3Section: "Deal-Breakers" },
  { slug: "other",             kind: "other",       displayName: "Other",
    description: "Anything else that doesn't fit the canonical branches.",
    maxPathDepth: 1, isContainer: false },
];
```

### Sub-branches under `skills/*`

```ts
export const SKILLS_SUB_BRANCHES: readonly CanonicalBranchDef[] = [
  { slug: "skills/keep", kind: "skills", displayName: "Core Skills",
    description: "Skills you have and want to keep using.",
    maxPathDepth: 2, isContainer: false,
    acceptsSkillIntent: true, matcherScope: "job", l3Soft: true,
    l3Section: "Core Skills" },
  { slug: "skills/grow", kind: "skills", displayName: "Growth Skills",
    description: "Skills you want to grow into.",
    maxPathDepth: 2, isContainer: false,
    acceptsSkillIntent: true, matcherScope: "job", l3Soft: true,
    l3Section: "Growth Skills" },
  { slug: "skills/avoid", kind: "skills", displayName: "Avoid Skills",
    description: "Skills you want to avoid.",
    maxPathDepth: 2, isContainer: false,
    acceptsSkillIntent: true, matcherScope: "job", l3Soft: true,
    l3Section: "Avoid Skills" },
];
```

### Sub-branches under `company-attributes/*`

PRD §10 open question. Locked here as the **full set from design §5
hint**: `size`, `stage`, `funding`, `hq`, `product-or-services`,
`brand`, `culture`. Rationale: the seed cost is one Drizzle row per
sub-branch; the full set lets `conversation-runtime` route leaves
into named sub-branches without first widening the registry. If a
sub-branch turns out to be unused, soft-delete (`active = false`) is
cheap. Withholding sub-branches imposes a coupling tax on every
downstream PR.

```ts
export const COMPANY_ATTRIBUTE_SUB_BRANCHES: readonly CanonicalBranchDef[] = [
  { slug: "company-attributes/size",                kind: "attribute",
    displayName: "Size", description: "Headcount range.",
    maxPathDepth: 2, isContainer: false,
    matcherScope: "company", l3Soft: true },
  { slug: "company-attributes/stage",               kind: "attribute",
    displayName: "Stage", description: "Company growth stage (seed, Series A, etc.).",
    maxPathDepth: 2, isContainer: false,
    matcherScope: "company", l3Soft: true },
  { slug: "company-attributes/funding",             kind: "attribute",
    displayName: "Funding", description: "Funding profile (bootstrap, VC, public, etc.).",
    maxPathDepth: 2, isContainer: false,
    matcherScope: "company", l3Soft: true },
  { slug: "company-attributes/hq",                  kind: "attribute",
    displayName: "Headquarters", description: "HQ geography.",
    maxPathDepth: 2, isContainer: false,
    matcherScope: "company", l3Soft: true },
  { slug: "company-attributes/product-or-services", kind: "attribute",
    displayName: "Product or Services", description: "Product company vs services / consulting / agency.",
    maxPathDepth: 2, isContainer: false,
    matcherScope: "company", l3Soft: true },
  { slug: "company-attributes/brand",               kind: "attribute",
    displayName: "Brand", description: "Brand-recognition and reputation preferences.",
    maxPathDepth: 2, isContainer: false,
    matcherScope: "company", l3Soft: true },
  { slug: "company-attributes/culture",             kind: "attribute",
    displayName: "Culture", description: "Engineering culture, values, work style.",
    maxPathDepth: 2, isContainer: false,
    matcherScope: "company", l3Soft: true },
];

/** Single iterable for the seeder, deriveL2Inputs, and validators. */
export const ALL_CANONICAL_BRANCHES: readonly CanonicalBranchDef[] = [
  ...CANONICAL_BRANCHES,
  ...SKILLS_SUB_BRANCHES,
  ...COMPANY_ATTRIBUTE_SUB_BRANCHES,
];
```

**Row count check** (PRD §4 metric): `preference_branch` row count
must equal `ALL_CANONICAL_BRANCHES.length` = **9 + 3 + 7 = 19** after
seed.

**Parent linkage** (for the seeder to compute `preference_branch.parent_slug`):
a slug containing `/` derives its parent by trimming the last
segment. `skills/keep` → parent `skills`. Top-level slugs have
`parent_slug = null`. The seeder computes this; not stored in
`CANONICAL_BRANCHES` (DRY against the slug itself).

---

## 2. Leaf Zod schema

Location: `apps/web/src/lib/profile-tree/leaf-schema.ts`.

Field-by-field. Generated UUID v7 (lexicographically sortable, time-
prefixed) preferred for `leafId`; `crypto.randomUUID()` (v4) is
acceptable if v7 helper not already in repo — check existing pattern
before adding a dep.

```ts
import { z } from "zod";
import { ALL_CANONICAL_BRANCHES } from "./canonical-branches";

const VALID_SLUGS = new Set(ALL_CANONICAL_BRANCHES.map((b) => b.slug));
const SKILLS_SLUGS = new Set(
  ALL_CANONICAL_BRANCHES
    .filter((b) => b.acceptsSkillIntent)
    .map((b) => b.slug),
);

export const SkillIntentSchema = z.enum(["keep", "grow", "avoid"]);
export type SkillIntent = z.infer<typeof SkillIntentSchema>;

export const PolaritySchema = z.enum(["include", "exclude"]);
export type Polarity = z.infer<typeof PolaritySchema>;

/** A leaf provenance reference back to the conversation_message that
 * created it. `turnId` is a UUID matching `conversation_message.id`
 * in the future conversation-runtime sub-feature. Optional because
 * seeds may create leaves with no turn (none in this PR; locked for
 * downstream). */
export const LeafProvenanceSchema = z.object({
  turnId: z.string().uuid(),
});

export const LeafSchema = z
  .object({
    /** Stable identity for this leaf within the tree. UUID. Referenced
     * (soft, no FK) by job_match.claim_scores[].leafId in l3-widening. */
    id: z.string().uuid(),

    /** Canonical branch slug. Must match a row in
     * CANONICAL_BRANCHES / preference_branch. Validated by the
     * superRefine below. */
    branchSlug: z.string().min(1),

    /** Path from root to this leaf's parent slug. The last element
     * equals branchSlug. For `skills/keep` leaves: ["skills","skills/keep"].
     * For `industry` leaves: ["industry"]. The validator below enforces
     * length matches the branch's maxPathDepth. */
    branchPath: z.array(z.string().min(1)).min(1).max(2),

    /** Verbatim user phrasing. NEVER paraphrased. The leaf is the
     * record of what the user said. */
    claimText: z.string().min(1),

    /** Include vs exclude polarity. Every leaf has one. */
    polarity: PolaritySchema,

    /** Only set on leaves under branches with acceptsSkillIntent=true.
     * The superRefine below enforces this. */
    skillIntent: SkillIntentSchema.optional(),

    /** 0..1, optional. Self-reported by the LLM at commit time. */
    confidence: z.number().min(0).max(1).optional(),

    /** UI-visible relative weight. Locked at 1 for MVP — D11 / PRD §3.2
     * NG5 defer weight rebalancing. Future widening goes here. */
    weight: z.number().positive().default(1),

    /** Optional free-text qualifier ("at startup", "remote-first"). */
    note: z.string().optional(),

    /** Canonical synonym tokens for search-time expansion (D9). Populated
     * by conversation-runtime; empty for the wipe PR. */
    canonical: z.array(z.string()).optional(),

    /** Uncertainty marker — true when conversation-runtime committed a
     * best-guess after clarification budget exhausted. */
    flaggedUncertain: z.boolean().optional(),

    /** Where this leaf came from. */
    provenance: LeafProvenanceSchema.optional(),

    /** ISO 8601 timestamps. Maintained by the mutator; never auto-set
     * by Drizzle since the JSONB blob is mutated wholesale on write. */
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((leaf, ctx) => {
    // 1. Slug must be canonical.
    if (!VALID_SLUGS.has(leaf.branchSlug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["branchSlug"],
        message: `Unknown branchSlug: ${leaf.branchSlug}`,
      });
      return;
    }
    // 2. branchPath terminates at branchSlug.
    const last = leaf.branchPath[leaf.branchPath.length - 1];
    if (last !== leaf.branchSlug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["branchPath"],
        message: `branchPath must end at branchSlug (got [${leaf.branchPath.join(",")}], slug=${leaf.branchSlug})`,
      });
    }
    // 3. branchPath length matches the branch's maxPathDepth.
    const def = ALL_CANONICAL_BRANCHES.find((b) => b.slug === leaf.branchSlug);
    if (def && leaf.branchPath.length !== def.maxPathDepth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["branchPath"],
        message: `branchPath depth ${leaf.branchPath.length} != maxPathDepth ${def.maxPathDepth} for ${leaf.branchSlug}`,
      });
    }
    // 4. Container slugs may not host leaves (they hold sub-branch slugs).
    if (def?.isContainer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["branchSlug"],
        message: `${leaf.branchSlug} is a container; leaves must use a sub-branch slug`,
      });
    }
    // 5. skillIntent presence iff branch acceptsSkillIntent.
    if (leaf.skillIntent && !SKILLS_SLUGS.has(leaf.branchSlug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["skillIntent"],
        message: `skillIntent only allowed on skills/* leaves`,
      });
    }
  });

export type Leaf = z.infer<typeof LeafSchema>;
```

Notes:

- Field name choices vs umbrella design §4 sketch:
  - PRD §11 says `id`; design §4 says `leafId`. **This PR locks
    `id`** (matches the leaf-schema PRD reference; consistent with
    other JSONB row patterns in the codebase like
    `LocationPreferenceTier.rank`).
  - PRD §11 says `claimText`; design §4 says `claim`. **This PR
    locks `claimText`** (PRD-precedence; the longer name disambiguates
    from `claim` as a verb in code review).
  - PRD §11 says `polarity`; design §4 says `direction`. **This PR
    locks `polarity`** (PRD-precedence; downstream `Polarity` type
    name is clearer than `Direction`).
  - PRD §11 says `evidence` / `provenance` (one or the other);
    design §4 says `source.turnId`. **This PR locks `provenance:
    { turnId }`** as the named field. `evidence` is a separate
    concept (job-side substring-verified) used in L3 widening; not
    overloaded here.
- All optional fields use `?` not `null`. JSONB readers
  (deriveL2Inputs, summariseTreeForL3) discriminate on
  `key in leaf` rather than null checks; less ceremony.
- `weight` defaults to 1 even though it's a no-op for MVP — locking
  the type now means `l3-widening` doesn't have to migrate.

---

## 3. `preferenceTree` JSONB shape

```ts
export const PreferenceTreeSchema = z.object({
  schemaVersion: z.literal(1),
  leaves: z.array(LeafSchema),
});

export type PreferenceTree = z.infer<typeof PreferenceTreeSchema>;
```

Top-level keys locked: `schemaVersion`, `leaves`. **No other keys
in v1.** Future composition-change migrations may add a
`migrations: { lastAppliedVersion: number }` envelope; out of scope
here.

Column default: `'{"schemaVersion":1,"leaves":[]}'::jsonb` (PRD §6.3
+ §11.4). All existing rows get this default; the migration includes
`DEFAULT '...'::jsonb NOT NULL`. Drizzle's `.default(sql\`...\`)` on a
`jsonb` column emits the right SQL; verify the generated 0010 file
includes `DEFAULT '{"schemaVersion":1,"leaves":[]}'::jsonb` literally —
manual edit if Drizzle emits a parameter binding instead.

JSONB equality at test time uses `@>` containment both ways, not `=`,
per PRD §11.4 hint and external-findings note in research §External
findings.

---

## 4. `preference_branch` table

Drizzle table definition in `packages/db/src/schema.ts`. Modelled on
`roleFamilies` (lines 347-358) and design §5.

```ts
export const preferenceBranches = pgTable(
  "preference_branch",
  {
    /** Stable identifier; PK. NEVER rename without a moveLeaves
     * migration (ADR-0011 §Composition-change playbook). */
    slug: text("slug").primaryKey(),

    /** Self-FK for the editable sub-branch hierarchy. NULL for top-
     * level canonical roots. */
    parentSlug: text("parent_slug"),

    displayName: text("display_name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    description: text("description"),

    /** Soft-delete flag. ADR-0009 §Consequences requires soft-delete
     * to preserve leaf slug references across composition changes. */
    active: boolean("active").notNull().default(true),

    /** Per-branch JSONB tunables. Empty for MVP. */
    config: jsonb("config"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /** Lookup by parent for hierarchy walks (Profile Map renderer). */
    index("preference_branch_parent_idx").on(table.parentSlug),
    /** Common filter: WHERE active = true. */
    index("preference_branch_active_idx").on(table.active),
  ],
);
```

**Self-FK rationale:** design §5 declares
`references(() => preferenceBranch.slug)` on `parent_slug`. This PR
**does not** add the FK constraint at the DDL level. Reasoning: the
seeder inserts in `ALL_CANONICAL_BRANCHES` order which puts parents
before children, but a `references()` FK forces additional Drizzle
generation complexity (forward references inside the same table
definition need a separate `foreignKey` block) for a constraint that
adds zero safety in a solo product. The relationship is enforced by
the seeder. Mark for fast-follow if it becomes a problem.

**No FK to JSONB leaves.** ADR-0009 already established this.

**Relationship to `CANONICAL_BRANCHES`:** the seeder reads
`ALL_CANONICAL_BRANCHES`, INSERTs one row per entry, computes
`parentSlug` from the slug shape, and uses `onConflictDoNothing()`
so hand-edited `displayName` / `description` / `sortOrder` /
`active` / `config` survive re-runs. Slug + maxPathDepth +
acceptsSkillIntent are **not** persisted to the DB — those are
compile-time semantic hooks. `kind`, `l3Soft`, `l2Derivation`,
`matcherScope`, `synonymDimension`, `l3Section` likewise stay in TS
only. The DB row exposes only the runtime-editable surface.

---

## 5. `job_match.claimScores` JSONB shape

Column added now (NULL default) per PRD §11.2; **no write path in
this PR**. Contract locked so `l3-widening` doesn't redefine.

```ts
/** A single per-claim score, written by l3-widening. */
export const ClaimScoreSchema = z.object({
  /** References LeafSchema.id in the same user's preferenceTree.
   * Soft reference (no FK). Renderer drops entries whose leaf is
   * missing (per design §7). */
  leafId: z.string().uuid(),

  /** 0..10, integer. Clamped server-side at write time. */
  score: z.number().int().min(0).max(10),

  /** Verbatim substring of the job description supporting the score,
   * or null if the description was silent. Substring-verified at
   * write time (design §6 invariant). */
  evidencePhrase: z.string().nullable(),

  /** True iff the job description addressed this claim (D14). When
   * false, score is 5 (neutral) and evidencePhrase is null. */
  mentioned: z.boolean(),
});

export const ClaimScoresSchema = z.array(ClaimScoreSchema);
```

**Key choice — array vs map.** `claim_scores` is `ClaimScore[]`, not
`Record<leafId, ClaimScore>`. Rationale:

- Mirrors `evidenceQuotes: text[]` precedent on `job_match`.
- Allows server-side ordering (e.g., randomised input order
  preserved in output for position-bias mitigation per design §6).
- Array matches Zod's containment pattern used in the leaves array
  on `preferenceTree`.
- A map keyed by leafId looks tidier but JSONB equality with `@>`
  works the same either way; arrays are simpler for the rendering
  filter ("drop entries where leafId is missing in the tree").

Schema file location: **lock to**
`apps/worker/src/lib/scoring-schema.ts` (alongside
`ScoringOutputSchema`). `l3-widening` will import from there; the
schema doesn't need to live in `profile-tree/` because it's a
write-side worker concern. **This PR adds the type export only**;
no runtime consumer yet.

---

## 6. Function signatures

### 6.1 `mutateLeaf`

Location: `apps/web/src/lib/profile-tree/mutate-leaf.ts`. Pure;
immutable.

```ts
import type { Leaf, PreferenceTree } from "./leaf-schema";

/** Apply `mutator` to the leaf whose id matches. Returns a new tree
 * with the leaf replaced; throws if leafId not found. Immutable —
 * existing tree is not modified. updatedAt is stamped on the leaf;
 * caller is responsible for persisting the new tree. */
export function mutateLeaf(
  tree: PreferenceTree,
  leafId: string,
  mutator: (leaf: Leaf) => Leaf,
): PreferenceTree;
```

Implementation skeleton (illustrative; not the deliverable):

```ts
const idx = tree.leaves.findIndex((l) => l.id === leafId);
if (idx < 0) throw new Error(`Leaf not found: ${leafId}`);
const updated = mutator(tree.leaves[idx]);
const stamped = { ...updated, updatedAt: new Date().toISOString() };
return {
  schemaVersion: tree.schemaVersion,
  leaves: tree.leaves.map((l, i) => (i === idx ? stamped : l)),
};
```

**Idempotency contract:** `mutateLeaf` does not enforce idempotency.
Callers that need it (composition-change migrations) wrap with a
"skip if already at target shape" check. `mutateLeaf` is dumb — it
applies the mutator unconditionally. This keeps the function pure
and small; idempotency lives in `migrateLeaves`.

### 6.2 `moveLeaves`

Location: `apps/web/src/lib/profile-tree/move-leaves.ts`. **Pure
function on trees.** This is the *transformation*. The DB-level
batched wrapper that loads/saves trees and applies `FOR UPDATE`
batching lives in `migrate-leaves.ts` (§6.7).

```ts
import type { Leaf, PreferenceTree } from "./leaf-schema";

export interface MovePredicate {
  /** Match leaves whose branchSlug is in this set. */
  fromSlugs: string[];
  /** Optional: only move leaves whose branchPath contains this
   * substring. Used to disambiguate when fromSlugs alone is too
   * broad (e.g., moving only a subset of skills/grow leaves). */
  fromPathContains?: string;
}

export interface MoveTarget {
  toSlug: string;
  toPath: string[];
  /** Optional per-leaf mutator applied after the slug + path
   * rewrite. For merges that introduce new leaf fields (e.g., a
   * `scope` field when merging Exclusions and Deal-breakers). */
  mutateLeaf?: (leaf: Leaf) => Leaf;
}

/** Move all leaves matching `predicate` to a new branch. Returns a
 * new tree; throws if target slug is unknown or container. */
export function moveLeaves(
  tree: PreferenceTree,
  predicate: MovePredicate,
  target: MoveTarget,
): PreferenceTree;
```

**Where PRD §11.4 `FOR UPDATE` + 500–2000-row batching applies:**
not here. This signature is row-local (one tree per call). Batching
and locking live in `migrateLeaves` (§6.7) which iterates rows of
`user_profile`. The pure `moveLeaves` function has no DB awareness;
testable with fixtures.

### 6.3 `deriveL2Inputs`

Location: `apps/web/src/lib/profile-tree/derive-l2.ts`. Pure.

Matches what `filter-pipeline.ts:71-83` (industries) and lines 95-117
(titles, seniority, remotePreference, preferredLocations) currently
consume — the second set comes from retained columns on
`userProfiles`, the first from the dropped `userCompanyPreferences`
table. Only `industries` needs a new source.

```ts
export interface L2Inputs {
  /** Industry canonical tokens (positive polarity only). Excludes
   * are NOT handed to L2 (per design §12 / D9 invariant — positive
   * overlap only at L2). Fed into the SQL industry overlap
   * condition in filter-pipeline.ts:264-274. */
  industries: string[];
}

export function deriveL2Inputs(tree: PreferenceTree | null): L2Inputs;
```

**Return-type rationale — narrow surface.** Filter-pipeline.ts
already reads `targetTitles`, `targetSeniority`, `remotePreference`,
`preferredLocations`, `locationPreferences` from the retained columns
on `userProfiles` (lines 95-129). Those columns are **not dropped**
(PRD §11.3 invariant) and there is **no value** in re-deriving them
from the tree in this PR — they would re-derive to the same thing,
the tree is empty in MVP anyway, and the dispatch logic in §6.1 of
the umbrella ADR-0011 wants `deriveL2Inputs` to iterate
`CANONICAL_BRANCHES`. For MVP we **return only `industries`**; the
caller continues to read the retained columns directly.

This keeps `deriveL2Inputs` semantically aligned with the only
column that changes source in this PR. Future widening adds fields
to `L2Inputs` as columns get migrated into the tree.

Implementation skeleton (illustrative):

```ts
if (!tree) return { industries: [] };
const industries: string[] = [];
for (const leaf of tree.leaves) {
  const def = ALL_CANONICAL_BRANCHES.find((b) => b.slug === leaf.branchSlug);
  if (def?.l2Derivation !== "industry-tokens") continue;
  if (leaf.polarity !== "include") continue; // positive overlap only
  industries.push(leaf.claimText);
  for (const tok of leaf.canonical ?? []) industries.push(tok);
}
return { industries };
```

**Empty-tree return value:** `{ industries: [] }`. Filter-pipeline
already handles empty `industries` by skipping the overlap condition
(line 267). No code change needed in pipeline behaviour for the
empty-tree case beyond the input-source swap.

### 6.4 `summariseTreeForL3`

Location: `apps/web/src/lib/profile-tree/summarise-l3.ts`. Pure.

Locked invariants from PRD §11.2 + §11.4:

- Section labels mirror `scoring-prompt.ts:75-95` verbatim:
  `Core Skills`, `Growth Skills`, `Deal-Breakers`,
  `Preferred Industries`. **Lock-list of five sections** including
  `Avoid Skills` (the existing prompt line 158 reads "Avoid Skills
  (does not want)").
- Empty tree string: `"No preferences set yet."` (PRD §11.4 hint).
- Section ordering: same as the user-prompt body order in
  `scoring-prompt.ts:154-163` — **Core Skills → Growth Skills →
  Avoid Skills → Deal-Breakers → Preferred Industries**.
- A section with no matching leaves emits `<Label>: None specified`
  (mirrors the `joinOrDefault` fallback at line 39-42 of
  `scoring-prompt.ts`). Drift between "empty tree" and "tree with no
  skills" is undesirable; both produce the same per-section "None
  specified" line.

**Output format inside each section:** **comma-separated, single
line per section**. Rationale:

- The existing prompt uses `Core Skills: ${joinOrDefault(...)}`
  format — single line, comma-separated, in the user prompt body.
  Bullet lists would change the prompt body's natural-language
  rhythm and risk the L3 LLM scoring it differently. Mirroring the
  comma-separated form means the system prompt body
  (`scoring-prompt.ts:75-95`) needs zero text changes.
- Polarity is handled via the section mapping:
  `skills/keep` → Core Skills, `skills/grow` → Growth Skills,
  `skills/avoid` → Avoid Skills (always include the verbatim claim
  regardless of polarity — polarity is implicit in the section
  label).
- Industries split by polarity: include-polarity industry leaves
  feed Preferred Industries; exclude-polarity industry leaves are
  dropped from the L3 prompt in this PR (downstream `l3-widening`
  may add an Excluded Industries section, but not here).

Signature:

```ts
export function summariseTreeForL3(tree: PreferenceTree | null): string;
```

Exact empty-tree output: `"No preferences set yet."` (no trailing
newline). Lock-list one-liner — easy to test.

Exact non-empty output template:

```
Core Skills: <comma-joined claimText, or "None specified">
Growth Skills: <comma-joined claimText, or "None specified">
Avoid Skills: <comma-joined claimText, or "None specified">
Deal-Breakers: <comma-joined claimText, or "None specified">
Preferred Industries: <comma-joined claimText, or "None specified">
```

Five lines, no blank lines between, no trailing newline. Each line
ends at the last claim or "None specified" — no trailing comma.

**Where it's called from:** `buildScoringPrompt`'s caller in
`apps/worker/src/handlers/llm-scoring.ts` (the handler) — see §11.
Not from inside `buildScoringPrompt` itself, so the prompt builder
stays pure (no tree-shape import). The handler calls
`summariseTreeForL3(tree)` and passes the resulting string as
`profile.treeSummary` to the prompt builder.

### 6.5 `migrate-leaves.ts` — `migrateLeaves`

Location: `apps/web/src/lib/profile-tree/migrate-leaves.ts`. Exported
async function. **Shipped now for future use; not exercised by this
PR.**

PRD §10 open question: dry-run mode shipped or not? **Design's call:
ship with dry-run mode.** Rationale: composition-change migrations
benefit from a dry pass that asserts every row parses post-transform
before committing (per research §External findings "Validation,
layered defence"). The cost is one boolean param + an `if (dryRun)
return result without writing`. Cost paid once; value paid on every
composition-change.

```ts
import type { Database } from "@/lib/db";
import type { Leaf, PreferenceTree } from "./leaf-schema";
import type { MovePredicate, MoveTarget } from "./move-leaves";

export interface MigrationOptions {
  /** Schema version this migration writes. Rows already at >= this
   * version are skipped (idempotency). */
  toSchemaVersion: 1;

  /** Move predicate / target. Pure transformation applied per row. */
  predicate: MovePredicate;
  target: MoveTarget;

  /** When true, parse-transform-parse every row but skip the UPDATE
   * write. Returns the would-write count. Useful for pre-flight
   * checks before a composition-change migration. */
  dryRun?: boolean;

  /** Row batch size for the cursor pagination. Default 1000 per
   * research §External findings. */
  batchSize?: number;
}

export interface MigrationResult {
  /** Rows examined. */
  scanned: number;
  /** Rows that were rewritten (or would be, in dry-run). */
  rewritten: number;
  /** Rows skipped because already at toSchemaVersion. */
  skipped: number;
  /** Rows that failed parse-old (logged, not thrown). */
  parseErrors: number;
}

export async function migrateLeaves(
  db: Database,
  opts: MigrationOptions,
): Promise<MigrationResult>;
```

**Idempotency contract:** keyed off `tree.schemaVersion`. A row whose
tree already has `schemaVersion >= opts.toSchemaVersion` is skipped.
Re-running the same migration twice converges (research §External
findings "Idempotency"). When a composition-change is structurally
invisible at the schemaVersion level (e.g., move all `skills/avoid`
leaves to `skills/grow` without bumping the version), the caller is
responsible for an explicit "already migrated?" check inside the
move predicate.

**Batching + FOR UPDATE:** PRD §11.4 hint. Inside the function:

```sql
SELECT id, preference_tree, updated_at
FROM user_profile
WHERE id > $cursor
ORDER BY id
LIMIT $batchSize
FOR UPDATE SKIP LOCKED;
```

Pure-TS transform with `moveLeaves`; `UPDATE user_profile SET
preference_tree = $new, updated_at = now() WHERE id = $id AND
updated_at = $original_updated_at` for optimistic-lock safety. The
cursor pagination loop continues until a partial batch returns. Not
exercised in this PR; the contract is locked so future migrations
don't reinvent the wheel.

---

## 7. Migration 0010 SQL ordering

Inside the single transaction. Ordering matters because the schema
update needs to leave the DB consistent with the new TS schema at TX
commit. Drizzle's generator emits an autogen file; the developer
hand-edits to enforce this order and to add the JSONB default
literal + the DELETE statement.

**Step order** (locked):

1. `DROP TABLE conversation_message` (FK depends on conversation_state)
2. `DROP TABLE conversation_state`
3. `DROP TABLE user_company_preference`
4. `ALTER TABLE user_profile DROP COLUMN core_skills`
5. `ALTER TABLE user_profile DROP COLUMN growth_skills`
6. `ALTER TABLE user_profile DROP COLUMN avoid_skills`
7. `ALTER TABLE user_profile DROP COLUMN deal_breakers`
8. `ALTER TABLE user_profile DROP COLUMN preferred_industries`
9. `ALTER TABLE user_profile ADD COLUMN preference_tree jsonb NOT NULL DEFAULT '{"schemaVersion":1,"leaves":[]}'::jsonb`
10. `ALTER TABLE job_match ADD COLUMN claim_scores jsonb` (nullable, no default — explicit absence per PRD §11.2)
11. `DELETE FROM job_match` (DML — wipes cached RSLCD scores)
12. `CREATE TABLE preference_branch (...)` (DDL, no rows — seeder populates at worker boot)

Reasoning:

- **Drops before adds** (steps 4-8 before 9): cleaner dependency
  picture; if the developer accidentally re-runs the autogen
  generator after the manual edit, the diff stays comparable.
- **`DEFAULT` literal on the JSONB ADD COLUMN** (step 9): existing
  rows get a non-NULL initial tree. Without DEFAULT, the column
  would be NULL on existing rows and the leaf-schema readers would
  need a null guard — wasted code. PRD §11.4 hint locks this.
- **`DELETE FROM job_match` AFTER `claim_scores` is added** (step 11
  after 10): not strictly necessary (DELETE doesn't care about
  column existence) but keeps the logical flow "add new substrate,
  then clear stale cache". Reviewable.
- **`CREATE TABLE preference_branch` last** (step 12): the table is
  empty post-DDL; the worker seeder populates it on next boot per
  PRD §11.2 + design §11.1 below. Keeping CREATE TABLE near the end
  groups "destructive operations" in the first half of the
  migration and "additive operations" in the second half — easier
  to review.

**Where Drizzle generation may need manual edit:**

- **JSONB DEFAULT literal:** Drizzle's `jsonb().default(sql\`'...'::jsonb\`)`
  emits `DEFAULT '...'::jsonb` but the generator sometimes emits
  `DEFAULT $1` parameter binding instead, which fails at migration
  time. Verify the generated 0010 file shows the literal string;
  edit if not.
- **`DELETE FROM job_match`:** Drizzle is schema-diff-driven and
  does **not** emit DML. Add `DELETE FROM "job_match";` between the
  `ALTER TABLE job_match ADD COLUMN` and the
  `CREATE TABLE preference_branch` statements by hand. Mark with a
  comment block explaining why (cached RSLCD references obsolete
  flat profile shape).
- **`statement-breakpoint` markers:** Drizzle requires
  `--> statement-breakpoint` between each statement in the
  generated SQL (matches `0009_separate_match_signals.sql`
  precedent). Preserve them in the hand-edit.
- **No explicit `BEGIN/COMMIT`:** Drizzle's migration runner wraps
  the whole file in a transaction. **Do not add explicit `BEGIN
  TRANSACTION`** — would nest and may cause "transaction already in
  progress" errors with some drivers.

**Migration filename:** `0010_wipe_and_foundation.sql`. The slug
suffix is the only one this PR controls (Drizzle's autogen otherwise
picks a random adjective-noun). Hand-rename after generation; the
journal file `apps/web/drizzle/meta/_journal.json` records the slug
so it must match.

---

## 8. Seeder extension shape

PRD §11.1 leaves three options. **Design's choice: extend
`seedPollingConfig` to a sibling `seedAppConfigDefaults` plus a new
`seedPreferenceBranches`; rename `seedPollingConfig` to one of those
or keep all three? Decision: keep `seedPollingConfig` as-is and add
two new exported functions in the same file.**

Rationale:

- **Minimum diff.** `seedPollingConfig` is correct as-is (5 polling
  rows + 1 search row); renaming would touch its caller in
  `apps/worker/src/lib/seed-runner.ts` (or wherever it's currently
  invoked) and its test file. The PRD §4 success metric tracks
  `preference_branch` row count, not seeder shape.
- **Minimum coupling.** Three named functions are clearer than one
  combined function: each has a single responsibility, each is
  individually testable, each is independently re-runnable.
  `seed-config.test.ts` already exists with the pattern; extend it.
- **Failure isolation.** If `preference_branch` seeding fails (e.g.,
  DB unavailable), the polling-config seed should still succeed.
  Separate functions allow the worker bootstrap to call each in its
  own try/catch.

Result:

```ts
// apps/worker/src/lib/seed-config.ts

import type { Database } from "@gjs/db";
import { appConfig, preferenceBranches } from "@gjs/db/schema";
import { ALL_CANONICAL_BRANCHES } from "@/lib/profile-tree/canonical-branches";
// ^ Note: the worker imports from apps/web via the `@/lib/` alias.
// If the worker tsconfig doesn't resolve `@/lib/*`, the alternative
// is to relocate canonical-branches.ts to `packages/db` and re-export.
// For minimum-diff, prefer adding a `@/` alias entry to apps/worker
// tsconfig — verify current setup during /implement-task.

/** EXISTING. Unchanged. */
export async function seedPollingConfig(db: Database): Promise<void> { /* ... */ }

/** NEW. Seeds the five PRD §6.3 app_config defaults. */
export async function seedAppConfigDefaults(db: Database): Promise<void> {
  await db
    .insert(appConfig)
    .values([
      {
        key: "scoring.l3_candidate_cap",
        value: 100,
        description: "Max L3 candidates per scoring trigger.",
      },
      {
        key: "scoring.extend_batch_size",
        value: 100,
        description: "L3 candidates added per 'Score more' click.",
      },
      {
        key: "ui.profile_map_max_depth",
        value: 3,
        description: "Maximum Profile Map render depth.",
      },
      {
        key: "chatbot.clarification_budget",
        value: 2,
        description: "Conversation runtime: max clarification turns per ambiguous claim.",
      },
      {
        key: "scoring.l3_claims_per_call",
        value: 15,
        description: "Max per-claim L3 scoring entries per LLM call.",
      },
    ])
    .onConflictDoNothing();
}

/** NEW. Seeds preference_branch from ALL_CANONICAL_BRANCHES. */
export async function seedPreferenceBranches(db: Database): Promise<void> {
  const rows = ALL_CANONICAL_BRANCHES.map((b, i) => ({
    slug: b.slug,
    parentSlug: b.slug.includes("/")
      ? b.slug.split("/").slice(0, -1).join("/")
      : null,
    displayName: b.displayName,
    sortOrder: i,
    description: b.description,
    active: true,
    config: null,
  }));
  await db
    .insert(preferenceBranches)
    .values(rows)
    .onConflictDoNothing();
}
```

**Idempotency / every-boot vs one-shot:** PRD §11.1 open question.
**Design's choice: every-boot, idempotent.** Rationale:

- `onConflictDoNothing()` is the existing project precedent
  (`seedPollingConfig`) and `feedback_check_existing_libraries` favours
  reuse over new patterns.
- The cost of running three idempotent INSERTs on every worker boot
  is one DB round-trip — negligible.
- A `_migration_state` row would couple seeding to a per-deploy
  bootstrap step and create a different failure mode (state row out
  of sync with reality). Solo product; not worth the gain.

**Call site:** the worker's bootstrap (search for the existing
`seedPollingConfig` call site during `/implement-task`) calls
`seedPollingConfig(db)`, `seedAppConfigDefaults(db)`, then
`seedPreferenceBranches(db)` in sequence, each wrapped in its own
try/catch so a downstream failure doesn't prevent earlier seeds.
**Order matters for `seedPreferenceBranches`:** the seeder relies on
no FK constraint on `parent_slug` (per §4), so even if a parent row
isn't yet present (unlikely given the sort), the INSERT succeeds.

---

## 9. `/api/chatbot/{message,state,save}` 501 stub contract

PRD §11.2 locks:

- HTTP **501** status.
- Body: `{"error":"chatbot endpoints retired"}` (JSON).
- Three routes: `message`, `state`, `save` (the third was *not* in
  research's documented set per PRD §11.2 — **confirm now: yes, all
  three survive as 501 stubs**. Research §Baseline notes lines
  111-114 list all three route files; PRD §11.2 lists all three;
  ADR-0010 §Decision said "save" was deleted but the PRD now
  supersedes that (§11.2 is canonical for this sub-feature)).

**Lock the route file shape — direct `Response.json` per route, no
shared helper.** Rationale:

- Three files × three lines each = 9 lines total. A shared helper
  saves at most 6 lines while adding an import; net wash.
- Auth middleware path is preserved by the file's mere existence
  (Next.js App Router routing depends on file presence, not on the
  exported handler's contents).
- Each route file's contents are identical, so future deletion (when
  conversation-runtime replaces them) is one delete-per-file with no
  shared cleanup.

```ts
// apps/web/src/app/api/chatbot/message/route.ts
// apps/web/src/app/api/chatbot/state/route.ts
// apps/web/src/app/api/chatbot/save/route.ts

import { NextResponse } from "next/server";

const RETIRED_BODY = { error: "chatbot endpoints retired" } as const;

export function GET() {
  return NextResponse.json(RETIRED_BODY, { status: 501 });
}

export function POST() {
  return NextResponse.json(RETIRED_BODY, { status: 501 });
}
```

`state` currently only exposes `GET`; `message` and `save` only
expose `POST`. **The 501 stub exports both** `GET` and `POST` so
any existing client request method hits 501 cleanly (not 405). PRD
§11.1 leaves "JSON shape format details" to the design — only the
literal body in §11.2 is locked. Lock: no `code` field, no `status`
field in body. Exact `{"error":"chatbot endpoints retired"}`.

**No auth check in the stubs.** The legacy routes called
`auth.api.getSession()` first. The retired stub doesn't need auth —
the response is the same regardless of session. Saves a DB call and
removes the `@/lib/auth` import.

**No logging.** The stubs are fire-and-forget; logging every
unauthenticated retired-endpoint hit would be log noise.

---

## 10. `internet-expansion.ts` warn-logged no-op

PRD §11.2 locks:

- Skip DB read entirely.
- Log `"internet-expansion disabled pending tree-driven rewrite"` once
  per invocation.
- Return 0 new companies.
- Queue subscription stays mounted.

**Call-site shape:** the no-op replaces the entire handler body
between the per-batch-job try { ... } catch { ... } at lines 178-921.
The new shape:

```ts
export function createInternetExpansionHandler(db: Database, _boss: PgBoss) {
  return async (batchJobs: Job<ExpansionJobData>[]): Promise<void> => {
    for (const batchJob of batchJobs) {
      const { userId, userProfileId } = batchJob.data;
      log.warn(
        { userId, userProfileId },
        "internet-expansion disabled pending tree-driven rewrite",
      );
    }
  };
}
```

- **Log level: `warn`.** Per PRD §11.2 verbatim "warn-logged no-op".
- **Log message: exact match.** The PRD locks the text; `/log-episode`
  acceptance grep against logs will key on this string.
- **One log per `batchJob`, not per `batchJobs` array.** Rationale:
  pg-boss batches; each batch item is one user's expansion request.
  Logging per item gives visibility into the request volume; logging
  per batch hides that.
- **Return type stays `Promise<void>`.** PRD says "return 0 new
  companies" but the existing handler signature returns `void` (the
  pg-boss contract). The "0 new companies" guarantee is implicit:
  the function returns without enqueueing or inserting.
- **`_boss` prefixed with underscore.** ESLint convention for
  intentionally unused parameters. Verify the current ESLint config
  permits this; alternative is `// eslint-disable-next-line` if
  needed.
- **Imports prune:** delete the now-unused imports (`eq`, `and`,
  `inArray`, `userCompanyPreferences`, `userProfiles`,
  `roleFamilies`, `companies`, `jobs`, `jobMatches`, ATS-core helpers,
  decryptUserKey, discoverCompanies, etc.). Keep only `pg-boss` /
  `Database` types, `createLogger`, and the
  `ExpansionJobData` interface.

---

## 11. `buildScoringPrompt` signature change

Current shape (`apps/worker/src/lib/scoring-prompt.ts:17-37`):

```ts
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
```

New shape (locked):

```ts
interface UserProfileData {
  /** Pre-rendered Markdown-free summary produced by
   * summariseTreeForL3. Renders verbatim under the
   * `## Candidate Profile` section of the user prompt body. */
  treeSummary: string;

  /** Retained columns — still come from user_profile directly. */
  targetTitles: string[] | null;
  targetSeniority: string[] | null;
  preferredLocations: string[] | null;
  remotePreference: string | null;
  locationPreferences: unknown;
  minSalary: number | null;
  targetSalary: number | null;
  salaryCurrency: string | null;
}
```

**Why keep the retained columns alongside `treeSummary`:** the prompt
body lines 154-163 use **both** the tree-derived (skills, industries,
deal-breakers) AND the retained-column-derived (titles, seniority,
remote, salary, locations). Per PRD §11.3, the retained columns are
untouched. The cleanest seam is: tree handles the dropped fields,
columns handle the retained fields, prompt body keeps its existing
section structure.

**Prompt body change:**

Replace lines 154-163 in `scoring-prompt.ts` with:

```ts
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
${profile.treeSummary}
Location Preferences: ${summarizeLocationPreferences(profile.locationPreferences, profile.preferredLocations)}
Remote Preference: ${profile.remotePreference ?? "any"}
Salary Range: ${formatSalaryRange(profile.minSalary, profile.targetSalary, profile.salaryCurrency)}`;
```

**`treeSummary` is templated as a single substitution** that produces
the five-line block (Core Skills / Growth Skills / Avoid Skills /
Deal-Breakers / Preferred Industries). The system prompt body
(`SYSTEM_PROMPT` at line 75-133) is **unchanged** — every label it
references is still present in the user prompt.

**Where `summariseTreeForL3` is called from:** the handler
(`apps/worker/src/handlers/llm-scoring.ts`), not from inside
`buildScoringPrompt`. Handler change at lines 160-174 (PRD §0):

```ts
// Before (lines 160-174):
profile: {
  targetTitles: profile.targetTitles,
  targetSeniority: profile.targetSeniority,
  coreSkills: profile.coreSkills,
  growthSkills: profile.growthSkills,
  avoidSkills: profile.avoidSkills,
  dealBreakers: profile.dealBreakers,
  preferredLocations: profile.preferredLocations,
  remotePreference: profile.remotePreference,
  locationPreferences: profile.locationPreferences,
  minSalary: profile.minSalary,
  targetSalary: profile.targetSalary,
  salaryCurrency: profile.salaryCurrency,
  preferredIndustries: profile.preferredIndustries,
},

// After:
profile: {
  targetTitles: profile.targetTitles,
  targetSeniority: profile.targetSeniority,
  preferredLocations: profile.preferredLocations,
  remotePreference: profile.remotePreference,
  locationPreferences: profile.locationPreferences,
  minSalary: profile.minSalary,
  targetSalary: profile.targetSalary,
  salaryCurrency: profile.salaryCurrency,
  treeSummary: summariseTreeForL3(
    PreferenceTreeSchema.parse(profile.preferenceTree),
  ),
},
```

The `PreferenceTreeSchema.parse(...)` call validates the JSONB at
handler-time (per research §External findings "Validation, layered
defence: parse on read"). The handler is the right call site
because the prompt builder is the worker's `lib/` pure function and
shouldn't import a `profile-tree/` module from `apps/web/src/lib/`
unless the alias resolves.

**Cross-package import note:** `apps/worker` already imports from
`apps/web` via existing patterns? Verify during `/implement-task`.
If the alias `@/lib/profile-tree` is not available to the worker,
move `summariseTreeForL3` and the leaf schema files to `packages/db`
or a new `packages/profile-tree` package. **Recommended:** keep them
in `apps/web/src/lib/profile-tree/` and add a workspace alias entry
to the worker's tsconfig — minimum-diff vs creating a new package
for one cross-app helper.

---

## 12. Unit-test plan for `profile-tree/*`

Location: tests live next to source files per existing convention
(`apps/web/vitest.config.ts` line 14: `src/**/*.{test,spec}.{ts,tsx}`
glob). Test runner is Vitest, jsdom env, globals enabled.

**Fixtures (PRD §11.5 minimum eight + suggested two from research):**

1. **Empty tree** — `{ schemaVersion: 1, leaves: [] }`.
2. **Single-leaf tree** — one `industry`/`include` leaf.
3. **Multi-leaf single-branch** — three `industry` leaves with
   mixed polarity.
4. **Multi-branch tree** — `role`, `skills/keep`, `industry`,
   `deal-breakers` leaves.
5. **Deep `branchPath`** — `skills/keep` leaf with
   `branchPath: ["skills", "skills/keep"]`.
6. **Leaf with `skillIntent`** — `skills/grow` leaf with
   `skillIntent: "grow"`.
7. **Invalid leaf missing `branchSlug`** — assert
   `LeafSchema.safeParse(...)` fails with a `branchSlug` issue.
8. **`moveLeaves` golden path** — move all `industry` leaves to a
   new slug `industry-renamed` (using a hypothetical slug added at
   test-time; the actual slug remains canonical) — confirms slug +
   path rewrite and `mutateLeaf` integration.

**Recommended additions:**

9. **Merge path** (research suggestion) — combine two slugs via
   `moveLeaves` with `mutateLeaf` adding a per-leaf `scope` field.
   Demonstrates the ADR-0011 §Composition-change playbook step 4.
10. **Idempotency: re-mutate same leaf** — confirm `mutateLeaf`
    called twice produces the same final shape (the second call is
    a no-op when the mutator is identity).

**One fixture per file is fine; or group into:**

- `leaf-schema.test.ts` — fixtures 1, 2, 6, 7 (shape validation).
- `mutate-leaf.test.ts` — fixture 10.
- `move-leaves.test.ts` — fixtures 3, 4, 5, 8, 9.
- `derive-l2.test.ts` — verifies fixtures 1, 2, 3 produce expected
  `L2Inputs` (empty industries; one entry; positive-polarity only).
- `summarise-l3.test.ts` — verifies fixtures 1, 4, 6 produce the
  expected exact strings. Empty-tree case asserts exact match for
  `"No preferences set yet."`.
- `canonical-branches.test.ts` — assertions: row count matches PRD
  §4 metric (19); every slug has a unique slug; container slugs are
  marked correctly; every `l3Section` value is one of the lock-list
  five labels.

**No DB integration tests in this PR.** `migrate-leaves.ts` ships
without exercising the DB writer (PRD §7.1 + the "shipped for future
use" framing). A future PR (the first composition change) gets the
first end-to-end migrateLeaves test against a temp DB.

---

## 13. PR-boundary recommendation

PRD §10 + §11.1 open: single PR vs 2-4 PRs.

**Recommendation: SINGLE PR.**

Rationale:

- **HEAD-green-at-every-commit feasibility:** the cutover is
  inherently atomic — the schema change drops columns that the
  filter-pipeline and L3 worker currently read. Splitting into "drop
  columns" + "rewire pipeline" makes the intermediate commit fail
  typecheck because the column references in pipeline/worker would
  reference dropped columns. The only way to split *and* keep HEAD
  green is to land the new code first (with feature flags to choose
  source) — but PRD §11.2 + `CLAUDE.md` ban feature flags.
- **Diff profile:** the PR is ~1500 lines net (delete ~3000 lines of
  chatbot module; add ~500 lines of profile-tree module; ~50 lines
  of schema diff; ~150 lines of migration SQL; ~100 lines of
  pipeline/worker rewire). The deletions dominate; the additions
  are mostly small pure modules with focused tests. Reviewable in
  one sitting.
- **Reviewer load is the operator** — solo product per
  `project_no_prod_users`. No external reviewer queue to optimise
  for.
- **Rollback is the same effort regardless of PR count:** `pg_dump`
  snapshot + revert the merge commit(s). Splitting doesn't reduce
  rollback risk; it just multiplies it.
- **PRD §4 "Migration applies in one transaction"** metric is more
  naturally satisfied by a single PR — one PR, one migration, one
  worker reboot, one acceptance gate sweep.

**Logical commit boundaries inside the single PR** (operator
guidance, not enforced):

- Commit 1 — `feat(db)`: schema TS update + generated migration SQL
  (and hand edits for JSONB default + DELETE FROM).
- Commit 2 — `feat(web)`: `apps/web/src/lib/profile-tree/*` module
  + unit tests.
- Commit 3 — `chore(web)`: chatbot module + UI + onboarding page
  deletion + 501 stubs.
- Commit 4 — `refactor(web)`: filter-pipeline rewire.
- Commit 5 — `refactor(worker)`: scoring-prompt rewire +
  internet-expansion no-op.
- Commit 6 — `feat(worker)`: seed-config extension +
  `seedAppConfigDefaults` + `seedPreferenceBranches`.
- Commit 7 — `chore(ats-core)`: stale comment fix.

Each commit independently typechecks **only after** prior commits
(by design — the substrate is inherently coupled). HEAD-green is
satisfied at the **PR** level, not per-commit. If the operator
prefers per-commit-green, fold commits 1+3+4+5 into one
"Big-cutover" commit and keep 2, 6, 7 separate (those are additive
and self-contained).

---

## Risks

The PRD §9.3 lists dependencies and assumptions but not
architectural risks specific to this design. Augmenting:

- **[Performance / Query]** No JSONB GIN index on
  `user_profile.preference_tree`. For the solo product this is fine
  (one user, one row), but the L3 candidate filter loop in
  `internet-expansion.ts` and the future `conversation-runtime`
  prompt building scan the leaves array client-side. If user counts
  ever grow, an expression GIN index on
  `(preference_tree->'leaves')` becomes a hot recommendation. **Not
  added in this PR** — premature. Document in PRD §11.5 as a
  fast-follow if `migrate-leaves.ts`'s `FOR UPDATE` ever sees
  contention.
  **Mitigation:** none in this PR. Future-follow if needed.

- **[Type drift]** The `kind` / `l3Section` / `l3Soft` /
  `l2Derivation` / `matcherScope` / `acceptsSkillIntent` fields on
  `CanonicalBranchDef` are TS-only — they don't round-trip through
  `preference_branch`. A developer who edits `preference_branch.config`
  in the DB believing it influences the matcher will be surprised.
  **Mitigation:** a code comment at the top of
  `canonical-branches.ts` declaring "These fields are compile-time
  semantic hooks. To change runtime behaviour, edit this file and
  ship a migration." Add the same comment to the
  `preferenceBranches` table definition in `schema.ts`.

- **[Concurrency]** `preferenceTree` is a JSONB column that future
  conversation-runtime mutates wholesale. Two concurrent turns
  could last-write-wins overwrite each other. Per design §17 this
  is `conversation-runtime`'s problem (optimistic concurrency via
  `updatedAt`). **In this PR**, the tree is created empty and never
  written to — concurrency is not a live risk yet. The
  `migrateLeaves` signature already permits optimistic-lock writes;
  document that callers must use the `WHERE updatedAt = $original`
  clause.
  **Mitigation:** `migrate-leaves.ts` documents the optimistic-lock
  pattern in JSDoc.

- **[Foreign-key cascades]** Dropping
  `userCompanyPreferences` / `conversationStates` /
  `conversationMessages`: the schemas declare `onDelete: "cascade"`
  on the user_id FK; dropping the parent table is safe (no rows
  reference back). The `conversationMessages` FK to
  `conversationStates` (cascade) means dropping
  `conversationMessages` first then `conversationStates` is
  technically equivalent to dropping `conversationStates` and
  letting the cascade fire — but explicit DROP order is clearer and
  works on every Postgres version. **Locked at step 1 → step 2** in
  the migration order.
  **Mitigation:** see Migration §7 ordering.

- **[Cross-package import]** Worker's `apps/worker/src/lib/seed-
  config.ts` imports `ALL_CANONICAL_BRANCHES` from
  `apps/web/src/lib/profile-tree/canonical-branches.ts`. The `@/`
  alias resolution must work across apps. If the worker tsconfig
  paths don't include `@/lib/*` mapping to `../web/src/lib/*`, the
  build fails. **`/implement-task` must verify and add the path
  mapping** if absent. Alternative: relocate
  `canonical-branches.ts` (and only that file) to `packages/db`,
  re-export. The web app's `profile-tree` module then imports the
  constant from `@gjs/db/canonical-branches`. **Choice: prefer the
  alias path. Migrate to `packages/db` only if the alias is
  infeasible.**
  **Mitigation:** `/implement-task` validates path resolution
  before writing the seeder.

- **[Stub auth divergence]** The 501 stubs skip auth checks. A
  future test that hits `/api/chatbot/message` with an
  unauthenticated request and asserts 401 (legacy behaviour) would
  pass under legacy code and fail under the stub. **Document in PR
  description**: legacy 401 behaviour for chatbot routes is gone;
  the stubs are unconditional 501.
  **Mitigation:** scan existing tests for chatbot route assertions;
  update or delete.

- **[Migration rollback]** PRD §9.3 already notes `pg_dump` is
  operator-manual. Risk: operator forgets. **No software mitigation
  in this PR** (PRD §10 leaves `make snapshot-pre-wipe` to design;
  see below). **Design's call: do NOT add `make snapshot-pre-wipe`
  in this PR.** Rationale: solo product, operator (vasd85) is the
  only one running migrations, and adding a `Makefile` target for
  one snapshot creates a new pattern (no Makefile exists in repo
  today). README documentation is sufficient.

---

## Patterns to Follow

- **`role_family` as `preference_branch` template:**
  `packages/db/src/schema.ts:347-358` (`roleFamilies`). Same column
  conventions (text PK, text-array fields, default-empty),
  `is_system_defined` analogue is the implicit "lives in
  CANONICAL_BRANCHES" for `preferenceBranches`.
- **`seedPollingConfig` for seeder shape:**
  `apps/worker/src/lib/seed-config.ts:10-46`. `.insert(t).values([])
  .onConflictDoNothing()` is the documented pattern; extend with
  `seedAppConfigDefaults` and `seedPreferenceBranches`.
- **JSONB default literal precedent:**
  `apps/web/drizzle/0009_separate_match_signals.sql` hand-edits
  Drizzle autogen; same approach for 0010's `DEFAULT '...'::jsonb`
  literal and DML insertion.
- **One-line schema re-export:**
  `apps/web/src/lib/db/schema.ts` (`export * from "@gjs/db/schema"`)
  is preserved per PRD §11.3 invariant. Do not add named exports;
  the wildcard export captures the new `preferenceBranches`.
- **Zod-as-source-of-truth for JSONB shape:** existing
  `scoring-schema.ts`'s pattern (Zod + inferred type +
  `.parse()`-on-read). `leaf-schema.ts` follows the same pattern;
  `claim-scores` schema lives alongside `ScoringOutputSchema` in
  `scoring-schema.ts`.
- **Local structural type in ats-core:**
  `packages/ats-core/src/geo/resolve-user-location.ts:18-27` defines
  `LocationPreferenceTierInput` locally to avoid app→ats-core
  imports. The stale comment at lines 8-17 is the only fix; the
  pattern is correct.
- **NextResponse.json(...,{status}) for route stubs:** every
  existing route in `apps/web/src/app/api/` returns
  `NextResponse.json(body, { status })`. Match exactly.

---

## Open Questions

All PRD §10 questions are decided in this design:

- **Sub-branches under `company-attributes/*`:** full set
  (`size / stage / funding / hq / product-or-services / brand /
  culture`). §1 above.
- **`migrate-leaves.ts` dry-run mode:** shipped. §6.5 above.
- **`make snapshot-pre-wipe` script:** NOT shipped; README only.
  §Risks above.
- **PR boundaries:** single PR. §13 above.

**Questions remaining for `/implement-task`** (not architectural;
deferred to implementation discovery):

- **Worker `@/` alias resolution.** Verify
  `apps/worker/tsconfig.json` resolves `@/lib/*` to
  `../web/src/lib/*` (or equivalent). If not, the seeder import of
  `ALL_CANONICAL_BRANCHES` needs an alternate path. §Risks above.
- **`crypto.randomUUID()` vs UUID v7.** Search for an existing UUID
  v7 helper in repo before adding a dep. Default to
  `crypto.randomUUID()` if none exists.
- **Existing tests for chatbot routes.** Run
  `rg "api/chatbot" --type ts` and update or delete any test that
  asserts 401/200 on the retired routes.

---

# ADR drafts

Per the orchestrator instructions: "Likely no NEW ADR is needed."
This design surfaces **no fresh broad-scope decisions** that aren't
already captured by ADR-0009/0010/0011. The decisions made above
are scope-local to this PR:

- `summariseTreeForL3` rendering format (comma-separated, five
  sections) — local to this PR. Future widening or rewrite is
  within the L3 widening sub-feature's scope; not a system-wide
  pattern.
- Three-function seeder split — local to this PR's seeder file;
  doesn't establish a new convention beyond the existing
  "one function per logical seed bucket" pattern.
- `claim_scores` as `ClaimScore[]` array vs map — architecturally
  bundled into ADR-0007 already; this design is concretising the
  shape, not deciding it.
- Single PR vs split — operational PR-management choice, not an
  architectural decision worth an ADR.
- Comma-separated vs bullet inside `summariseTreeForL3` — same: a
  rendering choice inside the locked envelope of "section labels
  mirror scoring-prompt.ts".

**No new ADR files written to `ADR_OUTPUT_DIR`.**

If `/implement-task` discovers a divergence (e.g., the worker `@/`
alias is infeasible and `canonical-branches.ts` must move to
`packages/db`), that **would** be a new broad-scope decision and a
fresh ADR. Flag for the implementer to escalate if it happens.
