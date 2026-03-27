/**
 * Application-wide constants.
 * Centralised here so there are no magic numbers scattered through the codebase.
 */

// ─── Session ──────────────────────────────────────────────────────────────────
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_CART_ITEMS = 20;

// ─── Rate Limiting ────────────────────────────────────────────────────────────
export const RATE_LIMIT_GENERAL_MAX = 60;
export const RATE_LIMIT_WEBHOOK_MAX = 200;
export const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

// ─── Bull Queue Job Options ───────────────────────────────────────────────────
export const WHATSAPP_JOB_ATTEMPTS = 3;
export const PAYMENT_JOB_ATTEMPTS = 3;
/** Digital delivery gets MORE retries — failure means customer has paid but got nothing */
export const DIGITAL_DELIVERY_JOB_ATTEMPTS = 5;
export const JOB_BACKOFF_DELAY_MS = 2000;

// ─── External APIs ────────────────────────────────────────────────────────────
export const PAYSTACK_BASE_URL = 'https://api.paystack.co';
export const WHATSAPP_API_BASE_URL = 'https://graph.facebook.com/v19.0';

// ─── Security ─────────────────────────────────────────────────────────────────
export const BCRYPT_ROUNDS = 10;

// ─── Monetary ─────────────────────────────────────────────────────────────────
export const KOBO_PER_NAIRA = 100;
export const NAIRA_DECIMAL_PLACES = 2;

// ─── Cloudinary ───────────────────────────────────────────────────────────────
/** Folder in Cloudinary where digital product files are stored */
export const CLOUDINARY_DIGITAL_FOLDER = 'orb/digital-products';
/** Folder for product cover images */
export const CLOUDINARY_COVER_FOLDER = 'orb/covers';
/** Max file size for digital product upload: 100 MB */
export const MAX_DIGITAL_FILE_SIZE_BYTES = 100 * 1024 * 1024;
