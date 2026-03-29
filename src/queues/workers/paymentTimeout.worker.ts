/**
 * Payment timeout worker.
 *
 * Fires 30 minutes after a Paystack Pay with Transfer order is created.
 * If payment hasn't arrived yet (order still PAYMENT_PENDING), marks it EXPIRED
 * and notifies the customer with retry buttons.
 */
import { paymentTimeoutQueue, PaymentTimeoutJobData } from '../paymentTimeout.queue';
import { orderRepository } from '../../repositories/order.repository';
import { messageQueue } from '../message.queue';
import { logger, maskPhone } from '../../utils/logger';
import { Language } from '../../i18n';
import { msgTransferPaymentExpired } from '../../services/whatsapp/templates';

paymentTimeoutQueue.process(async (job) => {
  const { orderId, customerPhone, language } = job.data as PaymentTimeoutJobData;

  logger.info('Payment timeout job firing', { orderId: orderId.slice(-8), customer: maskPhone(customerPhone) });

  // Atomically flip PAYMENT_PENDING → EXPIRED. If it returns false the payment
  // already came in — nothing to do.
  const didExpire = await orderRepository.expirePaymentPending(orderId);
  if (!didExpire) {
    logger.info('Payment timeout: order already paid or cancelled — skipping', { orderId: orderId.slice(-8) });
    return;
  }

  logger.info('Order expired — notifying customer', { orderId: orderId.slice(-8) });

  const { message, buttons } = msgTransferPaymentExpired(orderId, language as Language);
  await messageQueue.add(
    { to: customerPhone, message, buttons },
    { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true },
  );
});

logger.info('Payment timeout worker started');
