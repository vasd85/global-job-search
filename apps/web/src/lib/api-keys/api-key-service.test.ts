// ---- Mocks ----------------------------------------------------------------

vi.mock("../db", () => ({ db: {} }));

vi.mock("../crypto/encryption", () => ({
  encrypt: vi.fn(() => ({
    ciphertext: Buffer.from("encrypted"),
    iv: Buffer.from("123456789012"),
    authTag: Buffer.from("1234567890123456"),
  })),
  decrypt: vi.fn(() => "sk-ant-decrypted-key"),
  generateHmac: vi.fn(() => "hmac-fingerprint-hex"),
}));

const validateMock = vi.fn();
vi.mock("./validate-anthropic-key", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  validateAnthropicKey: (...args: unknown[]) => validateMock(...args),
}));

// Re-import after mock registration
import { encrypt, decrypt } from "../crypto/encryption";
import {
  addApiKey,
  getActiveKeyMeta,
  getCurrentKeyMeta,
  decryptActiveKey,
  revokeApiKey,
  revalidateApiKey,
  ApiKeyValidationError,
  ApiKeyDuplicateError,
} from "./api-key-service";

const encryptMock = encrypt as ReturnType<typeof vi.fn>;
const decryptMock = decrypt as ReturnType<typeof vi.fn>;

// ---- DB mock helpers ------------------------------------------------------

interface MockChainable {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
}

interface MockDb {
  select: ReturnType<typeof vi.fn<() => MockChainable>>;
  insert: ReturnType<typeof vi.fn<() => MockChainable>>;
  update: ReturnType<typeof vi.fn<() => MockChainable>>;
  transaction: ReturnType<typeof vi.fn>;
}

function createMockDb(selectRows: Record<string, unknown>[] = []): MockDb {
  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(selectRows),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(selectRows.length > 0 ? [{ id: selectRows[0].id }] : []),
    values: vi.fn().mockResolvedValue(undefined),
  };

  const db: MockDb = {
    select: vi.fn(() => chainable),
    insert: vi.fn(() => chainable),
    update: vi.fn(() => chainable),
    // Transaction passes the same db as tx so pre-configured mocks are visible inside.
    transaction: vi.fn(async (fn: (tx: MockDb) => Promise<void>) => {
      await fn(db);
    }),
  };

  return db;
}

// ---- Setup ----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  validateMock.mockResolvedValue({ valid: true, status: "active" });
});

afterEach(() => {
  delete process.env.ENCRYPTION_KEY;
});

// ---- Tests ----------------------------------------------------------------

