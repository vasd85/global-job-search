#!/bin/bash
# PostToolUse hook. If a skill run is active for this session, append a
# compact one-line event to events.jsonl with tool name and truncated
# input/output. Non-blocking: any internal failure returns 0.

set +e

INPUT=$(cat)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT"        | jq -r '.cwd // empty'        2>/dev/null)
TOOL_NAME=$(printf '%s' "$INPUT"  | jq -r '.tool_name // empty'  2>/dev/null)

[[ -z "$SESSION_ID" ]] && exit 0

REPO="${CWD:-$PWD}"
MARKER="$REPO/.claude/logs/.active/$SESSION_ID"
[[ -f "$MARKER" ]] || exit 0

LOG_DIR=$(jq -r '.log_dir // empty' "$MARKER" 2>/dev/null)
[[ -d "$LOG_DIR" ]] || exit 0

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

TRUNC='walk(
  if type == "string" and length > 400 then .[0:400] + "…[+\(length-400)B]"
  elif type == "array" and length > 15 then .[0:15] + ["…[+\(length-15) items]"]
  else . end
)'

TOOL_INPUT=$(printf '%s' "$INPUT" | jq -c ".tool_input // null | $TRUNC" 2>/dev/null)
TOOL_RESP=$(printf '%s' "$INPUT"  | jq -c ".tool_response // null | $TRUNC" 2>/dev/null)

# Fallback to null-JSON if trunc failed
: "${TOOL_INPUT:=null}"
: "${TOOL_RESP:=null}"

EVENT=$(jq -cn \
  --arg ts "$TS" \
  --arg tool "$TOOL_NAME" \
  --argjson input "$TOOL_INPUT" \
  --argjson output "$TOOL_RESP" \
  '{ts: $ts, kind: "tool_use", tool: $tool, input: $input, output: $output}' 2>/dev/null)

[[ -n "$EVENT" ]] && printf '%s\n' "$EVENT" >> "$LOG_DIR/events.jsonl" 2>/dev/null

exit 0
