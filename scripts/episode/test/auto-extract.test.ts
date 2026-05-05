/**
 * Tests for `scripts/episode/auto-extract.sh`.
 *
 * Strategy (matches GJS-20 test-scenarios.md):
 *   1. Each test mkdtemps a fresh repo, `git init` + initial empty commit.
 *   2. PATH-shadowed mock `gh` reads fixture files from $MOCK_GH_FIXTURE_DIR.
 *   3. We spawn `bash <script>` with cwd = the tmp repo.
 *
 * The script uses bash 4+ features (`declare -A`, BASH_REMATCH). On macOS the
 * default `/bin/bash` is 3.2; we resolve a 4+ bash via `command -v bash`
 * (homebrew installs to /opt/homebrew/bin) and skip the suite with a clear
 * message if absent. Documented in test-scenarios.md `Things to watch`.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

// scripts/episode/test/auto-extract.test.ts → scripts/episode/auto-extract.sh
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, "..", "auto-extract.sh");
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_GH_SOURCE = path.resolve(__dirname, "fixtures", "gh");

// Resolve a bash 4+ binary. macOS ships /bin/bash 3.2 which lacks `declare -A`
// and other features the script depends on. Homebrew installs at
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
      "auto-extract.sh tests require bash >= 4. Install via `brew install bash`.",
    );
  }
});

// -------- helpers ----------------------------------------------------------

type SpawnResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

type ViewJson = {
  url: string;
  mergedAt: string | null;
  headRefName: string;
  title: string;
  body: string;
  mergeCommit: { oid: string } | null;
  baseRefName: string;
  number: number;
};

type Setup = {
  /** Mock-gh fixture data. */
  view?: Partial<ViewJson> | null;
  diffNameOnly?: string;
  diffFull?: string;
  /** Failure toggles propagated to the mock-gh script via env. */
  failView?: boolean;
  failDiffNames?: boolean;
  failDiff?: boolean;
};

function makeTmpRepo(): { repo: string; cleanup: () => void } {
  // realpath: on macOS `os.tmpdir()` is `/var/folders/...` whose canonical
  // path is `/private/var/...`. The script does `cd "$(git rev-parse
  // --show-toplevel)"` which always returns the canonical (resolved) path.
  // meta.json's `repo` field must match THAT, so resolve here.
  const raw = mkdtempSync(path.join(os.tmpdir(), "ax-"));
  const repo = realpathSync(raw);
  // git init + initial empty commit (the script does `git rev-parse
  // --show-toplevel` which requires *some* commit history for relative paths
  // and `git ls-tree` later).
  spawnInRepo(repo, ["init", "-q"]);
  // Use a stable identity to silence "Author identity unknown" prompts.
  spawnInRepo(repo, ["config", "user.email", "test@example.com"]);
  spawnInRepo(repo, ["config", "user.name", "Test"]);
  spawnInRepo(repo, ["commit", "--allow-empty", "-q", "-m", "init"]);
  return {
    repo,
    cleanup: () => rmSync(repo, { recursive: true, force: true }),
  };
}

