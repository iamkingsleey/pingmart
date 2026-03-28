/**
 * Reorder Job — Proactive Re-order Engine
 *
 * Runs daily and identifies customers whose last order was delivered
 * REORDER_DAYS_AFTER days ago. Sends them a personalised WhatsApp nudge.
 *
 * This drives repeat sales passively without any vendor intervention.
 */
import { subDays, startOfDay, endOfDay } from 'date-fns';
import { orderRepository } from '../repositories/order.repository';
import { sendReorderNudge } from '../services/reorder.service';
import { logger } from '../utils/logger';
import { env } from '../config/env';

const REORDER_DAYS_AFTER = parseInt(env.REORDER_DAYS_AFTER ?? '7', 10);

export async function runReorderJob(): Promise<void> {
  logger.info('Reorder job started', { daysAfter: REORDER_DAYS_AFTER });

  const targetDate = subDays(new Date(), REORDER_DAYS_AFTER);
  const from = startOfDay(targetDate);
  const to = endOfDay(targetDate);

  const eligibleOrders = await orderRepository.findEligibleForReorder(from, to);

  logger.info('Reorder job found eligible orders', { count: eligibleOrders.length });

  for (const order of eligibleOrders) {
    try {
      await sendReorderNudge(order);
      await orderRepository.markReorderSent(order.id);
    } catch (err) {
      logger.error('Failed to send reorder nudge', {
        orderId: order.id,
        error: (err as Error).message,
      });
      // Continue to next order — don't let one failure block the rest
    }
  }

  logger.info('Reorder job completed', { nudgesSent: eligibleOrders.length });
}
