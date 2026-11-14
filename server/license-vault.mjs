/**
 * VoxFlow Studio — Capa 5: bóveda AES-256-GCM para claves de licencia.
 * Llave de 32 bytes derivada con HKDF-SHA256 del secreto de sesión ya existente
 * (jamás una variable nueva obligatoria: si falta el secreto, no se cifra y el
 * backfill se reintenta al arrancar, sin romper el arranque del servidor).
 *
 * Formato de fila cifrada: `v1:<ivB64>:<tagB64>:<cipherB64>`
 * IV aleatorio de 12 bytes y authTag de 16 bytes únicos por cada fila.
 */
import crypto from "node:crypto";

const HKDF_INFO = "voxflow-admin-aes-gcm-v1";
const FORMAT_PREFIX = "v1";
let cachedKey = null;
let cachedSecret = "";

export function vaultSecret() {
  return String(
    process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || process.env.AUTH_SECRET || ""
  ).trim();
}

export function vaultKey() {
  const secret = vaultSecret();
  if (!secret) return null;
  if (cachedKey && cachedSecret === secret) return cachedKey;
  const key = Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from(HKDF_INFO, "utf8"), Buffer.alloc(0), 32)
  );
  cachedKey = key;
  cachedSecret = secret;
  return key;
}

export function vaultReady() {
  return vaultKey() !== null;
}

export function isEncryptedKey(value) {
  return typeof value === "string" && value.startsWith(`${FORMAT_PREFIX}:`) && value.split(":").length === 4;
}

export function encryptLicenseKey(token) {
  const key = vaultKey();
  if (!key || !token) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(token), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${FORMAT_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptLicenseKey(blob) {
  const key = vaultKey();
  if (!key || !blob) return null;
  const parts = String(blob).split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT_PREFIX) return null;
  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ciphertext = Buffer.from(parts[3], "base64");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
