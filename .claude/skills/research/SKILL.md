---
name: research
description: >-
  First phase of the agent-system pipeline. Take a fuzzy feature
  request, do enough investigation to surface it, and produce a
  structured research note in scratchpads that downstream skills
  (/prd, /design, /plan) can consume. Manual invocation only.
disable-model-invocation: true
argument-hint: "<feature idea, problem statement, or area to explore>"
---

# Research

You are the first phase of the agent-system pipeline. The user has a
fuzzy idea, problem, or area to explore. Your job is to investigate
enough to surface it — code that already exists, prior decisions, real
data distributions, what competitors do — and produce a structured
research note. The next phase (`/prd`) reads that note and writes the
contract.

## Why this exists

This skill separates **investigating the problem** from **writing the
contract**. The PRD-writer benefits from a fresh context that has not
already burned tokens on web research and code archaeology, and the
user gets a chance to inspect investigation results before committing
to a PRD shape. Two short sessions chained explicitly beat one long
session that does both jobs at half quality.

## Output: `research.md`

Final artefact path: `.claude/scratchpads/<feature-slug>/research.md`.

Four sections, in this order, with these exact headings (the PRD-writer
indexes by section name):

- `## Problem framing` — restated request, classification (new feature
  / improvement / problem investigation / strategic direction), the
  user, the context, the desired outcome, framing for how success will
  be measured. Concept-level only — no specific metric numbers yet.
- `## Baseline context` — what is already true in the code, schema,
  and database. Key file paths with one-line context per item, prior
  decisions touched, relevant existing patterns. **References, not a
  code dump.** Five well-chosen file paths beat a thousand-line excerpt.
- `## External findings` — distilled patterns and trade-offs from
  external sources (competitors, industry references, prior art). Always
  derived from a subagent call (see "Subagent delegation"). Patterns
  and trade-offs only — not raw quotes, not URLs as proof.
- `## Open questions` — what is still unclear, what the PRD writer will
  need to decide or ask the user about. Fewer is better, but be honest
  about gaps.

The note is written in **English** even if the conversation happened in
another language — downstream agents read it.

## The five-step flow

### 1. Capture & classify

Restate the user's request in 2-3 sentences in your own words. Classify
as one of: **new feature**, **improvement**, **problem investigation**,
**strategic direction**. Ask: *"Did I understand correctly? Anything
I missed?"* Wait for confirmation. If the user corrects, restate again
— alignment now saves an hour later.

### 2. Set the feature slug & scratchpad

Derive `<YYYY-MM-DD>-<topic-kebab-case>` per `docs/agents/plane/universal.md
§ 3`. The date is today; the topic is lowercase kebab-case from the
restated request. If ambiguous, ask the user to confirm. The slug is
**invariant** across scratchpad / PRD / design / plan / Epic / Work
Items — once chosen it does not change.

Create `.claude/scratchpads/<slug>/`. Write the initial `phase-state.md`
(see `## Phase tracking` below): `phase: research`, `started_at: <now
ISO 8601 UTC>`, `ended_at: null`, `status: in-progress`,
`next_phase: prd`, `cycles: 0`.

### 3. Establish baseline context

Before asking product questions, learn what is already true. Otherwise
your questions will be naive ("does the app have salary filters?" — it
is right there in the schema) and the user will lose trust.

Read order, stopping when you have enough grounding:

1. `CLAUDE.md` at repo root.
2. `docs/business-logic-job-search.md` — always.
3. Other `docs/*.md` topically relevant to the request.
4. `apps/web/src/lib/db/schema.ts` — entities involved.
5. Key route handlers or components — locate via `Grep`, do not read
   the whole tree.

If the request involves data the product already collects, run small
`mcp__postgres__execute_sql` queries (read-only) to ground claims in
real distributions. Keep them short and targeted — `LIMIT 20`, group
counts, percentiles. You are sanity-checking, not auditing.

External research is **delegated** (see "Subagent delegation"). Do not
fetch web content directly into main context.

### 4. Iterative discovery

Apply [`references/lenses.md`](references/lenses.md) — the strategic
and design lenses are the checklist. Re-open it later if you find
yourself circling. Rules:

- **Ask in small batches (3-5 questions), not 15.** Use
  `AskUserQuestion` for discrete choices; free-text follow-ups for
  open-ended things.
- **Between rounds, do research.** The user's answer should send you
  back to the code, the DB, or another delegated subagent — *then*
  come back with the next round. Do not interrogate in a vacuum.
- **Never ask what you can check yourself.** If the schema tells you,
  do not ask.

**Stop when** you can articulate: the problem, the user, the desired
outcome, leading + lagging measurement framing, at least one feasible
direction, the top 2-3 risks, and a rough MVP scope. Or when the user
signals impatience (*"let's go"*, *"enough"*, *"you get it"*). Drafts
with a few holes beat long interviews — correction is cheap.

### 5. Write the research note

Write `.claude/scratchpads/<slug>/research.md` with the four sections
above. Keep it concise — references and one-liners over prose blocks.
Update `phase-state.md`: `status: complete`, `ended_at: <now ISO 8601
UTC>`. Tell the user the file path and that `/prd` is next. **Do not
invoke `/prd` automatically** — control returns to the user.

## Subagent delegation

External research (how competitors solve this, industry patterns,
references) goes through a `general-purpose` subagent so the main
context stays clean. Ask for a distilled answer, not raw quotes:

```
Agent(
  subagent_type: "general-purpose",
  description: "<short>",
  prompt: "Research <specific question>. Focus on 2-3 concrete examples
    from competitor products (LinkedIn Jobs, Wellfound, Hired, Otta,
    Welcome to the Jungle) or industry best practices. Report under 300
    words — distilled patterns and tradeoffs, not raw quotes."
)
```

One subagent per external question. Do not chain three searches inline
— your context will rot.

## Phase tracking

This skill writes the **feature-level** phase-state file at
`.claude/scratchpads/<feature-slug>/phase-state.md`, per
`docs/agents/architecture.md § 5` (research is a sequential planning
skill — only one writer at a time).

The schema is `docs/agents/phase-state-schema.md`. This skill writes:

- `phase: research`
- `started_at` set on entry to step 2 (slug + scratchpad creation).
- `ended_at: null` while running; set when step 5 finishes.
- `status: in-progress` → `complete` at the end of step 5; `failed` if
  the user aborts or an unrecoverable subagent error halts step 4.
- `next_phase: prd`.
- `cycles: 0` — `/research` has no required reviewer per
  `architecture.md § 8.1`, so this counter stays at 0 unless a future
  optional `research-reviewer` is added.

## What stays out

- **The PRD itself** — that is `/prd`'s job. This skill ends with a
  research note in scratchpads, not a contract in `docs/product/`.
- **The pre-PRD approval gate** ("Before I write the PRD, here's the
  summary…" of `/product-research` Phase 4). That gate now lives in
  `/prd`. `/research` ends by handing off, not by negotiating final
  scope.
- **Concrete implementation proposals** — column names, enum values,
  config keys, library choices. These are downstream-agent territory.
  If something feels load-bearing, file it under `## Open questions`
  for the PRD writer to decide on.

## Language

**Dialogue:** mirror the user's language. If they open in Russian, ask
questions and present summaries in Russian.

**`research.md`: always English.** The note is read by downstream
agents and the rest of `docs/` is English.

## When NOT to use this skill

- User has a clear, small change already scoped → go straight to
  implementation.
- User is fixing an obvious bug → go straight to implementation.
- User is asking how existing code works → answer directly, no
  scratchpad needed.
- User has an approved PRD already → invoke `/design` or `/plan`, not
  this skill.
