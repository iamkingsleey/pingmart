/**
 * Mono OWO webhook handler.
 * POST /webhooks/mono
 *
 * Flow:
 *  1. Respond 200 immediately — Mono retries if response is slow.
 *  2. Verify webhook signature (mono-webhook-secret-hash) if MONO_SECRET_KEY is set.
 *     In test mode without a key, accept and log all events.
 *  3. Log the incoming event.
 *  4. On payment success: find the order by owoFundRequestId, apply idempotency
 *     guard, then hand off to the payment fulfillment flow.
 *
 * All logic after the 200 response runs asynchronously — errors never block the reply.
 */

import crypto from 'crypto';
import { Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { orderRepository } from '../repositories/order.repository';
import { paymentQueue } from '../queues/payment.queue';

// ─── Mono webhook payload types ───────────────────────────────────────────────

interface MonoFundRequest {
  id:        string;
  reference: string;
  status:    string;
  amount:    number;
  currency:  string;
}

interface MonoWebhookPayload {
  event: string;
  data?: {
    fund_request?: MonoFundRequest;
    payment?:      { amount?: number; status?: string };
  };
}

// ─── Signature verification ───────────────────────────────────────────────────

/**
 * Verifies the Mono webhook signature using HMAC-SHA512.
 * Mono sends the signature in the `mono-webhook-secret-hash` header.
 * Returns true if valid, or true if MONO_SECRET_KEY is absent (test mode).
 */
function verifyMonoSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!env.MONO_SECRET_KEY) {
    // Test mode — no key configured, accept all events but log a warning
    logger.warn('Mono webhook: MONO_SECRET_KEY not set — accepting without verification (test mode)');
    return true;
  }

  if (!signature) {
    logger.warn('Mono webhook: missing mono-webhook-secret-hash header');
    return false;
  }

  const expected = crypto
    .createHmac('sha512', env.MONO_SECRET_KEY)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signature, 'utf8'),
    );
  } catch {
    return false;
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleMonoWebhook(req: Request, res: Response): Promise<void> {
  // Respond 200 immediately — Mono retries if we're slow
  res.status(200).json({ status: 'received' });

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const signature = req.headers['mono-webhook-secret-hash'] as string | undefined;

  // Signature verification (async — response already sent)
  if (rawBody && !verifyMonoSignature(rawBody, signature)) {
    logger.warn('Mono webhook signature verification failed — ignoring event');
    return;
  }

  const payload = req.body as MonoWebhookPayload;
  const event = payload?.event ?? 'unknown';

  logger.info('Mono webhook received', { event });

  // Only process payment success events
  const SUCCESS_EVENTS = new Set([
    'mono.owo.payment_success',
    'payment.success',
    'fund_request.payment_success',
  ]);

  if (!SUCCESS_EVENTS.has(event)) {
    logger.info('Mono webhook: ignoring non-payment event', { event });
    return;
  }

  const fundRequest = payload.data?.fund_request;
  if (!fundRequest?.id) {
    logger.warn('Mono webhook: payment success event missing fund_request.id', { event });
    return;
  }

  const fundRequestId = fundRequest.id;
  const reference     = fundRequest.reference ?? '';

  try {
    // Look up order by owoFundRequestId
    const order = await orderRepository.findByOwoFundRequestId(fundRequestId);

    if (!order) {
      // Fallback: try finding by paystackReference (reference = orderId used as reference)
      logger.warn('Mono webhook: no order found by owoFundRequestId — ignoring', {
        fundRequestId,
        reference,
      });
      return;
    }

    // Idempotency guard: flip paymentProcessed false→true exactly once
    const wasNew = await orderRepository.markOwoPaymentProcessed(order.id);
    if (!wasNew) {
      logger.info('Mono webhook: duplicate payment event — ignored', {
        orderId: order.id,
        fundRequestId,
      });
      return;
    }

    // Hand off to the existing payment fulfillment queue
    // paymentQueue worker calls handlePaymentConfirmed(paystackReference)
    // which loads the order, notifies vendor and customer
    await paymentQueue.add(
      { paystackReference: order.paystackReference, event },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true },
    );

    logger.info('Mono OWO payment job enqueued', {
      orderId:       order.id,
      fundRequestId,
      paystackReference: order.paystackReference,
    });
  } catch (err) {
    logger.error('Mono webhook: error processing payment success', {
      fundRequestId,
      error: (err as Error).message,
    });
  }
}