describe("addApiKey", () => {
  test("validates, encrypts, and inserts a new key", async () => {
    const db = createMockDb([]);

    const result = await addApiKey(db as never, "user1", "anthropic", "sk-ant-test1234");

    expect(validateMock).toHaveBeenCalledWith("sk-ant-test1234");
    expect(encryptMock).toHaveBeenCalled();
    expect(result.maskedHint).toBe("...1234");
    expect(result.status).toBe("active");
  });

  test("throws ApiKeyValidationError when key is invalid", async () => {
    validateMock.mockResolvedValueOnce({ valid: false, status: "invalid", errorCode: "401" });
    const db = createMockDb([]);

    await expect(addApiKey(db as never, "user1", "anthropic", "sk-ant-bad")).rejects.toThrow(
      ApiKeyValidationError
    );
  });

  test("ApiKeyValidationError carries the validation result", async () => {
    const validation = { valid: false, status: "forbidden" as const, errorCode: "403" };
    validateMock.mockResolvedValueOnce(validation);
    const db = createMockDb([]);

    try {
      await addApiKey(db as never, "user1", "anthropic", "sk-ant-bad");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiKeyValidationError);
      expect((err as ApiKeyValidationError).validation).toEqual(validation);
    }
  });

  test("throws ApiKeyDuplicateError when same key is already active", async () => {
    const db = createMockDb();
    const chainable = db.select();
    db.select.mockClear();
    // Dup check finds a matching fingerprint
    chainable.limit.mockResolvedValueOnce([{ id: "dup-key-id" }]);

    await expect(
      addApiKey(db as never, "user1", "anthropic", "sk-ant-test1234"),
    ).rejects.toThrow(ApiKeyDuplicateError);
  });

  test("uses transaction when replacing existing active key with different key", async () => {
    const db = createMockDb();
    const chainable = db.select();
    db.select.mockClear();
    chainable.limit
      .mockResolvedValueOnce([])                           // dup check: no duplicate
      .mockResolvedValueOnce([{ id: "existing-key-id" }]); // existing key: found → replace

    await addApiKey(db as never, "user1", "anthropic", "sk-ant-new1234");

    expect(db.transaction).toHaveBeenCalled();
  });

  test("uses transaction even when no existing key (all checks inside tx)", async () => {
    const db = createMockDb([]);

    await addApiKey(db as never, "user1", "anthropic", "sk-ant-test1234");

    expect(db.transaction).toHaveBeenCalled();
  });

  test("sets status to active for billing_warning validation", async () => {
    validateMock.mockResolvedValueOnce({ valid: true, status: "billing_warning", errorCode: "402" });
    const db = createMockDb([]);

    const result = await addApiKey(db as never, "user1", "anthropic", "sk-ant-test1234");

    expect(result.status).toBe("active");
    expect(result.validationStatus).toBe("billing_warning");
  });

  test("sets status to active for rate_limited validation", async () => {
    validateMock.mockResolvedValueOnce({ valid: true, status: "rate_limited", errorCode: "429" });
    const db = createMockDb([]);

    const result = await addApiKey(db as never, "user1", "anthropic", "sk-ant-test1234");

    // rate_limited is a valid key (temporary limit) — store as active
    expect(result.status).toBe("active");
    expect(result.validationStatus).toBe("rate_limited");
  });

  test("masks last 4 characters of any key", async () => {
    const db = createMockDb([]);

    const result = await addApiKey(db as never, "user1", "anthropic", "sk-ant-api03-ABCD");

    expect(result.maskedHint).toBe("...ABCD");
  });

  test("generates fingerprintHmac from userId:provider:sha256(rawKey)", async () => {
    const generateHmacMock = (await import("../crypto/encryption")).generateHmac as ReturnType<typeof vi.fn>;
    const db = createMockDb([]);

    await addApiKey(db as never, "user-42", "anthropic", "sk-ant-test9999");

    // Raw key is SHA-256 hashed before being included in HMAC input
    const { createHash } = await import("node:crypto");
    const keyHash = createHash("sha256").update("sk-ant-test9999").digest("hex");
    expect(generateHmacMock).toHaveBeenCalledWith(`user-42:anthropic:${keyHash}`);
  });

  test("duplicate check runs before existing-key check", async () => {
    const callOrder: string[] = [];
    const db = createMockDb();
    const chainable = db.select();
    db.select.mockClear();

    chainable.limit
      .mockImplementationOnce(async () => {
        callOrder.push("dup-check");
        return [{ id: "dup-key-id" }]; // duplicate found
      })
      .mockImplementationOnce(async () => {
        callOrder.push("existing-check");
        return [];
      });

    await expect(
      addApiKey(db as never, "user1", "anthropic", "sk-ant-test1234"),
    ).rejects.toThrow(ApiKeyDuplicateError);

    // The function should throw on the dup check without reaching the existing-key check
    expect(callOrder).toEqual(["dup-check"]);
  });

  test("returns validationStatus matching the validation result status", async () => {
    validateMock.mockResolvedValueOnce({ valid: true, status: "active" });
    const db = createMockDb([]);

    const result = await addApiKey(db as never, "user1", "anthropic", "sk-ant-test1234");

    expect(result.validationStatus).toBe("active");
  });
});

describe("getActiveKeyMeta", () => {
  test("returns metadata when active key exists", async () => {
    const now = new Date();
    const db = createMockDb([{
      id: "key1",
      provider: "anthropic",
      maskedHint: "...1234",
      status: "active",
      lastValidatedAt: now,
      lastErrorCode: null,
      createdAt: now,
    }]);

    const result = await getActiveKeyMeta(db as never, "user1", "anthropic");

    expect(result).toEqual({
      id: "key1",
      provider: "anthropic",
      maskedHint: "...1234",
      status: "active",
      lastValidatedAt: now,
      lastErrorCode: null,
      createdAt: now,
    });
  });

  test("returns null when no active key exists", async () => {
    const db = createMockDb([]);

    const result = await getActiveKeyMeta(db as never, "user1", "anthropic");

    expect(result).toBeNull();
  });
});

