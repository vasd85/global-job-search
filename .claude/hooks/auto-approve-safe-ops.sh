#!/bin/bash
# PreToolUse hook for Bash — auto-approves commands that reference the agent
# scratchpad directory.
#
# Why a hook instead of a settings.json allow pattern: the /implement skill
# runs several scratchpad-related bash shapes (mkdir, `VAR=$(realpath ...)`,
# `echo ... > ... phase-state.md`) that can't be expressed as prefix+wildcard
# allow patterns without being overly broad. A substring grep on the literal
# path `.claude/scratchpads` is both simpler and more precise.
#
# Only runs on the Bash matcher. Write/Edit tools are bare-allowed in
# settings.json, so they do not need this hook.
#
# Runs AFTER deny hooks (git-commit-guard, pre-pr-checks). A deny from those
# overrides the allow emitted here.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -qF '.claude/scratchpads'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Scratchpad operation"}}'
  exit 0
fi

exit 0
