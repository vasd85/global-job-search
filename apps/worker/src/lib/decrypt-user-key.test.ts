import { decryptUserKey } from "./decrypt-user-key";

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock("@gjs/crypto", () => ({
  decrypt: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _eq: val })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
}));

vi.mock("@gjs/db/schema", () => ({
  userApiKeys: {
    id: Symbol("userApiKeys.id"),
    userId: Symbol("userApiKeys.userId"),
    provider: Symbol("userApiKeys.provider"),
    status: Symbol("userApiKeys.status"),
    ciphertext: Symbol("userApiKeys.ciphertext"),
    iv: Symbol("userApiKeys.iv"),
    authTag: Symbol("userApiKeys.authTag"),
  },
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────

import { decrypt } from "@gjs/crypto";
import { eq, and } from "drizzle-orm";

// ─── Helpers ───────────────────────────────────────────────────────────────

const mockDecrypt = decrypt as ReturnType<typeof vi.fn>;
const mockEq = eq as ReturnType<typeof vi.fn>;
const mockAnd = and as ReturnType<typeof vi.fn>;

function createMockDb(selectResult: unknown[]) {
  const mockLimit = vi.fn().mockResolvedValue(selectResult);
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  return {
    db: { select: mockSelect } as unknown as Parameters<typeof decryptUserKey>[0],
    mocks: { mockSelect, mockFrom, mockWhere, mockLimit },
  };
}

function makeKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    ciphertext: Buffer.from("encrypted"),
    iv: Buffer.from("init-vector"),
    authTag: Buffer.from("auth-tag"),
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("decryptUserKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Critical ──────────────────────────────────────────────────────────

  test("active key exists -- decrypts and returns plaintext", async () => {
    const keyRow = makeKeyRow();
    const { db } = createMockDb([keyRow]);
    mockDecrypt.mockReturnValue("sk-test-decrypted-key");

    const result = await decryptUserKey(db, "user-1");

    expect(result).toBe("sk-test-decrypted-key");
    expect(mockDecrypt).toHaveBeenCalledWith({
      ciphertext: keyRow.ciphertext,
      iv: keyRow.iv,
      authTag: keyRow.authTag,
      aad: "user-1:anthropic:key-1",
    });
  });

  test("no active key exists -- returns null", async () => {
    const { db } = createMockDb([]);

    const result = await decryptUserKey(db, "user-1");

    expect(result).toBeNull();
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  test("default provider is 'anthropic'", async () => {
    const { db } = createMockDb([makeKeyRow()]);
    mockDecrypt.mockReturnValue("sk-test");

    await decryptUserKey(db, "user-1");

    // Verify eq was called with the provider value "anthropic"
    expect(mockEq).toHaveBeenCalledWith(expect.anything(), "anthropic");
  });

  // ── Important ─────────────────────────────────────────────────────────

  test("custom provider parameter flows through to query and AAD", async () => {
    const keyRow = makeKeyRow();
    const { db } = createMockDb([keyRow]);
    mockDecrypt.mockReturnValue("sk-openai-key");

    await decryptUserKey(db, "user-1", "openai");

    // Provider is used in the query
    expect(mockEq).toHaveBeenCalledWith(expect.anything(), "openai");

    // Provider is used in AAD
    expect(mockDecrypt).toHaveBeenCalledWith(
      expect.objectContaining({ aad: "user-1:openai:key-1" }),
    );
  });

  test("decrypt throws (corrupted ciphertext) -- error propagates", async () => {
    const { db } = createMockDb([makeKeyRow()]);
    mockDecrypt.mockImplementation(() => {
      throw new Error("authentication tag mismatch");
    });

    await expect(decryptUserKey(db, "user-1")).rejects.toThrow(
      "authentication tag mismatch",
    );
  });

  // ── Nice-to-have ──────────────────────────────────────────────────────

  test("DB query filters by status 'active'", async () => {
    const { db } = createMockDb([makeKeyRow()]);
    mockDecrypt.mockReturnValue("sk-test");

    await decryptUserKey(db, "user-1");

    expect(mockEq).toHaveBeenCalledWith(expect.anything(), "active");
    expect(mockAnd).toHaveBeenCalled();
  });
});