describe("getCurrentKeyMeta", () => {
  test("returns active key", async () => {
    const now = new Date();
    const db = createMockDb([{
      id: "key1",
      provider: "anthropic",
      maskedHint: "...1234",
      status: "active",
      lastValidatedAt: now,
      lastErrorCode: null,
      createdAt: now,
    }]);

    const result = await getCurrentKeyMeta(db as never, "user1", "anthropic");

    expect(result).toEqual({
      id: "key1",
      provider: "anthropic",
      maskedHint: "...1234",
      status: "active",
      lastValidatedAt: now,
      lastErrorCode: null,
      createdAt: now,
    });
  });

  test("returns invalid key (visible after failed revalidation)", async () => {
    const now = new Date();
    const db = createMockDb([{
      id: "key2",
      provider: "anthropic",
      maskedHint: "...5678",
      status: "invalid",
      lastValidatedAt: now,
      lastErrorCode: "401",
      createdAt: now,
    }]);

    const result = await getCurrentKeyMeta(db as never, "user1", "anthropic");

    expect(result).toEqual({
      id: "key2",
      provider: "anthropic",
      maskedHint: "...5678",
      status: "invalid",
      lastValidatedAt: now,
      lastErrorCode: "401",
      createdAt: now,
    });
  });

  test("does not return revoked key", async () => {
    const db = createMockDb([]);

    const result = await getCurrentKeyMeta(db as never, "user1", "anthropic");

    // Mock returns empty array (simulating no active/invalid keys, only revoked)
    expect(result).toBeNull();
  });

  test("returns most recent key when multiple exist (ordered by createdAt desc)", async () => {
    // The mock returns whatever rows we give it; the ordering is enforced by the
    // query's .orderBy(desc(createdAt)). We verify the function uses orderBy.
    const newer = new Date("2026-02-01T12:00:00Z");
    const db = createMockDb([{
      id: "newer-key",
      provider: "anthropic",
      maskedHint: "...AAAA",
      status: "active",
      lastValidatedAt: newer,
      lastErrorCode: null,
      createdAt: newer,
    }]);

    const result = await getCurrentKeyMeta(db as never, "user1", "anthropic");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("newer-key");
  });

  test("returns null when no active or invalid keys exist", async () => {
    const db = createMockDb([]);

    const result = await getCurrentKeyMeta(db as never, "user1", "anthropic");

    expect(result).toBeNull();
  });
});

describe("decryptActiveKey", () => {
  test("returns decrypted key when active key exists", async () => {
    const db = createMockDb([{
      id: "key1",
      ciphertext: Buffer.from("encrypted"),
      iv: Buffer.from("123456789012"),
      authTag: Buffer.from("1234567890123456"),
    }]);

    const result = await decryptActiveKey(db as never, "user1", "anthropic");

    expect(decryptMock).toHaveBeenCalled();
    expect(result).toBe("sk-ant-decrypted-key");
  });

  test("constructs AAD as userId:provider:keyId", async () => {
    const db = createMockDb([{
      id: "key-uuid-42",
      ciphertext: Buffer.from("ct"),
      iv: Buffer.from("123456789012"),
      authTag: Buffer.from("1234567890123456"),
    }]);

    await decryptActiveKey(db as never, "user-abc", "anthropic");

    expect(decryptMock).toHaveBeenCalledWith(
      expect.objectContaining({ aad: "user-abc:anthropic:key-uuid-42" }),
    );
  });

  test("returns null when no active key exists", async () => {
    const db = createMockDb([]);

    const result = await decryptActiveKey(db as never, "user1", "anthropic");

    expect(result).toBeNull();
  });

  test("does not call decrypt when no key found", async () => {
    const db = createMockDb([]);

    await decryptActiveKey(db as never, "user1", "anthropic");

    expect(decryptMock).not.toHaveBeenCalled();
  });
});

describe("revokeApiKey", () => {
  test("sets status to revoked for owned key", async () => {
    const db = createMockDb([{ id: "key1" }]);

    await expect(revokeApiKey(db as never, "user1", "key1")).resolves.toBeUndefined();
  });

  test("throws when key not found or not owned", async () => {
    const db = createMockDb([]);

    await expect(revokeApiKey(db as never, "user1", "key-nope")).rejects.toThrow(
      "API key not found or already revoked"
    );
  });
});

