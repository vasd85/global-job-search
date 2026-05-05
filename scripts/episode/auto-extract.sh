#!/usr/bin/env bash
#
# auto-extract.sh — emit a schema-shaped episode-log JSON draft for one merged PR.
#
# Replaces the in-context "Step 2 auto-extract" recipe of the /log-episode skill
# (see .claude/skills/log-episode/SKILL.md). The agent passes the PR url plus the
# Plane epic code (one MCP retrieve away from the agent; the script never calls
# Plane MCP itself), and the script emits a single JSON object on stdout that:
#
#   - populates every auto-extracted field per docs/episodes/schema.json
#   - emits human-curated fields (decisions/blockers/dead_ends/learnings/tags
#     /parallel_with) as empty arrays for the agent to fill in during Step 3
#
# Sources, per docs/agents/architecture.md § 9.2 / § 9.6:
#   - gh pr view / gh pr diff   — PR-level facts and diff stats
#   - git ls-tree at merge SHA  — verifies prd/design/plan doc presence on main
#   - per-task phase-state.md   — started_at fallback when skill-logger is absent
#   - .claude/logs/<skill>/<run-dir>/{meta.json,events.jsonl}
#                                — session_ids, phases_run, durations
#   - <task-scratchpad>/code-review.md
#                                — reviews.code.{cycles,verdict,critical_findings_addressed}
#
# Usage:
#   auto-extract.sh <pr-url> --epic-code <code> [--feature-slug <slug>]
#
# Exit codes:
#   0 — JSON emitted on stdout
#   1 — hard failure (missing args, gh failure, unmerged PR, unparseable branch)

set -euo pipefail

# ---------- helpers ---------------------------------------------------------

err() {
  printf '%s\n' "$*" >&2
}

die() {
  err "$@"
  exit 1
}

# Wall-clock minutes between two ISO-8601 timestamps using python3 (portable
# across BSD and GNU date). Echoes a number; on failure echoes nothing and
# returns 1.
iso_minutes_between() {
  local start_ts="$1"
  local end_ts="$2"
  python3 - "$start_ts" "$end_ts" <<'PY' 2>/dev/null || return 1
import sys
from datetime import datetime, timezone

def parse(ts: str) -> datetime:
    # Accept trailing Z or explicit offset; treat naive as UTC.
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    dt = datetime.fromisoformat(ts)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt

start = parse(sys.argv[1])
end = parse(sys.argv[2])
delta_min = (end - start).total_seconds() / 60.0
# Round to nearest integer minute — matches existing JSONL entry shape.
print(round(delta_min))
PY
}

# Read the value of a YAML scalar key from the frontmatter block of a markdown
# file. Echoes the trimmed value; non-zero return when the key is absent.
yaml_frontmatter_value() {
  local key="$1"
  local file="$2"
  awk -v key="$key" '
    BEGIN { in_fm = 0; seen_fence = 0 }
    /^---[[:space:]]*$/ {
      if (seen_fence == 0) { in_fm = 1; seen_fence = 1; next }
      else { exit }
    }
    in_fm == 1 {
      if (match($0, "^" key "[[:space:]]*:[[:space:]]*")) {
        v = substr($0, RLENGTH + 1)
        sub(/[[:space:]]+$/, "", v)
        sub(/^[[:space:]]+/, "", v)
        print v
        exit
      }
    }
  ' "$file"
}

# ---------- bash version guard ----------------------------------------------

# This script uses bash 4+ features (`declare -A`, `BASH_REMATCH`). On macOS the
# default `/bin/bash` is 3.2 — fail fast with a clear remediation instead of a
# cryptic `declare: -A: invalid option` mid-run.
[[ "${BASH_VERSINFO[0]:-0}" -ge 4 ]] || die "auto-extract.sh: bash >= 4 required (have ${BASH_VERSION:-unknown}); install via 'brew install bash' on macOS"

# ---------- argument parsing ------------------------------------------------

pr_url=""
epic_code=""
feature_slug_arg=""

