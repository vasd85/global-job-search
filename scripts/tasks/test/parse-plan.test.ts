/**
 * Tests for `scripts/tasks/parse-plan.sh`.
 *
 * Strategy (matches GJS-21 test-scenarios.md):
 *   1. Each test mkdtemps a fresh repo, `git init` + initial empty commit.
 *   2. Plan / PRD / design fixtures are synthesised inline via the local
 *      `chunkBlock` / `synthHappyPlan` / `synthHappyPrd` builders.
 *   3. We spawn `bash <script> <slug>` with cwd = the tmp repo and assert on
 *      exit code, stdout (JSON-only on success, empty on failure), and stderr
 *      (single-line diagnostic).
 *
 * The script uses bash 4+ features. On macOS the default `/bin/bash` is 3.2;
 * we resolve a 4+ bash via the same candidate list as
 * scripts/episode/test/auto-extract.test.ts and skip the suite with a clear
 * message if absent.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

// scripts/tasks/test/parse-plan.test.ts → scripts/tasks/parse-plan.sh
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, "..", "parse-plan.sh");
const FIXTURE_DIR = path.resolve(__dirname, "fixtures");

// Resolve a bash 4+ binary. macOS ships /bin/bash 3.2 which lacks `declare -A`
// and BASH_VERSINFO semantics the script relies on. Homebrew installs at
// /opt/homebrew/bin/bash on Apple Silicon and /usr/local/bin/bash on Intel.
function resolveBashBin(): string | null {
  const candidates = [
    "/opt/homebrew/bin/bash",
    "/usr/local/bin/bash",
    "/usr/bin/bash",
    "/bin/bash",
  ];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-c", 'printf "%s" "$BASH_VERSION"'], {
      encoding: "utf-8",
    });
    if (probe.status === 0 && probe.stdout) {
      const major = Number.parseInt(probe.stdout.split(".")[0] ?? "0", 10);
      if (major >= 4) {
        return candidate;
      }
    }
  }
  return null;
}

const BASH_BIN = resolveBashBin();

beforeAll(() => {
  if (!BASH_BIN) {
    throw new Error(
      "parse-plan.sh tests require bash >= 4. Install via `brew install bash`.",
    );
  }
});

// -------- helpers ----------------------------------------------------------

type SpawnResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

type ParsedPlan = {
  epic: {
    name: string;
    description_html: string;
    external_id: string;
    labels: string[];
  };
  chunks: {
    id: string;
    title: string;
    depends_on: string[];
    labels: string[];
    goal: string;
    files: string[];
    acceptance_criteria: string[];
    name: string;
    description_html: string;
    external_id: string;
  }[];
};

function spawnInRepo(repo: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf-8" });
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${r.stderr || r.stdout || ""}`,
    );
  }
}

function makeTmpRepo(): string {
  // realpath: on macOS `os.tmpdir()` is `/var/folders/...` whose canonical
  // path is `/private/var/...`. parse-plan.sh does `cd $(git rev-parse
  // --show-toplevel)` which always returns the canonical path. Use realpath
  // here for symmetry with auto-extract.test.ts.
  const raw = mkdtempSync(path.join(os.tmpdir(), "pp-"));
  const repo = realpathSync(raw);
  spawnInRepo(repo, ["init", "-q"]);
  spawnInRepo(repo, ["config", "user.email", "test@example.com"]);
  spawnInRepo(repo, ["config", "user.name", "Test"]);
  spawnInRepo(repo, ["commit", "--allow-empty", "-q", "-m", "init"]);
  return repo;
}

function writeFiles(repo: string, files: Record<string, string>): void {
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(repo, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
}

function runScript(
  repo: string,
  args: string[],
  bashBinOverride?: string,
): SpawnResult {
  const bash = bashBinOverride ?? BASH_BIN;
  if (!bash) throw new Error("BASH_BIN unresolved");
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
  };
  const r = spawnSync(bash, [SCRIPT_PATH, ...args], {
    cwd: repo,
    env,
    encoding: "utf-8",
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function parseJson(stdout: string): ParsedPlan {
  try {
    return JSON.parse(stdout) as ParsedPlan;
  } catch (e) {
    throw new Error(
      `stdout is not valid JSON: ${
        e instanceof Error ? e.message : String(e)
      }\n--- stdout ---\n${stdout}`,
    );
  }
}

// -------- fixture builders -------------------------------------------------

type ChunkSpec = {
  id: string;
  title: string;
  dependsOnLine: string;
  labels: string[];
  goal: string;
  files: string[];
  ac: string[];
  /** Set to omit the corresponding marker entirely (negative-path tests). */
  omit?: ("Goal" | "Files" | "Acceptance criteria")[];
};

