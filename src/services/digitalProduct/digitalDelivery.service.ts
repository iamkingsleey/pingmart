/**
 * Digital product delivery service.
 *
 * Responsible for sending the product (link/file URL) to the customer
 * immediately after payment is confirmed. This is the most latency-critical
 * operation in the system — we target delivery within seconds.
 *
 * Failure handling:
 * - This service is called from the digital delivery Bull queue worker
 * - The worker retries up to DIGITAL_DELIVERY_JOB_ATTEMPTS times (5 by default)
 * - If ALL retries fail, the worker calls handleDeliveryFailure()
 * - handleDeliveryFailure() alerts the vendor manually and notifies the customer
 */
import { orderRepository } from '../../repositories/order.repository';
import { vendorRepository } from '../../repositories/vendor.repository';
import { sendTextMessage } from '../whatsapp/whatsapp.service';
import {
  msgDigitalDelivery,
  msgDigitalDeliveryFailed,
  msgDigitalDeliveryFailedVendorAlert,
} from '../whatsapp/templates';
import { logger, maskPhone } from '../../utils/logger';
import { DigitalDeliveryJob } from '../../types';

/**
 * Performs instant digital product delivery to a customer.
 * Called by the digital delivery queue worker.
 */
export async function deliverDigitalProduct(job: DigitalDeliveryJob): Promise<void> {
  const { orderId, customerPhone, vendorPhone, productName, deliveryContent, deliveryMessage } = job;

  logger.info('Delivering digital product', {
    orderId,
    customer: maskPhone(customerPhone),
    product: productName,
  });

  // Send the delivery message — this is what the customer has been waiting for
  const message = msgDigitalDelivery(productName, deliveryContent, deliveryMessage, orderId);
  await sendTextMessage(customerPhone, message);

  // Update order status in DB
  await orderRepository.markDigitalDelivered(orderId);

  logger.info('Digital product delivered', {
    orderId,
    customer: maskPhone(customerPhone),
    product: productName,
  });

  // Notify vendor of the sale (informational — no action needed)
  const order = await orderRepository.findByIdWithDetails(orderId);
  if (order) {
    const { msgNewDigitalSale } = await import('../whatsapp/templates');
    await sendTextMessage(vendorPhone, msgNewDigitalSale(order));
  }
}

/**
 * Called when ALL retry attempts for digital delivery have failed.
 * Alerts the vendor to send manually. Notifies customer of the delay.
 */
export async function handleDeliveryFailure(orderId: string): Promise<void> {
  logger.error('Digital delivery failed after all retries — manual intervention needed', { orderId });

  const order = await orderRepository.findByIdWithDetails(orderId);
  if (!order) return;

  const vendor = await vendorRepository.findById(order.vendorId);
  if (!vendor) return;

  const customerPhone = order.customer.whatsappNumber;

  // Tell customer what happened (honest but reassuring)
  await sendTextMessage(customerPhone, msgDigitalDeliveryFailed(orderId)).catch((err) =>
    logger.error('Failed to send delivery-failure message to customer', {
      orderId,
      error: err.message,
    }),
  );

  // Alert vendor with order details and instruction to send manually
  await sendTextMessage(vendor.whatsappNumber, msgDigitalDeliveryFailedVendorAlert(order)).catch(
    (err) =>
      logger.error('Failed to send delivery-failure alert to vendor', {
        orderId,
        error: err.message,
      }),
  );
}