# First positional = pr-url; remaining flags consumed by name.
if [[ $# -lt 1 || "$1" == --* ]]; then
  die "auto-extract.sh: <pr-url> required (positional, first argument)"
fi
pr_url="$1"
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --epic-code)
      [[ $# -ge 2 ]] || die "--epic-code requires a value"
      epic_code="$2"
      shift 2
      ;;
    --feature-slug)
      [[ $# -ge 2 ]] || die "--feature-slug requires a value"
      feature_slug_arg="$2"
      shift 2
      ;;
    *)
      die "auto-extract.sh: unknown argument '$1'"
      ;;
  esac
done

if [[ -z "$epic_code" ]]; then
  die "--epic-code required (e.g. --epic-code GJS-8)"
fi

# Anchor at repo root so all relative paths (scratchpads, episode log, docs)
# resolve regardless of caller cwd.
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

# ---------- gh pr view: single call, reuse parsed JSON ----------------------

if ! pr_json="$(gh pr view "$pr_url" --json url,mergedAt,headRefName,title,body,mergeCommit,baseRefName,number 2>/dev/null)"; then
  die "auto-extract.sh: gh pr view failed for '$pr_url'"
fi

merged_at="$(printf '%s' "$pr_json" | jq -r '.mergedAt // empty')"
if [[ -z "$merged_at" ]]; then
  die "auto-extract.sh: PR '$pr_url' is not merged (mergedAt is null)"
fi

branch="$(printf '%s' "$pr_json" | jq -r '.headRefName // empty')"
title="$(printf '%s' "$pr_json" | jq -r '.title // empty')"
merge_commit="$(printf '%s' "$pr_json" | jq -r '.mergeCommit.oid // empty')"
canonical_pr_url="$(printf '%s' "$pr_json" | jq -r '.url // empty')"

# ---------- task_id, task_type from branch (fallback: PR title) -------------

task_type=""
task_id=""
if [[ "$branch" =~ ^([a-z]+)/(.+)-GJS-([0-9]+)$ ]]; then
  task_type="${BASH_REMATCH[1]}"
  task_id="GJS-${BASH_REMATCH[3]}"
elif [[ "$title" =~ (GJS-[0-9]+) ]]; then
  task_id="${BASH_REMATCH[1]}"
  # No reliable task_type from title — this branch shape is unsupported.
  die "auto-extract.sh: cannot parse task_type from branch '$branch' (title fallback gave task_id but not type)"
else
  die "cannot parse GJS-<n> from branch '$branch' or PR title '$title'"
fi

# Allowlist task_type per Conventional Commits / docs/episodes/schema.json.
case "$task_type" in
  feat|fix|refactor|chore|docs|test) ;;
  *) die "auto-extract.sh: branch '$branch' has unsupported type prefix '$task_type'; expected feat|fix|refactor|chore|docs|test" ;;
esac

# ---------- feature_slug: --feature-slug, glob fallback, or empty -----------

feature_slug=""
if [[ -n "$feature_slug_arg" ]]; then
  feature_slug="$feature_slug_arg"
else
  # Glob .claude/scratchpads/*/tasks/<task_id>/phase-state.md and take parent-of-tasks dir.
  for ps in .claude/scratchpads/*/tasks/"$task_id"/phase-state.md; do
    if [[ -f "$ps" ]]; then
      # ps = .claude/scratchpads/<slug>/tasks/<task_id>/phase-state.md
      # parent-of-tasks dir is the <slug>.
      parent_dir="${ps%/tasks/*}"
      feature_slug="${parent_dir##*/}"
      break
    fi
  done
fi

# ---------- episode_id ------------------------------------------------------

# YYYY-MM-DD comes from the first 10 chars of the ISO-8601 mergedAt string —
# UTC by definition (gh emits Z-suffixed timestamps).
merged_date="${merged_at:0:10}"
if [[ -n "$feature_slug" ]]; then
  episode_id="${merged_date}-${feature_slug}-${task_id}"
