// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  import.meta.dirname,
  "../../../drizzle/0003_useful_the_anarchist.sql",
);
const migrationSql = readFileSync(migrationPath, "utf-8");

describe("migration 0003: Schema P3 (MDSC to RSLCD)", () => {
  describe("column renames use ALTER RENAME, not DROP+ADD", () => {
    it.each<[string, string, string]>([
      ["job_match", "score_m", "score_r"],
      ["user_profile", "primary_skills", "core_skills"],
      ["user_profile", "secondary_skills", "growth_skills"],
      ["user_profile", "weight_mobility", "weight_role"],
    ])(
      '%s: RENAME COLUMN "%s" TO "%s"',
      (table, oldCol, newCol) => {
        expect(migrationSql).toContain(
          `ALTER TABLE "${table}" RENAME COLUMN "${oldCol}" TO "${newCol}"`,
        );
      },
    );
  });

  it("includes SET DEFAULT 0.25 for weight_role", () => {
    expect(migrationSql).toContain(
      'ALTER TABLE "user_profile" ALTER COLUMN "weight_role" SET DEFAULT 0.25',
    );
  });

  it("includes SET DEFAULT 0.15 for weight_compensation", () => {
    expect(migrationSql).toContain(
      'ALTER TABLE "user_profile" ALTER COLUMN "weight_compensation" SET DEFAULT 0.15',
    );
  });

  it("foreign key on user_company_preference references user table with cascade", () => {
    expect(migrationSql).toContain(
      'FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade',
    );
  });

  it("does NOT contain DROP COLUMN statements", () => {
    expect(migrationSql).not.toContain("DROP COLUMN");
  });

  it("does NOT contain DROP TABLE statements", () => {
    expect(migrationSql).not.toContain("DROP TABLE");
  });
});
