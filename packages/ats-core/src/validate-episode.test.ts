import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Episode } from "./episode-schema";

// packages/ats-core/src/<file> → packages/ats-core/scripts/validate-episode.ts
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(
  __dirname,
  "../scripts/validate-episode.ts",
);

// Pinned, byte-equivalent (whitespace-normalised) copy of
// docs/agents/architecture.md § 9.1. Inlined deliberately so this CLI
// suite is self-contained — no dependency on docs/episodes/<YYYY-MM>.jsonl
// (which is mutated by /log-episode runs and may not exist on a fresh
// CI checkout). Em-dashes preserved at `decisions[0].rejected[*]` and
// `learnings[0]` — do not "fix" to ASCII.
const CANONICAL_EXAMPLE: Episode = {
  schema_version: 1,
  episode_id: "2026-04-28-fix-greenhouse-rate-limit-GJS-42",
  feature_slug: "fix-greenhouse-rate-limit",
  task_id: "GJS-42",
  task_type: "fix",
  status: "merged",
  started_at: "2026-04-28T10:15:00Z",
  completed_at: "2026-04-28T11:42:00Z",

  branch: "fix/greenhouse-backoff-GJS-42",
  pr_url: "https://github.com/vasd85/global-job-search/pull/123",
  plane_work_item_id: "GJS-42",
  plane_epic_id: "GJS-40",
  prd_link: "docs/product/fix-greenhouse-rate-limit.md",
  design_link: null,
  plan_link: "docs/plans/fix-greenhouse-rate-limit.md",
  session_ids: ["1124e18f-3963-43d3-93ce-424420a57222"],

  phases_run: ["research", "prd", "plan", "tasks", "implement", "review"],
  parallel_with: ["GJS-43"],

  reviews: {
    prd: { cycles: 1, verdict: "approved" },
    plan: { cycles: 2, verdict: "approved", critical_findings_addressed: 3 },
    code: { cycles: 1, verdict: "approved" },
  },

  duration_min_total: 87,
  duration_min_by_phase: {
    research: 12,
    prd: 18,
    plan: 22,
    implement: 30,
    review: 5,
  },
  files_touched_count: 4,
  test_count_added: 6,

  decisions: [
    {
      what: "exponential backoff with 5 max retries, jitter 100-500ms",
      why: "3 retries miss 4xx storms in production; jitter prevents thundering herd",
      rejected: [
        "circuit breaker — overkill for this scope",
        "fixed delay — uneven load",
      ],
      confidence: "verified",
    },
  ],
  blockers: [
    {
      what: "Greenhouse 429 responses lack standard Retry-After header",
      resolution: "extracted from response body via vendor wrapper",
      duration_min: 25,
      tag: "external-api",
    },
  ],
  dead_ends: [
    {
      tried: "react-query default retry config",
      why_failed: "doesn't expose Retry-After header to caller code",
    },
  ],
  learnings: [
    "Greenhouse 429s lack standard headers — extractor needs vendor-specific wrapper",
  ],
  tags: ["extractor", "greenhouse", "rate-limit"],
};

// Helper: deep clone the canonical example so per-test mutations
// don't leak between tests. Mirrors the helper in episode-schema.test.ts.
function validCanonical(): Episode {
  return structuredClone(CANONICAL_EXAMPLE);
}

let tmpDir: string;
let validFixturePath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "validate-episode-"));

  validFixturePath = path.join(tmpDir, "valid.json");
  writeFileSync(validFixturePath, JSON.stringify(CANONICAL_EXAMPLE));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

type SpawnResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function runScript(...args: string[]): SpawnResult {
  // pnpm exec tsx is the workspace-stable way to invoke the script;
  // npx tsx prints noisy npm-config warnings on this dev box.
  const result = spawnSync(
    "pnpm",
    ["exec", "tsx", SCRIPT_PATH, ...args],
    { encoding: "utf-8" },
  );
  // Surface spawn-level failures (e.g. pnpm not on PATH) before the
  // status-code assertions run. Without this guard, a missing binary
  // shows up as "expected 0 to be null" — masking the real cause.
  if (result.error) {
    throw new Error(`failed to spawn 'pnpm': ${result.error.message}`);
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("validate-episode CLI", () => {
  test("exits 0 with the literal success prefix and clean stderr for a valid episode", () => {
    const { status, stdout, stderr } = runScript(validFixturePath);
    expect(status).toBe(0);
    // Tighter than `toContain("ok")` — pins the exact success line shape so
    // a refactor that drops the prefix or changes the format is caught.
    expect(stdout.startsWith("validate-episode: ok (")).toBe(true);
    // Success path must not leak debug output to stderr; CI log aggregators
    // piping 2>&1 would otherwise pick up spurious lines.
    expect(stderr).toBe("");
  });

  test("prints `path :: code :: message` and exits 1 on schema mismatch", () => {
    // Tamper schema_version: 1 → 2 (literal mismatch). The schema's own
    // rule for this is exhaustively tested in episode-schema.test.ts;
    // this test asserts the CLI's output contract on a known-bad input.
    const fixture = validCanonical();
    (fixture as unknown as { schema_version: number }).schema_version = 2;

    const tamperedPath = path.join(tmpDir, "tampered.json");
    writeFileSync(tamperedPath, JSON.stringify(fixture));

    const { status, stdout } = runScript(tamperedPath);
    expect(status).toBe(1);
    // `\S+` matches any non-space token (the issue.code, e.g.
    // "invalid_value"); the trailing ` :: ` proves both join separators
    // survive into the output.
    expect(stdout).toMatch(/^schema_version :: \S+ :: /m);
  });

  test("prints usage to stderr and exits 1 when no path argument is provided", () => {
    const { status, stdout, stderr } = runScript();
    expect(status).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/usage:/i);
    expect(stderr).toContain("validate-episode");
  });

  test("exits 1 with a `validate-episode:` prefixed ENOENT message for a missing file", () => {
    const missingPath = path.join(tmpDir, "does-not-exist.json");
    const { status, stderr } = runScript(missingPath);
    expect(status).toBe(1);
    expect(stderr.startsWith("validate-episode:")).toBe(true);
    // Node surfaces the underlying readFileSync failure as either
    // `ENOENT` (the code) or "no such file" (the message); accept either
    // so a future Node version that reformats the string still passes.
    expect(stderr).toMatch(/ENOENT|no such file/i);
  });

  test("exits 1 with a `validate-episode:` prefixed parse error on malformed JSON", () => {
    const malformedPath = path.join(tmpDir, "malformed.json");
    writeFileSync(malformedPath, "{not valid");

    const { status, stderr } = runScript(malformedPath);
    expect(status).toBe(1);
    expect(stderr.startsWith("validate-episode:")).toBe(true);
    // `JSON.parse` throws a SyntaxError whose message contains either
    // "JSON" or "Unexpected" depending on the V8 version; both are
    // acceptable evidence the catch fired on a parse failure.
    expect(stderr).toMatch(/JSON|Unexpected/i);
  });

  test("prints nested issue paths joined with `.` (decisions.0.confidence)", () => {
    // Set decisions[0].confidence to "" to trigger min(1) at the nested
    // path. The CLI does `issue.path.join(".")`, so the line must read
    // `decisions.0.confidence :: …`. A regression to e.g. `join("/")` or
    // dropping `join` entirely (printing the raw array) would fail this.
    const fixture = validCanonical();
    (
      fixture.decisions[0] as unknown as { confidence: string }
    ).confidence = "";

    const nestedPath = path.join(tmpDir, "nested.json");
    writeFileSync(nestedPath, JSON.stringify(fixture));

    const { status, stdout } = runScript(nestedPath);
    expect(status).toBe(1);
    expect(stdout).toMatch(/^decisions\.0\.confidence :: \S+ :: /m);
  });

  test("prints every issue (not just the first) when multiple fields are invalid", () => {
    // Mutate two unrelated fields so we get two issues from one parse.
    // The script's `for (const issue of result.error.issues)` loop is
    // the only thing guaranteeing both surface; a refactor to
    // `result.error.issues[0]` would silently lose one.
    const fixture = validCanonical();
    (fixture as unknown as { task_type: string }).task_type = "bogus";
    (
      fixture.decisions[0] as unknown as { confidence: string }
    ).confidence = "";

    const multiPath = path.join(tmpDir, "multi.json");
    writeFileSync(multiPath, JSON.stringify(fixture));

    const { status, stdout } = runScript(multiPath);
    expect(status).toBe(1);
    expect(stdout).toMatch(/^task_type :: /m);
    expect(stdout).toMatch(/^decisions\.0\.confidence :: /m);
  });
});
