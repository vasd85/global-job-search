/**
 * Validate one episode log entry against `EpisodeSchema` (zod).
 *
 * Usage:
 *   pnpm --filter @gjs/ats-core validate:episode <path>
 *   npx tsx packages/ats-core/scripts/validate-episode.ts <path>
 *
 * Replaces the previous `npx ajv-cli@5` step in
 * `.claude/skills/log-episode/SKILL.md`. ajv-cli@5 rejects the schema's
 * `date-time` format under strict mode without an `ajv-formats` plugin;
 * driving validation directly off the zod schema source per ADR-0003
 * removes that footgun.
 *
 * Exit codes:
 *   0 — input file parses as JSON and matches `EpisodeSchema`.
 *   1 — argv missing, file unreadable, JSON malformed, or schema mismatch.
 */

import { readFileSync } from "node:fs";
import { EpisodeSchema } from "../src/episode-schema";

const inputPath = process.argv[2];
if (!inputPath) {
  process.stderr.write(
    "validate-episode: usage: validate-episode <path-to-json>\n",
  );
  process.exit(1);
}

let parsed: unknown;
try {
  parsed = JSON.parse(readFileSync(inputPath, "utf-8"));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`validate-episode: ${message}\n`);
  process.exit(1);
}

const result = EpisodeSchema.safeParse(parsed);
if (!result.success) {
  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    process.stdout.write(`${path} :: ${issue.code} :: ${issue.message}\n`);
  }
  process.exit(1);
}

process.stdout.write(`validate-episode: ok (${inputPath})\n`);
process.exit(0);