function spawnInRepo(repo: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf-8" });
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${r.stderr || r.stdout || ""}`,
    );
  }
}

function gitHeadSha(repo: string): string {
  const r = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf-8",
  });
  if (r.status !== 0) throw new Error(`git rev-parse failed: ${r.stderr}`);
  return r.stdout.trim();
}

function writeFiles(repo: string, files: Record<string, string>): void {
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(repo, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
}

function commitFiles(repo: string, files: Record<string, string>): string {
  writeFiles(repo, files);
  spawnInRepo(repo, ["add", ...Object.keys(files)]);
  spawnInRepo(repo, ["commit", "-q", "-m", "fixture"]);
  return gitHeadSha(repo);
}

function writeMockGh(): { binDir: string; cleanup: () => void } {
  const binDir = mkdtempSync(path.join(os.tmpdir(), "ax-bin-"));
  // Copy the fixture mock into bin/gh; use cpSync to preserve the +x bit.
  cpSync(FIXTURE_GH_SOURCE, path.join(binDir, "gh"));
  chmodSync(path.join(binDir, "gh"), 0o755);
  return {
    binDir,
    cleanup: () => rmSync(binDir, { recursive: true, force: true }),
  };
}

function writeFixtureDir(setup: Setup): {
  fixDir: string;
  cleanup: () => void;
} {
  const fixDir = mkdtempSync(path.join(os.tmpdir(), "ax-fix-"));
  if (setup.view !== undefined && setup.view !== null) {
    writeFileSync(
      path.join(fixDir, "view-json.json"),
      JSON.stringify(setup.view),
    );
  }
  if (setup.diffNameOnly !== undefined) {
    writeFileSync(path.join(fixDir, "diff-name-only.txt"), setup.diffNameOnly);
  }
  if (setup.diffFull !== undefined) {
    writeFileSync(path.join(fixDir, "diff-full.diff"), setup.diffFull);
  }
  return {
    fixDir,
    cleanup: () => rmSync(fixDir, { recursive: true, force: true }),
  };
}

function runScript(repo: string, args: string[], setup: Setup): SpawnResult {
  if (!BASH_BIN) throw new Error("BASH_BIN unresolved");
  const { binDir, cleanup: cleanBin } = writeMockGh();
  const { fixDir, cleanup: cleanFix } = writeFixtureDir(setup);
  try {
    const env: Record<string, string> = {
      // Keep PATH minimally; `bash`, `git`, `jq`, `python3` resolve from the
      // host. Prepend the mock-bin so `gh` resolves to our shim.
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      MOCK_GH_FIXTURE_DIR: fixDir,
      HOME: process.env.HOME ?? "",
    };
    if (setup.failView) env.MOCK_GH_FAIL_VIEW = "1";
    if (setup.failDiffNames) env.MOCK_GH_FAIL_DIFF_NAMES = "1";
    if (setup.failDiff) env.MOCK_GH_FAIL_DIFF = "1";

    const r = spawnSync(BASH_BIN, [SCRIPT_PATH, ...args], {
      cwd: repo,
      env,
      encoding: "utf-8",
    });
    return {
      status: r.status,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
    };
  } finally {
    cleanBin();
    cleanFix();
  }
}

/** Parse stdout as JSON; helpful in many scenarios. */
function parseJson(stdout: string): Record<string, unknown> {
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `stdout is not valid JSON: ${
        e instanceof Error ? e.message : String(e)
      }\n--- stdout ---\n${stdout}`,
    );
  }
}

// -------- canonical fixtures ----------------------------------------------

const PR_URL = "https://github.com/vasd85/global-job-search/pull/123";
const FEATURE_SLUG = "fix-greenhouse-rate-limit";
const TASK_ID = "GJS-42";
const SESSION_ID = "1124e18f-3963-43d3-93ce-424420a57222";
const STARTED_AT = "2026-04-28T10:15:00Z";
const META_STARTED_AT = "2026-04-28T10:30:00Z";
const MERGED_AT = "2026-04-28T11:42:00Z";

function canonicalView(overrides: Partial<ViewJson> = {}): ViewJson {
  return {
    url: PR_URL,
    mergedAt: MERGED_AT,
    headRefName: "fix/greenhouse-backoff-GJS-42",
    title: "fix(ats-core): backoff retries (GJS-42)",
    body: "",
    mergeCommit: { oid: "0".repeat(40) },
    baseRefName: "main",
    number: 123,
    ...overrides,
  };
}

function phaseStateMd(startedAt: string | null): string {
  const lines: string[] = ["---", "phase: implement-task"];
  if (startedAt !== null) lines.push(`started_at: ${startedAt}`);
  lines.push("status: in-progress", "---", "", "## Notes", "");
  return lines.join("\n");
}

function metaJson(args: {
  repo: string;
  startedAt: string;
  sessionId: string;
  skill: string;
}): string {
  return JSON.stringify({
    repo: args.repo,
    started_at: args.startedAt,
    session_id: args.sessionId,
    skill: args.skill,
  });
}

function eventsJsonl(timestamps: string[]): string {
  return timestamps.map((ts) => JSON.stringify({ ts, kind: "x" })).join("\n");
}

// -------- tests ------------------------------------------------------------

describe("auto-extract.sh — argument parsing", () => {
  // S2: missing positional <pr-url>
  test.each<[string, string[]]>([
    ["no args", []],
    ["first arg is a flag", ["--epic-code", "GJS-40"]],
  ])(
    "exits 1 when <pr-url> is missing (%s)",
    (_label, args) => {
      const { repo, cleanup } = makeTmpRepo();
      try {
        const { status, stdout, stderr } = runScript(repo, args, {});
        expect(status).toBe(1);
        expect(stdout).toBe("");
        expect(stderr).toMatch(
          /^auto-extract\.sh: <pr-url> required \(positional, first argument\)\n?$/,
        );
      } finally {
        cleanup();
      }
    },
  );

  // S3: missing or value-less --epic-code
  test("exits 1 when --epic-code is absent entirely", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stderr } = runScript(repo, [PR_URL], {});
      expect(status).toBe(1);
      expect(stderr).toMatch(/--epic-code required/);
    } finally {
      cleanup();
    }
  });

  test("exits 1 when --epic-code is missing while other flags are present", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stderr } = runScript(
        repo,
        [PR_URL, "--feature-slug", "foo"],
        {},
      );
      expect(status).toBe(1);
      expect(stderr).toMatch(/--epic-code required/);
    } finally {
      cleanup();
    }
  });

  test("exits 1 when --epic-code has no value", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stderr } = runScript(repo, [PR_URL, "--epic-code"], {});
      expect(status).toBe(1);
      expect(stderr).toMatch(/--epic-code requires a value/);
    } finally {
      cleanup();
    }
  });

  // S4: bad / unknown flags + --feature-slug value-less; reordered flags
  test("exits 1 when --feature-slug has no value", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stderr } = runScript(
        repo,
        [PR_URL, "--epic-code", "GJS-40", "--feature-slug"],
        {},
      );
      expect(status).toBe(1);
      expect(stderr).toMatch(/--feature-slug requires a value/);
    } finally {
      cleanup();
    }
  });

  test("exits 1 on unknown flag with the literal flag in the message", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stderr } = runScript(
        repo,
        [PR_URL, "--epic-code", "GJS-40", "--nope"],
        {},
      );
      expect(status).toBe(1);
      expect(stderr).toMatch(
        /^auto-extract\.sh: unknown argument '--nope'\n?$/,
      );
    } finally {
      cleanup();
    }
  });

  test("succeeds when --feature-slug is given before --epic-code (order-independent)", () => {
    // Reuses the canonical happy-path fixture in a "reordered flags" shape.
    const { repo, cleanup } = makeTmpRepo();
    try {
      const args = [
        PR_URL,
        "--feature-slug",
        FEATURE_SLUG,
        "--epic-code",
        "GJS-40",
      ];
      const { status, stdout } = runScript(repo, args, {
        view: canonicalView(),
        diffNameOnly: "a.ts\nb.ts\n",
        diffFull: "diff --git a/a.ts b/a.ts\n",
      });
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.feature_slug).toBe(FEATURE_SLUG);
      expect(out.plane_epic_id).toBe("GJS-40");
    } finally {
      cleanup();
    }
  });
});

describe("auto-extract.sh — gh pr view + merge state", () => {
  // S5: gh pr view fails
  test("exits 1 when `gh pr view` fails, with quoted URL in error", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const url = "https://github.com/x/y/pull/1";
      const { status, stdout, stderr } = runScript(
        repo,
        [url, "--epic-code", "GJS-1"],
        { failView: true },
      );
      expect(status).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toMatch(
        new RegExp(
          `^auto-extract\\.sh: gh pr view failed for '${url.replace(
            /\//g,
            "\\/",
          )}'\\n?$`,
        ),
      );
    } finally {
      cleanup();
    }
  });

  // S6: PR not merged
  test("exits 1 when PR is not merged (mergedAt is null)", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stdout, stderr } = runScript(
        repo,
        [PR_URL, "--epic-code", "GJS-1"],
        { view: canonicalView({ mergedAt: null }) },
      );
      expect(status).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toMatch(/PR '.+' is not merged \(mergedAt is null\)/);
    } finally {
      cleanup();
    }
  });

  // S7: gh pr view JSON parse — canonical pr_url replaces argument-URL
  test("emits the canonical url from gh pr view, not the input arg", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      // Pass an input URL with a trailing slash; assert the output is the
      // canonical URL from JSON. The mock returns the canonical URL
      // unconditionally.
      const inputUrl = `${PR_URL}/`;
      const { status, stdout } = runScript(
        repo,
        [inputUrl, "--epic-code", "GJS-40", "--feature-slug", FEATURE_SLUG],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.branch).toBe("fix/greenhouse-backoff-GJS-42");
      expect(out.pr_url).toBe(PR_URL); // canonical, no trailing slash
      expect(out.completed_at).toBe(MERGED_AT);
    } finally {
      cleanup();
    }
  });
});

