import { sha1, sha256 } from "./hash";

describe("sha1", () => {
  test.each([
    ["test", "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3"],
    ["abc", "a9993e364706816aba3e25717850c26c9cd0d89d"],
    ["", "da39a3ee5e6b4b0d3255bfef95601890afd80709"],
  ])("returns correct hex digest for %j", (input, expected) => {
    expect(sha1(input)).toBe(expected);
  });

  test("returns a 40-char lowercase hex string", () => {
    expect(sha1("anything")).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("sha256", () => {
  test.each([
    ["test", "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ])("returns correct hex digest for %j", (input, expected) => {
    expect(sha256(input)).toBe(expected);
  });

  test("returns a 64-char lowercase hex string", () => {
    expect(sha256("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});
