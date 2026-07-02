import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  LeafSchema,
  type Leaf,
  PreferenceTreeSchema,
} from "./leaf-schema";
import {
  deepPathTree,
  ID_A,
  makeLeaf,
  multiBranchTree,
  singleLeafTree,
  skillIntentGrowTree,
  TS,
  TURN,
} from "./__fixtures__";

/**
 * `LeafSchema` validates field types AND a 5-rule `superRefine`:
 *   1. Unknown branchSlug -> issue on branchSlug, early return (one issue).
 *   2. branchPath last element != branchSlug -> issue on branchPath.
 *   3. branchPath.length != def.maxPathDepth -> issue on branchPath.
 *   4. def.isContainer -> issue on branchSlug.
 *   5. skillIntent set but slug not in SKILLS_SLUGS -> issue on skillIntent.
 *
 * superRefine multiplicity is NOT one-per-failure: a malformed leaf can fire
 * multiple issues (e.g. a container slug at the wrong depth fires rules 3 AND
 * 4). Negative assertions therefore use `issues.some(...)` matching on
 * path/message and never pin `issues.length` — EXCEPT the unknown-slug path
 * (rule 1), which early-returns and legitimately yields exactly one issue.
 */

// Matches the v4/any UUID variant the schema accepts.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("LeafSchema — positive cases", () => {
  // LS-P1 — locked fixture #2.
  test("accepts a valid single industry/include leaf and applies weight 1", () => {
    const leaf = singleLeafTree().leaves[0];
    const result = LeafSchema.safeParse(leaf);
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Fixture carries weight: 1 explicitly, so parsed data deep-equals it.
    expect(result.data).toEqual(leaf);
    expect(result.data.weight).toBe(1);
    expect(result.data.branchPath).toEqual(["industry"]);
  });

  // LS-P2 — locked fixture #5 (deep branchPath).
  test("accepts a deep-path skills/keep leaf (depth 2 == maxPathDepth)", () => {
    const result = LeafSchema.safeParse(deepPathTree().leaves[0]);
    expect(result.success).toBe(true);
  });

  // LS-P3 — locked fixture #6 (skillIntent leaf).
  test("accepts a skills/grow leaf carrying skillIntent: grow", () => {
    const result = LeafSchema.safeParse(skillIntentGrowTree().leaves[0]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.skillIntent).toBe("grow");
  });

  // LS-P5 — weight default applied when omitted (protects round-trip/mutate).
  test("applies weight default of 1 when weight is omitted", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { weight: _omit, ...withoutWeight } = makeLeaf();
    const parsed = LeafSchema.parse(withoutWeight);
    expect(parsed.weight).toBe(1);
  });

  // LS-P6 — a maximal leaf round-trips every optional field.
  test("round-trips every optional field on a maximal skills/keep leaf", () => {
    const maximal = makeLeaf({
      branchSlug: "skills/keep",
      branchPath: ["skills", "skills/keep"],
      claimText: "TypeScript",
      polarity: "include",
      skillIntent: "keep",
      confidence: 0.8,
      note: "at startup",
      canonical: ["ts", "typescript"],
      flaggedUncertain: true,
      provenance: { turnId: TURN },
    });
    const result = LeafSchema.safeParse(maximal);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(maximal);
  });

  // LS-P8 — Unicode / SQL-significant claimText is accepted verbatim (the
  // schema requires only min(1); it never sanitizes — claims are stored as the
  // user said them).
  test.each<[string, string]>([
    ["emoji", "remote 🚀 first"],
    ["RTL", "شركة"],
    ["zero-width", "fin​tech"],
    ["SQL-significant", "O'Brien & Co; DROP TABLE jobs;--"],
  ])("accepts %s characters in claimText verbatim", (_label, claimText) => {
    const result = LeafSchema.safeParse(makeLeaf({ claimText }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.claimText).toBe(claimText);
  });
});

