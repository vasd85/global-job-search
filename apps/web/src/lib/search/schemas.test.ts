import { SearchQuerySchema } from "./schemas";

describe("SearchQuerySchema", () => {
  describe("defaults", () => {
    test("applies defaults when no values provided", () => {
      const result = SearchQuerySchema.parse({});
      expect(result).toEqual({ limit: 50, offset: 0 });
    });

    test("applies defaults for null and undefined values", () => {
      const result = SearchQuerySchema.parse({
        limit: undefined,
        offset: undefined,
      });
      expect(result).toEqual({ limit: 50, offset: 0 });
    });
  });

  describe("coercion", () => {
    test("coerces string numbers correctly", () => {
      const result = SearchQuerySchema.parse({ limit: "25", offset: "100" });
      expect(result).toEqual({ limit: 25, offset: 100 });
    });
  });

  describe("limit boundaries", () => {
    test.each([
      [1, true, "minimum valid"],
      [200, true, "maximum valid"],
      [0, false, "below min"],
      [201, false, "above max"],
      [-1, false, "negative"],
    ])("limit=%s -> %s (%s)", (limit, shouldPass) => {
      const result = SearchQuerySchema.safeParse({ limit });
      expect(result.success).toBe(shouldPass);
    });
  });

  describe("non-integer values are rejected", () => {
    test.each([
      [{ limit: 2.5 }, "numeric float limit"],
      [{ limit: "2.5" }, "string float limit"],
      [{ offset: 1.1 }, "numeric float offset"],
    ])("%s (%s)", (input, _desc) => {
      const result = SearchQuerySchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("offset boundaries", () => {
    test("offset 0 is valid", () => {
      const result = SearchQuerySchema.safeParse({ offset: 0 });
      expect(result.success).toBe(true);
    });

    test("negative offset is rejected", () => {
      const result = SearchQuerySchema.safeParse({ offset: -1 });
      expect(result.success).toBe(false);
    });
  });

  describe("non-numeric strings are rejected", () => {
    test.each([
      [{ limit: "abc" }, "alphabetic string"],
      [{ limit: "NaN" }, "NaN string"],
      [{ limit: "" }, "empty string"],
    ])("%s (%s)", (input, _desc) => {
      const result = SearchQuerySchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
