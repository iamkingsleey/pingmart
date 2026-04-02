/**
 * Mono OWO webhook routes.
 * Mounted at /webhooks/mono via the main webhook router.
 *
 * Body parsing is handled globally in app.ts (with raw body capture for HMAC verification).
 * No additional body parser is added here.
 */
import { Router } from 'express';
import { webhookRateLimit } from '../middlewares/rateLimit.middleware';
import { handleMonoWebhook } from '../webhooks/monoWebhook';

const router = Router();

// POST /webhooks/mono — Mono OWO payment events
router.post('/', webhookRateLimit, handleMonoWebhook);

export { router as monoRouter };
