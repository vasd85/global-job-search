#!/bin/bash
# PreToolUse hook for Edit|Write — blocks modifications to protected paths.
# Protected: qa-jobs-scrapper/ (legacy, read-only) and .env* (secrets).

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

if [[ "$FILE_PATH" == *"qa-jobs-scrapper"* ]]; then
  echo "Blocked: qa-jobs-scrapper/ is read-only legacy code. Do not modify." >&2
  exit 2
fi

BASENAME=$(basename "$FILE_PATH")
if [[ "$BASENAME" == .env* && "$BASENAME" != ".env.example" ]]; then
  echo "Blocked: .env files contain secrets and must not be edited by agents. Use .env.example for template changes." >&2
  exit 2
fi

exit 0