function chunkBlock(opts: ChunkSpec): string {
  const labelLines = opts.labels.map((l) => `  - ${l}`).join("\n");
  const lines: string[] = [];
  lines.push(`### Chunk ${opts.id} — ${opts.title}`);
  lines.push("");
  lines.push("```yaml");
  lines.push(`id: ${opts.id}`);
  lines.push(opts.dependsOnLine);
  lines.push("labels:");
  lines.push(labelLines);
  lines.push("```");
  lines.push("");
  const omit = opts.omit ?? [];
  if (!omit.includes("Goal")) {
    lines.push(`**Goal.** ${opts.goal}`);
    lines.push("");
  }
  if (!omit.includes("Files")) {
    lines.push("**Files.**");
    for (const f of opts.files) {
      lines.push(`- ${f}`);
    }
    lines.push("");
  }
  if (!omit.includes("Acceptance criteria")) {
    lines.push("**Acceptance criteria.**");
    for (const a of opts.ac) {
      lines.push(`- [ ] ${a}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function synthHappyPlan(opts: {
  title?: string;
  chunks: ChunkSpec[];
}): string {
  const title = opts.title ?? "Synthetic plan";
  const blocks = opts.chunks.map((c) => chunkBlock(c));
  return `# ${title}\n\n## 5. Chunks\n\n${blocks.join("\n")}`;
}

function synthHappyPrd(opts: {
  title: string;
  goal: string;
  inBullets: string[];
  outBullets: string[];
}): string {
  const lines: string[] = [];
  lines.push(`# ${opts.title}`);
  lines.push("");
  lines.push("## Goal");
  lines.push("");
  lines.push(opts.goal);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push("### In");
  for (const b of opts.inBullets) {
    lines.push(`- ${b}`);
  }
  if (opts.inBullets.length === 0) lines.push("");
  lines.push("");
  lines.push("### Out");
  for (const b of opts.outBullets) {
    lines.push(`- ${b}`);
  }
  return lines.join("\n");
}

/** Minimal canonical happy-path chunk shape used by many tests. */
function minimalChunk(
  id: string,
  title: string,
  slug: string,
  dependsOnLine = "depends_on: []",
): ChunkSpec {
  return {
    id,
    title,
    dependsOnLine,
    labels: ["type:feat", `feature:${slug}`],
    goal: `Goal for ${id}.`,
    files: [`src/${id}.ts`],
    ac: [`${id} passes`],
  };
}

// -------- byte-exact expected HTML (S10, S11) -----------------------------

const S10_EXPECTED_EPIC_HTML =
  '<h2>Source documents</h2>' +
  '<ul>' +
  '<li>PRD: <a href="https://github.com/vasd85/global-job-search/blob/main/docs/product/template-test.md">docs/product/template-test.md</a></li>' +
  '<li>Design: <a href="https://github.com/vasd85/global-job-search/blob/main/docs/designs/template-test.md">docs/designs/template-test.md</a></li>' +
  '<li>Plan: <a href="https://github.com/vasd85/global-job-search/blob/main/docs/plans/template-test.md">docs/plans/template-test.md</a></li>' +
  '<li>Feature slug: <code>template-test</code></li>' +
  '</ul>' +
  '<h2>Goal</h2><p>epic goal text</p>' +
  '<h2>Scope</h2>' +
  '<p><strong>In:</strong></p><ul><li>ship</li></ul>' +
  '<p><strong>Out:</strong></p><ul><li>gold-plating</li></ul>';

const S11_EXPECTED_CHUNK_HTML =
  '<h2>Plan reference</h2>' +
  '<ul>' +
  '<li>Plan section: <a href="https://github.com/vasd85/global-job-search/blob/main/docs/plans/wi-template-test.md#chunk-chunky">docs/plans/wi-template-test.md#chunk-chunky</a></li>' +
  '<li>Chunk id: <code>chunky</code></li>' +
  '<li>Feature: <code>wi-template-test</code></li>' +
  '<li>Parent Epic: see Plane sidebar</li>' +
  '</ul>' +
  '<h2>Goal</h2><p>chunky goal</p>' +
  '<h2>Acceptance criteria</h2><ul><li>[ ] first ac</li><li>[ ] second ac</li></ul>' +
  '<h2>Files (expected)</h2><ul><li>src/a.ts</li><li>src/b.ts</li></ul>';

// -------- test scaffolding (per-test cleanup) ------------------------------

let repo: string | null = null;

afterEach(() => {
  if (repo !== null) {
    rmSync(repo, { recursive: true, force: true });
    repo = null;
  }
});

// =========================================================================
// Happy paths (Scenarios 1–9)
// =========================================================================

describe("parse-plan.sh — happy paths", () => {
  // S1: minimal canonical plan with PRD
  test("S1 emits a JSON document with epic and one chunk for a minimal canonical plan", () => {
    repo = makeTmpRepo();
    const plan = synthHappyPlan({
      title: "Happy plan",
      chunks: [
        {
          id: "first",
          title: "Land the foundation",
          dependsOnLine: "depends_on: []",
          labels: ["type:feat", "feature:happy"],
          goal: "Single-sentence goal.",
          files: ["src/foo.ts"],
          ac: ["foo compiles"],
        },
      ],
    });
    const prd = synthHappyPrd({
      title: "Happy Feature",
      goal: "A one-paragraph elevator pitch.",
      inBullets: ["shipping the thing"],
      outBullets: ["gold-plating"],
    });
    writeFiles(repo, {
      "docs/plans/happy.md": plan,
      "docs/product/happy.md": prd,
    });
    const { status, stdout, stderr } = runScript(repo, ["happy"]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    expect(out.epic.name).toBe("Happy Feature");
    expect(out.epic.external_id).toBe("gjs:epic:happy");
    expect(out.epic.labels).toEqual(["feature:happy"]);
    expect(typeof out.epic.description_html).toBe("string");
    expect(out.epic.description_html.length).toBeGreaterThan(0);
    expect(out.chunks.length).toBe(1);
    const c0 = out.chunks[0]!;
    expect(c0.id).toBe("first");
    expect(c0.title).toBe("Land the foundation");
    // WI name = chunk title (per tasks.md § 3, not the goal's first paragraph).
    expect(c0.name).toBe("Land the foundation");
    expect(c0.external_id).toBe("gjs:wi:happy:first");
    expect(c0.depends_on).toEqual([]);
    expect(c0.labels).toEqual(["type:feat", "feature:happy"]);
    expect(c0.goal).toBe("Single-sentence goal.");
    expect(c0.files).toEqual(["src/foo.ts"]);
    expect(c0.acceptance_criteria).toEqual(["foo compiles"]);
  });

  // S2: multi-chunk DAG; order preserved, depends_on resolved across forms
  test("S2 preserves declaration order across three chunks with mixed depends_on forms", () => {
    repo = makeTmpRepo();
    const plan = synthHappyPlan({
      chunks: [
        minimalChunk("a", "Alpha", "multi"),
        {
          ...minimalChunk("b", "Beta", "multi"),
          // multi-line list form
          dependsOnLine: "depends_on:\n  - a",
        },
        {
          ...minimalChunk("c", "Gamma", "multi"),
          // inline list form
          dependsOnLine: "depends_on: [a, b]",
        },
      ],
    });
    const prd = synthHappyPrd({
      title: "Multi Feature",
      goal: "Multi-chunk feature.",
      inBullets: ["a"],
      outBullets: ["b"],
    });
    writeFiles(repo, {
      "docs/plans/multi.md": plan,
      "docs/product/multi.md": prd,
    });
    const { status, stdout, stderr } = runScript(repo, ["multi"]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    expect(out.chunks.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(out.chunks[1]!.depends_on).toEqual(["a"]);
    expect(out.chunks[2]!.depends_on).toEqual(["a", "b"]);
  });

  // S3: `depends_on: []` empty inline form
  test("S3 parses depends_on: [] as an empty array (not null, not [''])", () => {
    repo = makeTmpRepo();
    const plan = synthHappyPlan({
      chunks: [minimalChunk("only", "Only chunk", "empty-deps")],
    });
    writeFiles(repo, { "docs/plans/empty-deps.md": plan });
    const { status, stdout, stderr } = runScript(repo, ["empty-deps"]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    // Round-trips through JSON.parse as an empty array exactly.
    expect(stdout).toContain('"depends_on": []');
    const out = parseJson(stdout);
    expect(out.chunks[0]!.depends_on).toEqual([]);
    expect(Array.isArray(out.chunks[0]!.depends_on)).toBe(true);
  });

  // S4: `depends_on: [first]` single-item inline form
  test("S4 parses depends_on: [first] as a one-element array", () => {
    repo = makeTmpRepo();
    const plan = synthHappyPlan({
      chunks: [
        minimalChunk("first", "F", "single-dep"),
        {
          ...minimalChunk("second", "S", "single-dep"),
          dependsOnLine: "depends_on: [first]",
        },
      ],
    });
    writeFiles(repo, { "docs/plans/single-dep.md": plan });
    const { status, stdout, stderr } = runScript(repo, ["single-dep"]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    expect(out.chunks[1]!.depends_on).toEqual(["first"]);
  });

  // S35: `depends_on: first` bare scalar form (no brackets, no dash-list).
  // Forward-compat with /plan emitting the scalar shorthand for a single dep.
  test("S35 parses depends_on: <id> bare scalar form as a one-element array", () => {
    repo = makeTmpRepo();
    const plan = synthHappyPlan({
      chunks: [
        minimalChunk("first", "F", "scalar-dep"),
        {
          ...minimalChunk("second", "S", "scalar-dep"),
          dependsOnLine: "depends_on: first",
        },
      ],
    });
    writeFiles(repo, { "docs/plans/scalar-dep.md": plan });
    const { status, stdout, stderr } = runScript(repo, ["scalar-dep"]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    expect(out.chunks[1]!.depends_on).toEqual(["first"]);
  });

  // S5: multi-line dash list form for depends_on, with blank lines stress.
  test("S5 parses multi-line dash-list depends_on with blank-line spacing", () => {
    repo = makeTmpRepo();
    const plan = synthHappyPlan({
      chunks: [
        minimalChunk("first", "F", "multiline"),
        minimalChunk("second", "S", "multiline"),
        {
          ...minimalChunk("third", "T", "multiline"),
          // Blank line between key and first dash exercises the parser's
          // `if not line.strip(): continue` branch.
          dependsOnLine: "depends_on:\n\n  - first\n\n  - second",
        },
      ],
    });
    writeFiles(repo, { "docs/plans/multiline.md": plan });
    const { status, stdout, stderr } = runScript(repo, ["multiline"]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    expect(out.chunks[2]!.depends_on).toEqual(["first", "second"]);
  });

  // S6: real-shape 6-chunk plan synthesized at a matching slug.
  test("S6 parses a 6-chunk plan with the profile-driven-architecture DAG shape", () => {
    repo = makeTmpRepo();
    const slug = "profile-driven-architecture";
    const ids = [
      "wipe-and-foundation",
      "conversation-runtime",
      "profile-map-ui",
      "l3-widening",
      "results-affordances",
      "location-alignment",
    ];
    const depsByIndex: string[] = [
      "depends_on: []",
      "depends_on: [wipe-and-foundation]",
      "depends_on: [wipe-and-foundation]",
      "depends_on: [wipe-and-foundation]",
      "depends_on: [l3-widening]",
      "depends_on: [profile-map-ui]",
    ];
    const titles = [
      "Drop legacy profile artefacts",
      "Replace step engine with tree-mutating LLM agent",
      "Render the tree as the Profile Map view",
      "Widen L3 schema with per-claim scores",
      "Three results-page affordances + transient L2 overlay",
      "Optional fast-follow: align location-tier shape",
    ];
    const plan = synthHappyPlan({
      title: "Profile-driven architecture",
      chunks: ids.map((id, i) => ({
        ...minimalChunk(id, titles[i]!, slug, depsByIndex[i]!),
      })),
    });
    writeFiles(repo, { [`docs/plans/${slug}.md`]: plan });
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    expect(out.chunks.length).toBe(6);
    expect(out.chunks.map((c) => c.id)).toEqual(ids);
    expect(out.chunks[5]!.external_id).toBe(
      `gjs:wi:${slug}:location-alignment`,
    );
    expect(out.chunks[1]!.depends_on).toEqual(["wipe-and-foundation"]);
    expect(out.chunks[3]!.depends_on).toEqual(["wipe-and-foundation"]);
    expect(out.chunks[4]!.depends_on).toEqual(["l3-widening"]);
    expect(out.chunks[5]!.depends_on).toEqual(["profile-map-ui"]);
  });

  // S7: missing PRD → epic renders with placeholder, helper succeeds (AC#8)
  test("S7 succeeds when PRD is absent and uses placeholder text", () => {
    repo = makeTmpRepo();
    const plan = synthHappyPlan({
      chunks: [minimalChunk("only", "Only chunk", "no-prd")],
    });
    writeFiles(repo, { "docs/plans/no-prd.md": plan });
    const { status, stdout, stderr } = runScript(repo, ["no-prd"]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    expect(out.epic.name).toBe("no-prd"); // slug fallback
    expect(out.epic.description_html).toContain(
      "<em>(PRD goal not available — see plan)</em>",
    );
    expect(out.epic.description_html).not.toContain("<li>Design: ");
    // Both Scope-In and Scope-Out fall back to the bullets_html placeholder.
    const placeholder = "<ul><li><em>(none)</em></li></ul>";
    // Two occurrences (In + Out).
    const matches = out.epic.description_html.split(placeholder).length - 1;
    expect(matches).toBe(2);
  });

  // S8: design file present → epic includes Design row (AC#3)
  test("S8 includes the Design <li> row when docs/designs/<slug>.md exists", () => {
    repo = makeTmpRepo();
    const plan = synthHappyPlan({
      chunks: [minimalChunk("only", "Only chunk", "design-included")],
    });
    const prd = synthHappyPrd({
      title: "With design",
      goal: "g",
      inBullets: ["in"],
      outBullets: ["out"],
    });
    writeFiles(repo, {
      "docs/plans/design-included.md": plan,
      "docs/product/design-included.md": prd,
      "docs/designs/design-included.md": "# Design body\n",
    });
    const { status, stdout, stderr } = runScript(repo, ["design-included"]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    const html = out.epic.description_html;
    expect(html).toContain(
      '<li>Design: <a href="https://github.com/vasd85/global-job-search/blob/main/docs/designs/design-included.md">docs/designs/design-included.md</a></li>',
    );
    // Ordering: PRD → Design → Plan.
    const prdIdx = html.indexOf("<li>PRD: ");
    const designIdx = html.indexOf("<li>Design: ");
    const planIdx = html.indexOf("<li>Plan: ");
    expect(prdIdx).toBeGreaterThanOrEqual(0);
    expect(designIdx).toBeGreaterThan(prdIdx);
    expect(planIdx).toBeGreaterThan(designIdx);
  });

  // S9: design file absent → no Design row, PRD → Plan adjacent.
  test("S9 omits the Design row when docs/designs/<slug>.md is absent", () => {
    repo = makeTmpRepo();
    const plan = synthHappyPlan({
      chunks: [minimalChunk("only", "Only chunk", "no-design")],
    });
    const prd = synthHappyPrd({
      title: "No design",
      goal: "g",
      inBullets: ["in"],
      outBullets: ["out"],
    });
    writeFiles(repo, {
      "docs/plans/no-design.md": plan,
      "docs/product/no-design.md": prd,
    });
    const { status, stdout, stderr } = runScript(repo, ["no-design"]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    const html = out.epic.description_html;
    expect(html).not.toContain("<li>Design:");
    // PRD row ends; Plan row immediately follows (no list item between).
    const prdItem =
      '<li>PRD: <a href="https://github.com/vasd85/global-job-search/blob/main/docs/product/no-design.md">docs/product/no-design.md</a></li>';
    const planItemPrefix = "<li>Plan: ";
    const prdEnd = html.indexOf(prdItem) + prdItem.length;
    expect(html.indexOf(planItemPrefix)).toBe(prdEnd);
  });
});

// =========================================================================
// Description-template fidelity (Scenarios 10–13)
// =========================================================================

describe("parse-plan.sh — description template fidelity", () => {
  // S10: epic description_html byte-conformance.
  test("S10 produces byte-exact epic description_html per tasks.md § 4.1", () => {
    repo = makeTmpRepo();
    const slug = "template-test";
    const plan = synthHappyPlan({
      chunks: [minimalChunk("only", "Only chunk", slug)],
    });
    const prd = synthHappyPrd({
      title: "Templated Epic",
      goal: "epic goal text",
      inBullets: ["ship"],
      outBullets: ["gold-plating"],
    });
    writeFiles(repo, {
      [`docs/plans/${slug}.md`]: plan,
      [`docs/product/${slug}.md`]: prd,
      [`docs/designs/${slug}.md`]: "# Design body\n",
    });
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    expect(out.epic.description_html).toBe(S10_EXPECTED_EPIC_HTML);
  });

  // S11: chunk description_html byte-conformance (with files).
  test("S11 produces byte-exact chunk description_html per tasks.md § 4.2", () => {
    repo = makeTmpRepo();
    const slug = "wi-template-test";
    const plan = synthHappyPlan({
      chunks: [
        {
          id: "chunky",
          title: "Chunky title",
          dependsOnLine: "depends_on: []",
          labels: ["type:feat", `feature:${slug}`],
          goal: "chunky goal",
          files: ["src/a.ts", "src/b.ts"],
          ac: ["first ac", "second ac"],
        },
      ],
    });
    writeFiles(repo, { [`docs/plans/${slug}.md`]: plan });
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    expect(out.chunks[0]!.description_html).toBe(S11_EXPECTED_CHUNK_HTML);
  });

  // S12: SHOULD — push-back: helper rejects empty **Files.** as missing.
  // Verified via smoke test: a Files marker with zero bullets exits 2 with
  // "missing required section '**Files.**'". This contradicts the
  // scenarios-doc "empty list → no <h2>Files</h2>" inference. Per the
  // scenario's push-back note, we flip S12 to a negative-path test.
  // TODO(GJS-21): if the helper is later relaxed to accept zero-bullet
  // Files. (so `files: []` and the `<h2>Files (expected)</h2>` block is
  // omitted), restore this scenario to a positive-path assertion.
  test("S12 rejects an empty **Files.** section as a missing structural section", () => {
    repo = makeTmpRepo();
    const plan = synthHappyPlan({
      chunks: [
        {
          id: "c",
          title: "Empty files",
          dependsOnLine: "depends_on: []",
          labels: ["type:feat", "feature:empty-files"],
          goal: "Goal.",
          files: [], // marker rendered, zero bullets
          ac: ["passes"],
        },
      ],
    });
    writeFiles(repo, { "docs/plans/empty-files.md": plan });
    const { status, stdout, stderr } = runScript(repo, ["empty-files"]);
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /^parse-plan\.sh: chunk 'c' missing required section '\*\*Files\.\*\*'\n?$/,
    );
  });

  // S13: HTML escaping (quote=False) — `<`/`>`/`&` escape, `"` does NOT.
  test("S13 escapes <script> and & in goal text via html.escape(quote=False)", () => {
    repo = makeTmpRepo();
    const goal = 'We need to <script>alert("xss")</script> and use & in copy.';
    const plan = synthHappyPlan({
      chunks: [
        {
          id: "xss",
          title: "Escape test",
          dependsOnLine: "depends_on: []",
          labels: ["type:feat", "feature:xss-test"],
          goal,
          files: ["src/a.ts"],
          ac: ["passes"],
        },
      ],
    });
    writeFiles(repo, { "docs/plans/xss-test.md": plan });
    const { status, stdout, stderr } = runScript(repo, ["xss-test"]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    // Parsed goal is the raw text verbatim (JSON-decoded by JSON.parse).
    expect(out.chunks[0]!.goal).toBe(goal);
    // description_html escapes <, >, & but NOT " (quote=False).
    expect(out.chunks[0]!.description_html).toContain(
      '&lt;script&gt;alert("xss")&lt;/script&gt; and use &amp; in copy.',
    );
    // Never a literal <script> tag (would prove an escape was skipped).
    expect(out.chunks[0]!.description_html).not.toContain(
      "<script>alert",
    );
  });
});

// =========================================================================
// Negative paths (Scenarios 14–28)
// =========================================================================

describe("parse-plan.sh — negative paths", () => {
  // S14: 2-chunk DAG cycle (existing fixture).
  test("S14 exits 3 with named cycle path for a 2-chunk cycle fixture", () => {
    repo = makeTmpRepo();
    const slug = "cycle-fixture";
    mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
    cpSync(
      path.join(FIXTURE_DIR, "cycle.md"),
      path.join(repo, "docs", "plans", `${slug}.md`),
    );
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(3);
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /^parse-plan\.sh: DAG cycle detected: (a -> b -> a|b -> a -> b)\n?$/,
    );
  });

  // S15: 3-chunk DAG cycle prints a path with at least four nodes.
  test("S15 emits a 3-node cycle path with >= 3 arrows for a 3-cycle", () => {
    repo = makeTmpRepo();
    const slug = "cycle3";
    const plan = synthHappyPlan({
      chunks: [
        {
          ...minimalChunk("a", "A", slug),
          dependsOnLine: "depends_on: [c]",
          labels: ["type:chore", `feature:${slug}`],
        },
        {
          ...minimalChunk("b", "B", slug),
          dependsOnLine: "depends_on: [a]",
          labels: ["type:chore", `feature:${slug}`],
        },
        {
          ...minimalChunk("c", "C", slug),
          dependsOnLine: "depends_on: [b]",
          labels: ["type:chore", `feature:${slug}`],
        },
      ],
    });
    writeFiles(repo, { [`docs/plans/${slug}.md`]: plan });
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(3);
    expect(stdout).toBe("");
    // At least three ` -> ` separators and a trailing node.
    expect(stderr).toMatch(/DAG cycle detected: (\S+\s->\s){3,}\S+/);
  });

  // S16: unknown depends_on id.
  test("S16 exits 3 when depends_on references an unknown chunk id", () => {
    repo = makeTmpRepo();
    const slug = "unknown-dep";
    const plan = synthHappyPlan({
      chunks: [
        minimalChunk("first", "F", slug),
        {
          ...minimalChunk("second", "S", slug),
          dependsOnLine: "depends_on: [does-not-exist]",
        },
      ],
    });
    writeFiles(repo, { [`docs/plans/${slug}.md`]: plan });
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(3);
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /^parse-plan\.sh: chunk 'second' depends_on 'does-not-exist' which is not a known chunk id\n?$/,
    );
  });

  // S17: missing type:* label (existing fixture).
  test("S17 exits 3 when a chunk has no type:* label (uses fixture)", () => {
    repo = makeTmpRepo();
    const slug = "missing-label-fixture";
    mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
    cpSync(
      path.join(FIXTURE_DIR, "missing-label.md"),
      path.join(repo, "docs", "plans", `${slug}.md`),
    );
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(3);
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /^parse-plan\.sh: chunk 'lone' missing required 'type:\*' label\n?$/,
    );
  });

  // S18: two type:* labels on one chunk.
  test("S18 exits 3 when a chunk has two type:* labels", () => {
    repo = makeTmpRepo();
    const slug = "two-type";
    const plan = synthHappyPlan({
      chunks: [
        {
          ...minimalChunk("somechunk", "Title", slug),
          labels: ["type:feat", "type:fix", `feature:${slug}`],
        },
      ],
    });
    writeFiles(repo, { [`docs/plans/${slug}.md`]: plan });
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(3);
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /^parse-plan\.sh: chunk 'somechunk' has 2 'type:\*' labels; expected exactly one\n?$/,
    );
  });

  // S19: missing feature:<slug> label.
  test("S19 exits 3 when the feature:<slug> label is absent entirely", () => {
    repo = makeTmpRepo();
    const slug = "feature-missing";
    const plan = synthHappyPlan({
      chunks: [
        {
          ...minimalChunk("only", "Only chunk", slug),
          labels: ["type:feat"], // no feature:* label
        },
      ],
    });
    writeFiles(repo, { [`docs/plans/${slug}.md`]: plan });
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(3);
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /^parse-plan\.sh: chunk '\S+' missing required 'feature:feature-missing' label\n?$/,
    );
  });

  // S20: wrong feature:<other-slug> label.
  test("S20 exits 3 when feature:<other-slug> mismatches the invocation slug", () => {
    repo = makeTmpRepo();
    const slug = "wrong-feature";
    const plan = synthHappyPlan({
      chunks: [
        {
          ...minimalChunk("only", "Only chunk", slug),
          labels: ["type:feat", "feature:something-different"],
        },
      ],
    });
    writeFiles(repo, { [`docs/plans/${slug}.md`]: plan });
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(3);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/missing required 'feature:wrong-feature' label/);
  });

  // S21: type:invalid outside vocabulary.
  test("S21 exits 3 when type:* label is not in the architecture vocabulary", () => {
    repo = makeTmpRepo();
    const slug = "bad-type";
    const plan = synthHappyPlan({
      chunks: [
        {
          ...minimalChunk("only", "Only chunk", slug),
          labels: ["type:invalid", `feature:${slug}`],
        },
      ],
    });
    writeFiles(repo, { [`docs/plans/${slug}.md`]: plan });
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(3);
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /^parse-plan\.sh: chunk '\S+' has invalid type label 'type:invalid'; expected one of \[.*'type:chore'.*'type:docs'.*'type:feat'.*'type:fix'.*'type:refactor'.*'type:test'.*\]\n?$/,
    );
  });

  // S22: missing **Goal.** marker.
  test("S22 exits 2 when **Goal.** is missing", () => {
    repo = makeTmpRepo();
    const slug = "no-goal";
    const plan = synthHappyPlan({
      chunks: [
        {
          ...minimalChunk("x", "Title", slug),
          omit: ["Goal"],
        },
      ],
    });
    writeFiles(repo, { [`docs/plans/${slug}.md`]: plan });
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /^parse-plan\.sh: chunk '\S+' missing required section '\*\*Goal\.\*\*'\n?$/,
    );
  });

  // S23: missing **Files.** marker (existing fixture).
  test("S23 exits 2 when **Files.** is missing (uses fixture)", () => {
    repo = makeTmpRepo();
    const slug = "missing-section-fixture";
    mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
    cpSync(
      path.join(FIXTURE_DIR, "missing-section.md"),
      path.join(repo, "docs", "plans", `${slug}.md`),
    );
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /^parse-plan\.sh: chunk 'no-files' missing required section '\*\*Files\.\*\*'\n?$/,
    );
  });

  // S24: missing **Acceptance criteria.** marker.
  test("S24 exits 2 when **Acceptance criteria.** is missing", () => {
    repo = makeTmpRepo();
    const slug = "no-ac";
    const plan = synthHappyPlan({
      chunks: [
        {
          ...minimalChunk("x", "Title", slug),
          omit: ["Acceptance criteria"],
        },
      ],
    });
    writeFiles(repo, { [`docs/plans/${slug}.md`]: plan });
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /missing required section '\*\*Acceptance criteria\.\*\*'/,
    );
  });

  // S25: plan file does not exist.
  test("S25 exits 1 with the missing-plan diagnostic naming the path", () => {
    repo = makeTmpRepo();
    const { status, stdout, stderr } = runScript(repo, ["missing-plan"]);
    expect(status).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /^parse-plan\.sh: plan not found at 'docs\/plans\/missing-plan\.md'\n?$/,
    );
  });

  // S26: wrong arg count (zero or two).
  test.each<[string, string[]]>([
    ["zero args", []],
    ["two args", ["a", "b"]],
  ])("S26 exits 1 with usage line for %s", (_label, args) => {
    repo = makeTmpRepo();
    const { status, stdout, stderr } = runScript(repo, args);
    expect(status).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /^parse-plan\.sh: exactly one positional argument required: <feature-slug>\n?$/,
    );
  });

  // S27: plan with zero chunk headings.
  test("S27 exits 2 with a clear diagnostic when no '### Chunk' blocks are found", () => {
    repo = makeTmpRepo();
    writeFiles(repo, {
      "docs/plans/empty.md": "# Empty plan with no chunks\n\nJust prose.\n",
    });
    const { status, stdout, stderr } = runScript(repo, ["empty"]);
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /^parse-plan\.sh: no '### Chunk <id> — <title>' blocks found in 'docs\/plans\/empty\.md'\n?$/,
    );
  });

  // S28: legacy `### Step N` plan format is deliberately rejected.
  test("S28 rejects the legacy '### Step N' plan format as no-chunks-found", () => {
    repo = makeTmpRepo();
    const legacy = [
      "# Legacy plan",
      "## 5. Steps",
      "",
      "### Step 1 — First step",
      "",
      "Plain prose; no YAML block.",
      "",
      "**Outputs.**",
      "- something.md",
      "",
    ].join("\n");
    writeFiles(repo, { "docs/plans/legacy-format.md": legacy });
    const { status, stdout, stderr } = runScript(repo, ["legacy-format"]);
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /no '### Chunk <id> — <title>' blocks found in 'docs\/plans\/legacy-format\.md'/,
    );
  });
});