describe("auto-extract.sh — branch and title parsing", () => {
  // S8: allowed type prefixes (matrix)
  test.each<[string, string]>([
    ["feat", "GJS-1"],
    ["fix", "GJS-2"],
    ["refactor", "GJS-3"],
    ["chore", "GJS-4"],
    ["docs", "GJS-5"],
    ["test", "GJS-6"],
  ])(
    "accepts %s/x-%s and parses task_type + task_id",
    (taskType, taskId) => {
      const { repo, cleanup } = makeTmpRepo();
      try {
        const branch = `${taskType}/x-${taskId}`;
        const { status, stdout } = runScript(
          repo,
          [PR_URL, "--epic-code", "GJS-40"],
          {
            view: canonicalView({ headRefName: branch }),
            diffNameOnly: "",
            diffFull: "",
          },
        );
        expect(status).toBe(0);
        const out = parseJson(stdout);
        expect(out.task_type).toBe(taskType);
        expect(out.task_id).toBe(taskId);
        expect(out.feature_slug).toBe("");
      } finally {
        cleanup();
      }
    },
  );

  // S9: branch matches regex but type is not in allowlist
  test("exits 1 when branch type prefix is not in the allowlist", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stderr } = runScript(
        repo,
        [PR_URL, "--epic-code", "GJS-40"],
        { view: canonicalView({ headRefName: "release/v1.2-GJS-7" }) },
      );
      expect(status).toBe(1);
      expect(stderr).toMatch(
        /branch 'release\/v1\.2-GJS-7' has unsupported type prefix 'release'; expected feat\|fix\|refactor\|chore\|docs\|test/,
      );
    } finally {
      cleanup();
    }
  });

  // S10: malformed branch, title contains GJS-N
  test("refuses title-only mode (branch malformed but title has GJS-<n>)", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stderr } = runScript(
        repo,
        [PR_URL, "--epic-code", "GJS-40"],
        {
          view: canonicalView({
            headRefName: "bad-branch-name",
            title: "fix something for GJS-42",
          }),
        },
      );
      expect(status).toBe(1);
      expect(stderr).toMatch(
        /^auto-extract\.sh: cannot parse task_type from branch 'bad-branch-name' \(title fallback gave task_id but not type\)\n?$/,
      );
    } finally {
      cleanup();
    }
  });

  // S11: malformed branch + no GJS marker in title
  test("exits 1 when neither branch nor title yield a GJS-<n>", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stderr } = runScript(
        repo,
        [PR_URL, "--epic-code", "GJS-40"],
        { view: canonicalView({ headRefName: "wat", title: "no marker here" }) },
      );
      expect(status).toBe(1);
      expect(stderr).toMatch(
        /cannot parse GJS-<n> from branch 'wat' or PR title 'no marker here'/,
      );
    } finally {
      cleanup();
    }
  });

  // S12: multi-segment branch path
  test("parses multi-segment branches (feat/sub/scope-GJS-99) using greedy (.+)", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stdout } = runScript(
        repo,
        [PR_URL, "--epic-code", "GJS-40"],
        {
          view: canonicalView({
            headRefName: "feat/sub/scope-and-deep-GJS-99",
          }),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.task_type).toBe("feat");
      expect(out.task_id).toBe("GJS-99");
    } finally {
      cleanup();
    }
  });
});

