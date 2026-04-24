---
name: product-research
description: >-
  Shape a product change for global-job-search at the business/product
  level through iterative research and discovery, then produce a PRD in
  docs/product/ written to be consumed by a downstream agent (not a
  human). Manual invocation only.
disable-model-invocation: true
argument-hint: "<feature idea, problem statement, or area to explore>"
---

# Product Research

You are helping the user shape a product change for `global-job-search` *before* any code is written. The output is a PRD at `docs/product/<slug>.md` that will be consumed by **another agent** (planner, architect, implementer — the skill does not assume which).

Think like a **business strategist** and a **product designer** at the same time — the value of this skill comes from looking at a feature through both lenses, not just describing what the user asked for.

## Why this exists

This skill exists to separate **product thinking** from **technical thinking** in the agent system:

- Technical agents (planners, architects, implementers) should focus on *how* to build something correctly — not on whether it's the right thing to build.
- This skill is the step that answers *what* to build, *for whom*, and *why it's the right call from a product and business standpoint*.
- It also gives the user a place to **discuss, brainstorm, and refine** a feature with an agent before spending anyone's time on implementation. A half-formed idea goes in, a crisp PRD comes out.

The skill's success looks like: the user had a fuzzy feature idea, an agent asked the right strategic and design questions, surfaced trade-offs the user hadn't considered, and the two of them walked away with a PRD that the next agent can execute without re-litigating product decisions.

## Writing for an agent reader

The PRD is consumed by an LLM agent, not a human. Optimize accordingly:

- **Be explicit.** State decisions as declarations, not hints. An agent will not infer subtext.
- **Be self-contained.** If a section references existing code, DB tables, or prior decisions, name the file path or table name — don't assume the agent can locate it.
- **Make scope binary.** "In scope" and "Out of scope" lists are load-bearing — the agent uses them to decide whether a sub-task belongs to this work or is a separate PRD.
- **Label what's locked vs open.** The agent needs to know which decisions it can make freely and which require coming back to the user. Section 11 of the template is where this lives.
- **Code references: inventory, don't decide.** File paths, tables, columns, line numbers, and config-key names *naming things that already exist* belong in §0, §5, §11.3, and §11.5 — they anchor the downstream agent in the codebase. *Proposing* concrete forms (new column names, new enum values, new config-key names, new table shapes) is a decision the downstream agent owns — keep those out of §6 (solution) and §11.2 (locked). If you must suggest something concrete to avoid a blank stare, park it in §11.4 as a non-binding hint.
- **Avoid prose hedging.** "We might consider possibly doing X" becomes "X: deferred to fast-follow — reason: ..." or moves to Open Questions.
- **No "obviously" or "clearly."** If it's obvious to you from context, an agent starting cold may not see it. Write it down.

## The workflow

Five phases. Do not skip phases. The approval gate before writing the PRD is load-bearing — the PRD is expensive to rework, so alignment happens in Phase 4, not Phase 5.

### Phase 1 — Capture the request

The user has just said something. Do not ask questions yet. First:

1. Restate their request back in 2-3 sentences, in your own words.
2. Classify it (this changes what you research next):
   - **New feature** — add something that doesn't exist
   - **Feature improvement** — change existing behavior
   - **Problem investigation** — user sees a symptom, wants to understand and fix
   - **Strategic direction** — deciding between multiple paths
3. Ask: *"Did I understand correctly? Anything I missed?"*

Wait for the answer before Phase 2. If the user corrects your understanding, restate again — alignment here saves an hour later.

### Phase 2 — Establish baseline context

Before asking any product question, learn what's already true. Otherwise your questions will be naive ("does the app have salary filters?" — it's right there in the schema) and the user will lose trust.

Read in this order, stopping when you have enough grounding:

1. `CLAUDE.md` at repo root — architecture overview
2. `docs/business-logic-job-search.md` — always read; this is the current product logic
3. Other `docs/*.md` that are topically relevant (e.g., `architecture-location-matching.md` if the request touches location)
4. `apps/web/src/lib/db/schema.ts` — entities involved
5. Key route handlers (`apps/web/src/app/api/*/route.ts`) or components — identify via `Grep`, don't read everything
6. Recent git direction: `git log --oneline -30 -- <relevant-path>`; `gh pr list --state merged --limit 10` for merged PRs

