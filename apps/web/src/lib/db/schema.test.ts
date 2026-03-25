// @vitest-environment node
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  appConfig,
  roleFamilies,
  userCompanyPreferences,
  companies,
  userProfiles,
  jobMatches,
} from "./schema";

// ---------------------------------------------------------------------------
// appConfig
// ---------------------------------------------------------------------------

describe("appConfig table definition", () => {
  const cols = getTableColumns(appConfig);

  it("uses text PK, not uuid", () => {
    expect(cols.key.primary).toBe(true);
    expect(cols.key.dataType).toBe("string");
    expect(cols.key.hasDefault).toBe(false);
  });

  it("value column is jsonb and not null", () => {
    expect(cols.value.dataType).toBe("json");
    expect(cols.value.notNull).toBe(true);
  });

  it("description column is nullable text", () => {
    expect(cols.description.dataType).toBe("string");
    expect(cols.description.notNull).toBe(false);
  });

  it("updatedAt has defaultNow and is not null", () => {
    expect(cols.updatedAt.notNull).toBe(true);
    expect(cols.updatedAt.hasDefault).toBe(true);
  });

  it("has no createdAt column (intentional for upsert-only table)", () => {
    expect(cols).not.toHaveProperty("createdAt");
  });

  it("has exactly 4 columns", () => {
    expect(Object.keys(cols)).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// roleFamilies
// ---------------------------------------------------------------------------

describe("roleFamilies table definition", () => {
  const cols = getTableColumns(roleFamilies);

  it("PK is uuid with defaultRandom", () => {
    expect(cols.id.primary).toBe(true);
    expect(cols.id.dataType).toBe("string");
    expect(cols.id.hasDefault).toBe(true);
  });

  it("slug is unique and not null", () => {
    expect(cols.slug.notNull).toBe(true);
    expect(cols.slug.isUnique).toBe(true);
  });

  it("name is not null", () => {
    expect(cols.name.notNull).toBe(true);
  });

  it.each<[string]>([
    ["strongMatch"],
    ["moderateMatch"],
    ["departmentBoost"],
    ["departmentExclude"],
  ])("%s is a nullable text array", (colName) => {
    const col = cols[colName as keyof typeof cols];
    expect(col.dataType).toBe("array");
    expect(col.notNull).toBe(false);
  });

  it("isSystemDefined defaults to true and is not null", () => {
    expect(cols.isSystemDefined.notNull).toBe(true);
    expect(cols.isSystemDefined.hasDefault).toBe(true);
    expect(cols.isSystemDefined.default).toBe(true);
  });

  it.each<[string]>([["createdAt"], ["updatedAt"]])(
    "%s is present with defaultNow and not null",
    (colName) => {
      const col = cols[colName as keyof typeof cols];
      expect(col.notNull).toBe(true);
      expect(col.hasDefault).toBe(true);
    },
  );

  it.each<[string, string]>([
    ["strongMatch", "strong_match"],
    ["moderateMatch", "moderate_match"],
    ["departmentBoost", "department_boost"],
    ["departmentExclude", "department_exclude"],
    ["isSystemDefined", "is_system_defined"],
    ["createdAt", "created_at"],
    ["updatedAt", "updated_at"],
  ])("%s maps to DB column %s", (propName, dbName) => {
    const col = cols[propName as keyof typeof cols];
    expect(col.name).toBe(dbName);
  });
});

// ---------------------------------------------------------------------------
// userCompanyPreferences
// ---------------------------------------------------------------------------

describe("userCompanyPreferences table definition", () => {
  const cols = getTableColumns(userCompanyPreferences);

  it("PK is uuid with defaultRandom", () => {
    expect(cols.id.primary).toBe(true);
    expect(cols.id.dataType).toBe("string");
    expect(cols.id.hasDefault).toBe(true);
  });

  it("userId is not null and unique", () => {
    expect(cols.userId.notNull).toBe(true);
    expect(cols.userId.isUnique).toBe(true);
  });

  it("userId references user table with cascade delete", () => {
    const config = getTableConfig(userCompanyPreferences);
    const userIdFk = config.foreignKeys.find((fk) => {
      const ref = fk.reference();
      return ref.columns.some((c) => c.name === "user_id");
    });
    expect(userIdFk).toBeDefined();
    expect(userIdFk!.onDelete).toBe("cascade");
    const ref = userIdFk!.reference();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const foreignTableConfig = getTableConfig(ref.foreignTable as any);
    expect(foreignTableConfig.name).toBe("user");
  });

  it.each<[string]>([
    ["industries"],
    ["companySizes"],
    ["companyStages"],
    ["hqGeographies"],
    ["productTypes"],
    ["exclusions"],
  ])("%s is a nullable text array", (colName) => {
    const col = cols[colName as keyof typeof cols];
    expect(col.dataType).toBe("array");
    expect(col.notNull).toBe(false);
  });

  it("workFormat is nullable text (not array)", () => {
    expect(cols.workFormat.dataType).toBe("string");
    expect(cols.workFormat.notNull).toBe(false);
  });

  it("has exactly 11 columns", () => {
    expect(Object.keys(cols)).toHaveLength(11);
  });
});

// ---------------------------------------------------------------------------
// companies (new columns)
// ---------------------------------------------------------------------------

describe("companies table — new polling columns", () => {
  const cols = getTableColumns(companies);

  it("consecutiveErrors is integer, not null, defaults to 0", () => {
    expect(cols.consecutiveErrors.dataType).toBe("number");
    expect(cols.consecutiveErrors.notNull).toBe(true);
    expect(cols.consecutiveErrors.hasDefault).toBe(true);
    expect(cols.consecutiveErrors.default).toBe(0);
  });

  it("pollPriority is text, not null, defaults to 'daily'", () => {
    expect(cols.pollPriority.dataType).toBe("string");
    expect(cols.pollPriority.notNull).toBe(true);
    expect(cols.pollPriority.hasDefault).toBe(true);
    expect(cols.pollPriority.default).toBe("daily");
  });

  it("nextPollAfter is nullable timestamp", () => {
    expect(cols.nextPollAfter.dataType).toBe("date");
    expect(cols.nextPollAfter.notNull).toBe(false);
  });

  it("new columns coexist with existing polling columns", () => {
    const pollingColumns = [
      "lastPolledAt",
      "lastPollStatus",
      "lastPollError",
      "consecutiveErrors",
      "pollPriority",
      "nextPollAfter",
    ];
    for (const name of pollingColumns) {
      expect(cols).toHaveProperty(name);
    }
  });
});

// ---------------------------------------------------------------------------
// userProfiles (renames + new columns + default changes)
// ---------------------------------------------------------------------------

describe("userProfiles table — MDSC to RSLCD migration", () => {
  const cols = getTableColumns(userProfiles);

  it("old column names do NOT exist (renames completed)", () => {
    expect(cols).not.toHaveProperty("primarySkills");
    expect(cols).not.toHaveProperty("secondarySkills");
    expect(cols).not.toHaveProperty("weightMobility");
  });

  it.each<[string, string]>([
    ["coreSkills", "core_skills"],
    ["growthSkills", "growth_skills"],
    ["weightRole", "weight_role"],
  ])("%s exists with DB column name %s", (propName, dbName) => {
    const col = cols[propName as keyof typeof cols];
    expect(col).toBeDefined();
    expect(col.name).toBe(dbName);
  });

  it("RSLCD weight defaults sum to 1.0", () => {
    const weightColumns = [
      cols.weightRole,
      cols.weightSkills,
      cols.weightLocation,
      cols.weightCompensation,
      cols.weightDomain,
    ];

    const sum = weightColumns.reduce((acc, col) => {
      expect(col.hasDefault).toBe(true);
      return acc + (col.default as number);
    }, 0);

    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("weightRole default changed from 0.3 to 0.25", () => {
    expect(cols.weightRole.hasDefault).toBe(true);
    expect(cols.weightRole.default).toBe(0.25);
  });

  it("weightCompensation default changed from 0.3 to 0.15", () => {
    expect(cols.weightCompensation.hasDefault).toBe(true);
    expect(cols.weightCompensation.default).toBe(0.15);
  });

  it("weightLocation is a new column with default 0.20 and notNull", () => {
    expect(cols.weightLocation.dataType).toBe("number");
    expect(cols.weightLocation.notNull).toBe(true);
    expect(cols.weightLocation.hasDefault).toBe(true);
    expect(cols.weightLocation.default).toBe(0.2);
  });

  it.each<[string]>([["avoidSkills"], ["dealBreakers"]])(
    "%s is a nullable text array",
    (colName) => {
      const col = cols[colName as keyof typeof cols];
      expect(col.dataType).toBe("array");
      expect(col.notNull).toBe(false);
    },
  );

  it("targetSalary is nullable integer", () => {
    expect(cols.targetSalary.dataType).toBe("number");
    expect(cols.targetSalary.notNull).toBe(false);
    expect(cols.targetSalary.hasDefault).toBe(false);
  });

  it("salaryCurrency defaults to 'USD'", () => {
    expect(cols.salaryCurrency.dataType).toBe("string");
    expect(cols.salaryCurrency.hasDefault).toBe(true);
    expect(cols.salaryCurrency.default).toBe("USD");
  });

  it.each<[string]>([
    ["weightRole"],
    ["weightSkills"],
    ["weightLocation"],
    ["weightCompensation"],
    ["weightDomain"],
  ])("%s is present, real type, and notNull", (colName) => {
    const col = cols[colName as keyof typeof cols];
    expect(col).toBeDefined();
    expect(col.dataType).toBe("number");
    expect(col.notNull).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// jobMatches (rename + new column)
// ---------------------------------------------------------------------------

describe("jobMatches table — RSLCD score columns", () => {
  const cols = getTableColumns(jobMatches);

  it("old column name scoreM does NOT exist", () => {
    expect(cols).not.toHaveProperty("scoreM");
  });

  it("scoreR exists with correct DB column name score_r", () => {
    expect(cols.scoreR).toBeDefined();
    expect(cols.scoreR.name).toBe("score_r");
    expect(cols.scoreR.dataType).toBe("number");
    expect(cols.scoreR.notNull).toBe(false);
  });

  it("scoreL exists as nullable integer with DB name score_l", () => {
    expect(cols.scoreL).toBeDefined();
    expect(cols.scoreL.name).toBe("score_l");
    expect(cols.scoreL.dataType).toBe("number");
    expect(cols.scoreL.notNull).toBe(false);
  });

  it("all five RSLCD score columns are present", () => {
    const scoreColumns = ["scoreR", "scoreS", "scoreL", "scoreC", "scoreD"];
    for (const name of scoreColumns) {
      expect(cols).toHaveProperty(name);
    }
  });

  it.each<[string]>([
    ["scoreR"],
    ["scoreS"],
    ["scoreL"],
    ["scoreC"],
    ["scoreD"],
  ])("%s is nullable (scores populated asynchronously)", (colName) => {
    const col = cols[colName as keyof typeof cols];
    expect(col.notNull).toBe(false);
  });

  it("existing columns scoreS, scoreC, scoreD, matchPercent remain present", () => {
    expect(cols.scoreS).toBeDefined();
    expect(cols.scoreC).toBeDefined();
    expect(cols.scoreD).toBeDefined();
    expect(cols.matchPercent).toBeDefined();
    expect(cols.matchPercent.dataType).toBe("number");
  });
});
