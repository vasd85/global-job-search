# <Feature title>

Status: **Draft v1** | Date: YYYY-MM-DD | Owner: <user>

> **Reader:** this PRD is written for a downstream agent (planner,
> architect, or implementer) — not a human. Sections are fixed in name
> and order; index by section number when needed. Decisions are
> declarative. "N/A" is a valid value for a section; empty is not.

---

## 0. Inputs & pointers

<Files, tables, and references the downstream agent should read before acting. Absolute paths or repo-relative paths, not descriptions.>

- **Repo:** `/Users/vasd85/repo/personal-projects/global-job-search`
- **Relevant existing docs:** `docs/<file>.md`, ...
- **Schema:** `apps/web/src/lib/db/schema.ts` (tables: `<table>`, `<table>`)
- **Related code paths:** `apps/web/src/<path>`, `packages/ats-core/src/<path>`
- **DB access:** `mcp__postgres__execute_sql` (tables listed above; read-only via dbhub)

---

## 1. Problem

### 1.1 User problem
<What pain does the user have today? Name the user and the moment — avoid "users want X" vagueness. "A senior QA engineer browsing jobs on a lunch break wants to..." is the right tone.>

### 1.2 Business problem
<Why this matters for the product. Tie it to the mission (matching users to dream jobs) or to a concrete product health metric.>

### 1.3 Why now
<What changed that makes this worth doing now? New data, new user signal, new competitive pressure, newly possible because of a prior feature.>

---

## 2. User & context

### 2.1 Target user
<Persona, seniority, current workflow. Be specific — "senior backend engineer considering a switch every 6-12 months" not "job seekers".>

### 2.2 Jobs-to-be-done
<The specific job the feature is hired for. Format: "When I ___, I want to ___, so I can ___.">

### 2.3 Scenarios
<2-3 concrete use cases describing the user in motion. Each scenario should have a trigger, a flow, and an outcome.>

- **Scenario A — <name>:** ...
- **Scenario B — <name>:** ...

---

## 3. Goals & non-goals

### 3.1 Goals
<Outcomes we commit to. Each should be observable by either the user or in data.>

- G1 — ...
- G2 — ...

### 3.2 Non-goals
<Explicitly out of scope. This is protection against scope creep during implementation.>

- NG1 — ...
- NG2 — ...

---

## 4. Success metrics

<Leading indicators (activity — fires quickly, tells you if anyone noticed) + lagging indicators (outcome — fires slowly, tells you if it mattered). State target values if known; "TBD after week 1 of data" is also fine.>

| Metric | Type | Target | Measured how |
|---|---|---|---|
| <metric> | leading | <value> | <data source or SQL sketch> |
| <metric> | lagging | <value> | <data source> |

**Kill criteria:** <What pattern in the data means we should rip this out rather than iterate? Write this BEFORE launch, so it's an honest commitment.>

---

## 5. Current state

### 5.1 Existing behavior
<What happens in the product today for this user/scenario? Reference relevant code paths, DB tables, UI components. File references welcome (`apps/web/src/...`).>

### 5.2 Baseline data
<What the DB tells us about current usage. Actual numbers from sample queries, not guesses. Paste each number together with the SQL that produced it so the downstream agent can re-run or extend it.>

---

## 6. Proposed solution

### 6.1 Conceptual approach
<High-level mechanism. Describe WHAT happens and WHY. No library names, no SQL, no column types — those choices belong to the downstream agent.>

### 6.2 User flow
<Step-by-step what the user does and sees, end-to-end. Number the steps. Include the happy path first, then call out what changes in the unhappy branches.>

1. User ...
2. System ...
3. User ...

### 6.3 Entities & state changes
<What data concepts change. "We start tracking X per user", "Jobs gain a new classification Y", etc. Concept-level — no column types, no migrations.>

### 6.4 Interactions with existing features
<How this connects to chatbot, search, scoring, ingestion, etc. Which existing flows does it change? Which ones does it leave alone?>

---

## 7. MVP scope

### 7.1 In the first ship
<The minimum we need to validate the hypothesis. Trim hard — if the first ship takes more than 1-2 weeks of work, it's probably not an MVP, it's a product.>

- ...

### 7.2 Fast follow (after validation)
<Things we deliberately defer until we see real usage, even though they'd be nice. Listing them here prevents "should we do this now?" fights during implementation.>

- ...

### 7.3 Maybe-never
<Ideas we considered but decided against. Writing them down stops us from re-litigating later.>

- ...

---

## 8. Alternatives considered

<2-3 other approaches we thought about and why we didn't pick them. One paragraph each. Be concrete about the trade-off — "Approach B was cheaper but didn't solve X" beats "We felt A was better".>

### Alternative A — <name>
Why considered: ... Why rejected: ...

### Alternative B — <name>
Why considered: ... Why rejected: ...

---

## 9. Risks & trade-offs

### 9.1 Product risks
<What could go wrong for users. Confusion, mistrust, misuse, surprising behavior.>

### 9.2 Business risks
<Economic, competitive, strategic. Including: does this make us look worse in some comparison? Does this gate future flexibility?>

### 9.3 Dependencies & assumptions
<Things this relies on being true. Data availability, ATS support, user profile completeness. Flag anything fragile so the downstream agent can verify before building.>

---

## 10. Open questions

<Things the PRD deliberately leaves open because they need data we don't have yet, or a decision that depends on implementation. Not blockers — but track them so they don't silently get resolved in the wrong direction.>

- [ ] ...
- [ ] ...

---

## 11. Contract with the downstream agent

### 11.1 Decisions the agent owns
<Technical decisions explicitly delegated to whichever agent consumes this PRD. The agent may make these freely without coming back.>

- ...
- ...

### 11.2 Decisions that are locked
<Product-level decisions the agent must NOT change. Changing any of these requires re-opening this PRD with the user for a new approval, not a unilateral agent decision.>

- ...
- ...

### 11.3 Invariants to preserve
<Existing product behavior that this work must NOT break, even if the agent finds a reason it would be easier to. Reference code paths or sections by name.>

- ...
- ...

### 11.4 Technical hints (optional, non-binding)
<If research surfaced a concrete technical constraint or an obvious implementation lever, flag it here. Label each as a hint, not a requirement — the agent may override with justification.>

- Hint: ...
- Hint: ...

### 11.5 Verified during research
<Things the research phase already checked so the downstream agent does not redo them. Reduces duplicate work.>

- ...
- ...