else
  episode_id="${merged_date}-${task_id}"
fi

# ---------- prd / design / plan link verification at merge SHA --------------

# null when feature_slug is empty OR the file isn't present in the merge tree.
verify_doc_at_merge() {
  local rel_path="$1"
  if [[ -z "$feature_slug" || -z "$merge_commit" ]]; then
    return 1
  fi
  local hit
  hit="$(git ls-tree --name-only "$merge_commit" -- "$rel_path" 2>/dev/null || true)"
  [[ -n "$hit" ]]
}

prd_link_json="null"
design_link_json="null"
plan_link_json="null"
if [[ -n "$feature_slug" ]]; then
  if verify_doc_at_merge "docs/product/${feature_slug}.md"; then
    prd_link_json="$(jq -n --arg p "docs/product/${feature_slug}.md" '$p')"
  fi
  if verify_doc_at_merge "docs/designs/${feature_slug}.md"; then
    design_link_json="$(jq -n --arg p "docs/designs/${feature_slug}.md" '$p')"
  fi
  if verify_doc_at_merge "docs/plans/${feature_slug}.md"; then
    plan_link_json="$(jq -n --arg p "docs/plans/${feature_slug}.md" '$p')"
  fi
fi

# ---------- started_at from per-task phase-state.md -------------------------

started_at_json="null"
phase_state_path=""
if [[ -n "$feature_slug" ]]; then
  phase_state_path=".claude/scratchpads/${feature_slug}/tasks/${task_id}/phase-state.md"
  if [[ -f "$phase_state_path" ]]; then
    if started_raw="$(yaml_frontmatter_value started_at "$phase_state_path")" \
       && [[ -n "$started_raw" && "$started_raw" != "null" ]]; then
      started_at_json="$(jq -n --arg t "$started_raw" '$t')"
    fi
  fi
fi

# ---------- session_ids: filter meta.json by repo + window ------------------

# Window: [started_at, completed_at]. If started_at is null, the array is empty.
session_ids_json="[]"
phases_run_json="[]"
duration_min_total_json="null"
duration_min_by_phase_json="null"

