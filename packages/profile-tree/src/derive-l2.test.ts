import { describe, expect, test } from "vitest";
import { deriveL2Inputs } from "./derive-l2";
import type { PreferenceTree } from "./leaf-schema";
import {
  allExcludeIndustryTree,
  emptyTree,
  ID_A,
  ID_B,
  industryWithCanonicalTree,
  makeLeaf,
  mixedIndustryTree,
  multiBranchTree,
  singleLeafTree,
} from "./__fixtures__";

/**
 * `deriveL2Inputs` collects `claimText` + `canonical` tokens of
 * include-polarity leaves under branches whose `l2Derivation ===
 * "industry-tokens"` (only `industry`). null/empty tree -> { industries: [] };
 * exclude-polarity dropped; non-industry branches ignored; unknown slugs
 * skipped (the def lookup returns undefined). Order follows leaf array order;
 * no deduplication (that is the SQL overlap layer's job).
 */

describe("deriveL2Inputs", () => {
  // DL-1
  test("returns { industries: [] } for a null tree", () => {
    expect(deriveL2Inputs(null)).toEqual({ industries: [] });
  });

  // DL-2
  test("returns { industries: [] } for an empty-leaves tree", () => {
    expect(deriveL2Inputs(emptyTree())).toEqual({ industries: [] });
  });

  // DL-3
  test("returns the claimText of a single include industry leaf", () => {
    expect(deriveL2Inputs(singleLeafTree())).toEqual({
      industries: ["fintech"],
    });
  });

  // DL-4 — include claims only, in leaf-array order; exclude dropped.
  test("includes only include-polarity industry claims, in order", () => {
    expect(deriveL2Inputs(mixedIndustryTree())).toEqual({
      industries: ["fintech", "healthtech"],
    });
  });

  // DL-5 — canonical tokens appended after claimText, in order.
  test("appends canonical tokens after the claimText, in order", () => {
    expect(deriveL2Inputs(industryWithCanonicalTree())).toEqual({
      industries: ["fintech", "financial services", "banking"],
    });
  });

  // DL-6 — all-exclude industry tree contributes nothing.
  test("returns { industries: [] } when every industry leaf is exclude", () => {
    expect(deriveL2Inputs(allExcludeIndustryTree())).toEqual({
      industries: [],
    });
  });

  // DL-7 — only the industry leaf contributes; role/skills/deal-breakers are
  // gated out by l2Derivation !== "industry-tokens".
  test("ignores non-industry branches in a multi-branch tree", () => {
    expect(deriveL2Inputs(multiBranchTree())).toEqual({
      industries: ["fintech"],
    });
  });

  // DL-8 — a leaf with an unknown slug is skipped, not crashed (def lookup is
  // undefined, optional chaining guards it). The input bypasses LeafSchema
  // deliberately; deriveL2Inputs operates on a typed PreferenceTree and does
  // not parse, so we cast a structurally-shaped tree locally.
  test("skips a leaf whose slug is not canonical without throwing", () => {
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
    expect(deriveL2Inputs(tree)).toEqual({ industries: [] });
  });

  // DL-9 — empty canonical array contributes only the claimText.
  test("an empty canonical array contributes only the claimText", () => {
    const tree: PreferenceTree = {
      schemaVersion: 1,
      leaves: [makeLeaf({ claimText: "fintech", canonical: [] })],
    };
    expect(deriveL2Inputs(tree)).toEqual({ industries: ["fintech"] });
  });

  // DL-10 — duplicates are NOT deduplicated.
  // TODO: dedup is the caller's job (the SQL overlap layer), not
  // deriveL2Inputs. If a future consumer assumes uniqueness, dedup must happen
  // downstream or here explicitly.
  test("does not deduplicate repeated claim values", () => {
    const tree: PreferenceTree = {
      schemaVersion: 1,
      leaves: [
        makeLeaf({ id: ID_A, claimText: "fintech" }),
        makeLeaf({ id: ID_B, claimText: "fintech" }),
      ],
    };
    expect(deriveL2Inputs(tree)).toEqual({
      industries: ["fintech", "fintech"],
    });
  });
});
