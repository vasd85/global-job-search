---
name: warnings-on-approved-pattern
description: Cross-check writer/reviewer skills for the "warnings on approved" output-format mismatch — recurring failure mode in evaluator-optimizer pairs
type: feedback
---

When auditing any writer-skill + reviewer-subagent pair in this project's agent-system pipeline (/prd + prd-reviewer, future /plan + plan-reviewer, /design + design-reviewer, /research + optional research-reviewer), explicitly cross-check this contract:

**The trap.** `architecture.md § 8.2` step 8 specifies "Warning-only findings are surfaced to the user with three choices: fix now, defer to follow-up, or skip with rationale." This means warnings can co-exist with an `approved` verdict. But step 4 of the same section says "Writer skill reads only `### Verdict`. Full findings are read only if verdict is `changes-required`." These two rules collide unless the reviewer's output format explicitly allows a `### Findings` block to appear under `approved`.

**Why:** First instance found in GJS-16 prd-reviewer audit (2026-04-30): the reviewer's canonical output format only emitted `### Findings` on `changes-required`, so any warnings on an approved verdict had nowhere to live and the SKILL.md step-4 "surface to user" branch was unreachable. The writer skill was tempted to either drop warnings silently or escalate to changes-required just to expose them — both corrupt verdict semantics.

**How to apply:** When reviewing a future writer/reviewer pair, verify three things in lockstep:
1. Reviewer's output format spec: does `### Findings` appear under `approved`, or is the format gated to `changes-required` only?
2. Writer SKILL.md step-4 read rule: does it read findings on `approved` when the file contains a `### Findings` block?
3. The verdict token line: is the verdict guaranteed to be the first non-empty line under `### Verdict` so the orchestrator's verdict-first parse is deterministic?

If any of these three is unspecified, flag as Critical. The fix is one of: (a) extend the output format to allow `### Findings` under `approved` (recommended — preserves architecture rule), or (b) explicitly retire the warnings-on-approved branch (requires architecture.md amendment).