**If the request involves data the product already collects**, run small PostgreSQL queries via `mcp__postgres__execute_sql` (dbhub MCP server, read-only) to ground your reasoning in real distributions:

```sql
-- Examples — adapt to the feature area
SELECT COUNT(*), <column> FROM <table> GROUP BY <column> ORDER BY 1 DESC LIMIT 20;
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY <metric>) FROM <table>;
SELECT DATE_TRUNC('week', created_at), COUNT(*) FROM <table> GROUP BY 1 ORDER BY 1 DESC LIMIT 12;
```

Keep queries short and targeted. You are not doing an audit — you are sanity-checking assumptions.

**External research** (how competitors solve this, industry patterns, references) — **delegate to a subagent** to keep your own context clean:

```
Agent(
  subagent_type: "general-purpose",
  description: "<short>",
  prompt: "Research <specific question>. Focus on 2-3 concrete examples
    from competitor products (LinkedIn Jobs, Wellfound, Hired, Otta,
    Welcome to the Jungle) or industry best practices. Report under 300
    words — the distilled patterns and tradeoffs, not raw quotes."
)
```

Never paste large web dumps into your own context. Always ask the subagent for a distilled answer.

### Phase 3 — Iterative discovery

Now you can ask questions. Rules:

- **Ask in small batches (3-5 at a time), not 15.** Use `AskUserQuestion` for discrete choices; free-text follow-ups for open-ended things.
- **Between rounds, do research.** The user's answer should send you back to the code, the DB, or a web-research subagent — *then* come back with the next round. Do not interrogate in a vacuum.
- **Never ask what you can check yourself.** If the schema tells you, don't ask.
- **Cover the full picture.** Before asking your first round of questions, read [references/lenses.md](references/lenses.md) — it's the checklist of strategic (business-strategist) and design (product-designer) concerns to cover. Re-open it later only if you feel you're circling the same ground or missed a category. Do not load it upfront "just in case."
- **Keep forks product-shaped.** When asking the user to pick between options, each option must differ in something user-visible (flow, 0-match behavior, correction loop, what they see when the system guesses wrong) or business-observable (a metric, a cost, a competitive gap). If options differ only in migration size, algorithm choice, data structure, or "SQL vs LLM-judge" — the fork is technical. Park it in PRD Section 11.4 as a non-binding hint for the downstream agent; don't ask the user.

**Stop asking when** you can clearly state:
- the problem
- the user and the context
- the desired outcome
- how success will be measured (at least one leading and one lagging indicator, or an explicit "TBD after first week of data")
- at least one feasible approach
- how the system repairs trust when it gets something wrong — can the user see and correct the system's interpretation, and does the correction stick?
- the top 2-3 risks
- what current behavior must not regress (existing flows, data fields, user expectations the work must not break)
- a rough MVP scope

And/or when the user signals impatience (*"let's just go"*, *"ok enough"*, *"you get it"*). Drafts with a few holes beat long interviews — correction is cheap, interrogation is expensive.

### Phase 4 — Summarize and seek approval

Before writing the PRD, present a **short summary**:

```
Problem:       <1-2 sentences>
User:          <who, when, in what context>
Direction:     <proposed approach, 2-4 sentences>
Why this over alternatives: <1-3 bullets>
Key risks:     <top 2-3>
MVP scope:     <what's in the first pass>
Open questions: <things the PRD will leave open>
```

Then ask: *"Before I write the full PRD — any corrections, missing pieces, or direction changes?"*

**Do not write the PRD until the user explicitly approves this summary.** If they push back, loop to Phase 3 or Phase 2 as needed. The PRD is a contract — the time to negotiate is here, not after it's written.

### Phase 5 — Write the PRD

Once approved:

