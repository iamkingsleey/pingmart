/**
 * Paystack webhook handler.
 * POST /webhooks/paystack
 *
 * Flow:
 *  1. Verify HMAC-SHA512 signature — reject with 401 if invalid.
 *  2. Respond 200 immediately (Paystack retries if we're slow).
 *  3. For charge.success only:
 *     a. Look up the order by reference — silently ignore if not found.
 *     b. Attempt an atomic conditional UPDATE (paymentProcessed = false → true).
 *        If count = 0, this is a duplicate — silently ignore.
 *        If count = 1, this is the first delivery — enqueue the payment job.
 *
 * This handler is idempotent: duplicate webhooks for the same reference are
 * safely discarded at the DB level without any side effects.
 */
import { Request, Response } from 'express';
import { env } from '../config/env';
import { verifyPaystackSignature } from '../utils/crypto';
import { logger, maskReference } from '../utils/logger';
import { paymentQueue } from '../queues/payment.queue';
import { orderRepository } from '../repositories/order.repository';
import { PaystackWebhookPayload } from '../types/paystack';

export async function handlePaystackWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers['x-paystack-signature'] as string | undefined;

  if (!signature) {
    logger.warn('Paystack webhook missing signature');
    res.status(401).json({ error: 'Missing signature' });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    res.status(500).json({ error: 'Internal error' });
    return;
  }

  if (!verifyPaystackSignature(rawBody, signature, env.PAYSTACK_WEBHOOK_SECRET)) {
    logger.warn('Paystack signature verification failed');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Respond 200 immediately — Paystack will retry if we take too long
  res.status(200).json({ status: 'received' });

  const payload = req.body as PaystackWebhookPayload;
  const reference = payload.data?.reference ?? '';

  logger.info('Paystack webhook received', {
    event: payload.event,
    reference: maskReference(reference),
  });

  // Only process charge.success — all other events are acknowledged and ignored
  if (payload.event !== 'charge.success') {
    logger.info('Ignoring non-charge.success event', { event: payload.event });
    return;
  }

  try {
    const channel = payload.data?.channel ?? '';
    // For dedicated_nuban payments, the virtual account number is in authorization
    const authorization = (payload.data as unknown as { authorization?: { receiver_bank_account_number?: string } }).authorization;
    const accountNumber = authorization?.receiver_bank_account_number ?? '';

    // ── dedicated_nuban (Pay with Transfer) ────────────────────────────────
    // For virtual account payments, Paystack does NOT include our paystackReference
    // in the webhook. We look up the order by the virtual account number instead.
    if (channel === 'dedicated_nuban' && accountNumber) {
      logger.info('Dedicated NUBAN payment received', { account: accountNumber.slice(-4) });

      const nubanOrder = await orderRepository.findByVirtualAccount(accountNumber);
      if (!nubanOrder) {
        logger.warn('dedicated_nuban charge for unknown account — ignored', { account: accountNumber.slice(-4) });
        return;
      }

      // Idempotency guard
      const nubanNew = await orderRepository.markPaymentProcessed(nubanOrder.id);
      if (!nubanNew) {
        logger.info('Duplicate dedicated_nuban webhook — ignored', { orderId: nubanOrder.id });
        return;
      }

      await paymentQueue.add(
        { paystackReference: nubanOrder.paystackReference, event: payload.event },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true },
      );

      logger.info('Dedicated NUBAN payment job enqueued', { orderId: nubanOrder.id });
      return;
    }

    // ── Standard charge.success (card / bank debit) ────────────────────────
    const order = await orderRepository.findByPaystackReference(reference);
    if (!order) {
      logger.warn('charge.success for unknown reference — ignored', {
        reference: maskReference(reference),
      });
      return;
    }

    // Atomic idempotency guard: flip paymentProcessed false→true exactly once.
    // If this returns count=0, the webhook is a duplicate — stop here.
    const wasNew = await orderRepository.markPaymentProcessed(order.id);
    if (!wasNew) {
      logger.info('Duplicate charge.success webhook — ignored', {
        orderId: order.id,
        reference: maskReference(reference),
      });
      return;
    }

    // First-time processing: hand off to the payment queue worker for fulfillment
    await paymentQueue.add(
      { paystackReference: reference, event: payload.event },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true },
    );

    logger.info('Payment job enqueued', {
      orderId: order.id,
      reference: maskReference(reference),
    });
  } catch (err) {
    logger.error('Error processing charge.success webhook', {
      reference: maskReference(reference),
      error: (err as Error).message,
    });
  }
}
