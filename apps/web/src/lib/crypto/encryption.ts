import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export interface EncryptResult {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export interface DecryptParams {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  aad: string;
}

function getEncryptionKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (256-bit key)");
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string, aad: string): EncryptResult {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { ciphertext: encrypted, iv, authTag };
}

export function decrypt(params: DecryptParams): string {
  const key = getEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, params.iv);
  decipher.setAAD(Buffer.from(params.aad, "utf8"));
  decipher.setAuthTag(params.authTag);

  const decrypted = Buffer.concat([decipher.update(params.ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

export function generateHmac(data: string): string {
  const key = getEncryptionKey();
  return createHmac("sha256", key).update(data).digest("hex");
}
