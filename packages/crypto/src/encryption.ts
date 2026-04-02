import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const HKDF_HASH = "sha256";
const HKDF_KEY_LENGTH = 32; // 256 bits

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

function getMasterKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (256-bit key)");
  }
  return Buffer.from(hex, "hex");
}

/** Derive a purpose-specific subkey via HKDF (domain separation). */
function deriveSubkey(purpose: "aes-256-gcm" | "hmac-sha256"): Buffer {
  const ikm = getMasterKey();
  return Buffer.from(hkdfSync(HKDF_HASH, ikm, Buffer.alloc(0), purpose, HKDF_KEY_LENGTH));
}

export function encrypt(plaintext: string, aad: string): EncryptResult {
  const key = deriveSubkey("aes-256-gcm");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { ciphertext: encrypted, iv, authTag };
}

export function decrypt(params: DecryptParams): string {
  const key = deriveSubkey("aes-256-gcm");
  const decipher = createDecipheriv(ALGORITHM, key, params.iv);
  decipher.setAAD(Buffer.from(params.aad, "utf8"));
  decipher.setAuthTag(params.authTag);

  const decrypted = Buffer.concat([decipher.update(params.ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

export function generateHmac(data: string): string {
  const key = deriveSubkey("hmac-sha256");
  return createHmac("sha256", key).update(data).digest("hex");
}
