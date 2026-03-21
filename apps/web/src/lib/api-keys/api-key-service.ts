import { eq, and, ne, or, desc } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../db";
import { userApiKeys } from "../db/schema";
import { encrypt, decrypt, generateHmac } from "../crypto/encryption";
import { validateAnthropicKey, type ValidationResult } from "./validate-anthropic-key";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ApiKeyProvider = "anthropic";
export type ApiKeyStatus = "active" | "invalid" | "revoked";

export interface ApiKeyMeta {
  id: string;
  provider: ApiKeyProvider;
  maskedHint: string | null;
  status: ApiKeyStatus;
  lastValidatedAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
}

export interface AddApiKeyResult {
  id: string;
  maskedHint: string;
  status: ApiKeyStatus;
  validationStatus: ValidationResult["status"];
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function addApiKey(
  db: Database,
  userId: string,
  provider: ApiKeyProvider,
  rawKey: string,
): Promise<AddApiKeyResult> {
  const validation = await validateAnthropicKey(rawKey);
  if (!validation.valid) {
    throw new ApiKeyValidationError(validation);
  }

  const newId = randomUUID();
  const aad = `${userId}:${provider}:${newId}`;
  const { ciphertext, iv, authTag } = encrypt(rawKey, aad);
  // Hash the raw key before HMAC so the fingerprint never contains raw key material
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const fingerprintHmac = generateHmac(`${userId}:${provider}:${keyHash}`);
  const maskedHint = `...${rawKey.slice(-4)}`;
  const now = new Date();

  // After validation check above, status is "active" | "billing_warning" | "rate_limited".
  // Map all valid statuses to the DB-level "active" status.
  const dbStatus: ApiKeyStatus =
    validation.status === "active" || validation.status === "billing_warning" || validation.status === "rate_limited"
      ? "active"
      : "invalid";

  // Single transaction: dedup check + revoke existing + insert new key
  await db.transaction(async (tx) => {
    const duplicate = await tx
      .select({ id: userApiKeys.id })
      .from(userApiKeys)
      .where(and(
        eq(userApiKeys.userId, userId),
        eq(userApiKeys.provider, provider),
        eq(userApiKeys.status, "active"),
        eq(userApiKeys.fingerprintHmac, fingerprintHmac),
      ))
      .limit(1);

    if (duplicate.length > 0) {
      throw new ApiKeyDuplicateError();
    }

    const existing = await tx
      .select({ id: userApiKeys.id })
      .from(userApiKeys)
      .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider), eq(userApiKeys.status, "active")))
      .limit(1);

    if (existing.length > 0) {
      await tx
        .update(userApiKeys)
        .set({ status: "revoked", revokedAt: now, updatedAt: now })
        .where(eq(userApiKeys.id, existing[0].id));
    }

    await tx.insert(userApiKeys).values({
      id: newId,
      userId,
      provider,
      ciphertext,
      iv,
      authTag,
      keyVersion: 1,
      status: dbStatus,
      maskedHint,
      fingerprintHmac,
      lastValidatedAt: now,
      lastErrorCode: validation.errorCode ?? null,
    });
  });

  return { id: newId, maskedHint, status: dbStatus, validationStatus: validation.status };
}

export async function getActiveKeyMeta(
  db: Database,
  userId: string,
  provider: ApiKeyProvider,
): Promise<ApiKeyMeta | null> {
  const rows = await db
    .select({
      id: userApiKeys.id,
      provider: userApiKeys.provider,
      maskedHint: userApiKeys.maskedHint,
      status: userApiKeys.status,
      lastValidatedAt: userApiKeys.lastValidatedAt,
      lastErrorCode: userApiKeys.lastErrorCode,
      createdAt: userApiKeys.createdAt,
    })
    .from(userApiKeys)
    .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider), eq(userApiKeys.status, "active")))
    .limit(1);

  return (rows[0] as ApiKeyMeta | undefined) ?? null;
}

