import { describe, expect, test } from "vitest";
import {
  ALL_CANONICAL_BRANCHES,
  CANONICAL_BRANCHES,
  COMPANY_ATTRIBUTE_SUB_BRANCHES,
  SKILLS_SUB_BRANCHES,
  type CanonicalBranchDef,
} from "./canonical-branches";

/**
 * `ALL_CANONICAL_BRANCHES` is the single source of truth for the branch
 * taxonomy. These tests lock the count, slug uniqueness, container flags, and
 * the per-field semantic hooks (`l3Section`, `maxPathDepth`,
 * `acceptsSkillIntent`, `l2Derivation`, ...) that the schema and the four pure
 * transforms read against. A drift here silently changes leaf validation, L2
 * derivation, or the L3 summary, so the assertions are intentionally exact.
 */

const FIVE_L3_LABELS = [
  "Core Skills",
  "Growth Skills",
  "Avoid Skills",
  "Deal-Breakers",
  "Preferred Industries",
] as const;

describe("ALL_CANONICAL_BRANCHES", () => {
  // CB-1
  test("contains exactly 19 entries", () => {
    expect(ALL_CANONICAL_BRANCHES.length).toBe(19);
  });

  // CB-2
  test("every slug is unique", () => {
    const slugs = ALL_CANONICAL_BRANCHES.map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  // CB-3
  test("exactly the two known containers are flagged isContainer: true", () => {
    const containerSlugs = ALL_CANONICAL_BRANCHES.filter((b) => b.isContainer)
      .map((b) => b.slug)
      .sort();
    expect(containerSlugs).toEqual(["company-attributes", "skills"]);
  });

  // CB-12
  test("is the concatenation of the three exported sub-arrays", () => {
    expect(ALL_CANONICAL_BRANCHES.length).toBe(
      CANONICAL_BRANCHES.length +
        SKILLS_SUB_BRANCHES.length +
        COMPANY_ATTRIBUTE_SUB_BRANCHES.length,
    );
    expect(ALL_CANONICAL_BRANCHES).toEqual([
      ...CANONICAL_BRANCHES,
      ...SKILLS_SUB_BRANCHES,
      ...COMPANY_ATTRIBUTE_SUB_BRANCHES,
    ]);
  });
});

describe("l3Section taxonomy", () => {
  const branchesWithSection = ALL_CANONICAL_BRANCHES.filter(
    (b): b is CanonicalBranchDef & { l3Section: string } =>
      b.l3Section !== undefined,
  );

  // CB-4
  test.each(branchesWithSection.map((b) => [b.slug, b.l3Section] as const))(
    "%s carries an l3Section that is one of the five locked labels",
    (_slug, label) => {
      expect(FIVE_L3_LABELS).toContain(label);
    },
  );

  // CB-5 — the mapping is complete and correct; no other branch defines a
  // section. This is the contract `summarise-l3.ts`'s SLUG_TO_SECTION derives
  // from, so locking it here protects the L3 summariser indirectly.
  test("maps exactly the five expected slug -> section pairs", () => {
    const pairs = branchesWithSection
      .map((b) => [b.slug, b.l3Section] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
    expect(pairs).toEqual([
      ["deal-breakers", "Deal-Breakers"],
      ["industry", "Preferred Industries"],
      ["skills/avoid", "Avoid Skills"],
      ["skills/grow", "Growth Skills"],
      ["skills/keep", "Core Skills"],
    ]);
    expect(branchesWithSection.length).toBe(5);
  });
});

describe("kind lock-list", () => {
  // CB-6 — design §1 locks nine kinds, one per top-level slug.
  test("top-level branches use exactly the nine locked kind values", () => {
    const kinds = [...new Set(CANONICAL_BRANCHES.map((b) => b.kind))].sort();
    expect(kinds).toEqual([
      "attribute",
      "compensation",
      "dealbreaker",
      "exclusion",
      "industry",
      "location",
      "other",
      "role",
      "skills",
    ]);
  });
});

describe("maxPathDepth", () => {
  // CB-7 — consumed by LeafSchema.superRefine rule 3.
  const depthCases: [string, 1 | 2][] = [
    ["role", 1],
    ["compensation", 1],
    ["location", 1],
    ["industry", 1],
    ["exclusions", 1],
    ["deal-breakers", 1],
    ["other", 1],
    ["skills", 2],
    ["company-attributes", 2],
    ["skills/keep", 2],
    ["skills/grow", 2],
    ["skills/avoid", 2],
    ["company-attributes/size", 2],
    ["company-attributes/stage", 2],
    ["company-attributes/funding", 2],
    ["company-attributes/hq", 2],
    ["company-attributes/product-or-services", 2],
    ["company-attributes/brand", 2],
    ["company-attributes/culture", 2],
  ];

  test.each(depthCases)("%s has maxPathDepth %i", (slug, expected) => {
    const def = ALL_CANONICAL_BRANCHES.find((b) => b.slug === slug);
    expect(def?.maxPathDepth).toBe(expected);
  });
});

describe("acceptsSkillIntent", () => {
  // CB-8 — drives SKILLS_SLUGS in leaf-schema.ts (superRefine rule 5).
  // TODO(I3): the `skills` *container* has acceptsSkillIntent: true, so
  // SKILLS_SLUGS includes the container slug. This is dead-but-harmless because
  // superRefine rule 4 rejects any leaf using a container slug before rule 5
  // could matter. A container can never host a leaf, so it never needs to
  // "accept skillIntent" — consider dropping the flag from the container.
  test("is true for exactly skills + the three skills/* sub-branches", () => {
    const slugs = ALL_CANONICAL_BRANCHES.filter((b) => b.acceptsSkillIntent)
      .map((b) => b.slug)
      .sort();
    expect(slugs).toEqual([
      "skills",
      "skills/avoid",
      "skills/grow",
      "skills/keep",
    ]);
  });
});

describe("l2Derivation", () => {
  // CB-9 — deriveL2Inputs switches on l2Derivation === "industry-tokens";
  // only `industry` must match.
  test("is set only on role/location/industry with the expected kinds", () => {
    const pairs = ALL_CANONICAL_BRANCHES.filter(
      (b) => b.l2Derivation !== undefined,
    )
      .map((b) => [b.slug, b.l2Derivation] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
    expect(pairs).toEqual([
      ["industry", "industry-tokens"],
      ["location", "location-tier"],
      ["role", "titles"],
    ]);
  });
});

describe("synonymDimension", () => {
  // CB-10
  test("synonymDimension 'industry' is present only on the industry branch", () => {
    const slugs = ALL_CANONICAL_BRANCHES.filter(
      (b) => b.synonymDimension === "industry",
    ).map((b) => b.slug);
    expect(slugs).toEqual(["industry"]);
  });
});

describe("sub-branch namespacing", () => {
  // CB-11
  test.each(SKILLS_SUB_BRANCHES.map((b) => [b.slug] as const))(
    "%s is namespaced under skills/",
    (slug) => {
      expect(slug.startsWith("skills/")).toBe(true);
    },
  );

  test.each(COMPANY_ATTRIBUTE_SUB_BRANCHES.map((b) => [b.slug] as const))(
    "%s is namespaced under company-attributes/",
    (slug) => {
      expect(slug.startsWith("company-attributes/")).toBe(true);
    },
  );
});