describe("auto-extract.sh — feature_slug resolution", () => {
  // S13: explicit slug overrides any glob result
  test("uses --feature-slug verbatim and ignores any scratchpad", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          "my-explicit-slug",
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.feature_slug).toBe("my-explicit-slug");
      expect(out.episode_id).toBe(
        `2026-04-28-my-explicit-slug-${TASK_ID}`,
      );
    } finally {
      cleanup();
    }
  });

  // S14: omitted, single glob hit derives slug
  test("derives feature_slug from the only matching scratchpad", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      writeFiles(repo, {
        [`.claude/scratchpads/auto-derived-slug/tasks/${TASK_ID}/phase-state.md`]:
          phaseStateMd(null),
      });
      const { status, stdout } = runScript(
        repo,
        [PR_URL, "--epic-code", "GJS-40"],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.feature_slug).toBe("auto-derived-slug");
      expect(typeof out.feature_slug).toBe("string");
      // Adversarial: a regression to greedy left-strip would leave a slash.
      expect(out.feature_slug as string).not.toContain("/");
      expect(out.episode_id).toBe(
        `2026-04-28-auto-derived-slug-${TASK_ID}`,
      );
    } finally {
      cleanup();
    }
  });

  // S15: omitted + no glob hit → empty string + cascading nulls
  test("falls back to empty feature_slug and cascades all derived fields to null/[]/{}", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stdout } = runScript(
        repo,
        [PR_URL, "--epic-code", "GJS-40"],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.feature_slug).toBe("");
      expect(out.episode_id).toBe(`2026-04-28-${TASK_ID}`);
      expect(out.prd_link).toBeNull();
      expect(out.design_link).toBeNull();
      expect(out.plan_link).toBeNull();
      expect(out.session_ids).toEqual([]);
      expect(out.reviews).toEqual({});
      expect(out.started_at).toBeNull();
      // NOTE: feature_slug == "" is rejected by EpisodeSchema (minLength 1).
      // That invariant is asserted in episode-schema.test.ts; here we only
      // lock the script's "degrade cleanly when slug unknown" contract.
    } finally {
      cleanup();
    }
  });

  // S16: omitted + multiple glob hits → first is selected, deterministically
  test("selects the lexicographically-first slug when multiple scratchpads exist", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      writeFiles(repo, {
        [`.claude/scratchpads/alpha/tasks/${TASK_ID}/phase-state.md`]:
          phaseStateMd(null),
        [`.claude/scratchpads/beta/tasks/${TASK_ID}/phase-state.md`]:
          phaseStateMd(null),
      });
      const args = [PR_URL, "--epic-code", "GJS-40"];
      const setup: Setup = {
        view: canonicalView(),
        diffNameOnly: "",
        diffFull: "",
      };
      const r1 = runScript(repo, args, setup);
      const r2 = runScript(repo, args, setup);
      expect(r1.status).toBe(0);
      expect(r2.status).toBe(0);
      const out1 = parseJson(r1.stdout);
      const out2 = parseJson(r2.stdout);
      // Stable across runs.
      expect(out1.feature_slug).toBe(out2.feature_slug);
      // Lexicographically first → "alpha".
      expect(out1.feature_slug).toBe("alpha");
    } finally {
      cleanup();
    }
  });
});

