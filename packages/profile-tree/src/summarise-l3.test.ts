import { describe, expect, test } from "vitest";
import { summariseTreeForL3 } from "./summarise-l3";
import type { PreferenceTree } from "./leaf-schema";
import {
  emptyTree,
  ID_A,
  ID_B,
  ID_C,
  makeLeaf,
  multiBranchTree,
  partialSectionsTree,
  skillsAllPolaritiesTree,
} from "./__fixtures__";

/**
 * `summariseTreeForL3` renders the five-section L3 prompt block. An empty
 * (length 0) or null tree returns EXACTLY "No preferences set yet." (no
 * trailing newline). Any non-empty tree returns five lines (no blank lines, no
 * trailing newline) in the locked order Core Skills -> Growth Skills -> Avoid
 * Skills -> Deal-Breakers -> Preferred Industries; each line
 * "<Label>: <comma-joined claimText | None specified>". Industries are
 * include-only; skills sections are polarity-agnostic.
 *
 * The empty-vs-populated drift (I7) is intentional and subtle: an EMPTY-leaves
 * tree is the one-liner, while a NON-empty tree with no summarisable leaves is
 * the five-line all-"None specified" block. SL-3 locks the distinction.
 */

const EMPTY = "No preferences set yet.";
const ALL_NONE = [
  "Core Skills: None specified",
  "Growth Skills: None specified",
  "Avoid Skills: None specified",
  "Deal-Breakers: None specified",
  "Preferred Industries: None specified",
].join("\n");

describe("summariseTreeForL3 — empty / null", () => {
  // SL-1 — empty tree returns the exact one-liner, no newline.
  test("returns the exact one-liner with no trailing newline for an empty tree", () => {
    const result = summariseTreeForL3(emptyTree());
    expect(result).toBe(EMPTY);
    expect(result.includes("\n")).toBe(false);
    expect(result.endsWith(".")).toBe(true);
  });

  // SL-2 — null tree returns the same one-liner.
  test("returns the exact one-liner for a null tree", () => {
    expect(summariseTreeForL3(null)).toBe(EMPTY);
  });

  // SL-3 (setup B) — a NON-empty tree of unsummarised leaves returns the
  // five-line all-"None specified" block, NOT the one-liner. The role leaf maps
  // to no section and is skipped, but the empty-string short-circuit does not
  // fire because leaves.length !== 0.
  test("a non-empty tree of unsummarised leaves returns the all-None block", () => {
    const tree: PreferenceTree = {
      schemaVersion: 1,
      leaves: [
        makeLeaf({
          branchSlug: "role",
          branchPath: ["role"],
          claimText: "Staff Engineer",
          polarity: "include",
        }),
      ],
    };
    expect(summariseTreeForL3(tree)).toBe(ALL_NONE);
  });
});

