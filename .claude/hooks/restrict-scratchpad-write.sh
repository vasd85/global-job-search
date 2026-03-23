#!/bin/bash
# PreToolUse hook for Write — restricts writes to .claude/scratchpads/ only.
# Applied to thinker agents (code-architect, test-scenario-designer, code-reviewer)
# to enforce read-only access to source code while allowing scratchpad output.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

if [[ "$FILE_PATH" == *".claude/scratchpads/"* ]]; then
  exit 0
fi

echo "Blocked: thinker agents can only write to .claude/scratchpads/. Attempted: $FILE_PATH" >&2
exit 2