/**
 * Get the user's current key (active or invalid) for display in the settings UI.
 * Unlike getActiveKeyMeta, this also returns invalid keys so the user can see
 * the status and choose to replace or revalidate.
 * Revoked keys are excluded — the user intentionally revoked them.
 */
export async function getCurrentKeyMeta(
  db: Database,
  userId: string,
  provider: ApiKeyProvider,
): Promise<ApiKeyMeta | null> {
  const rows = await db
    .select({
      id: userApiKeys.id,
      provider: userApiKeys.provider,
      maskedHint: userApiKeys.maskedHint,
      status: userApiKeys.status,
      lastValidatedAt: userApiKeys.lastValidatedAt,
      lastErrorCode: userApiKeys.lastErrorCode,
      createdAt: userApiKeys.createdAt,
    })
    .from(userApiKeys)
    .where(and(
      eq(userApiKeys.userId, userId),
      eq(userApiKeys.provider, provider),
      or(eq(userApiKeys.status, "active"), eq(userApiKeys.status, "invalid")),
    ))
    .orderBy(desc(userApiKeys.createdAt))
    .limit(1);

  return (rows[0] as ApiKeyMeta | undefined) ?? null;
}

export async function decryptActiveKey(
  db: Database,
  userId: string,
  provider: ApiKeyProvider,
): Promise<string | null> {
  const rows = await db
    .select({
      id: userApiKeys.id,
      ciphertext: userApiKeys.ciphertext,
      iv: userApiKeys.iv,
      authTag: userApiKeys.authTag,
    })
    .from(userApiKeys)
    .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider), eq(userApiKeys.status, "active")))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  const aad = `${userId}:${provider}:${row.id}`;
  return decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, aad });
}

export async function revokeApiKey(
  db: Database,
  userId: string,
  keyId: string,
): Promise<void> {
  const now = new Date();
  const result = await db
    .update(userApiKeys)
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where(and(eq(userApiKeys.id, keyId), eq(userApiKeys.userId, userId), eq(userApiKeys.status, "active")))
    .returning({ id: userApiKeys.id });

  if (result.length === 0) {
    throw new ApiKeyNotFoundError("API key not found or already revoked");
  }
}

export async function revalidateApiKey(
  db: Database,
  userId: string,
  keyId: string,
): Promise<ValidationResult> {
  const rows = await db
    .select({
      id: userApiKeys.id,
      provider: userApiKeys.provider,
      ciphertext: userApiKeys.ciphertext,
      iv: userApiKeys.iv,
      authTag: userApiKeys.authTag,
    })
    .from(userApiKeys)
    .where(and(eq(userApiKeys.id, keyId), eq(userApiKeys.userId, userId), ne(userApiKeys.status, "revoked")))
    .limit(1);

  if (rows.length === 0) {
    throw new ApiKeyNotFoundError();
  }

  const row = rows[0];
  const aad = `${userId}:${row.provider}:${row.id}`;
  const rawKey = decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, aad });

  const validation = await validateAnthropicKey(rawKey);
  const now = new Date();

  await db
    .update(userApiKeys)
    .set({
      status: validation.valid ? "active" : "invalid",
      lastValidatedAt: now,
      lastErrorCode: validation.errorCode ?? null,
      updatedAt: now,
    })
    .where(eq(userApiKeys.id, keyId));

  return validation;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class ApiKeyValidationError extends Error {
  public readonly validation: ValidationResult;

  constructor(validation: ValidationResult) {
    super(`API key validation failed: ${validation.status}${validation.errorMessage ? ` — ${validation.errorMessage}` : ""}`);
    this.name = "ApiKeyValidationError";
    this.validation = validation;
  }
}

export class ApiKeyDuplicateError extends Error {
  constructor() {
    super("This API key is already active");
    this.name = "ApiKeyDuplicateError";
  }
}

export class ApiKeyNotFoundError extends Error {
  constructor(message = "API key not found") {
    super(message);
    this.name = "ApiKeyNotFoundError";
  }
}
