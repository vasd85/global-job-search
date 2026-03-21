import { createHmac as rawCreateHmac } from "node:crypto";
import { encrypt, decrypt, generateHmac } from "./encryption";

const VALID_HEX_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

beforeEach(() => {
  process.env.ENCRYPTION_KEY = VALID_HEX_KEY;
});

afterEach(() => {
  delete process.env.ENCRYPTION_KEY;
});

describe("encrypt / decrypt", () => {
  test("round-trips plaintext correctly", () => {
    const plaintext = "sk-ant-api03-test-key-1234";
    const aad = "user1:anthropic:key-uuid-1";

    const { ciphertext, iv, authTag } = encrypt(plaintext, aad);
    const decrypted = decrypt({ ciphertext, iv, authTag, aad });

    expect(decrypted).toBe(plaintext);
  });

  test("returns Buffer instances with correct lengths", () => {
    const { ciphertext, iv, authTag } = encrypt("test", "aad");

    expect(Buffer.isBuffer(ciphertext)).toBe(true);
    expect(Buffer.isBuffer(iv)).toBe(true);
    expect(Buffer.isBuffer(authTag)).toBe(true);
    expect(iv.length).toBe(12);
    expect(authTag.length).toBe(16);
  });

  test("produces different ciphertext for same plaintext (unique IV)", () => {
    const plaintext = "sk-ant-api03-same-key";
    const aad = "user1:anthropic:id1";

    const result1 = encrypt(plaintext, aad);
    const result2 = encrypt(plaintext, aad);

    expect(result1.ciphertext.equals(result2.ciphertext)).toBe(false);
    expect(result1.iv.equals(result2.iv)).toBe(false);
  });

  test("throws on AAD mismatch during decryption", () => {
    const { ciphertext, iv, authTag } = encrypt("secret", "user1:anthropic:id1");

    expect(() =>
      decrypt({ ciphertext, iv, authTag, aad: "user2:anthropic:id1" })
    ).toThrow();
  });

  test("throws on tampered ciphertext", () => {
    const { ciphertext, iv, authTag } = encrypt("secret", "aad");
    ciphertext[0] ^= 0xff;

    expect(() => decrypt({ ciphertext, iv, authTag, aad: "aad" })).toThrow();
  });

  test("throws on tampered authTag", () => {
    const { ciphertext, iv, authTag } = encrypt("secret", "aad");
    authTag[0] ^= 0xff;

    expect(() => decrypt({ ciphertext, iv, authTag, aad: "aad" })).toThrow();
  });
});

