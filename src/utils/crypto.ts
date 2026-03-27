/**
 * Cryptographic utilities.
 * All signature comparisons use crypto.timingSafeEqual to prevent timing attacks.
 */
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { BCRYPT_ROUNDS } from '../config/constants';

/** Verifies Meta's X-Hub-Signature-256 header. Payload must be raw bytes. */
export function verifyWhatsAppSignature(payload: Buffer, signature: string, secret: string): boolean {
  if (!signature.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return safeCompare(expected, signature.slice(7));
}

/** Verifies Paystack's x-paystack-signature header using HMAC-SHA512. */
export function verifyPaystackSignature(payload: Buffer, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha512', secret).update(payload).digest('hex');
  return safeCompare(expected, signature);
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

export async function hashApiKey(raw: string): Promise<string> {
  return bcrypt.hash(raw, BCRYPT_ROUNDS);
}

export async function verifyApiKey(raw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(raw, hash);
}

/** orb_<32 random hex chars> */
export function generateApiKey(): string {
  return `orb_${crypto.randomBytes(16).toString('hex')}`;
}

/** ORB-<timestamp>-<6 random hex chars> — safe to expose to customers */
export function generatePaystackReference(): string {
  const ts = Date.now();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ORB-${ts}-${rand}`;
}

// ─── AES-256-GCM — bank account numbers at rest ───────────────────────────────
//
// Encrypted format stored as a single string: `${iv_hex}:${authTag_hex}:${ciphertext_hex}`
//   • IV  — 96-bit (12 bytes) random nonce, optimal for GCM
//   • authTag — 128-bit (16 bytes) GCM authentication tag; prevents tampering
//   • ciphertext — AES-256-GCM encrypted plaintext
//
// keyHex must be a 64-character hex string (32 bytes / 256 bits).

/**
 * Encrypts a bank account number using AES-256-GCM.
 * @param plaintext  The raw account number string.
 * @param keyHex     64-character hex string (32 bytes) — from ENCRYPTION_KEY env var.
 * @returns          `${iv_hex}:${authTag_hex}:${ciphertext_hex}`
 */
export function encryptBankAccount(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  const iv = crypto.randomBytes(12); // 96-bit nonce — optimal for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 128-bit tag
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a bank account number previously encrypted with {@link encryptBankAccount}.
 * @param encrypted  `${iv_hex}:${authTag_hex}:${ciphertext_hex}` as stored in the DB.
 * @param keyHex     64-character hex string (32 bytes) — from ENCRYPTION_KEY env var.
 * @returns          The original plaintext account number.
 * @throws           If the ciphertext has been tampered with (GCM auth tag mismatch).
 */
export function decryptBankAccount(encrypted: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted bank account format');
  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
