import { db } from "@/lib/db";
import { decryptActiveKey } from "./api-key-service";

/**
 * Get the decrypted active Anthropic API key for a user.
 * Returns null if no active key exists.
 * Server-side only — never expose to client routes.
 */
export async function getUserAnthropicKey(userId: string): Promise<string | null> {
  return decryptActiveKey(db, userId, "anthropic");
}
