---
name: Skill 200-line guard
description: Agent-system pipeline skills (research, prd, design, plan, tasks, etc.) must stay under 200 lines, not the generic 500-line skills-guide limit
type: feedback
---

The generic skills authoring guide caps SKILL.md at 500 lines, but the
agent-system pipeline imposes a tighter 200-line cap per
`docs/plans/agent-system.md § 6` ("Skill bloat" risk). All planning-pipeline
skills inherit this stricter bound.

**Why:** the cross-cutting risks section locks the cap at 200 to keep each
skill's working set small as the per-skill module loading invariant
(architecture § 1 invariant 10) bounds context.

**How to apply:** when reviewing a `/research`, `/prd`, `/design`, `/plan`,
`/tasks`, `/feature`, `/implement-task`, or `/log-episode` SKILL.md, count
lines and flag anything over 200 as Critical against GJS plan, even if the
skills-authoring guide would tolerate it.
