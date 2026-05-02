# <Feature title> — Implementation plan

Status: **Draft v1** | Date: YYYY-MM-DD | Owner: <user>
PRD: `docs/product/<slug>.md` | Design: `docs/designs/<slug>.md` (if present)

> **Reader:** this plan is written for downstream agents (`/tasks`,
> `/implement-task`) — not a human reviewer. The DAG of chunks in §5
> is **machine-parseable**: each chunk has a YAML metadata block with
> `id`, `depends_on`, and `labels`. `/tasks` greps these to create
> Plane Epic + Work Items + `blocked_by` relations. Sections are
> fixed in name and order; index by section number when needed.
> Decisions are declarative. "N/A — <reason>" is a valid section
> body; empty is not. Each chunk is one logical change → one Work
> Item → one PR.

---

## 0. Context

<Why this plan exists. One paragraph: the user-facing problem from
PRD §1, the chosen approach from PRD §6, and (if a design exists)
the technical contract from `docs/designs/<slug>.md`. Cite PRD and
design section numbers — do not paraphrase. The plan does not
re-litigate PRD or design decisions; it sequences them.>

- **PRD:** `docs/product/<slug>.md` (key sections: §3 goals/non-goals,
  §6 proposed solution, §11.2 locked decisions, §11.3 invariants).
- **Design:** `docs/designs/<slug>.md` — reference the format used
  (Feature Plan / Architectural Decision / Refactoring) and the
  sections that this plan grounds itself in. If no design exists,
  write `N/A — design phase skipped (PRD §0 inventory: 1-2 files,
  no architectural decisions, no new data models, no new API
  contracts)`.
- **ADRs:** list only the ADRs cited by the design (`docs/adr/<NNNN>-
  <topic>.md`) — these are read in full by `/implement-task`.

---

## 1. Goals

<Mapped 1:1 to PRD §3.1. Each PRD goal lists which chunk(s) deliver
it. Coverage is enforced by the reviewer: every PRD goal must map to
≥1 chunk's acceptance criteria.>

- **G1 — <restated PRD goal>** → delivered by chunks `<id>`, `<id>`.
- **G2 — <restated PRD goal>** → delivered by chunk `<id>`.

---

## 2. Non-goals

<Restated from PRD §3.2 + plan-specific exclusions. Plan-specific
exclusions cover work that fits the topic but is deferred — for
example, "telemetry for this feature lands in a follow-up plan; this
plan only adds the feature itself".>

- **NG1 — <restated PRD non-goal>**.
- **NG2 — <plan-specific exclusion>** — reason: ...

---

## 3. Constraints

<Hard constraints the plan and downstream agents must respect. Three
kinds: (a) PRD §11.2 locked product decisions, carried forward
verbatim; (b) technical realities surfaced by the design or by the
existing codebase; (c) deadlines and external dependencies, if any.
Constraints are NOT goals — a constraint shapes how the work is done,
a goal is what the work delivers.>

- **C1 — <locked decision from PRD §11.2>**: <one-line restatement>.
  Source: PRD §11.2.
- **C2 — <technical reality>**: <one-line restatement>. Source:
  design §<N> / existing code at `<path>`.
- **C3 — <deadline or external dep>**: <one-line restatement>.

---

## 4. Dependency DAG

<Visual prose describing chunk ordering. Call out: (a) the critical
path (longest chain from start to finish); (b) parallelisation
opportunities (chunks with no shared deps and no file overlap that
can run concurrently); (c) diamonds (where two parallel branches
re-converge); (d) isolated leaves (chunks that block nothing
downstream and can be deferred). The machine-readable DAG lives in
§5 metadata blocks — this section is for human reading and for
`/tasks`/`/implement-task` scheduling hints.>

**Critical path:** `<id>` → `<id>` → `<id>`.

**Parallelisable after `<id>`:** `<id>`, `<id>` — no shared files,
no shared deps.

**Diamonds:** `<id-A>` and `<id-B>` both unblock `<id-C>`.

**Isolated leaves:** `<id>` — blocks nothing; safe to defer.

ASCII diagram (optional, helpful for plans with >5 chunks):

```
            ┌─ step-2 ─┐
step-1 ──┬──┤          ├── step-5
         └──┴─ step-3 ─┘
             step-4 (isolated)
```

---

## 5. Chunks

<Each chunk is a `### Chunk <id> — <imperative title>` heading
immediately followed by the YAML metadata fenced block, then the
prose subsections **Goal**, **Files**, **Acceptance criteria**,
**Test strategy**, **Effort**, **Risks**. Optional **Hints** if the
design or PRD §11.4 surfaced concrete technical levers.>

<The YAML block schema:

```yaml
id: <kebab-case-id>           # required, unique within plan, stable across reruns
depends_on: [<id>, <id>, ...] # required; empty list `[]` for root chunks
labels:                       # required; at least feature:<feature> + type:<type>
  - feature:<feature>
  - type:<chore|feat|fix|refactor|docs|test>
```

The `id` is kebab-case and stable across plan reruns — `/tasks` uses
it as the Plane Work Item `external_id`. The `depends_on` list is
the DAG: every id must resolve to another chunk's `id` in this plan.
`labels` always contain at least `feature:<feature-slug>` and
`type:<conventional-commit-type>`. Add `priority:<level>` or
`risk:<level>` if useful.>

### Chunk <id-1> — <imperative title>

```yaml
id: <id-1>
depends_on: []
labels:
  - feature:<feature-slug>
  - type:<chore|feat|fix|refactor|docs|test>
```

**Goal.** <One sentence: what this chunk delivers and why. Anchor in
a PRD goal (G<N>) or constraint (C<N>) where possible.>

**Files.** <Concrete file paths the chunk creates or modifies. Use
absolute repo-relative paths, not glob patterns. If two chunks list
the same file, the later chunk MUST declare the earlier in
`depends_on` — the reviewer flags this as Critical otherwise.>

- `apps/web/src/<path>` — <create | modify | delete>
- `packages/ats-core/src/<path>` — <create | modify | delete>

**Acceptance criteria.** <Binary, observable checks. Each item is a
checkbox `/implement-task`'s reviewer can verify. Avoid "well-tested"
or "documented" — restate as a concrete artefact or command exit
code. The reviewer flags vague criteria as Critical.>

- [ ] `<command>` exits 0 and produces `<file>`.
- [ ] `<file>` contains `<expected substring>`.
- [ ] `pnpm typecheck` exits 0 with the change applied.

**Test strategy.** <How this chunk is verified beyond acceptance
criteria. Be specific — "manual smoke" is fine for configs;
"integration test" without a path is a Warning. Cite which suite
runs (`pnpm test`, `pnpm test packages/ats-core`, `vitest run
<path>`) and what passes/fails first.>

**Effort.** <Rough range: e.g. `30-45 min`, `2-3 h`, `4-6 h`. Wildly
divergent estimates within one plan are a Warning — usually means
one chunk is mis-scoped and should be split.>

**Risks.** <Chunk-local risks with a one-line mitigation each.
Cross-cutting risks go to §6, not here.>

- <risk> — mitigation: <one line>.

**Hints (optional).** <Non-binding technical levers surfaced by the
design or by PRD §11.4. The implementing agent may override with
justification. Never write "must use X" here — that belongs in §3
constraints.>

- Hint: ...

### Chunk <id-2> — <imperative title>

```yaml
id: <id-2>
depends_on: [<id-1>]
labels:
  - feature:<feature-slug>
  - type:<chore|feat|fix|refactor|docs|test>
```

**Goal.** ...

**Files.**

- ...

**Acceptance criteria.**

- [ ] ...
- [ ] ...

**Test strategy.** ...

**Effort.** ...

**Risks.**

- ...

<Repeat for each chunk. Order in source by approximate dependency
depth (roots first, leaves last) for readability — but the DAG is
the source of truth, not file order. Out-of-order is a Warning, not
Critical.>

---

## 6. Cross-cutting risks

<Risks that span multiple chunks or the plan as a whole — not
localised to one chunk. Each item: the risk, which chunks it touches,
and a mitigation. The reviewer flags as Warning when individual
chunks reference cross-cutting risks but §6 does not summarise them.>

- **<risk>** — touches chunks `<id>`, `<id>`. Mitigation: <one or
  two lines>.
- **<risk>** — applies plan-wide. Mitigation: <one or two lines>.

---

## 7. Validation strategy

<End-to-end "the feature is shipped" definition. This is what makes
the plan complete, beyond individual chunk acceptance criteria. State
the steps a human (or `/feature` orchestrator) takes after every
chunk has merged: which command to run, which path to visit, which
data to inspect. If the validation requires real data, name the
fixture or query.>

1. <step — what to verify>.
2. <step>.
3. <step>.

**Definition of done:** <one or two sentences naming the observable
outcome that proves the feature shipped — a UI flow that completes,
a query that returns the expected shape, a metric that fires.>

---

## 8. Open questions

<Decisions deliberately deferred to implementation time. Items here
are genuinely undecidable until an implementer touches the code (e.g.
"which index strategy fits the actual query plan" — answered by
`EXPLAIN` once the column exists). Items already resolved in PRD §10
or the design must NOT reappear here — the reviewer flags duplicates
as Warning. If §8 turns out to be empty, write `N/A — no decisions
deferred to implementation`.>

- [ ] <question> — to be decided by chunk `<id>` implementer.
- [ ] <question> — to be decided after chunk `<id>` lands and
  produces real data.
