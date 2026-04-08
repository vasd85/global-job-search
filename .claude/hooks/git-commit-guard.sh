#!/bin/bash
# PreToolUse hook for Bash — validates git commit commands.
#
# Canonical form (enforced):
#   git commit -F - <<'EOF'
#   type(scope): description
#
#   Optional body.
#   EOF
#
# What it does:
# 1. Blocks -m / --message (fallback — primary block is in settings.json deny list).
# 2. Extracts the commit message from either:
#    a. `-F -` stdin HEREDOC with delimiter `EOF` (canonical),
#    b. `-F <file>` file path (backward compat; no longer produced by the agent).
# 3. Validates the first line against Conventional Commits.
# 4. Runs `pnpm typecheck` and `pnpm lint`; on failure, surfaces the output.
#
# --amend is recognized and skips format validation (existing commit's message
# is preserved or opened in an editor), but typecheck + lint still run.

set -uo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only process git commit. Match at start-of-line OR after a shell operator
# (; && || | &) so compound commands like `git add foo && git commit ...`
# are not bypassed.
if ! echo "$COMMAND" | grep -qE '(^|[;&|]+[[:space:]]*)git[[:space:]]+commit\b'; then
  exit 0
fi

# Fallback check: block -m / --message (primary enforcement is the deny list).
if echo "$COMMAND" | grep -qE 'git[[:space:]]+commit[[:space:]]+([^|&;]*[[:space:]])?(-[a-zA-Z]*m\b|--message\b)'; then
  cat >&2 <<'MSG'
Blocked: do not use `-m` / `--message`. Commit with a stdin HEREDOC instead:

  git commit -F - <<'EOF'
  type(scope): description

  Optional body.
  EOF

The hook parses the HEREDOC body from the command to validate Conventional
Commits format. The form `git commit -m "..."` is banned so the validator
only has one canonical shape to handle.
MSG
  exit 2
fi

# --amend: keep existing message (or open editor). Skip format validation.
IS_AMEND=0
if echo "$COMMAND" | grep -qE 'git[[:space:]]+commit[[:space:]]+[^|&;]*--amend\b'; then
  IS_AMEND=1
fi

if [[ $IS_AMEND -eq 0 ]]; then
  MESSAGE_BODY=""

  # Case 1: stdin HEREDOC form — `-F - <<'EOF' ... EOF`
  # Extract the body between the line containing `<<'EOF'` and the line that
  # is exactly `EOF`. Pure bash, no regex quoting gymnastics.
  if echo "$COMMAND" | grep -qE '\-F[[:space:]]+-[[:space:]]+<<-?'"'"'?"?EOF'"'"'?"?'; then
    in_body=0
    while IFS= read -r line; do
      if [[ $in_body -eq 1 ]]; then
        [[ "$line" == "EOF" ]] && break
        MESSAGE_BODY+="$line"$'\n'
      else
        # Start marker: line contains <<EOF, <<'EOF', or <<"EOF" (optionally with -)
        if [[ "$line" =~ \<\<-?[\'\"]?EOF[\'\"]? ]]; then
          in_body=1
        fi
      fi
    done <<< "$COMMAND"
  fi

  # Case 2 (backward compat): `-F <path>` where <path> is an actual file.
  # Only attempt if HEREDOC extraction didn't find anything.
  if [[ -z "$MESSAGE_BODY" ]]; then
    TEMP_FILE=$(echo "$COMMAND" | grep -oE '\-F[[:space:]]+[^[:space:]-][^[:space:]]*' | head -1 | awk '{print $2}')
    if [[ -n "$TEMP_FILE" && -f "$TEMP_FILE" ]]; then
      MESSAGE_BODY=$(cat "$TEMP_FILE")
    fi
  fi

  if [[ -z "$MESSAGE_BODY" ]]; then
    cat >&2 <<'MSG'
Blocked: cannot extract commit message from command. Use this exact form:

  git commit -F - <<'EOF'
  type(scope): description
  EOF

The HEREDOC delimiter must be `EOF` (single-quoted: `<<'EOF'`).
MSG
    exit 2
  fi

  FIRST_LINE=$(echo "$MESSAGE_BODY" | head -1)

  # Validate Conventional Commits format.
  if ! echo "$FIRST_LINE" | grep -qE '^(feat|fix|refactor|chore|docs|test)(\([a-z0-9-]+\))?: .+'; then
    cat >&2 <<MSG
Blocked: commit subject must follow Conventional Commits:
  <type>(<scope>): <description>
  Types:  feat, fix, refactor, chore, docs, test
  Scopes: web, ats-core, db, api (optional)
  Got:    '$FIRST_LINE'
MSG
    exit 2
  fi
fi

# Run typecheck and lint. Capture output so we can surface it on failure.
cd "$CLAUDE_PROJECT_DIR" || exit 0

TYPECHECK_OUT=$(pnpm typecheck 2>&1)
TYPECHECK_RC=$?
LINT_OUT=$(pnpm lint 2>&1)
LINT_RC=$?

if [[ $TYPECHECK_RC -ne 0 || $LINT_RC -ne 0 ]]; then
  echo "Blocked: pre-commit checks failed." >&2
  if [[ $TYPECHECK_RC -ne 0 ]]; then
    {
      echo
      echo "--- pnpm typecheck ---"
      echo "$TYPECHECK_OUT"
    } >&2
  fi
  if [[ $LINT_RC -ne 0 ]]; then
    {
      echo
      echo "--- pnpm lint ---"
      echo "$LINT_OUT"
    } >&2
  fi
  exit 2
fi

exit 0