describe("LeafSchema — superRefine rejection rules", () => {
  // LS-N1 — locked fixture #7. Missing branchSlug key: the base
  // z.string().min(1) type check fires ("Invalid input"/"Required") on
  // branchSlug; superRefine does not run for an absent required field. Do NOT
  // assert message text — it differs from rule 1's "Unknown branchSlug".
  test("rejects a leaf whose branchSlug key is omitted entirely", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { branchSlug: _omit, ...missingSlug } = makeLeaf();
    const result = LeafSchema.safeParse(missingSlug);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some((i) => i.path.includes("branchSlug")),
    ).toBe(true);
  });

  // LS-N2 — rule 1. Present-but-unknown slug early-returns, so EXACTLY one
  // issue. This is the one scenario that may pin issues.length === 1.
  test("rejects a present-but-unknown branchSlug with exactly one issue", () => {
    const result = LeafSchema.safeParse(
      makeLeaf({ branchSlug: "nope", branchPath: ["nope"] }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.length).toBe(1);
    expect(result.error.issues[0].path).toEqual(["branchSlug"]);
    expect(
      result.error.issues.some(
        (i) =>
          i.path.includes("branchSlug") && /Unknown branchSlug/.test(i.message),
      ),
    ).toBe(true);
  });

  // LS-N3 — rule 2. industry slug with branchPath ["role"]: depth 1 ==
  // maxPathDepth 1 so rule 3 does NOT fire; only rule 2.
  test("rejects a branchPath that does not end at branchSlug", () => {
    const result = LeafSchema.safeParse(
      makeLeaf({ branchSlug: "industry", branchPath: ["role"] }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        (i) =>
          i.path.includes("branchPath") &&
          /must end at branchSlug/.test(i.message),
      ),
    ).toBe(true);
  });

  // LS-N4 — rule 3. skills/keep at depth 1: last element == slug (rule 2 ok),
  // depth 1 != maxPathDepth 2 (rule 3 fires), not a container (rule 4 ok).
  test("rejects a branchPath whose depth != the branch maxPathDepth", () => {
    const result = LeafSchema.safeParse(
      makeLeaf({ branchSlug: "skills/keep", branchPath: ["skills/keep"] }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        (i) =>
          i.path.includes("branchPath") &&
          /depth 1 != maxPathDepth 2/.test(i.message),
      ),
    ).toBe(true);
  });

  // LS-N5 — rule 4 in isolation. skills container at depth 2 with last element
  // == slug: rules 2 and 3 pass, only rule 4 fires.
  test("rejects a leaf hosted directly on a container slug", () => {
    const result = LeafSchema.safeParse(
      makeLeaf({ branchSlug: "skills", branchPath: ["skills", "skills"] }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        (i) => i.path.includes("branchSlug") && /is a container/.test(i.message),
      ),
    ).toBe(true);
  });

  // LS-N6 — rule 5. skillIntent on industry (a non-skills branch).
  test("rejects skillIntent set on a non-skills branch", () => {
    const result = LeafSchema.safeParse(
      makeLeaf({
        branchSlug: "industry",
        branchPath: ["industry"],
        skillIntent: "keep",
      }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        (i) =>
          i.path.includes("skillIntent") &&
          /skillIntent only allowed on skills/.test(i.message),
      ),
    ).toBe(true);
  });

  // LS-N7 — multiplicity lock. Container slug at the WRONG depth fires BOTH
  // rule 3 (depth) AND rule 4 (container). Explicitly do NOT assert length: 1.
  test("fires both the depth and container issues for a container at depth 1", () => {
    const result = LeafSchema.safeParse(
      makeLeaf({ branchSlug: "skills", branchPath: ["skills"] }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        (i) =>
          i.path.includes("branchPath") &&
          /depth 1 != maxPathDepth 2/.test(i.message),
      ),
    ).toBe(true);
    expect(
      result.error.issues.some(
        (i) => i.path.includes("branchSlug") && /is a container/.test(i.message),
      ),
    ).toBe(true);
  });

  // LS-P7 — provenance.turnId must be a UUID.
  test("rejects provenance with a non-UUID turnId", () => {
    const result = LeafSchema.safeParse(
      makeLeaf({ provenance: { turnId: "x" } as Leaf["provenance"] }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        (i) => i.path.includes("provenance") && i.path.includes("turnId"),
      ),
    ).toBe(true);
  });
});