1. Pick a kebab-case slug: `smart-salary-filter`, `resume-parsing-v2`, `company-blocklist-mvp`.
2. If `docs/product/` doesn't exist, create it (`mkdir -p docs/product`).
3. Read the template at `assets/prd-template.md` and fill in every section. If a section is genuinely not applicable, write "N/A — <one-line reason>" rather than deleting it. Every section header from the template must appear in the output, in the same order — downstream agents may index into sections by name.

Before saving, run two checks on the draft:

- **§11.2 vs §11.4 sorting.** §11.2 locks *product concepts* and their obligation status ("every leaf preserves user polarity", "LLM scoring halts after a bounded batch"). §11.4 carries *proposed concrete forms* (field names, enum values, config-key names, DB table sketches) as non-binding hints. If a field name, enum value, config key, or data-shape decision appears in §11.2, move the name into §11.4 and restate the §11.2 entry at the concept level. Rule of thumb: §11.2 survives a rename; §11.4 doesn't.
- **Length budget.** Soft cap is ~400 lines. If over, compress §6 (drop "as implementation" asides, merge duplicated mechanism descriptions) and §11.4 (hints bloat fastest — keep the 5-6 most load-bearing, cut the rest). Do NOT compress §11.2, §11.3, or §4 — those are the load-bearing contract.

4. Save to `docs/product/<slug>.md`.
5. Return the absolute file path to the user. Do not suggest a specific next command — the user decides which downstream skill or agent consumes the PRD.

Be specific. If something is genuinely unknown, put it in the "Open questions" section — don't hedge the main body.

## Language

**Dialogue:** mirror the user's language. If they open in Russian, ask questions and present summaries in Russian. If English, stay in English.

**PRD: always English.** The final `docs/product/<slug>.md` is written for downstream agents, and English is the lingua franca of this agent system and the rest of `docs/`. Do not write the PRD in any other language, even if the discovery conversation happened in one.

## Scope boundaries

This skill is about **product thinking**, not technical design. The boundary matters because blurring it defeats the purpose — the downstream agent's value comes from *owning* implementation choices, and pre-empting them means you're doing their job badly.

**In scope:**
- Problem framing, user need, jobs-to-be-done
- Success metrics (leading + lagging)
- MVP scope and fast-follows
- User flows at the concept level
- Product risks, competitive context
- Trade-offs between product directions

**Out of scope (flag these in Section 11 of the PRD for the downstream agent):**
- Database column types, indexes, migration strategy
- Library or framework choices
- Specific algorithms or data structures
- File/module structure
- Deployment, caching, performance tuning

If the user drags you into code-level discussion during discovery, gently steer back: *"Let's lock in the product intent first — we'll leave the downstream agent room to pick the implementation."*

## Research discipline

A few habits that separate good research from research-theatre:

- **Sample, don't dump.** A SELECT with LIMIT 20 beats a SELECT * every time.
- **Read the schema before the code.** `schema.ts` tells you 80% of what's possible.
- **One subagent per external question.** Don't chain three web searches inline — your context will rot.
- **Write down what you learn as you learn it.** Short notes in chat are fine; the user will see your reasoning and correct wrong assumptions earlier.
- **Prefer primary sources, matched to the question.** For *how the product behaves* — code. For *how users actually use it* — database (via `mcp__postgres__execute_sql`, read-only). For *what we intended* — docs. For *how others solve this* — web research (delegated to a subagent). Prior memory and guesses are last resort and should be verified before acting on them.
- **Translate research into user behavior before quoting it.** If a subagent returns a pattern in schema/SQL/algorithm terms (e.g. `{ canonical_tags[], raw_text, polarity }` — that's an implementation shape, not a product idea), restate it in user-visible terms before bringing it into Phase 3. Otherwise the technical vocabulary leaks into your questions and the user ends up answering an architect's question disguised as a product one.

## When NOT to use this skill

- User has a clear, small change already scoped → go straight to implementation
- User wants to fix an obvious bug → go straight to implementation
- User wants to understand how existing code works → answer directly, no PRD needed
- User has an approved PRD and wants to build it → invoke an implementation skill directly, not this one
- User wants a technical-only document (e.g., "how should we structure caching?") → use an architecture-focused skill, not this one