describe("auto-extract.sh — doc-link verification at merge SHA", () => {
  // S17: all three docs present at merge sha
  test("emits the three doc paths when all are committed at merge_commit.oid", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const sha = commitFiles(repo, {
        [`docs/product/${FEATURE_SLUG}.md`]: "# product\n",
        [`docs/designs/${FEATURE_SLUG}.md`]: "# designs\n",
        [`docs/plans/${FEATURE_SLUG}.md`]: "# plans\n",
      });
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView({ mergeCommit: { oid: sha } }),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.prd_link).toBe(`docs/product/${FEATURE_SLUG}.md`);
      expect(out.design_link).toBe(`docs/designs/${FEATURE_SLUG}.md`);
      expect(out.plan_link).toBe(`docs/plans/${FEATURE_SLUG}.md`);
    } finally {
      cleanup();
    }
  });

  // S18: only some docs in the merge commit tree
  test("returns null for docs not present in the merge commit tree", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      // Only the plan is committed; product and design are uncommitted in
      // the working tree to prove the script does NOT use working-tree state.
      const sha = commitFiles(repo, {
        [`docs/plans/${FEATURE_SLUG}.md`]: "# plan\n",
      });
      writeFiles(repo, {
        [`docs/product/${FEATURE_SLUG}.md`]: "# product (uncommitted)\n",
        [`docs/designs/${FEATURE_SLUG}.md`]: "# designs (uncommitted)\n",
      });
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView({ mergeCommit: { oid: sha } }),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.prd_link).toBeNull();
      expect(out.design_link).toBeNull();
      expect(out.plan_link).toBe(`docs/plans/${FEATURE_SLUG}.md`);
    } finally {
      cleanup();
    }
  });

  // S19: mergeCommit null → no doc links
  test("returns null for all doc links when mergeCommit is null", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      // Commit all three docs into the working tree, then deliberately
      // pass mergeCommit: null. The script's `verify_doc_at_merge` returns
      // 1 immediately when merge_commit is empty.
      commitFiles(repo, {
        [`docs/product/${FEATURE_SLUG}.md`]: "# product\n",
        [`docs/designs/${FEATURE_SLUG}.md`]: "# designs\n",
        [`docs/plans/${FEATURE_SLUG}.md`]: "# plans\n",
      });
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView({ mergeCommit: null }),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.prd_link).toBeNull();
      expect(out.design_link).toBeNull();
      expect(out.plan_link).toBeNull();
    } finally {
      cleanup();
    }
  });

  // S20: empty feature_slug → no doc links regardless of disk state
  test("returns null for all doc links when feature_slug is empty (early return)", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      // Commit a `docs/product/anything.md` so a regression to
      // `docs/product/${feature_slug}.md` with empty slug (= `docs/product/.md`)
      // could not coincidentally pass.
      const sha = commitFiles(repo, {
        "docs/product/anything.md": "# something\n",
      });
      const { status, stdout } = runScript(
        repo,
        [PR_URL, "--epic-code", "GJS-40"],
        {
          view: canonicalView({ mergeCommit: { oid: sha } }),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.feature_slug).toBe("");
      expect(out.prd_link).toBeNull();
      expect(out.design_link).toBeNull();
      expect(out.plan_link).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("auto-extract.sh — started_at from phase-state.md", () => {
  // S21: file missing → null + cascade
  test("emits started_at null when phase-state.md is absent", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.started_at).toBeNull();
      expect(out.session_ids).toEqual([]);
      expect(out.duration_min_total).toBeNull();
    } finally {
      cleanup();
    }
  });

  // S22: file present + valid started_at
  test("reads started_at from phase-state.md frontmatter", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      writeFiles(repo, {
        [`.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/phase-state.md`]:
          phaseStateMd(STARTED_AT),
      });
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.started_at).toBe(STARTED_AT);
    } finally {
      cleanup();
    }
  });

  // S23: started_at missing or literal "null"
  test.each<[string, string]>([
    ["missing key", "---\nphase: x\n---\n"],
    ["literal null value", "---\nphase: x\nstarted_at: null\n---\n"],
  ])("emits started_at JSON null when frontmatter has %s", (_label, body) => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      writeFiles(repo, {
        [`.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/phase-state.md`]:
          body,
      });
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      // started_at must be JSON null (not the string "null").
      expect(stdout).toMatch(/"started_at"\s*:\s*null/);
      const out = parseJson(stdout);
      expect(out.started_at).toBeNull();
    } finally {
      cleanup();
    }
  });

  // S24: empty frontmatter `---\n---\n`
  test("emits started_at null on empty frontmatter (just two fences)", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      writeFiles(repo, {
        [`.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/phase-state.md`]:
          "---\n---\n# body\n",
      });
      const { status, stdout, stderr } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      expect(stderr).toBe("");
      const out = parseJson(stdout);
      expect(out.started_at).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("auto-extract.sh — session_ids, phases_run, durations", () => {
  // S25: started_at null → all session-derived fields empty/null
  test("emits empty session arrays and null durations when started_at is null", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      // No phase-state.md → started_at null. Logs do exist; the
      // outer `if [[ "$started_at_json" != "null" ]]` should short-circuit
      // and skip the entire block.
      writeFiles(repo, {
        ".claude/logs/implement/run1/meta.json": metaJson({
          repo,
          startedAt: META_STARTED_AT,
          sessionId: SESSION_ID,
          skill: "implement",
        }),
        ".claude/logs/implement/run1/events.jsonl": eventsJsonl([
          META_STARTED_AT,
          MERGED_AT,
        ]),
      });
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.session_ids).toEqual([]);
      expect(out.phases_run).toEqual([]);
      expect(out.duration_min_total).toBeNull();
      expect(out.duration_min_by_phase).toBeNull();
    } finally {
      cleanup();
    }
  });

  // S26: single in-window session, valid events, span 30 min
  test("aggregates one in-window session correctly (30-min span)", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      writeFiles(repo, {
        [`.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/phase-state.md`]:
          phaseStateMd(STARTED_AT),
        ".claude/logs/implement/run1/meta.json": metaJson({
          repo,
          startedAt: META_STARTED_AT,
          sessionId: SESSION_ID,
          skill: "implement",
        }),
        ".claude/logs/implement/run1/events.jsonl": eventsJsonl([
          "2026-04-28T10:30:00Z",
          "2026-04-28T11:00:00Z",
        ]),
      });
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.session_ids).toEqual([SESSION_ID]);
      expect(out.phases_run).toEqual(["implement"]);
      expect(out.duration_min_total).toBe(30);
      expect(out.duration_min_by_phase).toEqual({ implement: 30 });
    } finally {
      cleanup();
    }
  });

  // S27: multiple sessions, mixed in/out of window, mixed repos
  test("filters sessions by repo and time window (only in-window + matching-repo wins)", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      writeFiles(repo, {
        [`.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/phase-state.md`]:
          phaseStateMd(STARTED_AT),
        // A: in-window, repo matches → IN
        ".claude/logs/implement/runA/meta.json": metaJson({
          repo,
          startedAt: "2026-04-28T10:30:00Z",
          sessionId: "session-A",
          skill: "implement",
        }),
        ".claude/logs/implement/runA/events.jsonl": eventsJsonl([
          "2026-04-28T10:30:00Z",
          "2026-04-28T10:50:00Z",
        ]),
        // B: in-window, wrong repo → OUT
        ".claude/logs/implement/runB/meta.json": metaJson({
          repo: "/some/other/repo",
          startedAt: "2026-04-28T10:35:00Z",
          sessionId: "session-B",
          skill: "implement",
        }),
        ".claude/logs/implement/runB/events.jsonl": eventsJsonl([
          "2026-04-28T10:35:00Z",
          "2026-04-28T10:55:00Z",
        ]),
        // C: out-of-window (before started_at) → OUT
        ".claude/logs/implement/runC/meta.json": metaJson({
          repo,
          startedAt: "2026-04-28T09:00:00Z",
          sessionId: "session-C",
          skill: "implement",
        }),
        ".claude/logs/implement/runC/events.jsonl": eventsJsonl([
          "2026-04-28T09:00:00Z",
          "2026-04-28T09:20:00Z",
        ]),
        // D: out-of-window (after merged_at) → OUT
        ".claude/logs/implement/runD/meta.json": metaJson({
          repo,
          startedAt: "2026-04-28T12:00:00Z",
          sessionId: "session-D",
          skill: "implement",
        }),
        ".claude/logs/implement/runD/events.jsonl": eventsJsonl([
          "2026-04-28T12:00:00Z",
          "2026-04-28T12:20:00Z",
        ]),
      });
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.session_ids).toEqual(["session-A"]);
      expect(out.duration_min_total).toBe(20);
    } finally {
      cleanup();
    }
  });

  // S27 boundary check: a session whose started_at == window endpoint
  // (started_at or merged_at) IS included (the script uses `<` / `>`).
  test("includes sessions whose meta.started_at sits exactly on a window boundary", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      writeFiles(repo, {
        [`.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/phase-state.md`]:
          phaseStateMd(STARTED_AT),
        // A: meta.started_at == started_at (exact lower bound).
        ".claude/logs/implement/runA/meta.json": metaJson({
          repo,
          startedAt: STARTED_AT,
          sessionId: "session-low",
          skill: "implement",
        }),
        ".claude/logs/implement/runA/events.jsonl": eventsJsonl([
          STARTED_AT,
          "2026-04-28T10:25:00Z",
        ]),
        // B: meta.started_at == merged_at (exact upper bound).
        ".claude/logs/research/runB/meta.json": metaJson({
          repo,
          startedAt: MERGED_AT,
          sessionId: "session-high",
          skill: "research",
        }),
        ".claude/logs/research/runB/events.jsonl": eventsJsonl([
          MERGED_AT,
          MERGED_AT,
        ]),
      });
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      // Both endpoints retained.
      expect(out.session_ids).toEqual(
        expect.arrayContaining(["session-low", "session-high"]),
      );
      expect((out.session_ids as string[]).length).toBe(2);
    } finally {
      cleanup();
    }
  });

  // S28: two sessions of same skill — durations sum, phases_run dedupes
  test("sums per-phase durations across multiple sessions of the same skill", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      writeFiles(repo, {
        [`.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/phase-state.md`]:
          phaseStateMd(STARTED_AT),
        // Session A: 10 minutes
        ".claude/logs/implement/runA/meta.json": metaJson({
          repo,
          startedAt: "2026-04-28T10:30:00Z",
          sessionId: "sess-A",
          skill: "implement",
        }),
        ".claude/logs/implement/runA/events.jsonl": eventsJsonl([
          "2026-04-28T10:30:00Z",
          "2026-04-28T10:40:00Z",
        ]),
        // Session B: 15 minutes (gap of 20 minutes after A)
        ".claude/logs/implement/runB/meta.json": metaJson({
          repo,
          startedAt: "2026-04-28T11:00:00Z",
          sessionId: "sess-B",
          skill: "implement",
        }),
        ".claude/logs/implement/runB/events.jsonl": eventsJsonl([
          "2026-04-28T11:00:00Z",
          "2026-04-28T11:15:00Z",
        ]),
      });
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect((out.session_ids as string[]).length).toBe(2);
      expect(out.phases_run).toEqual(["implement"]); // deduplicated
      expect(out.duration_min_by_phase).toEqual({ implement: 25 });
      // Total spans first ts to last ts across both sessions = 45 min.
      expect(out.duration_min_total).toBe(45);
      // Sanity check: total ≥ sum-of-per-phase (gap between sessions counts).
      expect(out.duration_min_total as number).toBeGreaterThanOrEqual(25);
    } finally {
      cleanup();
    }
  });

  // S29: corrupted meta.json silently skipped; events.jsonl missing/empty contributes 0
  test("silently skips meta.json missing required keys; tolerates empty events.jsonl", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      writeFiles(repo, {
        [`.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/phase-state.md`]:
          phaseStateMd(STARTED_AT),
        // A: well-formed → 20 min span, contributes
        ".claude/logs/implement/runA/meta.json": metaJson({
          repo,
          startedAt: "2026-04-28T10:30:00Z",
          sessionId: "sess-A",
          skill: "implement",
        }),
        ".claude/logs/implement/runA/events.jsonl": eventsJsonl([
          "2026-04-28T10:30:00Z",
          "2026-04-28T10:50:00Z",
        ]),
        // B: missing `repo` key → silently skipped
        ".claude/logs/implement/runB/meta.json": JSON.stringify({
          started_at: "2026-04-28T10:40:00Z",
          session_id: "sess-B",
          skill: "implement",
        }),
        ".claude/logs/implement/runB/events.jsonl": eventsJsonl([
          "2026-04-28T10:40:00Z",
        ]),
        // C: well-formed, but events.jsonl has no ts-bearing lines
        ".claude/logs/research/runC/meta.json": metaJson({
          repo,
          startedAt: "2026-04-28T11:00:00Z",
          sessionId: "sess-C",
          skill: "research",
        }),
        ".claude/logs/research/runC/events.jsonl":
          '{"kind":"foo"}\n{"kind":"bar"}\n',
      });
      const { status, stdout, stderr } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      // No crash on B's missing key.
      expect(stderr).toBe("");
      const out = parseJson(stdout);
      // B is excluded (missing keys); A and C are present.
      expect(out.session_ids).toEqual(
        expect.arrayContaining(["sess-A", "sess-C"]),
      );
      expect(out.session_ids).not.toContain("sess-B");
      // Duration total comes from A only (C's events have no ts).
      expect(out.duration_min_total).toBe(20);
      // C's skill is NOT in per-phase map (never reached iso_minutes_between).
      expect(out.duration_min_by_phase).toEqual({ implement: 20 });
    } finally {
      cleanup();
    }
  });
});