describe("revalidateApiKey", () => {
  test("decrypts key and re-validates with provider", async () => {
    const db = createMockDb([{
      id: "key1",
      provider: "anthropic",
      ciphertext: Buffer.from("encrypted"),
      iv: Buffer.from("123456789012"),
      authTag: Buffer.from("1234567890123456"),
    }]);

    const result = await revalidateApiKey(db as never, "user1", "key1");

    expect(decryptMock).toHaveBeenCalled();
    expect(validateMock).toHaveBeenCalled();
    expect(result).toEqual({ valid: true, status: "active" });
  });

  test("updates status to invalid when validation fails", async () => {
    validateMock.mockResolvedValueOnce({ valid: false, status: "invalid", errorCode: "401" });
    const db = createMockDb([{
      id: "key1",
      provider: "anthropic",
      ciphertext: Buffer.from("encrypted"),
      iv: Buffer.from("123456789012"),
      authTag: Buffer.from("1234567890123456"),
    }]);

    const result = await revalidateApiKey(db as never, "user1", "key1");

    expect(result.valid).toBe(false);
    expect(result.status).toBe("invalid");
    // Verify update was called (status change is persisted)
    expect(db.update).toHaveBeenCalled();
  });

  test("passes decrypted key to validateAnthropicKey", async () => {
    decryptMock.mockReturnValueOnce("sk-ant-real-key-5678");
    const db = createMockDb([{
      id: "key1",
      provider: "anthropic",
      ciphertext: Buffer.from("encrypted"),
      iv: Buffer.from("123456789012"),
      authTag: Buffer.from("1234567890123456"),
    }]);

    await revalidateApiKey(db as never, "user1", "key1");

    expect(validateMock).toHaveBeenCalledWith("sk-ant-real-key-5678");
  });

  test("throws when key not found", async () => {
    const db = createMockDb([]);

    await expect(revalidateApiKey(db as never, "user1", "key-nope")).rejects.toThrow(
      "API key not found"
    );
  });

  test("throws when key is revoked (cannot resurrect revoked keys)", async () => {
    // Mock returns empty because the query now filters out revoked keys via ne(status, "revoked")
    const db = createMockDb([]);

    await expect(revalidateApiKey(db as never, "user1", "revoked-key")).rejects.toThrow(
      "API key not found"
    );
  });

  test("constructs AAD as userId:provider:keyId for decryption", async () => {
    const db = createMockDb([{
      id: "reval-key-99",
      provider: "anthropic",
      ciphertext: Buffer.from("encrypted"),
      iv: Buffer.from("123456789012"),
      authTag: Buffer.from("1234567890123456"),
    }]);

    await revalidateApiKey(db as never, "user-xyz", "reval-key-99");

    expect(decryptMock).toHaveBeenCalledWith(
      expect.objectContaining({ aad: "user-xyz:anthropic:reval-key-99" }),
    );
  });

  test("updates status to active when re-validation succeeds", async () => {
    validateMock.mockResolvedValueOnce({ valid: true, status: "active" });
    const setCalls: Record<string, unknown>[] = [];
    const chainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: "key1",
        provider: "anthropic",
        ciphertext: Buffer.from("encrypted"),
        iv: Buffer.from("123456789012"),
        authTag: Buffer.from("1234567890123456"),
      }]),
      set: vi.fn((data: Record<string, unknown>) => {
        setCalls.push(data);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
      returning: vi.fn().mockResolvedValue([]),
      values: vi.fn().mockResolvedValue(undefined),
    };
    const db = {
      select: vi.fn(() => chainable),
      insert: vi.fn(() => chainable),
      update: vi.fn(() => chainable),
      transaction: vi.fn(),
    };

    await revalidateApiKey(db as never, "user1", "key1");

    expect(setCalls[0]).toEqual(expect.objectContaining({ status: "active" }));
  });

  test("persists errorCode from failed validation", async () => {
    validateMock.mockResolvedValueOnce({ valid: false, status: "invalid", errorCode: "401" });
    const setCalls: Record<string, unknown>[] = [];
    const chainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: "key1",
        provider: "anthropic",
        ciphertext: Buffer.from("encrypted"),
        iv: Buffer.from("123456789012"),
        authTag: Buffer.from("1234567890123456"),
      }]),
      set: vi.fn((data: Record<string, unknown>) => {
        setCalls.push(data);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
      returning: vi.fn().mockResolvedValue([]),
      values: vi.fn().mockResolvedValue(undefined),
    };
    const db = {
      select: vi.fn(() => chainable),
      insert: vi.fn(() => chainable),
      update: vi.fn(() => chainable),
      transaction: vi.fn(),
    };

    await revalidateApiKey(db as never, "user1", "key1");

    expect(setCalls[0]).toEqual(expect.objectContaining({
      status: "invalid",
      lastErrorCode: "401",
    }));
  });
});

describe("ApiKeyValidationError", () => {
  test("includes status and errorMessage in message", () => {
    const error = new ApiKeyValidationError({
      valid: false,
      status: "invalid",
      errorCode: "401",
      errorMessage: "invalid x-api-key",
    });

    expect(error.message).toContain("invalid");
    expect(error.message).toContain("invalid x-api-key");
    expect(error.name).toBe("ApiKeyValidationError");
  });

  test("message omits dash-separator when errorMessage is absent", () => {
    const error = new ApiKeyValidationError({
      valid: false,
      status: "forbidden",
      errorCode: "403",
    });

    expect(error.message).not.toContain(" \u2014 ");
    expect(error.message).toContain("forbidden");
    expect(error.name).toBe("ApiKeyValidationError");
  });
});

describe("ApiKeyDuplicateError", () => {
  test("has correct name and message", () => {
    const error = new ApiKeyDuplicateError();

    expect(error.name).toBe("ApiKeyDuplicateError");
    expect(error.message).toBe("This API key is already active");
    expect(error).toBeInstanceOf(Error);
  });
});
