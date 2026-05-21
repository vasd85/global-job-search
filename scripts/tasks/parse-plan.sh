#!/usr/bin/env bash
#
# parse-plan.sh — parse a plan markdown into the JSON inventory /tasks needs.
#
# Replaces the in-context "Step 1 (parse plan) + Step 3.3 (Epic description) +
# Step 3.4 (WI description)" recipes of .claude/skills/tasks/SKILL.md. The
# agent passes the feature slug; the script reads docs/plans/<slug>.md (and
# optionally docs/product/<slug>.md), validates the chunk DAG and labels, and
# emits a single JSON object on stdout that:
#
#   - `epic`:  { name, description_html, external_id, labels }
#       — name from PRD H1 (fallback to feature slug)
#       — description_html rendered from docs/agents/plane/tasks.md § 4.1
#   - `chunks`: [ { id, title, depends_on, labels, goal, files,
#                   acceptance_criteria, name, description_html, external_id } ]
#       — one entry per `### Chunk <id> — <title>` block in the plan
#       — description_html rendered from docs/agents/plane/tasks.md § 4.2
#
# Tooling: bash for argument parsing and orchestration; python3 (already a
# project dep via scripts/episode/auto-extract.sh) does the markdown parsing,
# DAG validation, label validation, HTML escaping and JSON emission in one
# pass. jq is used only by callers that pipe the output.
#
# Plan format (per .claude/skills/tasks/SKILL.md Step 1, canonical shape used
# by `/plan`-generated plans):
#
#   ### Chunk <id> — <title>
#
#   ```yaml
#   id: <id>
#   depends_on: [<other-id>, ...]   # or [], or bare scalar `depends_on: <id>`
#   labels:
#     - type:<feat|fix|refactor|chore|docs|test>
#     - feature:<feature-slug>
#     - <other-namespace>:<value>   # optional, preserved
#   ```
#
#   **Goal.** ...one or more paragraphs...
#
#   **Files.** (or **Files (...).**)
#   - <path>
#   - ...
#
#   **Acceptance criteria.** (or **Acceptance criteria (...).**)
#   - [ ] <line copied verbatim>
#   - [ ] ...
#
# Diagnostics go to stderr; stdout carries the single JSON document only.
#
# Usage:
#   parse-plan.sh <feature-slug>
#
# Exit codes:
#   0 — JSON emitted on stdout
#   1 — usage / IO error
#   2 — structural error (missing section, missing yaml, malformed heading)
#   3 — semantic error (label set, DAG cycle, unknown dependency)

set -euo pipefail

# ---------- helpers ---------------------------------------------------------

err() {
  printf '%s\n' "$*" >&2
}

die() {
  local code="$1"
  shift
  err "$@"
  exit "$code"
}

# ---------- bash version guard ---------------------------------------------

# Helper does nothing fancy in bash itself, but `set -u` + BASH_VERSINFO and
# the eventual rewrite-prone follow-ups call for bash 4+ across project
# scripts (matches scripts/episode/auto-extract.sh policy). On macOS the
# default /bin/bash is 3.2 — fail fast with a clear remediation.
[[ "${BASH_VERSINFO[0]:-0}" -ge 4 ]] || die 1 \
  "parse-plan.sh: bash >= 4 required (have ${BASH_VERSION:-unknown}); install via 'brew install bash' on macOS"

# ---------- argument parsing ------------------------------------------------