describe("auto-extract.sh — reviews.code parsing", () => {
  // S30: approved verdict
  test("captures approved verdict with cycles=1 and zero critical findings", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      writeFiles(repo, {
        [`.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/code-review.md`]:
          "# Review\n\n### Verdict\n\napproved\n",
      });
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.reviews).toEqual({
        code: {
          cycles: 1,
          verdict: "approved",
          critical_findings_addressed: 0,
        },
      });
    } finally {
      cleanup();
    }
  });

  // S31: changes-required + 2 Critical findings (Important not counted)
  test("counts only `#### Critical*` headings under `### Findings`", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const review = [
        "### Verdict",
        "",
        "changes-required",
        "",
        "### Findings",
        "",
        "#### Critical 1: foo",
        "details",
        "",
        "#### Critical 2: bar",
        "more details",
        "",
        "#### Important 1: baz",
        "noise",
        "",
      ].join("\n");
      writeFiles(repo, {
        [`.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/code-review.md`]:
          review,
      });
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      const reviews = out.reviews as {
        code: { verdict: string; critical_findings_addressed: number };
      };
      expect(reviews.code.verdict).toBe("changes-required");
      expect(reviews.code.critical_findings_addressed).toBe(2);
    } finally {
      cleanup();
    }
  });

  // S32: verdict normalisation (whitespace + mixed case).
  //
  // The CRLF sub-fixture is intentionally omitted — see the skipped test
  // immediately after this `test.each`. The script does `tr -d '\r'` AFTER
  // the awk pipeline that captures the verdict line, so a CRLF-edited
  // code-review.md leaves the awk pass with an effectively-empty verdict.
  test.each<[string, string]>([
    ["whitespace around verdict", "### Verdict\n\n   approved   \n"],
    ["capital initial", "### Verdict\n\nApproved\n"],
  ])(
    "normalises verdict to lowercase trimmed (%s)",
    (_label, body) => {
      const { repo, cleanup } = makeTmpRepo();
      try {
        writeFiles(repo, {
          [`.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/code-review.md`]:
            body,
        });
        const { status, stdout } = runScript(
          repo,
          [
            PR_URL,
            "--epic-code",
            "GJS-40",
            "--feature-slug",
            FEATURE_SLUG,
          ],
          {
            view: canonicalView(),
            diffNameOnly: "",
            diffFull: "",
          },
        );
        expect(status).toBe(0);
        const out = parseJson(stdout);
        const reviews = out.reviews as { code: { verdict: string } };
        expect(reviews.code.verdict).toBe("approved");
      } finally {
        cleanup();
      }
    },
  );

  // BUG: CRLF-edited code-review.md files lose the verdict.
  // The awk pipeline at scripts/episode/auto-extract.sh:340-350 advances
  // past the `### Verdict` heading, then encounters the `\r` blank line.
  // Awk's `NF > 0` is true (the lone `\r` counts as one field), so the
  // print branch fires on the blank line. Substitutions strip the `\r` to
  // empty, awk emits an empty line, the downstream `tr -d '\r'` runs too
  // late, and `verdict` becomes "" — which the case-allowlist rejects,
  // dropping reviews to `{}`. Fix: run `tr -d '\r' < file | awk ...`
  // (CR-strip BEFORE awk) or insert a `gsub(/\r$/, "")` at the top of the
  // awk program. See test-progress.md for follow-up routing.
  test.skip("normalises verdict to lowercase trimmed (CRLF line endings)", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      writeFiles(repo, {
        [`.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/code-review.md`]:
          "### Verdict\r\n\r\napproved\r\n",
      });
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      const reviews = out.reviews as { code: { verdict: string } };
      expect(reviews.code.verdict).toBe("approved");
    } finally {
      cleanup();
    }
  });

  // S33: invalid / absent verdict → reviews == {}
  test.each<[string, string | null]>([
    ["file absent", null],
    ["non-allowlisted verdict", "### Verdict\n\nneeds-work\n"],
    ["next non-empty line is another heading", "### Verdict\n\n### Next\n"],
  ])("emits reviews == {} when %s", (_label, body) => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const files: Record<string, string> = {};
      if (body !== null) {
        files[
          `.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/code-review.md`
        ] = body;
      }
      writeFiles(repo, files);
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: "",
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.reviews).toEqual({});
    } finally {
      cleanup();
    }
  });
});

