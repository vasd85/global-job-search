import { z } from "zod";
import { ALL_CANONICAL_BRANCHES } from "./canonical-branches";

const VALID_SLUGS = new Set(ALL_CANONICAL_BRANCHES.map((b) => b.slug));
const SKILLS_SLUGS = new Set(
  ALL_CANONICAL_BRANCHES.filter((b) => b.acceptsSkillIntent).map((b) => b.slug),
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

/** `preferenceTree` JSONB shape (design §3). Top-level keys locked:
 * `schemaVersion`, `leaves`. No other keys in v1. */
export const PreferenceTreeSchema = z.object({
  schemaVersion: z.literal(1),
  leaves: z.array(LeafSchema),
});

export type PreferenceTree = z.infer<typeof PreferenceTreeSchema>;