if [[ $# -ne 1 ]]; then
  die 1 "parse-plan.sh: exactly one positional argument required: <feature-slug>"
fi

feature_slug="$1"
if [[ ! "$feature_slug" =~ ^[A-Za-z0-9_-]+$ ]]; then
  die 1 "parse-plan.sh: <feature-slug> must be non-empty; only [A-Za-z0-9_-] allowed"
fi

# Anchor at repo root so relative paths resolve regardless of caller cwd.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  die 1 "parse-plan.sh: not inside a git repository"
fi
cd "$repo_root"

plan_path="docs/plans/${feature_slug}.md"
prd_path="docs/product/${feature_slug}.md"
design_path="docs/designs/${feature_slug}.md"

if [[ ! -f "$plan_path" ]]; then
  die 1 "parse-plan.sh: plan not found at '$plan_path'"
fi

# GitHub repo for embedded links (per docs/agents/plane/universal.md § 1).
# Hard-coded by convention; if the workspace migrates, update universal.md
# and this constant together.
REPO_URL="https://github.com/vasd85/global-job-search"

# ---------- single-pass parser (python3) ------------------------------------
#
# Python parses the plan, validates the DAG and labels, and emits one JSON
# document on stdout (or a diagnostic + non-zero exit on failure). Bash here
# is the thin shim. Python is already a project dep via auto-extract.sh.

PARSE_PLAN_FEATURE_SLUG="$feature_slug" \
PARSE_PLAN_PLAN_PATH="$plan_path" \
PARSE_PLAN_PRD_PATH="$prd_path" \
PARSE_PLAN_DESIGN_PATH="$design_path" \
PARSE_PLAN_REPO_URL="$REPO_URL" \
python3 <<'PY'
import html
import json
import os
import re
import sys


def err(msg: str) -> None:
    print(msg, file=sys.stderr)


def die(code: int, msg: str) -> None:
    err(msg)
    sys.exit(code)


SLUG = os.environ["PARSE_PLAN_FEATURE_SLUG"]
PLAN_PATH = os.environ["PARSE_PLAN_PLAN_PATH"]
PRD_PATH = os.environ["PARSE_PLAN_PRD_PATH"]
DESIGN_PATH = os.environ["PARSE_PLAN_DESIGN_PATH"]
REPO_URL = os.environ["PARSE_PLAN_REPO_URL"]

VALID_TYPE_LABELS = {
    "type:feat",
    "type:fix",
    "type:refactor",
    "type:chore",
    "type:docs",
    "type:test",
}
REQUIRED_FEATURE_LABEL = f"feature:{SLUG}"


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def gh_blob(rel_path: str) -> str:
    return f"{REPO_URL}/blob/main/{rel_path}"


# ---------- markdown helpers ------------------------------------------------

# Heading: `### Chunk <id> — <title>` (em-dash); also accept `--` / `-` so a
# hand-edited plan does not blow up on ASCII fallback.
HEADING_RE = re.compile(r"^### Chunk[ \t]+([A-Za-z0-9_-]+)[ \t]+(?:—|--|-)[ \t]+(.+)$")
H2_RE = re.compile(r"^## ")
YAML_FENCE_OPEN_RE = re.compile(r"^```yaml[ \t]*$")
YAML_FENCE_CLOSE_RE = re.compile(r"^```[ \t]*$")
SECTION_MARKER_RE = re.compile(r"^\*\*([A-Z][A-Za-z ]*)(?:[ \t]*\([^)]*\))?\.\*\*")
ANY_MARKER_RE = re.compile(r"^\*\*")


def split_chunks(lines):
    """Return list of (chunk_id, title, body_lines)."""
    chunks = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        m = HEADING_RE.match(line)
        if not m:
            i += 1
            continue
        chunk_id = m.group(1)
        title = m.group(2).rstrip()
        body = []
        i += 1
        while i < n:
            nxt = lines[i]
            if HEADING_RE.match(nxt) or H2_RE.match(nxt):
                break
            body.append(nxt)
            i += 1
        chunks.append((chunk_id, title, body))
    return chunks


def extract_yaml_block(body_lines, chunk_id):
    in_block = False
    yaml_lines = []
    for line in body_lines:
        if not in_block and YAML_FENCE_OPEN_RE.match(line):
            in_block = True
            continue
        if in_block and YAML_FENCE_CLOSE_RE.match(line):
            return yaml_lines
        if in_block:
            yaml_lines.append(line)
    die(2, f"parse-plan.sh: chunk '{chunk_id}' missing YAML metadata block")
    return []  # unreachable


def parse_scalar(line):
    """Trim leading/trailing whitespace and optional quotes."""
    s = line.strip()
    if (s.startswith('"') and s.endswith('"')) or (
        s.startswith("'") and s.endswith("'")
    ):
        s = s[1:-1]
    return s


def parse_yaml_block(yaml_lines, chunk_id):
    """Return (id, depends_on, labels). Supports the two forms /plan emits.

    Note: this is not a full YAML parser. The /plan template is fixed; we
    accept exactly the keys it produces in either of the two list forms.
    """
    out = {"id": None, "depends_on": [], "labels": []}
    i = 0
    n = len(yaml_lines)
    while i < n:
        line = yaml_lines[i]
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$", line)
        if not m:
            i += 1
            continue
        key, rest = m.group(1), m.group(2)
        if key == "id":
            out["id"] = parse_scalar(rest)
            i += 1
            continue
        if key == "depends_on":
            rest_stripped = rest.strip()
            if rest_stripped.startswith("[") and rest_stripped.endswith("]"):
                inner = rest_stripped[1:-1].strip()
                if inner:
                    out["depends_on"] = [
                        parse_scalar(part) for part in inner.split(",")
                        if parse_scalar(part)
                    ]
                i += 1
                continue
            if rest_stripped:
                out["depends_on"] = [parse_scalar(rest_stripped)]
                i += 1
                continue
            # Multi-line list form.
            j = i + 1
            collected = []
            while j < n:
                lst = yaml_lines[j]
                m2 = re.match(r"^\s+-\s+(.*)$", lst)
                if not m2:
                    if not lst.strip():
                        j += 1
                        continue
                    break
                collected.append(parse_scalar(m2.group(1)))
                j += 1
            out["depends_on"] = [c for c in collected if c]
            i = j
            continue
        if key == "labels":
            j = i + 1
            collected = []
            while j < n:
                lst = yaml_lines[j]
                m2 = re.match(r"^\s+-\s+(.*)$", lst)
                if not m2:
                    if not lst.strip():
                        j += 1
                        continue
                    break
                collected.append(parse_scalar(m2.group(1)))
                j += 1
            out["labels"] = [c for c in collected if c]
            i = j
            continue
        # Unknown key — skip line, do not fail (forward-compat with extra
        # metadata that /plan may emit later).
        i += 1
    if not out["labels"]:
        die(2, f"parse-plan.sh: chunk '{chunk_id}' missing labels in yaml block")
    return out


def extract_section(body_lines, keyword):
    """Return the text of the **<keyword>(<optional ...>).** section.

    Body runs from the marker line (with the marker stripped) until the next
    `**...**` marker at column 0 or `### ` heading or end of body.
    """
    marker_re = re.compile(
        r"^\*\*" + re.escape(keyword) + r"(?:[ \t]*\([^)]*\))?\.\*\*[ \t]*"
    )
    out = []
    in_block = False
    for line in body_lines:
        if not in_block:
            m = marker_re.match(line)
            if m:
                in_block = True
                tail = line[m.end():]
                if tail.strip():
                    out.append(tail)
            continue
        if line.startswith("### "):
            break
        # Stop at the next bold-section marker (not a mid-paragraph `**`).
        m_next = SECTION_MARKER_RE.match(line)
        if m_next and m_next.group(1) != keyword:
            break
        out.append(line)
    return "\n".join(out).strip("\n")


def collapse_paragraph(text):
    lines = [line.strip() for line in text.splitlines()]
    return " ".join(line for line in lines if line)


def list_bullets(text):
    items = []
    for line in text.splitlines():
        m = re.match(r"^\s*-\s+(.*)$", line)
        if m:
            items.append(m.group(1).rstrip())
    return items


def list_checkbox_items(text):
    items = []
    for line in text.splitlines():
        m = re.match(r"^\s*-\s+\[[ xX]\]\s+(.*)$", line)
        if m:
            items.append(m.group(1).rstrip())
    return items


# ---------- read PRD (optional) --------------------------------------------

epic_name = SLUG
epic_goal = ""
scope_in = []
scope_out = []

if os.path.isfile(PRD_PATH):
    with open(PRD_PATH, encoding="utf-8") as fh:
        prd_lines = fh.read().splitlines()
    for line in prd_lines:
        if line.startswith("# "):
            epic_name = line[2:].strip()
            break
    # Goal: the H2 named "Goal" (case-insensitive).
    in_goal = False
    acc = []
    for line in prd_lines:
        if not in_goal and re.match(r"^##\s+[Gg]oal\s*$", line):
            in_goal = True
            continue
        if in_goal:
            if re.match(r"^##\s+", line):
                break
            if line.strip() == "" and acc:
                # Blank line after some content closes the paragraph.
                break
            if line.strip():
                acc.append(line.strip())
    epic_goal = " ".join(acc)
    # Scope: bullets under H3 "In" / "Out" inside H2 "Scope".
    in_scope = False
    in_in = False
    in_out = False
    for line in prd_lines:
        if re.match(r"^##\s+[Ss]cope\s*$", line):
            in_scope = True
            in_in = in_out = False
            continue
        if in_scope and re.match(r"^##\s+", line):
            in_scope = False
            in_in = in_out = False
            continue
        if not in_scope:
            continue
        if re.match(r"^###?\s+[Ii]n\s*$", line):
            in_in, in_out = True, False
            continue
        if re.match(r"^###?\s+[Oo]ut\s*$", line):
            in_in, in_out = False, True
            continue
        if re.match(r"^###?\s+", line):
            in_in = in_out = False
            continue
        m = re.match(r"^\s*-\s+(.+?)\s*$", line)
        if not m:
            continue
        if in_in:
            scope_in.append(m.group(1))
        elif in_out:
            scope_out.append(m.group(1))

design_present = os.path.isfile(DESIGN_PATH)

# ---------- read plan ------------------------------------------------------

with open(PLAN_PATH, encoding="utf-8") as fh:
    plan_lines = fh.read().splitlines()

chunks_raw = split_chunks(plan_lines)
if not chunks_raw:
    die(2, f"parse-plan.sh: no '### Chunk <id> — <title>' blocks found in '{PLAN_PATH}'")

parsed_chunks = []
seen_ids = set()
for chunk_id, title, body in chunks_raw:
    if chunk_id in seen_ids:
        die(2, f"parse-plan.sh: duplicate chunk id '{chunk_id}' in plan")
    seen_ids.add(chunk_id)

    yaml_lines = extract_yaml_block(body, chunk_id)
    yaml_data = parse_yaml_block(yaml_lines, chunk_id)
    if yaml_data["id"] and yaml_data["id"] != chunk_id:
        die(
            2,
            f"parse-plan.sh: chunk '{chunk_id}' yaml id '{yaml_data['id']}' does not match heading",
        )

    # Body after the yaml fence is the section pool.
    post_yaml = []
    in_yaml = False
    after = False
    for line in body:
        if not in_yaml and not after and YAML_FENCE_OPEN_RE.match(line):
            in_yaml = True
            continue
        if in_yaml and YAML_FENCE_CLOSE_RE.match(line):
            in_yaml = False
            after = True
            continue
        if in_yaml:
            continue
        if after:
            post_yaml.append(line)

    goal_text = extract_section(post_yaml, "Goal")
    files_text = extract_section(post_yaml, "Files")
    ac_text = extract_section(post_yaml, "Acceptance criteria")

    if not goal_text.strip():
        die(2, f"parse-plan.sh: chunk '{chunk_id}' missing required section '**Goal.**'")
    if not files_text.strip():
        die(2, f"parse-plan.sh: chunk '{chunk_id}' missing required section '**Files.**'")
    if not ac_text.strip():
        die(
            2,
            f"parse-plan.sh: chunk '{chunk_id}' missing required section '**Acceptance criteria.**'",
        )

    goal = collapse_paragraph(goal_text)
    files = list_bullets(files_text)
    ac = list_checkbox_items(ac_text)
    if not ac:
        die(
            2,
            f"parse-plan.sh: chunk '{chunk_id}' '**Acceptance criteria.**' has no '- [ ]' bullets",
        )

    parsed_chunks.append(
        {
            "id": chunk_id,
            "title": title,
            "depends_on": yaml_data["depends_on"],
            "labels": yaml_data["labels"],
            "goal": goal,
            "files": files,
            "acceptance_criteria": ac,
        }
    )

# ---------- DAG validation -------------------------------------------------

id_set = {c["id"] for c in parsed_chunks}
adj = {c["id"]: c["depends_on"] for c in parsed_chunks}

for c in parsed_chunks:
    for dep in c["depends_on"]:
        if dep not in id_set:
            die(
                3,
                f"parse-plan.sh: chunk '{c['id']}' depends_on '{dep}' which is not a known chunk id",
            )

# Three-colour DFS.
WHITE, GRAY, BLACK = 0, 1, 2
color = {cid: WHITE for cid in id_set}
path = []


def dfs(node):
    color[node] = GRAY
    path.append(node)
    for dep in adj.get(node, []):
        c = color.get(dep, WHITE)
        if c == GRAY:
            # Trim path to start of cycle for a clearer message.
            try:
                start = path.index(dep)
                cycle = path[start:] + [dep]
            except ValueError:
                cycle = path + [dep]
            die(3, "parse-plan.sh: DAG cycle detected: " + " -> ".join(cycle))
        if c == WHITE:
            dfs(dep)
    color[node] = BLACK
    path.pop()


for cid in [c["id"] for c in parsed_chunks]:
    if color[cid] == WHITE:
        dfs(cid)

# ---------- label validation -----------------------------------------------

for c in parsed_chunks:
    type_labels = [lbl for lbl in c["labels"] if lbl.startswith("type:")]
    feature_match = REQUIRED_FEATURE_LABEL in c["labels"]
    if len(type_labels) == 0:
        die(3, f"parse-plan.sh: chunk '{c['id']}' missing required 'type:*' label")
    if len(type_labels) > 1:
        die(
            3,
            f"parse-plan.sh: chunk '{c['id']}' has {len(type_labels)} 'type:*' labels; expected exactly one",
        )
    if type_labels[0] not in VALID_TYPE_LABELS:
        die(
            3,
            f"parse-plan.sh: chunk '{c['id']}' has invalid type label '{type_labels[0]}'; expected one of {sorted(VALID_TYPE_LABELS)}",
        )
    if not feature_match:
        die(
            3,
            f"parse-plan.sh: chunk '{c['id']}' missing required '{REQUIRED_FEATURE_LABEL}' label",
        )

# ---------- render Epic description_html -----------------------------------


def bullets_html(items):
    if not items:
        return "<ul><li><em>(none)</em></li></ul>"
    return "<ul>" + "".join(f"<li>{esc(it)}</li>" for it in items) + "</ul>"


def render_epic_html():
    parts = []
    parts.append("<h2>Source documents</h2>")
    parts.append("<ul>")
    prd_rel = f"docs/product/{SLUG}.md"
    plan_rel = f"docs/plans/{SLUG}.md"
    parts.append(
        f'<li>PRD: <a href="{esc(gh_blob(prd_rel))}">{esc(prd_rel)}</a></li>'
    )
    if design_present:
        design_rel = f"docs/designs/{SLUG}.md"
        parts.append(
            f'<li>Design: <a href="{esc(gh_blob(design_rel))}">{esc(design_rel)}</a></li>'
        )
    parts.append(
        f'<li>Plan: <a href="{esc(gh_blob(plan_rel))}">{esc(plan_rel)}</a></li>'
    )
    parts.append(f"<li>Feature slug: <code>{esc(SLUG)}</code></li>")
    parts.append("</ul>")
    parts.append("<h2>Goal</h2>")
    if epic_goal.strip():
        parts.append(f"<p>{esc(epic_goal.strip())}</p>")
    else:
        parts.append("<p><em>(PRD goal not available — see plan)</em></p>")
    parts.append("<h2>Scope</h2>")
    parts.append("<p><strong>In:</strong></p>")
    parts.append(bullets_html(scope_in))
    parts.append("<p><strong>Out:</strong></p>")
    parts.append(bullets_html(scope_out))
    return "".join(parts)


def gh_anchor(text):
    out_chars = []
    for ch in text.lower():
        if ch.isalnum() or ch in (" ", "-"):
            out_chars.append(ch)
    s = "".join(out_chars).strip().replace(" ", "-")
    while "--" in s:
        s = s.replace("--", "-")
    return s


def render_wi_html(chunk):
    cid = chunk["id"]
    heading = f"chunk {cid}"
    anchor = gh_anchor(heading)
    plan_rel = f"docs/plans/{SLUG}.md"
    plan_url = f"{gh_blob(plan_rel)}#{anchor}"
    parts = []
    parts.append("<h2>Plan reference</h2>")
    parts.append("<ul>")
    parts.append(
        f'<li>Plan section: <a href="{esc(plan_url)}">{esc(plan_rel)}#{esc(anchor)}</a></li>'
    )
    parts.append(f"<li>Chunk id: <code>{esc(cid)}</code></li>")
    parts.append(f"<li>Feature: <code>{esc(SLUG)}</code></li>")
    parts.append("<li>Parent Epic: see Plane sidebar</li>")
    parts.append("</ul>")
    parts.append("<h2>Goal</h2>")
    if chunk["goal"].strip():
        parts.append(f"<p>{esc(chunk['goal'].strip())}</p>")
    else:
        parts.append("<p><em>(no goal text)</em></p>")
    parts.append("<h2>Acceptance criteria</h2>")
    if chunk["acceptance_criteria"]:
        parts.append("<ul>")
        for ac in chunk["acceptance_criteria"]:
            parts.append(f"<li>[ ] {esc(ac)}</li>")
        parts.append("</ul>")
    else:
        parts.append("<p><em>(none — see plan)</em></p>")
    if chunk["files"]:
        parts.append("<h2>Files (expected)</h2>")
        parts.append("<ul>")
        for f in chunk["files"]:
            parts.append(f"<li>{esc(f)}</li>")
        parts.append("</ul>")
    return "".join(parts)


epic_obj = {
    "name": epic_name,
    "description_html": render_epic_html(),
    "external_id": f"gjs:epic:{SLUG}",
    "labels": [REQUIRED_FEATURE_LABEL],
}

chunk_objs = []
for c in parsed_chunks:
    chunk_objs.append(
        {
            "id": c["id"],
            "title": c["title"],
            "depends_on": c["depends_on"],
            "labels": c["labels"],
            "goal": c["goal"],
            "files": c["files"],
            "acceptance_criteria": c["acceptance_criteria"],
            "name": c["title"],
            "description_html": render_wi_html(c),
            "external_id": f"gjs:wi:{SLUG}:{c['id']}",
        }
    )

# Stdout: single JSON document, single trailing newline.
sys.stdout.write(json.dumps({"epic": epic_obj, "chunks": chunk_objs}, indent=2))
sys.stdout.write("\n")
PY
