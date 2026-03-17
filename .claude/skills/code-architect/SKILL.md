---
name: code-architect
description: >-
  Designs implementation plans for multi-file changes, new features, or
  architectural decisions. Use before starting complex implementations
  that touch multiple files or require design choices.
---

# Code Architect

Launch the **architect** subagent to design an implementation plan.

Pass the full context of the task — the subagent runs in isolation and
does not see the current conversation. Include in the prompt:

- The feature, change, or decision being planned
- Any business context the user provided (goals, constraints, timeline)
- Any preferences or constraints mentioned in the conversation

Present the subagent's output to the user as-is.
