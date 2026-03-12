import { sha1, sha256 } from "./hash";

describe("sha1", () => {
  test("returns correct hex digest for known test vector 'test'", () => {
    // RFC 3174 / widely-known reference value
    expect(sha1("test")).toBe(
      "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3",
    );
  });

  test("returns correct hex digest for 'abc'", () => {
    expect(sha1("abc")).toBe(
      "a9993e364706816aba3e25717850c26c9cd0d89d",
    );
  });

  test("returns correct hex digest for empty string", () => {
    expect(sha1("")).toBe(
      "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    );
  });

  test("handles unicode input (emoji)", () => {
    const hash = sha1("\u{1F600}"); // grinning face emoji
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    // Ensure it is deterministic
    expect(sha1("\u{1F600}")).toBe(hash);
  });

  test("handles unicode input (multibyte characters)", () => {
    const hash = sha1("\u00e9\u00e0\u00fc"); // e-acute, a-grave, u-umlaut
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    expect(sha1("\u00e9\u00e0\u00fc")).toBe(hash);
  });

  test("handles long string input", () => {
    const longString = "a".repeat(100_000);
    const hash = sha1(longString);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    // Deterministic across calls
    expect(sha1(longString)).toBe(hash);
  });

  test("produces different hashes for different inputs", () => {
    expect(sha1("hello")).not.toBe(sha1("world"));
  });

  test("always returns a 40-character lowercase hex string", () => {
    const inputs = ["foo", "bar", "12345", " ", "\n"];
    for (const input of inputs) {
      expect(sha1(input)).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});

describe("sha256", () => {
  test("returns correct hex digest for known test vector 'test'", () => {
    expect(sha256("test")).toBe(
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    );
  });

  test("returns correct hex digest for 'abc'", () => {
    // NIST FIPS 180-4 one-block test vector
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("returns correct hex digest for empty string", () => {
    expect(sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("handles unicode input (emoji)", () => {
    const hash = sha256("\u{1F600}");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("\u{1F600}")).toBe(hash);
  });

  test("handles unicode input (multibyte characters)", () => {
    const hash = sha256("\u00e9\u00e0\u00fc");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("\u00e9\u00e0\u00fc")).toBe(hash);
  });

  test("handles long string input", () => {
    const longString = "b".repeat(100_000);
    const hash = sha256(longString);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(longString)).toBe(hash);
  });

  test("produces different hashes for different inputs", () => {
    expect(sha256("hello")).not.toBe(sha256("world"));
  });

  test("always returns a 64-character lowercase hex string", () => {
    const inputs = ["foo", "bar", "12345", " ", "\n"];
    for (const input of inputs) {
      expect(sha256(input)).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