if [[ "$started_at_json" != "null" ]]; then
  started_at="$(printf '%s' "$started_at_json" | jq -r '.')"

  # Collect (session_id, skill, run_dir) tuples for matching meta.json files.
  matched_runs=""
  if compgen -G ".claude/logs/*/*/meta.json" > /dev/null; then
    for meta in .claude/logs/*/*/meta.json; do
      [[ -f "$meta" ]] || continue
      meta_repo="$(jq -r '.repo // empty' "$meta" 2>/dev/null || true)"
      meta_started="$(jq -r '.started_at // empty' "$meta" 2>/dev/null || true)"
      meta_session="$(jq -r '.session_id // empty' "$meta" 2>/dev/null || true)"
      meta_skill="$(jq -r '.skill // empty' "$meta" 2>/dev/null || true)"
      [[ -z "$meta_repo" || -z "$meta_started" || -z "$meta_session" || -z "$meta_skill" ]] && continue
      [[ "$meta_repo" != "$repo_root" ]] && continue
      # Window check: started_at <= meta_started <= merged_at (lexicographic
      # ISO-8601 compare is safe — both ends are Z-suffixed UTC).
      if [[ "$meta_started" < "$started_at" ]]; then continue; fi
      if [[ "$meta_started" > "$merged_at" ]]; then continue; fi
      run_dir="$(dirname "$meta")"
      matched_runs+="${meta_session}\t${meta_skill}\t${run_dir}\n"
    done
  fi

  if [[ -n "$matched_runs" ]]; then
    # session_ids — preserve discovery order, jq builds the array.
    session_ids_json="$(printf '%b' "$matched_runs" | awk -F'\t' 'NF>=1 && $1 != "" {print $1}' \
      | jq -R . | jq -s .)"

    # phases_run — unique skill names in discovery order.
    phases_run_json="$(printf '%b' "$matched_runs" | awk -F'\t' 'NF>=2 && $2 != "" {print $2}' \
      | awk '!seen[$0]++' \
      | jq -R . | jq -s .)"

    # Per-session min/max ts → per-skill aggregate minutes; total = global min/max.
    declare -a all_min_ts=()
    declare -a all_max_ts=()
    declare -A skill_minutes_acc=()
    while IFS=$'\t' read -r _sid skill run_dir; do
      [[ -z "$skill" || -z "$run_dir" ]] && continue
      events_file="${run_dir}/events.jsonl"
      [[ -f "$events_file" ]] || continue
      bounds="$(jq -r 'select(.ts != null) | .ts' "$events_file" 2>/dev/null \
        | awk 'NR==1{min=$0; max=$0; next} {if($0<min) min=$0; if($0>max) max=$0} END{if(NR>0) print min "\t" max}')"
      [[ -z "$bounds" ]] && continue
      sess_min="${bounds%%$'\t'*}"
      sess_max="${bounds##*$'\t'}"
      all_min_ts+=("$sess_min")
      all_max_ts+=("$sess_max")
      if sess_minutes="$(iso_minutes_between "$sess_min" "$sess_max")"; then
        prior="${skill_minutes_acc[$skill]:-0}"
        # Sum across multiple sessions for the same skill.
        skill_minutes_acc["$skill"]="$((prior + sess_minutes))"
      fi
    done < <(printf '%b' "$matched_runs")

    if [[ ${#all_min_ts[@]} -gt 0 ]]; then
      global_min="${all_min_ts[0]}"
      global_max="${all_max_ts[0]}"
      for ts in "${all_min_ts[@]}"; do
        [[ "$ts" < "$global_min" ]] && global_min="$ts"
      done
      for ts in "${all_max_ts[@]}"; do
        [[ "$ts" > "$global_max" ]] && global_max="$ts"
      done
      if total_minutes="$(iso_minutes_between "$global_min" "$global_max")"; then
        duration_min_total_json="$total_minutes"
      fi
    fi

    if [[ ${#skill_minutes_acc[@]} -gt 0 ]]; then
      # Build the per-phase object from the accumulator.
      by_phase_args=()
      by_phase_filter='{}'
      i=0
      for skill in "${!skill_minutes_acc[@]}"; do
        by_phase_args+=(--arg "k${i}" "$skill" --argjson "v${i}" "${skill_minutes_acc[$skill]}")
        by_phase_filter+=" | .[\$k${i}] = \$v${i}"
        i=$((i + 1))
      done
      duration_min_by_phase_json="$(jq -n "${by_phase_args[@]}" "$by_phase_filter")"
    fi
  fi
fi

# ---------- reviews from <task-scratchpad>/code-review.md -------------------

reviews_json="{}"
if [[ -n "$feature_slug" ]]; then
  code_review_path=".claude/scratchpads/${feature_slug}/tasks/${task_id}/code-review.md"
  if [[ -f "$code_review_path" ]]; then
    # Verdict = first non-empty, non-heading line under "### Verdict".
    # Pre-strip CR before awk: a CRLF-edited code-review.md leaves a `\r`-only
    # blank line under the heading, which satisfies awk's `NF > 0` and would
    # be consumed as the verdict if the strip ran later in the pipe.
    verdict="$(tr -d '\r' < "$code_review_path" | awk '
      /^### Verdict[[:space:]]*$/ { in_block = 1; next }
      /^### / && in_block { exit }
      in_block && NF > 0 {
        # Strip leading/trailing whitespace.
        sub(/^[[:space:]]+/, "")
        sub(/[[:space:]]+$/, "")
        print
        exit
      }
    ' | awk '{print tolower($0)}')"

    case "$verdict" in
      approved|changes-required) ;;
      *) verdict="" ;;
    esac

    if [[ -n "$verdict" ]]; then
      critical_count=0
      if [[ "$verdict" == "changes-required" ]]; then
        # Count "#### Critical*" headings under "### Findings". Pre-strip CR
        # for parity with the verdict parser above (CRLF-edited markdown).
        critical_count="$(tr -d '\r' < "$code_review_path" | awk '
          /^### Findings[[:space:]]*$/ { in_block = 1; next }
          /^### / && in_block { exit }
          in_block && /^#### Critical/ { count++ }
          END { print count + 0 }
        ')"
      fi
      reviews_json="$(jq -n \
        --arg verdict "$verdict" \
        --argjson cycles 1 \
        --argjson critical "$critical_count" \
        '{code: {cycles: $cycles, verdict: $verdict, critical_findings_addressed: $critical}}')"
    fi
  fi
fi

# ---------- files_touched_count, test_count_added --------------------------

files_touched_json="null"
if files_list="$(gh pr diff "$pr_url" --name-only 2>/dev/null)"; then
  if [[ -z "$files_list" ]]; then
    files_touched_json="0"
  else
    files_touched_json="$(printf '%s\n' "$files_list" | grep -c '.' || true)"
  fi
elif fallback_diff="$(gh pr diff "$pr_url" 2>/dev/null)"; then
  files_touched_json="$(printf '%s\n' "$fallback_diff" | grep -c '^diff --git' || true)"
fi
[[ -z "$files_touched_json" ]] && files_touched_json="null"

test_count_json="null"
if pr_diff="$(gh pr diff "$pr_url" 2>/dev/null)"; then
  # Match added test cases minus removed ones. The `^\+[^+]` filter avoids
  # the `+++ b/...` file-header lines that start with three plus signs.
  added="$(printf '%s\n' "$pr_diff" | grep -cE '^\+[^+].*\b(it|test|describe)\(' || true)"
  removed="$(printf '%s\n' "$pr_diff" | grep -cE '^-[^-].*\b(it|test|describe)\(' || true)"
  net=$((added - removed))
  (( net < 0 )) && net=0
  test_count_json="$net"
fi

# ---------- compose final JSON via one jq -n call --------------------------

jq -n \
  --argjson schema_version 1 \
  --arg episode_id "$episode_id" \
  --arg feature_slug "$feature_slug" \
  --arg task_id "$task_id" \
  --arg task_type "$task_type" \
  --arg status "merged" \
  --argjson started_at "$started_at_json" \
  --arg completed_at "$merged_at" \
  --arg branch "$branch" \
  --arg pr_url "$canonical_pr_url" \
  --arg plane_work_item_id "$task_id" \
  --arg plane_epic_id "$epic_code" \
  --argjson prd_link "$prd_link_json" \
  --argjson design_link "$design_link_json" \
  --argjson plan_link "$plan_link_json" \
  --argjson session_ids "$session_ids_json" \
  --argjson phases_run "$phases_run_json" \
  --argjson reviews "$reviews_json" \
  --argjson duration_min_total "$duration_min_total_json" \
  --argjson duration_min_by_phase "$duration_min_by_phase_json" \
  --argjson files_touched_count "$files_touched_json" \
  --argjson test_count_added "$test_count_json" \
  '{
    schema_version: $schema_version,
    episode_id: $episode_id,
    feature_slug: $feature_slug,
    task_id: $task_id,
    task_type: $task_type,
    status: $status,
    started_at: $started_at,
    completed_at: $completed_at,
    branch: $branch,
    pr_url: $pr_url,
    plane_work_item_id: $plane_work_item_id,
    plane_epic_id: $plane_epic_id,
    prd_link: $prd_link,
    design_link: $design_link,
    plan_link: $plan_link,
    session_ids: $session_ids,
    phases_run: $phases_run,
    parallel_with: [],
    reviews: $reviews,
    duration_min_total: $duration_min_total,
    duration_min_by_phase: $duration_min_by_phase,
    files_touched_count: $files_touched_count,
    test_count_added: $test_count_added,
    decisions: [],
    blockers: [],
    dead_ends: [],
    learnings: [],
    tags: []
  }'