// =========================================================================
// Robustness / edge cases (Scenarios 29–34)
// =========================================================================

describe("parse-plan.sh — robustness and edge cases", () => {
  // S29: stdout round-trips through Node JSON.parse AND python3 json.load.
  test("S29 stdout round-trips through both Node JSON.parse and python3 json.load", () => {
    repo = makeTmpRepo();
    const plan = synthHappyPlan({
      chunks: [minimalChunk("first", "Land the foundation", "happy")],
    });
    const prd = synthHappyPrd({
      title: "Happy",
      goal: "g",
      inBullets: ["in"],
      outBullets: ["out"],
    });
    writeFiles(repo, {
      "docs/plans/happy.md": plan,
      "docs/product/happy.md": prd,
    });
    const { status, stdout, stderr } = runScript(repo, ["happy"]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    expect(typeof out.epic).toBe("object");
    expect(Array.isArray(out.chunks)).toBe(true);
    // Cross-check via python3 (defensively skip if python3 is unavailable).
    const probe = spawnSync("python3", ["--version"], { encoding: "utf-8" });
    if (probe.status !== 0) {
      // No python3 — Node-side parse is sufficient for the contract.
      return;
    }
    const py = spawnSync(
      "python3",
      [
        "-c",
        "import json,sys; obj=json.load(sys.stdin); assert 'epic' in obj and 'chunks' in obj",
      ],
      { input: stdout, encoding: "utf-8" },
    );
    expect(py.status).toBe(0);
  });

  // S30: chunk title with multiple em-dashes.
  test("S30 preserves multiple em-dashes in the chunk title after the first split", () => {
    repo = makeTmpRepo();
    const slug = "em-dashes";
    // Build the plan manually because chunkBlock always uses a single em-dash
    // between id and title; we want the title to itself contain em-dashes.
    const plan = `# Em-dash plan

## 5. Chunks

### Chunk a — Adds — Feature — More

\`\`\`yaml
id: a
depends_on: []
labels:
  - type:feat
  - feature:${slug}
\`\`\`

**Goal.** Test em-dashes.

**Files.**
- src/a.ts

**Acceptance criteria.**
- [ ] passes
`;
    writeFiles(repo, { [`docs/plans/${slug}.md`]: plan });
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    expect(out.chunks[0]!.id).toBe("a");
    expect(out.chunks[0]!.title).toBe("Adds — Feature — More");
    expect(out.chunks[0]!.name).toBe("Adds — Feature — More");
  });

  // S31: SHOULD — multi-line goal collapses lines with a single space.
  test("S31 collapses a multi-line Goal section into one space-joined paragraph", () => {
    repo = makeTmpRepo();
    const slug = "multi-para";
    const plan = `# Multi-paragraph plan

## 5. Chunks

### Chunk a — Title

\`\`\`yaml
id: a
depends_on: []
labels:
  - type:feat
  - feature:${slug}
\`\`\`

**Goal.** First paragraph line.
Second paragraph line.

**Files.**
- src/a.ts

**Acceptance criteria.**
- [ ] passes
`;
    writeFiles(repo, { [`docs/plans/${slug}.md`]: plan });
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const out = parseJson(stdout);
    expect(out.chunks[0]!.goal).toBe(
      "First paragraph line. Second paragraph line.",
    );
    expect(out.chunks[0]!.description_html).toContain(
      "<p>First paragraph line. Second paragraph line.</p>",
    );
  });

  // S32: trailing newline behaviour — exactly one \n.
  test("S32 emits exactly one trailing newline on stdout (never two)", () => {
    repo = makeTmpRepo();
    const plan = synthHappyPlan({
      chunks: [minimalChunk("only", "Only chunk", "newline-check")],
    });
    writeFiles(repo, { "docs/plans/newline-check.md": plan });
    const { status, stdout } = runScript(repo, ["newline-check"]);
    expect(status).toBe(0);
    expect(stdout.endsWith("\n")).toBe(true);
    expect(stdout.endsWith("\n\n")).toBe(false);
    const parts = stdout.split("\n");
    // The trailing newline produces a final empty-string element.
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[parts.length - 1]).toBe("");
    // The penultimate (last non-empty) element should not itself be "".
    expect(parts[parts.length - 2]).not.toBe("");
  });

  // S33: stdout MUST be empty on label-validation failure (no half-flushed JSON).
  test("S33 stdout is exactly empty when label validation aborts the run", () => {
    repo = makeTmpRepo();
    const slug = "expected-slug";
    const plan = synthHappyPlan({
      chunks: [
        {
          ...minimalChunk("x", "Title", slug),
          labels: ["type:feat", "feature:other-slug"],
        },
      ],
    });
    writeFiles(repo, { [`docs/plans/${slug}.md`]: plan });
    const { status, stdout, stderr } = runScript(repo, [slug]);
    expect(status).toBe(3);
    expect(stdout).toBe(""); // exact equality, no partial JSON.
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr).toMatch(/missing required 'feature:expected-slug' label/);
  });

  // S34: SHOULD — bash 3.2 guard emits a `brew install bash` hint.
  // Skip if /bin/bash is unavailable or is itself bash 4+.
  const legacyBash = "/bin/bash";
  const legacyProbe = spawnSync(legacyBash, ["-c", 'echo "$BASH_VERSION"'], {
    encoding: "utf-8",
  });
  const legacyMajor =
    legacyProbe.status === 0 && legacyProbe.stdout
      ? Number.parseInt(legacyProbe.stdout.split(".")[0] ?? "0", 10)
      : -1;
  const shouldSkipS34 = legacyProbe.status !== 0 || legacyMajor >= 4;
  (shouldSkipS34 ? test.skip : test)(
    "S34 bash 3.2 guard exits 1 with a brew install hint",
    () => {
      repo = makeTmpRepo();
      const { status, stdout, stderr } = runScript(
        repo,
        ["any-slug"],
        legacyBash,
      );
      expect(status).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toMatch(
        /^parse-plan\.sh: bash >= 4 required \(have .*\); install via 'brew install bash' on macOS\n?$/,
      );
    },
  );
});