describe("LeafSchema — base-type constraints", () => {
  // LS-N8 — every field constraint is defended independent of superRefine.
  // Each override yields a leaf that must fail safeParse.
  test.each<[string, Partial<Leaf>]>([
    ["empty claimText (min 1)", { claimText: "" }],
    ["polarity outside enum", { polarity: "neutral" as Leaf["polarity"] }],
    ["confidence above 1", { confidence: 1.5 }],
    ["confidence below 0", { confidence: -0.1 }],
    ["weight zero (not positive)", { weight: 0 }],
    ["weight negative", { weight: -1 }],
    ["id not a UUID", { id: "not-a-uuid" }],
    ["createdAt date-only (not full datetime)", { createdAt: "2026-05-29" }],
    [
      "updatedAt with a timezone offset (rejected by Zod v4)",
      { updatedAt: "2026-05-29T12:00:00+02:00" },
    ],
    ["branchPath empty (min 1)", { branchPath: [] }],
    ["branchPath too deep (max 2)", { branchPath: ["a", "b", "c"] }],
  ])("rejects %s", (_label, overrides) => {
    expect(LeafSchema.safeParse(makeLeaf(overrides)).success).toBe(false);
  });

  // LS-N9 — string-coercion traps: Zod must NOT silently coerce strings into
  // numbers/booleans here.
  test.each<[string, Record<string, unknown>]>([
    ["weight as string '1'", { weight: "1" }],
    ["confidence as string '0.5'", { confidence: "0.5" }],
    ["flaggedUncertain as string 'false'", { flaggedUncertain: "false" }],
  ])("rejects %s without coercion", (_label, overrides) => {
    const leaf = { ...makeLeaf(), ...overrides };
    expect(LeafSchema.safeParse(leaf).success).toBe(false);
  });
});

describe("PreferenceTreeSchema", () => {
  // LS-P4 — locked fixture #4 (multi-branch) at the tree level.
  test("accepts the multi-branch tree", () => {
    const tree = multiBranchTree();
    const result = PreferenceTreeSchema.safeParse(tree);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.leaves.length).toBe(4);
    expect(result.data.schemaVersion).toBe(1);
  });

  // LS-N9 (tree-level coercion trap) — schemaVersion is a literal 1, no string
  // coercion.
  test("rejects schemaVersion as the string '1'", () => {
    const result = PreferenceTreeSchema.safeParse({
      schemaVersion: "1",
      leaves: [],
    });
    expect(result.success).toBe(false);
  });

  // LS-N10 — z.literal(1): v1 is the only legal version.
  test.each<[number]>([[2], [0]])(
    "rejects schemaVersion %i with an issue on schemaVersion",
    (version) => {
      const result = PreferenceTreeSchema.safeParse({
        schemaVersion: version,
        leaves: [],
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some((i) => i.path.includes("schemaVersion")),
      ).toBe(true);
    },
  );

  // LS-N11 — extra top-level keys.
  // TODO(I2): design §3 says "No other keys in v1," but the schema is NOT
  // .strict(), so unknown keys are silently STRIPPED rather than rejected. If
  // the design intends rejection, PreferenceTreeSchema (and LeafSchema) need
  // .strict(). This test locks the CURRENT (stripping) behavior.
  test("strips unknown top-level keys rather than rejecting them", () => {
    const result = PreferenceTreeSchema.safeParse({
      schemaVersion: 1,
      leaves: [],
      extra: true,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect("extra" in result.data).toBe(false);
    expect(result.data).toStrictEqual({ schemaVersion: 1, leaves: [] });
  });

  // LS-N1 (tree level) — invalid leaves surface through the tree schema.
  test("rejects a tree containing an invalid leaf", () => {
    const result = PreferenceTreeSchema.safeParse({
      schemaVersion: 1,
      leaves: [makeLeaf({ branchSlug: "nope", branchPath: ["nope"] })],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((i) => i.path.includes("leaves"))).toBe(
      true,
    );
  });
});

describe("id shape (no deterministic value assumptions)", () => {
  // Global note #4: never assert a specific id value; assert UUID shape.
  test("a fixture id matches the UUID shape via regex and zod", () => {
    expect(ID_A).toMatch(UUID_RE);
    expect(z.string().uuid().safeParse(ID_A).success).toBe(true);
  });

  test("a stamped ISO timestamp re-parses as a valid datetime", () => {
    // toISOString always emits a Z suffix.
    const stamped = new Date(TS).toISOString();
    expect(z.string().datetime().safeParse(stamped).success).toBe(true);
  });
});
