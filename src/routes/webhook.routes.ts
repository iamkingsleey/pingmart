/**
 * Webhook routes.
 *
 * Body parsing is handled globally in app.ts (with raw body capture).
 * These routes only add signature verification middleware on top.
 */
import { Router } from 'express';
import { verifyWhatsAppWebhookSignature } from '../middlewares/webhookSignature.middleware';
import { webhookRateLimit } from '../middlewares/rateLimit.middleware';
import { handleWhatsAppVerification, handleWhatsAppWebhook } from '../webhooks/whatsapp.webhook';
import { handlePaystackWebhook } from '../webhooks/paystack.webhook';
import { monoRouter } from './monoRoutes';

const router = Router();

// WhatsApp — GET for Meta hub.challenge verification (no signature required)
router.get('/whatsapp', webhookRateLimit, handleWhatsAppVerification);

// WhatsApp — POST for incoming messages (X-Hub-Signature-256 required)
router.post(
  '/whatsapp',
  webhookRateLimit,
  verifyWhatsAppWebhookSignature,
  handleWhatsAppWebhook,
);

// Paystack — POST for payment events (x-paystack-signature required)
router.post(
  '/paystack',
  webhookRateLimit,
  handlePaystackWebhook,
);

// Mono OWO — POST /webhooks/mono for OWO payment events
router.use('/mono', monoRouter);

export { router as webhookRouter };
