import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../config/env';
import { verifyWhatsAppSignature } from '../utils/crypto';
import { logger } from '../utils/logger';

declare global {
  namespace Express {
    interface Request { rawBody?: Buffer; }
  }
}

/** Captures raw body bytes before JSON parsing — required for HMAC verification. */
export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  req.rawBody = buf;
}

/** Verifies X-Hub-Signature-256 on WhatsApp webhooks. Rejects with 401 if invalid. */
export function verifyWhatsAppWebhookSignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;

  // ── TEMPORARY DEBUG — remove once signature mismatch is resolved ─────────────
  const zodSecret   = env.WHATSAPP_APP_SECRET;          // Zod-parsed value
  const rawSecret   = process.env.WHATSAPP_APP_SECRET ?? ''; // raw process.env
  const computedSig = req.rawBody
    ? `sha256=${crypto.createHmac('sha256', zodSecret).update(req.rawBody).digest('hex')}`
    : 'NO_RAW_BODY';
  logger.warn('[WEBHOOK-DEBUG] Signature diagnostics', {
    // Secret preview — first 6 + last 4 chars, never the full value
    secretPreview:    `${rawSecret.slice(0, 6)}...${rawSecret.slice(-4)}`,
    secretLength:     rawSecret.length,
    zodSecretLength:  zodSecret.length,
    secretsMatch:     rawSecret === zodSecret,      // detects Zod trimming/transform
    // Signatures
    receivedSig:      signature ?? 'MISSING',
    computedSig,
    sigsMatch:        signature === computedSig,
    // Raw body
    rawBodyPresent:   !!req.rawBody,
    rawBodyBytes:     req.rawBody?.length ?? 0,
    isBuffer:         req.rawBody instanceof Buffer,
  });
  // ── END DEBUG ─────────────────────────────────────────────────────────────────

  if (!signature) { res.status(401).json({ error: 'Missing signature' }); return; }
  if (!req.rawBody) { res.status(500).json({ error: 'Internal error' }); return; }

  if (!verifyWhatsAppSignature(req.rawBody, signature, env.WHATSAPP_APP_SECRET)) {
    logger.warn('WhatsApp webhook signature invalid');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }
  next();
}
