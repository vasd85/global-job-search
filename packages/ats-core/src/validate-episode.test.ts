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

function runScript(filePath: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  // pnpm exec tsx is the workspace-stable way to invoke the script;
  // npx tsx prints noisy npm-config warnings on this dev box.
  const result = spawnSync(
    "pnpm",
    ["exec", "tsx", SCRIPT_PATH, filePath],
    { encoding: "utf-8" },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("validate-episode CLI", () => {
  test("exits 0 and prints ok for a valid episode entry", () => {
    const { status, stdout } = runScript(validFixturePath);
    expect(status).toBe(0);
    expect(stdout).toContain("ok");
  });

  test("exits non-zero and mentions the offending field on schema mismatch", () => {
    // Tamper schema_version: 1 → 2 (literal mismatch).
    const tampered = firstLine.replace(
      /"schema_version":\s*1\b/,
      '"schema_version":2',
    );
    expect(tampered).not.toBe(firstLine);

    const tamperedPath = path.join(tmpDir, "tampered.json");
    writeFileSync(tamperedPath, tampered);

    const { status, stdout, stderr } = runScript(tamperedPath);
    expect(status).not.toBe(0);
    expect(`${stdout}${stderr}`).toContain("schema_version");
  });
});
