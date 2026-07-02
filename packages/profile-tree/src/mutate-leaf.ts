import type { Leaf, PreferenceTree } from "./leaf-schema";

/** Apply `mutator` to the leaf whose id matches. Returns a new tree
 * with the leaf replaced; throws if leafId not found. Immutable —
 * existing tree is not modified. updatedAt is stamped on the leaf;
 * caller is responsible for persisting the new tree.
 *
 * Idempotency contract: `mutateLeaf` does NOT enforce idempotency. It
 * applies the mutator unconditionally. Callers that need idempotency
 * (composition-change migrations) wrap with a "skip if already at
 * target shape" check. */
export function mutateLeaf(
  tree: PreferenceTree,
  leafId: string,
  mutator: (leaf: Leaf) => Leaf,
): PreferenceTree {
  const idx = tree.leaves.findIndex((l) => l.id === leafId);
  if (idx < 0) throw new Error(`Leaf not found: ${leafId}`);
  const updated = mutator(tree.leaves[idx]);
  const stamped: Leaf = { ...updated, updatedAt: new Date().toISOString() };
  return {
    schemaVersion: tree.schemaVersion,
    leaves: tree.leaves.map((l, i) => (i === idx ? stamped : l)),
  };
}
