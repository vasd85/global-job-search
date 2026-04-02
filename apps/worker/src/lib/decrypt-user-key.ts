import { eq, and } from "drizzle-orm";
import type { Database } from "@gjs/db";
import { userApiKeys } from "@gjs/db/schema";
import { decrypt } from "@gjs/crypto";

/**
 * Decrypt the user's active API key for the given provider.
 * Returns the plaintext key string or null if no active key exists.
 *
 * Mirrors the pattern in apps/web/src/lib/api-keys/api-key-service.ts#decryptActiveKey.
 */
export async function decryptUserKey(
  db: Database,
  userId: string,
  provider = "anthropic",
): Promise<string | null> {
  const rows = await db
    .select({
      id: userApiKeys.id,
      ciphertext: userApiKeys.ciphertext,
      iv: userApiKeys.iv,
      authTag: userApiKeys.authTag,
    })
    .from(userApiKeys)
    .where(
      and(
        eq(userApiKeys.userId, userId),
        eq(userApiKeys.provider, provider),
        eq(userApiKeys.status, "active"),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  const aad = `${userId}:${provider}:${row.id}`;
  return decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, aad });
}
