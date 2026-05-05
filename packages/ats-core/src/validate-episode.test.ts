import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// packages/ats-core/src/<file> → packages/ats-core/scripts/validate-episode.ts
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(
  __dirname,
  "../scripts/validate-episode.ts",
);
const FIXTURE_JSONL = path.resolve(
  __dirname,
  "../../../docs/episodes/2026-05.jsonl",
);

let tmpDir: string;
let validFixturePath: string;
let firstLine: string;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "validate-episode-"));

  // Use the GJS-19 entry committed to docs/episodes/2026-05.jsonl as a
  // known-valid example. The file is jsonl (multi-line); extract line 1.
  const raw = readFileSync(FIXTURE_JSONL, "utf-8");
  const candidate = raw.split("\n").find((line) => line.trim().length > 0);
  if (!candidate) {
    throw new Error(`fixture ${FIXTURE_JSONL} has no non-empty lines`);
  }
  firstLine = candidate;

  validFixturePath = path.join(tmpDir, "valid.json");
  writeFileSync(validFixturePath, firstLine);
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
    const tampered = firstLine.replace(
      /"schema_version":\s*1\b/,
      '"schema_version":2',
    );
    expect(tampered).not.toBe(firstLine);

    const tamperedPath = path.join(tmpDir, "tampered.json");
    writeFileSync(tamperedPath, tampered);

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
    const parsed = JSON.parse(firstLine) as {
      decisions: { confidence: string }[];
    };
    if (!parsed.decisions || parsed.decisions.length === 0) {
      throw new Error("fixture line must have at least one decisions entry");
    }
    parsed.decisions[0].confidence = "";

    const nestedPath = path.join(tmpDir, "nested.json");
    writeFileSync(nestedPath, JSON.stringify(parsed));

    const { status, stdout } = runScript(nestedPath);
    expect(status).toBe(1);
    expect(stdout).toMatch(/^decisions\.0\.confidence :: \S+ :: /m);
  });

  test("prints every issue (not just the first) when multiple fields are invalid", () => {
    // Mutate two unrelated fields so we get two issues from one parse.
    // The script's `for (const issue of result.error.issues)` loop is
    // the only thing guaranteeing both surface; a refactor to
    // `result.error.issues[0]` would silently lose one.
    const parsed = JSON.parse(firstLine) as {
      task_type: string;
      decisions: { confidence: string }[];
    };
    if (!parsed.decisions || parsed.decisions.length === 0) {
      throw new Error("fixture line must have at least one decisions entry");
    }
    parsed.task_type = "bogus";
    parsed.decisions[0].confidence = "";

    const multiPath = path.join(tmpDir, "multi.json");
    writeFileSync(multiPath, JSON.stringify(parsed));

    const { status, stdout } = runScript(multiPath);
    expect(status).toBe(1);
    expect(stdout).toMatch(/^task_type :: /m);
    expect(stdout).toMatch(/^decisions\.0\.confidence :: /m);
  });
});
