# ADR-0005 — Run the profile conversation as a single LLM call per turn with structured output

## Status

Proposed

## Context

The umbrella PRD (`docs/product/2026-05-06-profile-driven-architecture.md`)
locks (§11.2): collection is conversational and adaptive (no 16-step
wizard), ambiguous input triggers agent-initiated clarification with
a best-guess interpretation before commit, non-canonical claims land
in `Other` with explicit acknowledgement (no auto-creation of
canonical branches), the UI toggle between Chat and Profile is a UI
control (never a chat command). The PRD assigns prompt architecture,
LLM model choice, and structured-output-vs-tool-calls to the architect
(§11.1).

The current 16-step engine (`apps/web/src/lib/chatbot/engine.ts`,
`steps.ts`, `schemas.ts`, `state.ts`) is replaced wholesale; nothing
in its driver remains. The conversation runtime must:

- Decompose a compound user statement into one or more claims.
- For each unambiguous claim: emit a tree mutation with verbatim
  phrasing and direction.
- For at most one ambiguous claim per turn: emit a clarification
  question with the agent's best-guess interpretation; do not commit
  until the user resolves it (or the budget exhausts).
- Optionally nudge a neglected branch.
- Place claims that fit no canonical branch in `Other` with an
  explicit acknowledgement.

Three runtime shapes were considered:

- **A. Single LLM call per turn with structured output.** One prompt
  → one structured response containing `replyText`, `claimsToCommit`,
  optional `ambiguousClaim`, optional `branchNudge`, optional
  `acknowledgment`. Engine applies tree mutations in TypeScript.
- **B. Tool-use with explicit functions** (`commit_claim`,
  `ask_clarification`, `place_in_other`, `nudge_branch`). Each tool
  call is a discrete commit; runtime arbitrates with a tool loop.
- **C. Multi-step pipeline** — distinct LLM calls for decompose →
  classify → validate → commit.

Forces:

- BYOK economics: every conversation turn is user-funded. Single-call
  is cheapest.
- The L3 worker already uses `generateText` + `Output.object` from
  the Vercel AI SDK with a Zod schema (`ScoringOutputSchema`,
  `apps/worker/src/lib/scoring-schema.ts`). That pattern is proven
  in this codebase.
- A single structured response is naturally streamable (SSE) for
  perceived responsiveness.
- Tree mutations belong in TypeScript so the structural invariants
  (verbatim phrasing, branch validation against `preference_branch`,
  `leafId` assignment) are typed and testable; offloading mutations
  to LLM tool calls couples them to model judgement.
- The conversation does not need to invoke real external tools —
  there is no DB-write that the LLM should perform autonomously
  before the engine has applied invariants.

## Decision

We will run each user turn as a single Anthropic call via
`generateText` + `Output.object` with a Zod-validated structured
response. The runtime parses the response, applies tree mutations in
TypeScript, and persists. The contract:

```ts
const NewClaimSchema = z.object({
  branchSlug: z.string(),
  branchPath: z.array(z.string()),
  claim: z.string(),                           // verbatim from user
  direction: z.enum(['include', 'exclude']),
  canonical: z.array(z.string()).optional(),
  note: z.string().optional(),
  skillIntent: z.enum(['keep', 'grow', 'avoid']).optional(),
  confidence: z.number().optional(),
});

const TurnOutputSchema = z.object({
  replyText: z.string(),
  claimsToCommit: z.array(NewClaimSchema),
  ambiguousClaim: z.object({
    bestGuessBranch: z.string(),
    bestGuessDirection: z.enum(['include', 'exclude']),
    bestGuessClaimText: z.string(),
    clarificationQuestion: z.string(),
  }).nullable(),
  branchNudge: z.string().nullable(),
  acknowledgment: z.string().nullable(),
});
```

The runtime layer (`apps/web/src/lib/profile-conversation/`) is
responsible for:

- Loading the current `preferenceTree` and the active branch
  registry.
- Building the prompt (system: agent's role, branch taxonomy, copy
  guidance, forbidden labels per PRD §11.4; user: prior turns from
  `conversation_message`, current user message, current tree
  summary).