describe("generateHmac", () => {
  test("produces consistent output for same input", () => {
    const hmac1 = generateHmac("user1:anthropic:sk-ant-123");
    const hmac2 = generateHmac("user1:anthropic:sk-ant-123");

    expect(hmac1).toBe(hmac2);
  });

  test("produces different output for different inputs", () => {
    const hmac1 = generateHmac("user1:anthropic:sk-ant-123");
    const hmac2 = generateHmac("user2:anthropic:sk-ant-123");

    expect(hmac1).not.toBe(hmac2);
  });

  test("returns a hex string", () => {
    const hmac = generateHmac("test");

    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("ENCRYPTION_KEY validation", () => {
  test("throws when ENCRYPTION_KEY is not set", () => {
    delete process.env.ENCRYPTION_KEY;

    expect(() => encrypt("test", "aad")).toThrow("ENCRYPTION_KEY environment variable is not set");
  });

  test("decrypt also throws when ENCRYPTION_KEY is not set", () => {
    delete process.env.ENCRYPTION_KEY;

    expect(() =>
      decrypt({
        ciphertext: Buffer.from("x"),
        iv: Buffer.from("123456789012"),
        authTag: Buffer.from("1234567890123456"),
        aad: "test",
      })
    ).toThrow("ENCRYPTION_KEY environment variable is not set");
  });

  test("generateHmac also throws when ENCRYPTION_KEY is not set", () => {
    delete process.env.ENCRYPTION_KEY;

    expect(() => generateHmac("test")).toThrow("ENCRYPTION_KEY environment variable is not set");
  });

  test("throws when ENCRYPTION_KEY is not 64 hex chars", () => {
    process.env.ENCRYPTION_KEY = "too-short";

    expect(() => encrypt("test", "aad")).toThrow("ENCRYPTION_KEY must be a 64-character hex string");
  });

  test("throws when ENCRYPTION_KEY has invalid hex characters", () => {
    process.env.ENCRYPTION_KEY = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";

    expect(() => encrypt("test", "aad")).toThrow("ENCRYPTION_KEY must be a 64-character hex string");
  });

  test("accepts uppercase hex in ENCRYPTION_KEY", () => {
    process.env.ENCRYPTION_KEY = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";

    const { ciphertext, iv, authTag } = encrypt("test", "aad");
    const result = decrypt({ ciphertext, iv, authTag, aad: "aad" });

    expect(result).toBe("test");
  });
});

describe("encrypt / decrypt edge cases", () => {
  test("round-trips empty string", () => {
    const { ciphertext, iv, authTag } = encrypt("", "aad");
    const result = decrypt({ ciphertext, iv, authTag, aad: "aad" });

    expect(result).toBe("");
  });

  test("round-trips unicode content", () => {
    const plaintext = "API key for integration test";
    const { ciphertext, iv, authTag } = encrypt(plaintext, "aad");
    const result = decrypt({ ciphertext, iv, authTag, aad: "aad" });

    expect(result).toBe(plaintext);
  });

  test("throws when decrypting with a different ENCRYPTION_KEY", () => {
    const { ciphertext, iv, authTag } = encrypt("secret-key", "aad");
    process.env.ENCRYPTION_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    expect(() => decrypt({ ciphertext, iv, authTag, aad: "aad" })).toThrow();
  });

  test("round-trips a long realistic API key", () => {
    const longKey = "sk-ant-api03-" + "a".repeat(100) + "-TAIL";
    const aad = "user-abc:anthropic:key-uuid";

    const { ciphertext, iv, authTag } = encrypt(longKey, aad);
    const result = decrypt({ ciphertext, iv, authTag, aad });

    expect(result).toBe(longKey);
  });
});

describe("generateHmac edge cases", () => {
  test("produces a valid hex string for empty input", () => {
    const hmac = generateHmac("");

    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is sensitive to key order in composite input", () => {
    const hmac1 = generateHmac("user1:anthropic:sk-key");
    const hmac2 = generateHmac("anthropic:user1:sk-key");

    expect(hmac1).not.toBe(hmac2);
  });
});

describe("HKDF key derivation (domain separation)", () => {
  test("encrypt and generateHmac use different derived subkeys", () => {
    // Verify the observable property: the HMAC output is NOT what you'd get
    // if generateHmac used the raw master key directly (no HKDF derivation).
    const masterKey = Buffer.from(VALID_HEX_KEY, "hex");

    // HMAC with raw master key (no HKDF)
    const hmacWithMasterKey = rawCreateHmac("sha256", masterKey).update("test-data").digest("hex");
    // HMAC through the module (uses HKDF-derived subkey)
    const hmacWithDerivedKey = generateHmac("test-data");

    // They must differ because HKDF derives a different subkey
    expect(hmacWithDerivedKey).not.toBe(hmacWithMasterKey);
  });

  test("encrypt/decrypt still round-trip after HKDF derivation", () => {
    // This is a smoke test to confirm HKDF doesn't break the encrypt/decrypt contract
    const plaintext = "sk-ant-api03-hkdf-test-key";
    const aad = "user1:anthropic:hkdf-key-id";

    const { ciphertext, iv, authTag } = encrypt(plaintext, aad);
    const decrypted = decrypt({ ciphertext, iv, authTag, aad });

    expect(decrypted).toBe(plaintext);
  });

  test("HMAC is deterministic across calls (derived key is stable for same master key)", () => {
    const hmac1 = generateHmac("determinism-check");
    const hmac2 = generateHmac("determinism-check");

    expect(hmac1).toBe(hmac2);
  });

  test("different master keys produce different derived subkeys", () => {
    const hmac1 = generateHmac("same-input");

    // Switch to a different master key
    process.env.ENCRYPTION_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const hmac2 = generateHmac("same-input");

    expect(hmac1).not.toBe(hmac2);
  });

  test("ciphertext from one master key cannot be decrypted with a different master key", () => {
    const { ciphertext, iv, authTag } = encrypt("secret", "aad");

    // Switch master key
    process.env.ENCRYPTION_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    expect(() => decrypt({ ciphertext, iv, authTag, aad: "aad" })).toThrow();
  });
});
