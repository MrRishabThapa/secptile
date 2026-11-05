/**
 * Mail token crypto (Phase 7) — AES-256-GCM for OAuth tokens at rest.
 *
 * No token material may ever appear unencrypted on disk. The key comes from
 * MAIL_ENCRYPTION_KEY in .env.local and must be exactly 64 hex chars
 * (32 bytes) — generate one with:
 *
 *   openssl rand -hex 32
 *
 * Envelope format (what lands in the token file):
 *
 *   v1.<iv-b64url>.<ciphertext-b64url>.<authTag-b64url>
 *
 * The IV is fresh per encryption and the GCM auth tag is stored alongside,
 * so a tampered file fails authentication instead of decrypting garbage.
 * This module is inert on its own: `store.ts` (and the API routes) carry the
 * `server-only` guard that keeps it out of any client bundle.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class MailCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailCryptoError";
  }
}

const PREFIX = "v1";
const IV_BYTES = 12; // GCM's recommended nonce length
const KEY_HEX_LENGTH = 64; // 32 bytes → AES-256

function readKeyHex(): string {
  return process.env.MAIL_ENCRYPTION_KEY?.trim() ?? "";
}

/** True when MAIL_ENCRYPTION_KEY exists and has the documented shape. */
export function mailEncryptionKeyValid(): boolean {
  const raw = readKeyHex();
  return new RegExp(`^[0-9a-fA-F]{${KEY_HEX_LENGTH}}$`).test(raw);
}

function key(): Buffer {
  if (!mailEncryptionKeyValid()) {
    throw new MailCryptoError(
      `MAIL_ENCRYPTION_KEY is missing or not ${KEY_HEX_LENGTH} hex chars — generate one with "openssl rand -hex 32" and restart the app.`,
    );
  }
  return Buffer.from(readKeyHex(), "hex");
}

/** Encrypt a string (token material) into the self-describing envelope. */
export function encryptString(plaintext: string): string {
  if (!plaintext) {
    throw new MailCryptoError("Nothing to encrypt.");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

/**
 * Reveal an encrypted string. Callers are server-side only (see store.ts);
 * error messages name the failure without echoing any token material.
 */
export function decryptString(envelope: string): string {
  if (!envelope) {
    throw new MailCryptoError("Nothing to decrypt.");
  }
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new MailCryptoError("Unrecognized encrypted-token envelope.");
  }
  const [tag, iv, ciphertext] = [parts[3], parts[1], parts[2]].map((part) => {
    const buffer = Buffer.from(part, "base64url");
    if (buffer.length === 0) {
      throw new MailCryptoError("Encrypted-token envelope is corrupted.");
    }
    return buffer;
  });
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    // GCM authentication failed: wrong key or tampered file. Nothing about
    // the original value is recoverable from this error — keep it that way.
    throw new MailCryptoError(
      "Mail tokens failed authentication — MAIL_ENCRYPTION_KEY changed or the token file was tampered with. Reconnect the mail accounts.",
    );
  }
}
