/**
 * Generate `docs/episodes/schema.json` from the zod schema in
 * `packages/ats-core/src/episode-schema.ts`.
 *
 * Usage:
 *   pnpm --filter @gjs/ats-core gen:episode-schema
 *   npx tsx packages/ats-core/scripts/gen-episode-schema.ts
 *
 * Run this whenever `episode-schema.ts` changes. CI catches forgotten
 * regenerations via the drift test in `episode-schema.test.ts`.
 *
 * Decision rationale: see ADR-0003.
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateEpisodeSchemaJson } from "../src/episode-schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "episodes",
  "schema.json",
);

const serialised = generateEpisodeSchemaJson();
writeFileSync(SCHEMA_PATH, serialised);

process.stdout.write(`wrote ${SCHEMA_PATH} (${serialised.length} bytes)\n`);
