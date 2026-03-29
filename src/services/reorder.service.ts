/**
 * Reorder Service — builds personalised re-order nudge messages and handles
 * customer YES / NO / OPT OUT replies to those nudges.
 *
 * Example nudge output:
 * "Hey Ada! 👋 It's been a week since you ordered from Mama Tee's Kitchen.
 *
 * Your last order was:
 * • 2x Jollof Rice (Large) — ₦3,000
 * • 1x Chapman (Large) — ₦800
 *
 * Total: ₦3,800
 *
 * Want to order the same again? Reply YES to reorder or NO to skip. 🍽️"
 */
import { OrderWithDetails } from '../repositories/order.repository';
import { messageQueue } from '../queues/message.queue';
import { formatNaira } from '../utils/formatters';
import { logger, maskPhone } from '../utils/logger';

export async function sendReorderNudge(order: OrderWithDetails): Promise<void> {
  const customerName = order.customer.name ?? 'there';
  const itemLines = order.orderItems
    .map((oi) => `• ${oi.quantity}x ${oi.product.name} — ${formatNaira(oi.quantity * oi.unitPrice)}`)
    .join('\n');

  const message =
    `Hey ${customerName}! 👋 It's been a week since you ordered from us.\n\n` +
    `Your last order was:\n${itemLines}\n\n` +
    `Total: ${formatNaira(order.totalAmount)}\n\n` +
    `Want to order the same again? 🍽️`;

  await messageQueue.add(
    {
      to: order.customer.whatsappNumber,
      message,
      buttons: [
        { id: 'YES', title: '✅ Yes, Reorder!' },
        { id: 'NO', title: '❌ No Thanks' },
      ],
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true },
  );

  logger.info('Reorder nudge queued', {
    orderId: order.id,
    customer: maskPhone(order.customer.whatsappNumber),
  });
}
