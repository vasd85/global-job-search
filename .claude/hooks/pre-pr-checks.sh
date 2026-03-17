#!/bin/bash
# PreToolUse hook for Bash — runs typecheck + tests before PR creation.
# Matches: gh pr create

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only process gh pr create commands
if ! echo "$COMMAND" | grep -qE '^\s*gh\s+pr\s+create\b'; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0

if ! pnpm typecheck 2>&1; then
  echo "Blocked: typecheck must pass before creating a PR. Run 'pnpm typecheck' and fix errors." >&2
  exit 2
fi

if ! pnpm test 2>&1; then
  echo "Blocked: tests must pass before creating a PR. Run 'pnpm test' and fix failures." >&2
  exit 2
fi

exit 0
