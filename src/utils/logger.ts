/**
 * Structured Winston logger.
 *
 * Privacy rules (enforced at every call site):
 *   - Never pass raw phone numbers — use maskPhone()
 *   - Never pass delivery addresses
 *   - Never pass product delivery links
 *   - Payment references: use maskReference() to truncate
 */
import winston from 'winston';
import { env } from '../config/env';

const { combine, timestamp, json, colorize, simple, errors } = winston.format;

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format:
    env.NODE_ENV === 'production'
      ? combine(errors({ stack: true }), timestamp(), json())
      : combine(errors({ stack: true }), timestamp({ format: 'HH:mm:ss' }), colorize(), simple()),
  defaultMeta: { service: 'whatsapp-order-bot' },
  transports: [new winston.transports.Console()],
});

// ─── Privacy Helpers ──────────────────────────────────────────────────────────

/**
 * Masks a phone number for safe logging.
 * +2348012345678 → +234***5678
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return '***';
  const prefix = phone.startsWith('+') ? phone.slice(0, 4) : phone.slice(0, 3);
  return `${prefix}***${phone.slice(-4)}`;
}

/**
 * Truncates a Paystack reference for safe logging.
 * ORB-1234567890-ABC123 → ORB-12...
 */
export function maskReference(ref: string): string {
  if (!ref || ref.length < 8) return '***';
  return `${ref.slice(0, 8)}...`;
}