describe("summariseTreeForL3 — populated blocks", () => {
  // SL-4 — fully-populated multi-branch tree in locked order; role dropped,
  // empty sections show None specified.
  test("renders the exact five-line block in locked order for a multi-branch tree", () => {
    const result = summariseTreeForL3(multiBranchTree());
    expect(result).toBe(
      [
        "Core Skills: TypeScript",
        "Growth Skills: None specified",
        "Avoid Skills: None specified",
        "Deal-Breakers: No on-call",
        "Preferred Industries: fintech",
      ].join("\n"),
    );
    // Exactly five lines, no trailing newline.
    expect(result.split("\n").length).toBe(5);
    expect(result.endsWith("\n")).toBe(false);
  });

  // SL-5 — skills sections include claims regardless of polarity (the
  // exclude-polarity avoid skill is STILL listed).
  test("skills sections include claims regardless of polarity", () => {
    const result = summariseTreeForL3(skillsAllPolaritiesTree());
    expect(result).toBe(
      [
        "Core Skills: K",
        "Growth Skills: G",
        "Avoid Skills: A",
        "Deal-Breakers: None specified",
        "Preferred Industries: None specified",
      ].join("\n"),
    );
  });

  // SL-6 — Preferred Industries drops exclude-polarity industry leaves.
  test("Preferred Industries drops exclude-polarity industry leaves", () => {
    const tree: PreferenceTree = {
      schemaVersion: 1,
      leaves: [
        makeLeaf({ id: ID_A, claimText: "fintech", polarity: "include" }),
        makeLeaf({ id: ID_B, claimText: "tobacco", polarity: "exclude" }),
      ],
    };
    const result = summariseTreeForL3(tree);
    expect(result).toBe(
      [
        "Core Skills: None specified",
        "Growth Skills: None specified",
        "Avoid Skills: None specified",
        "Deal-Breakers: None specified",
        "Preferred Industries: fintech",
      ].join("\n"),
    );
  });

  // SL-7 — multiple claims are comma-joined, no trailing comma, in leaf order.
  test("comma-joins multiple claims in a section in leaf order", () => {
    const tree: PreferenceTree = {
      schemaVersion: 1,
      leaves: [
        makeLeaf({
          id: ID_A,
          branchSlug: "skills/keep",
          branchPath: ["skills", "skills/keep"],
          claimText: "TypeScript",
          polarity: "include",
          skillIntent: "keep",
        }),
        makeLeaf({
          id: ID_B,
          branchSlug: "skills/keep",
          branchPath: ["skills", "skills/keep"],
          claimText: "Go",
          polarity: "include",
          skillIntent: "keep",
        }),
        makeLeaf({
          id: ID_C,
          branchSlug: "skills/keep",
          branchPath: ["skills", "skills/keep"],
          claimText: "Rust",
          polarity: "include",
          skillIntent: "keep",
        }),
      ],
    };
    const result = summariseTreeForL3(tree);
    expect(result.split("\n")[0]).toBe("Core Skills: TypeScript, Go, Rust");
  });

  // SL-8 — partial sections keep their fixed positions; gaps are None specified.
  test("partial sections keep their positions with gaps as None specified", () => {
    const result = summariseTreeForL3(partialSectionsTree());
    expect(result).toBe(
      [
        "Core Skills: TS",
        "Growth Skills: None specified",
        "Avoid Skills: None specified",
        "Deal-Breakers: None specified",
        "Preferred Industries: fintech",
      ].join("\n"),
    );
  });
});

describe("summariseTreeForL3 — robustness", () => {
  // SL-9 — comma-containing claimText is emitted verbatim.
  // TODO(I8): section values are NOT comma-escaped, so a claim containing
  // ", " produces an ambiguous line if ever machine-parsed (a splitter on ", "
  // would mis-split "C++, mostly"). Verbatim emission is the stated contract
  // (claims are never paraphrased); flagged for any downstream prompt consumer.
  test("emits comma-containing claimText verbatim (no escaping)", () => {
    const tree: PreferenceTree = {
      schemaVersion: 1,
      leaves: [
        makeLeaf({
          id: ID_A,
          branchSlug: "skills/keep",
          branchPath: ["skills", "skills/keep"],
          claimText: "C++, mostly",
          polarity: "include",
          skillIntent: "keep",
        }),
      ],
    };
    expect(summariseTreeForL3(tree).split("\n")[0]).toBe(
      "Core Skills: C++, mostly",
    );
  });

  // SL-10 — a leaf with a non-canonical slug is skipped (SLUG_TO_SECTION
  // returns undefined -> `if (!section) continue`). Input bypasses LeafSchema
  // deliberately; the summariser does not parse.
  test("skips a leaf whose slug is not canonical", () => {
    const tree = {
      schemaVersion: 1,
      leaves: [
        {
          ...makeLeaf({ claimText: "ghost" }),
          branchSlug: "not-a-real-slug",
          branchPath: ["not-a-real-slug"],
        },
      ],
    } as unknown as PreferenceTree;
    expect(summariseTreeForL3(tree)).toBe(ALL_NONE);
  });
});
