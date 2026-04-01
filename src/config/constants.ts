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

// ─── Freemium Plan Limits ─────────────────────────────────────────────────────

/**
 * Maximum notification numbers each plan supports.
 * Infinity means no cap (Pro plan).
 * Single source of truth — import from here, never hardcode in services.
 */
export const PLAN_NOTIFICATION_LIMITS: Record<string, number> = {
  free:    1,
  starter: 1,
  growth:  3,
  pro:     Infinity,
};

/** Monthly pricing labels shown in upgrade prompts. */
export const PLAN_UPGRADE_PRICING: Record<string, string> = {
  growth: '₦5,000/month',
  pro:    '₦15,000/month',
};

// ─── Cloudinary ───────────────────────────────────────────────────────────────
/** Folder in Cloudinary where digital product files are stored */
export const CLOUDINARY_DIGITAL_FOLDER = 'orb/digital-products';
/** Folder for product cover images */
export const CLOUDINARY_COVER_FOLDER = 'orb/covers';
/** Max file size for digital product upload: 100 MB */
export const MAX_DIGITAL_FILE_SIZE_BYTES = 100 * 1024 * 1024;

// ─── LLM Confidence Thresholds ────────────────────────────────────────────────
/**
 * Minimum confidence score (0.0–1.0) required for the global off-script fallback
 * to intercept a message and reply instead of letting the step-specific parser run.
 * Raise to be more conservative; lower to catch more edge cases.
 */
export const OFFSCRIPT_CONFIDENCE_THRESHOLD = 0.65;

// ─── LLM Pipeline ─────────────────────────────────────────────────────────────

/**
 * Minimum confidence (0.0–1.0) for classifyIntent() to act on a result.
 * Below this threshold with intent='unknown', the bot asks a clarifying question
 * rather than guessing. Raise to be more conservative.
 */
export const LLM_CONFIDENCE_THRESHOLD = 0.75;

/**
 * Number of back-and-forth exchanges (user + bot) to keep in conversation history.
 * 5 exchanges = 10 stored messages max per user session.
 */
export const CONVERSATION_HISTORY_MAX_EXCHANGES = 5;

/**
 * How long (seconds) to cache a classifyIntent() result in Redis.
 * Deduplicates rapid-fire identical messages (e.g. WhatsApp delivery retries).
 */
export const INTENT_CACHE_TTL_SECS = 30;
