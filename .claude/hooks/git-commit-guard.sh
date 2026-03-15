#!/bin/bash
# PreToolUse hook for Bash — validates git commit commands.
# 1. Ensures -F flag is used (not -m) — enforced by deny list, this is a fallback.
# 2. Validates commit message follows Conventional Commits format.
# 3. Runs typecheck + lint before allowing commit.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only process git commit commands
if ! echo "$COMMAND" | grep -qE '^\s*git\s+commit\b'; then
  exit 0
fi

# Fallback check: block -m flag (primary enforcement is deny list)
if echo "$COMMAND" | grep -qE 'git\s+commit\s+.*-[a-z]*m\s'; then
  echo "Blocked: use 'git commit -F /tmp/gjs_msg.txt' instead of -m flag (Cursor index.lock race)." >&2
  exit 2
fi

# Extract temp file path from -F argument
TEMP_FILE=$(echo "$COMMAND" | grep -oE '\-F\s+\S+' | awk '{print $2}')

if [[ -n "$TEMP_FILE" && -f "$TEMP_FILE" ]]; then
  FIRST_LINE=$(head -1 "$TEMP_FILE")

  # Validate Conventional Commits format
  if ! echo "$FIRST_LINE" | grep -qE '^(feat|fix|refactor|chore|docs|test)(\([a-z0-9-]+\))?: .+'; then
    echo "Blocked: commit message must follow Conventional Commits format:" >&2
    echo "  <type>(<scope>): <description>" >&2
    echo "  Types: feat, fix, refactor, chore, docs, test" >&2
    echo "  Scopes: web, ats-core, db, api" >&2
    echo "  Got: '$FIRST_LINE'" >&2
    exit 2
  fi
fi

# Run typecheck and lint
cd "$CLAUDE_PROJECT_DIR" || exit 0

ERRORS=""
if ! pnpm typecheck 2>&1; then
  ERRORS="typecheck failed"
fi

if ! pnpm lint 2>&1; then
  if [[ -n "$ERRORS" ]]; then
    ERRORS="$ERRORS; lint failed"
  else
    ERRORS="lint failed"
  fi
fi

if [[ -n "$ERRORS" ]]; then
  echo "Blocked: pre-commit checks failed ($ERRORS). Fix issues before committing." >&2
  exit 2
fi

exit 0
