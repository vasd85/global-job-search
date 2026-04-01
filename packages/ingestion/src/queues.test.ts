import { VENDOR_QUEUES, FUTURE_QUEUES } from "./queues";

// ─── VENDOR_QUEUES ──────────────────────────────────────────────────────────

describe("VENDOR_QUEUES", () => {
  test("maps all four supported vendors to correct queue names", () => {
    expect(VENDOR_QUEUES).toEqual({
      greenhouse: "poll/greenhouse",
      lever: "poll/lever",
      ashby: "poll/ashby",
      smartrecruiters: "poll/smartrecruiters",
    });
  });

  test("keys match the vendor strings used in the database atsVendor column", () => {
    const keys = Object.keys(VENDOR_QUEUES);
    expect(keys).toEqual(
      expect.arrayContaining([
        "greenhouse",
        "lever",
        "ashby",
        "smartrecruiters",
      ])
    );
    // Also confirm no unexpected keys
    expect(keys).toHaveLength(4);
  });

  test("has exactly 4 entries (guards against accidental add/remove)", () => {
    expect(Object.keys(VENDOR_QUEUES)).toHaveLength(4);
  });
});

// ─── FUTURE_QUEUES ──────────────────────────────────────────────────────────

describe("FUTURE_QUEUES", () => {
  test("has expected keys for future job types", () => {
    const keys = Object.keys(FUTURE_QUEUES);
    expect(keys).toEqual(
      expect.arrayContaining([
        "llmScoring",
        "internetExpansion",
        "descriptionFetch",
        "roleTaxonomy",
      ])
    );
  });
});

// ─── Queue name format ──────────────────────────────────────────────────────

describe("queue name format", () => {
  const allQueues = [
    ...Object.entries(VENDOR_QUEUES),
    ...Object.entries(FUTURE_QUEUES),
  ];

  test.each(allQueues)(
    '%s -> "%s" follows prefix/name convention',
    (_key, value) => {
      // pg-boss allows alphanumeric, underscores, hyphens, periods, forward slashes.
      // Our convention: prefix/name with lowercase letters and hyphens.
      expect(value).toMatch(/^[a-z]+\/[a-z-]+$/);
    }
  );
});
