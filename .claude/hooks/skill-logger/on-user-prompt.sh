#!/bin/bash
# UserPromptSubmit hook. Bootstraps a per-skill run directory under
# .claude/logs/<skill>/ on detecting a slash-command invocation, and
# appends subsequent free-text prompts to the active run's events.jsonl.
# Never blocks: any internal failure returns 0.

set +e

INPUT=$(cat)
PROMPT=$(printf '%s' "$INPUT"      | jq -r '.prompt // empty'          2>/dev/null)
SESSION_ID=$(printf '%s' "$INPUT"  | jq -r '.session_id // empty'      2>/dev/null)
TRANSCRIPT=$(printf '%s' "$INPUT"  | jq -r '.transcript_path // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT"         | jq -r '.cwd // empty'             2>/dev/null)

[[ -z "$SESSION_ID" ]] && exit 0

REPO="${CWD:-$PWD}"
LOGS_BASE="$REPO/.claude/logs"
ACTIVE_DIR="$LOGS_BASE/.active"
MARKER="$ACTIVE_DIR/$SESSION_ID"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

mkdir -p "$ACTIVE_DIR" 2>/dev/null

is_noise_command() {
  case "$1" in
    help|clear|compact|mcp|exit|quit|fast|config|model|add-dir|status|\
    login|logout|cost|bug|pr-comments|version|doctor|upgrade|memory|\
    resume|continue|loop|schedule|ide) return 0 ;;
    *) return 1 ;;
  esac
}

append_event() {
  # $1 = log_dir, $2 = event JSON
  [[ -d "$1" ]] || return 0
  printf '%s\n' "$2" >> "$1/events.jsonl" 2>/dev/null
}

SLASH_RAW=""
SLASH_ARGS=""
SKILL_NAME=""
if [[ "$PROMPT" =~ ^/([a-zA-Z0-9_:-]+)(.*)$ ]]; then
  SLASH_RAW="${BASH_REMATCH[1]}"
  SLASH_ARGS="${BASH_REMATCH[2]}"
  SKILL_NAME="${SLASH_RAW##*:}"
fi

if [[ -f "$MARKER" ]]; then
  ACTIVE_SKILL=$(jq -r '.skill // empty'   "$MARKER" 2>/dev/null)
  ACTIVE_DIR_PATH=$(jq -r '.log_dir // empty' "$MARKER" 2>/dev/null)

  if [[ -n "$SKILL_NAME" ]] && ! is_noise_command "$SLASH_RAW" && [[ "$SKILL_NAME" != "$ACTIVE_SKILL" ]]; then
    END_EVENT=$(jq -cn --arg ts "$TS" --arg reason "new_skill_invoked" \
      '{ts: $ts, kind: "skill_end", reason: $reason}' 2>/dev/null)
    append_event "$ACTIVE_DIR_PATH" "$END_EVENT"
  else
    USER_EVENT=$(jq -cn --arg ts "$TS" --arg p "$PROMPT" \
      '{ts: $ts, kind: "user_prompt", text: $p}' 2>/dev/null)
    append_event "$ACTIVE_DIR_PATH" "$USER_EVENT"
    exit 0
  fi
fi

if [[ -z "$SKILL_NAME" ]] || is_noise_command "$SLASH_RAW"; then
  exit 0
fi

TS_FS=$(date -u +%Y%m%d-%H%M%S)
LOG_DIR="$LOGS_BASE/$SKILL_NAME/$TS_FS-${SESSION_ID:0:8}"
mkdir -p "$LOG_DIR" 2>/dev/null

if [[ -n "$TRANSCRIPT" ]]; then
  ln -sfn "$TRANSCRIPT" "$LOG_DIR/raw.jsonl" 2>/dev/null
  SESSION_SIDE_DIR="${TRANSCRIPT%.jsonl}"
  [[ -e "$SESSION_SIDE_DIR" ]] && ln -sfn "$SESSION_SIDE_DIR" "$LOG_DIR/session-dir" 2>/dev/null
fi

jq -n \
  --arg skill     "$SKILL_NAME" \
  --arg slash     "/$SLASH_RAW" \
  --arg args      "${SLASH_ARGS# }" \
  --arg session   "$SESSION_ID" \
  --arg started   "$TS" \
  --arg repo      "$REPO" \
  --arg transcript "$TRANSCRIPT" \
  --arg prompt    "$PROMPT" \
  '{skill: $skill, slash_command: $slash, args: $args, session_id: $session, repo: $repo, started_at: $started, transcript_path: $transcript, initial_prompt: $prompt}' \
  > "$LOG_DIR/meta.json" 2>/dev/null

START_EVENT=$(jq -cn --arg ts "$TS" --arg skill "$SKILL_NAME" --arg p "$PROMPT" \
  '{ts: $ts, kind: "skill_start", skill: $skill, prompt: $p}' 2>/dev/null)
append_event "$LOG_DIR" "$START_EVENT"

jq -n --arg skill "$SKILL_NAME" --arg dir "$LOG_DIR" \
  '{skill: $skill, log_dir: $dir}' > "$MARKER" 2>/dev/null

exit 0
