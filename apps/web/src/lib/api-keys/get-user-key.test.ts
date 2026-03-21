// ---- Mocks ----------------------------------------------------------------

vi.mock("@/lib/db", () => ({ db: { __mock: true } }));

const decryptActiveKeyMock = vi.fn();
vi.mock("./api-key-service", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  decryptActiveKey: (...args: unknown[]) => decryptActiveKeyMock(...args),
}));

import { getUserAnthropicKey } from "./get-user-key";

// ---- Setup ----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- Tests ----------------------------------------------------------------

describe("getUserAnthropicKey", () => {
  test("delegates to decryptActiveKey with db, userId, and 'anthropic' provider", async () => {
    decryptActiveKeyMock.mockResolvedValueOnce("sk-ant-decrypted");

    const result = await getUserAnthropicKey("user-123");

    expect(decryptActiveKeyMock).toHaveBeenCalledWith(
      expect.objectContaining({ __mock: true }),
      "user-123",
      "anthropic",
    );
    expect(result).toBe("sk-ant-decrypted");
  });

  test("returns null when no active key exists", async () => {
    decryptActiveKeyMock.mockResolvedValueOnce(null);

    const result = await getUserAnthropicKey("user-no-key");

    expect(result).toBeNull();
  });

  test("propagates errors from decryptActiveKey", async () => {
    decryptActiveKeyMock.mockRejectedValueOnce(new Error("Decryption failed"));

    await expect(getUserAnthropicKey("user-err")).rejects.toThrow("Decryption failed");
  });
});
