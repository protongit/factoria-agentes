import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const ALGO = "aes-256-gcm";

function encryptionKey(): Buffer {
  const hex = process.env.SECRETS_ENCRYPTION_KEY ?? "";
  if (hex.length !== 64) {
    throw new Error("SECRETS_ENCRYPTION_KEY debe ser una clave hex de 32 bytes (64 caracteres).");
  }
  return Buffer.from(hex, "hex");
}

/** Cifra un secreto con AES-256-GCM. Formato: iv.tag.ct (hex). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}.${tag.toString("hex")}.${ct.toString("hex")}`;
}

/** Descifra un secreto cifrado con encryptSecret. */
export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, ctHex] = payload.split(".");
  if (!ivHex || !tagHex || !ctHex) throw new Error("Secreto cifrado con formato inválido.");
  const decipher = createDecipheriv(ALGO, encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]);
  return pt.toString("utf8");
}

/** Hash de contraseña con scrypt. Formato: scrypt.salt.hash (hex). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt.${salt.toString("hex")}.${hash.toString("hex")}`;
}

/** Verifica una contraseña contra su hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(".");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
