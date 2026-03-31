import { Request, Response, NextFunction } from 'express';
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
  if (!signature) { res.status(401).json({ error: 'Missing signature' }); return; }
  if (!req.rawBody) { res.status(500).json({ error: 'Internal error' }); return; }

  if (!verifyWhatsAppSignature(req.rawBody, signature, env.WHATSAPP_APP_SECRET)) {
    logger.warn('WhatsApp webhook signature invalid');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }
  next();
}