- Calling Anthropic with the schema.
- Validating each `claimsToCommit` entry: `branchSlug` resolves to
  an active row in `preference_branch`; verbatim phrasing matches
  the user's turn (or is verifiably substring-derived from it);
  `skillIntent` is set iff `branchSlug` is a Skills branch.
- Assigning `leafId` UUIDs and appending to the tree.
- If `ambiguousClaim` is non-null, store it on `conversation_state`
  as `pendingAmbiguousClaim` and increment
  `clarificationsForCurrentClaim`. On budget exhaust → commit the
  best-guess with `flaggedUncertain: true` and surface
  `acknowledgment` accordingly.
- Persisting the assistant turn to `conversation_message` (with the
  raw structured output on `metadata` for debugging).

`conversation_state.state` reshapes from the legacy step-driven
shape to:

```ts
ConversationStateV2 = {
  schemaVersion: 2,
  clarificationsForCurrentClaim: number,
  pendingAmbiguousClaim?: { bestGuess, question, asked: number },
  visitedBranches: string[],
}
```

No `currentStepIndex`, no `draft` — tree mutations apply directly.

Default Anthropic model: Claude Haiku 4.5 (parity with the L3
worker; lowest BYOK cost). Sub-feature plan may opt for Sonnet for
this runtime if test cycles reveal decomposition errors.
Clarification budget default: 2 (per PRD §11.4 starting reference),
tunable via `app_config.chatbot.clarification_budget`.

Tool-use is rejected for this runtime — there is no external tool
the LLM should invoke autonomously; tree mutations must pass through
TS validators with typed invariants. Multi-step is rejected on cost
and on consolidated-output research findings: a single high-quality
prompt with reasoning beats two cheap prompts.

## Consequences

- **Positive — one LLM call per user turn.** Predictable BYOK cost;
  fastest perceived responsiveness; matches the L3 worker pattern
  the codebase already operates.
- **Positive — typed tree mutations.** Every leaf creation passes
  through TS validators (branch active, verbatim phrasing,
  skillIntent gating, leafId assignment) before reaching the JSONB.
- **Positive — streaming friendly.** `generateText` supports
  streaming partial output for SSE-driven progressive UI rendering.
- **Positive — auditable via existing `conversation_message`.**
  Every turn (user and assistant) is persisted verbatim with the
  raw structured output on `metadata` for debugging.
- **Positive — clarification budget enforced server-side.** No
  prompt-jailbreak path lets the LLM hide ambiguity past the budget.
- **Negative — single response shape carries multiple concerns.**
  `claimsToCommit` plus `ambiguousClaim` plus `branchNudge` plus
  `acknowledgment` makes the schema slightly broader; sub-feature
  prompt design must steer the model away from over-emitting (e.g.,
  trying to commit and ask clarification on the same turn).
  Mitigated by examples in the system prompt and a server-side
  rule: if `ambiguousClaim` is non-null, `claimsToCommit` may still
  contain other (unambiguous) claims; only the ambiguous one is
  pending.
- **Negative — no autonomous tool use.** A future need (e.g., agent
  pulling current search results to ground a nudge) would require
  either widening the prompt context or migrating to tool-use. The
  TurnOutputSchema is shaped to be tool-use-portable: each top-level
  field maps cleanly to a tool name.
- **Negative — Anthropic structured-output limitations** (no
  min/max/int constraints on numbers) carry over from the L3
  pattern. Server-side clamping handles `confidence` and any future
  numeric fields, same pattern as `scoreR..D`.
- **Neutral — model choice deferred.** Haiku 4.5 default keeps cost
  parity with L3; sub-feature owns calibration.
- **Follow-on work.** Sub-feature plans must (1) write the prompt,
  copy templates, and the system-prompt forbidden-labels guard,
  (2) implement the runtime layer and tree-mutation validators,
  (3) reshape `conversation_state.state` (data wipe at ship makes
  this safe — no migration), (4) keep `conversation_message`
  schema unchanged but add the `metadata.rawTurnOutput` convention,
  (5) add the optimistic-concurrency guard against double-tab
  commits via `user_profile.updatedAt`.
