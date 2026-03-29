/**
 * Environment configuration with Zod validation.
 *
 * Validated at startup — the process exits immediately with a clear error
 * if any required variable is missing or malformed.
 * No silent misconfigurations in production.
 */
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000').transform(Number),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL URL'),

  // Redis
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis URL'),

  // WhatsApp Cloud API
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),

  // Paystack
  PAYSTACK_SECRET_KEY: z.string().startsWith('sk_', 'Must start with sk_'),
  PAYSTACK_WEBHOOK_SECRET: z.string().min(1),

  // Cloudinary — used for digital product file hosting
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),

  // Encryption — AES-256-GCM key for bank account numbers at rest
  // Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be a 64-character hex string (32 bytes)'),

  // Anthropic — Natural Language Understanding
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5'),

  // Re-order Engine
  REORDER_DAYS_AFTER: z.string().default('7'),

  // Groq — Voice note transcription via Whisper
  GROQ_API_KEY: z.string().min(1),

  // Pingmart Platform (Phase 2+)
  // The actual E.164 phone number for store deep-links: wa.me/{PINGMART_PHONE_NUMBER}?text=STORECODE
  PINGMART_PHONE_NUMBER: z.string().optional(),
  // Super-admin phone number — reserved for platform-level management
  PINGMART_ADMIN_PHONE: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.flatten().fieldErrors;
  const messages = Object.entries(errors)
    .map(([field, msgs]) => `  • ${field}: ${msgs?.join(', ')}`)
    .join('\n');
  console.error(`\n❌ Environment validation failed:\n${messages}\n`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