describe("auto-extract.sh — files_touched_count", () => {
  // S34: --name-only succeeds (with both 4-line and 0-line variants)
  test.each<[string, string, number]>([
    ["four files, trailing newline", "a.ts\nb.ts\nc.ts\nd.ts\n", 4],
    ["empty output", "", 0],
  ])("counts files_touched_count for %s", (_label, names, expected) => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffNameOnly: names,
          diffFull: "",
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.files_touched_count).toBe(expected);
    } finally {
      cleanup();
    }
  });

  // S35: --name-only fails, fall back to full diff with `^diff --git`
  test("falls back to counting `diff --git` headers when --name-only fails", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const fullDiff = [
        "diff --git a/x.ts b/x.ts",
        "old line",
        "diff --git a/y.ts b/y.ts",
        "old line",
        "diff --git a/z.ts b/z.ts",
        "",
      ].join("\n");
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          diffFull: fullDiff,
          failDiffNames: true,
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.files_touched_count).toBe(3);
    } finally {
      cleanup();
    }
  });

  // S36: both fail → both counts null
  test("emits both files_touched_count and test_count_added as null when both gh diff calls fail", () => {
    const { repo, cleanup } = makeTmpRepo();
    try {
      const { status, stdout } = runScript(
        repo,
        [
          PR_URL,
          "--epic-code",
          "GJS-40",
          "--feature-slug",
          FEATURE_SLUG,
        ],
        {
          view: canonicalView(),
          failDiffNames: true,
          failDiff: true,
        },
      );
      expect(status).toBe(0);
      const out = parseJson(stdout);
      expect(out.files_touched_count).toBeNull();
      expect(out.test_count_added).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("auto-extract.sh — test_count_added", () => {
  // S37: net counting matrix
  // Note: the script's regex `^\+[^+].*\b(it|test|describe)\(` requires a
  // non-`+` second char AND a *separate* `it(`/`test(`/`describe(` token
  // after that. Plain `+test("x")` does NOT match because there is no
  // second `test(` after the consumed `+t`. The fixtures therefore use a
  // leading space (`+ test(...)`) — which is what real `gh pr diff` output
  // shows for added lines that have at least one space of indent. This is
  // the same pattern verified manually with grep against the actual regex.
  test.each<[string, string, number]>([
    [
      "6 added test lines, 0 removed",
      [
        "diff --git a/foo.test.ts b/foo.test.ts",
        "+ test(\"a1\", () => {})",
        "+ test(\"a2\", () => {})",
        "+ test(\"a3\", () => {})",
        "+ it(\"a4\", () => {})",
        "+ describe(\"a5\")",
        "+ test(\"a6\", () => {})",
        "",
      ].join("\n"),
      6,
    ],
    [
      "0 added, 4 removed → clamped to 0",
      [
        "diff --git a/foo.test.ts b/foo.test.ts",
        "- test(\"r1\", () => {})",
        "- test(\"r2\", () => {})",
        "- it(\"r3\", () => {})",
        "- describe(\"r4\")",
        "",
      ].join("\n"),
      0,
    ],
    [
      "3 added, 3 removed → exact tie",
      [
        "diff --git a/foo.test.ts b/foo.test.ts",
        "+ test(\"a1\", () => {})",
        "+ it(\"a2\", () => {})",
        "+ describe(\"a3\")",
        "- test(\"r1\", () => {})",
        "- it(\"r2\", () => {})",
        "- describe(\"r3\")",
        "",
      ].join("\n"),
      0,
    ],
    [
      "+++ headers must not be counted",
      [
        "diff --git a/path/with/test/foo.ts b/path/with/test/foo.ts",
        "+++ b/path/with/test/foo.ts",
        "+++ b/describe.ts",
        "@@ -1,1 +1,1 @@",
        "+const x = 1;",
        "",
      ].join("\n"),
      0,
    ],
  ])(
    "computes test_count_added for %s",
    (_label, diffBody, expected) => {
      const { repo, cleanup } = makeTmpRepo();
      try {
        const { status, stdout } = runScript(
          repo,
          [
            PR_URL,
            "--epic-code",
            "GJS-40",
            "--feature-slug",
            FEATURE_SLUG,
          ],
          {
            view: canonicalView(),
            diffNameOnly: "a.ts\n",
            diffFull: diffBody,
          },
        );
        expect(status).toBe(0);
        const out = parseJson(stdout);
        expect(out.test_count_added).toBe(expected);
      } finally {
        cleanup();
      }
    },
  );
});

describe("auto-extract.sh — happy-path baseline + schema cross-check", () => {
  // S1 (happy-path baseline) and S38 (validate against schema).
  // These two scenarios share the same setup; S38 also pipes the stdout
  // through `pnpm --filter @gjs/ats-core validate:episode`.
  let repo: string;
  let sha: string;
  let happyResult: SpawnResult;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = makeTmpRepo();
    repo = tmp.repo;
    cleanup = tmp.cleanup;
    sha = commitFiles(repo, {
      [`docs/product/${FEATURE_SLUG}.md`]: "# product\n",
      [`docs/designs/${FEATURE_SLUG}.md`]: "# designs\n",
      [`docs/plans/${FEATURE_SLUG}.md`]: "# plans\n",
    });
    writeFiles(repo, {
      [`.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/phase-state.md`]:
        phaseStateMd(STARTED_AT),
      [`.claude/scratchpads/${FEATURE_SLUG}/tasks/${TASK_ID}/code-review.md`]:
        "### Verdict\n\napproved\n",
      ".claude/logs/implement/run1/meta.json": metaJson({
        repo,
        startedAt: META_STARTED_AT,
        sessionId: SESSION_ID,
        skill: "implement",
      }),
      ".claude/logs/implement/run1/events.jsonl": eventsJsonl([
        "2026-04-28T10:30:00Z",
        "2026-04-28T11:00:00Z",
      ]),
    });
    const fullDiff = [
      "diff --git a/foo.test.ts b/foo.test.ts",
      "+ test(\"a1\", () => {})",
      "+ test(\"a2\", () => {})",
      "+ test(\"a3\", () => {})",
      "+ it(\"a4\", () => {})",
      "+ describe(\"a5\")",
      "+ test(\"a6\", () => {})",
      "",
    ].join("\n");
    happyResult = runScript(
      repo,
      [
        PR_URL,
        "--epic-code",
        "GJS-40",
        "--feature-slug",
        FEATURE_SLUG,
      ],
      {
        view: canonicalView({ mergeCommit: { oid: sha } }),
        diffNameOnly: "a.ts\nb.ts\nc.ts\nd.ts\n",
        diffFull: fullDiff,
      },
    );
  });

  afterEach(() => {
    cleanup();
  });

  // S1: happy-path baseline shape
  test("emits the baseline JSON shape with all auto-extracted fields populated", () => {
    expect(happyResult.status).toBe(0);
    expect(happyResult.stderr).toBe("");
    const out = parseJson(happyResult.stdout);
    expect(out.task_id).toBe(TASK_ID);
    expect(out.task_type).toBe("fix");
    expect(out.feature_slug).toBe(FEATURE_SLUG);
    expect(out.plane_epic_id).toBe("GJS-40");
    expect(out.episode_id).toBe(`2026-04-28-${FEATURE_SLUG}-${TASK_ID}`);
    expect(out.status).toBe("merged");
    expect(out.schema_version).toBe(1);
    expect(out.completed_at).toBe(MERGED_AT);
    expect(out.started_at).toBe(STARTED_AT);
    expect(out.branch).toBe("fix/greenhouse-backoff-GJS-42");
    expect(out.pr_url).toBe(PR_URL);
    expect(out.session_ids).toEqual([SESSION_ID]);
    expect(out.phases_run).toEqual(["implement"]);
    expect(out.duration_min_total).toBe(30);
    expect(out.duration_min_by_phase).toEqual({ implement: 30 });
    expect(out.files_touched_count).toBe(4);
    expect(out.test_count_added).toBe(6);
    expect(out.prd_link).toBe(`docs/product/${FEATURE_SLUG}.md`);
    expect(out.design_link).toBe(`docs/designs/${FEATURE_SLUG}.md`);
    expect(out.plan_link).toBe(`docs/plans/${FEATURE_SLUG}.md`);
    expect(out.reviews).toEqual({
      code: {
        cycles: 1,
        verdict: "approved",
        critical_findings_addressed: 0,
      },
    });
    // Human-curated fields default to empty arrays.
    expect(out.decisions).toEqual([]);
    expect(out.blockers).toEqual([]);
    expect(out.dead_ends).toEqual([]);
    expect(out.learnings).toEqual([]);
    expect(out.tags).toEqual([]);
    expect(out.parallel_with).toEqual([]);
  });

  // S38: schema cross-check via pnpm --filter @gjs/ats-core validate:episode
  test("happy-path stdout validates against EpisodeSchema (zod) via validate:episode", () => {
    expect(happyResult.status).toBe(0);
    const tmpFile = path.join(repo, "episode-out.json");
    writeFileSync(tmpFile, happyResult.stdout);
    const r = spawnSync(
      "pnpm",
      ["--filter", "@gjs/ats-core", "validate:episode", tmpFile],
      { cwd: REPO_ROOT, encoding: "utf-8" },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("validate-episode: ok");
  });
});
