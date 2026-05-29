import { describe, expect, test } from "vitest";
import * as api from "./index";

/**
 * IX-1 — the public surface is fully re-exported. Guards against an
 * accidental dropped export breaking downstream consumers. Type-only exports
 * cannot be runtime-checked, so this covers runtime values only.
 */
describe("index barrel", () => {
  test.each([
    "CANONICAL_BRANCHES",
    "SKILLS_SUB_BRANCHES",
    "COMPANY_ATTRIBUTE_SUB_BRANCHES",
    "ALL_CANONICAL_BRANCHES",
    "LeafSchema",
    "PreferenceTreeSchema",
    "SkillIntentSchema",
    "PolaritySchema",
    "LeafProvenanceSchema",
    "mutateLeaf",
    "moveLeaves",
    "deriveL2Inputs",
    "summariseTreeForL3",
    "migrateLeaves",
  ])("re-exports %s as a defined value", (name) => {
    expect(api[name as keyof typeof api]).toBeDefined();
  });
});
