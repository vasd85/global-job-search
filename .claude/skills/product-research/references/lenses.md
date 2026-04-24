# Product lenses

Two mental models to hold simultaneously while researching a product change. Each lens alone is incomplete — together they prevent the two classic failures: (a) strategically-smart features that feel broken to users, (b) beautiful user flows that don't move any business needle.

When the two lenses disagree, surface the tension in the PRD rather than quietly picking one. The user decides the trade-off.

## Business strategist lens

Reasons about the company, the market, and the economics of building this.

### Value & differentiation
- What's the user's alternative today? (existing feature, a manual workaround, a competitor, doing nothing)
- What's 10× better about this vs those alternatives? If it's only 2× better, ship nothing and work on something else.
- If we don't build this, what happens? (Users churn? Stay the same? Never noticed?)

### Economics & cost
- What does this cost us on an ongoing basis — compute, third-party API calls, ATS rate limits, content curation, support load, scoring LLM tokens?
- What's the ratio of expected value to cost? Is there a cheaper experiment that tests the same hypothesis?
- Which users benefit most, and how many are there? Concentrated value for a small segment can still be the right call — name it explicitly.

### Strategic fit
- Does this push the product toward the stated mission (matching users to their dream jobs), or sideways into a different product?
- Does this open adjacent opportunities (e.g., enabling future features) or close them off?
- Opportunity cost: what are we *not* doing by spending time here?

### Measurement
- What's the leading indicator we'll see in week 1? (activity proxy — clicks, toggles, saved searches)
- What's the lagging indicator that matters? (outcome proxy — applications submitted, matchPercent improvements, user retention)
- What's the threshold where we kill vs double down? State the number, not "we'll see."

### Risk
- What's the worst-case user behavior this enables? (spam, gaming the scoring, data abuse)
- What's the reputational risk if this fails publicly? (misleading matches, biased scoring, false urgency)
- Which constraint is most likely to bite first — data quality, ATS rate limits, LLM token cost, user patience, your own attention span as a solo builder?

## Product designer lens

Reasons about the user as a human in a specific moment, using a specific tool.

### User & job
- Who specifically is this for? (junior QA engineer, senior backend dev, career-switcher from marketing, returning-to-work parent) — *not* "everyone."
- What job is the user hiring this feature for, in their own words?
- What's the trigger — what just happened in the user's life or workflow right before they want this?

### Current friction
- What does the user do today to accomplish this? (even if poorly — find the workaround)
- Where are the failure modes in the current flow? (confusion, drop-off, giving up, opening a spreadsheet)
- Which single step costs the user the most effort or the most frustration? Fix that first.

### Proposed flow
- Walk through end-to-end. Where does the user start? What do they see on the first screen?
- What's the first moment of value — the "aha" where they realize this is useful?
- What's the minimum set of interactions for one success path? If you can't describe it in 5 steps, the feature is too wide.

### Consistency & mental model
- Does this match how similar things work elsewhere in the product (chatbot, search filters, scoring)?
- Does this introduce a new concept the user must learn (e.g., "avoidSkills" distinct from "core skills")? Is the learning cost worth the power?
- Does the naming survive a 3-second glance, or does the user have to re-read?

### Edge cases
- What happens with empty data? (no matches, no profile, no jobs yet)
- What happens with too much data? (500 matches, 20 preferred titles)
- What happens with stale data? (job was posted, then taken down; company stopped hiring)
- What happens on first use (no history) vs tenth use (habituated)?
- What happens when the underlying assumption is violated? (user has no matching jobs at all; user's profile is half-filled)

### Trust
- Does the output feel truthful? For AI scoring especially — can the user see *why* a score is what it is?
- When the system guesses wrong, can the user correct it, and does the correction actually change behavior next time?
- Does the feature hide important state from the user (e.g., silently filtering jobs they'd want to see)?

## Using both lenses together

- If the strategist says "ship the cheapest MVP" and the designer says "that MVP will feel broken to the user," neither is wrong — surface the tension and let the user choose.
- If the designer can describe a beautiful flow but the strategist can't name a single lagging metric it moves, stop and go find one. Beautiful features that don't move metrics are a waste of the user's (solo builder's) time.
- If the strategist has a clear ROI story but the designer can't find a plausible user moment for the feature, stop and reconsider. The ROI is hypothetical until a real user flow justifies it.
