/**
 * Physical delivery service — handles vendor status update commands.
 *
 * Vendors update order status by sending messages to the bot:
 *   CONFIRM ORD-A3F9B2
 *   PREPARING ORD-A3F9B2
 *   READY ORD-A3F9B2
 *   DELIVERED ORD-A3F9B2
 *   CANCEL ORD-A3F9B2
 *
 * Each command updates the DB and notifies the customer.
 */
import { orderRepository } from '../../repositories/order.repository';
import { vendorRepository } from '../../repositories/vendor.repository';
import { sendTextMessage } from '../whatsapp/whatsapp.service';
import { msgPhysicalStatusUpdate } from '../whatsapp/templates';
import { logger, maskPhone } from '../../utils/logger';
import { OrderStatus } from '../../types';

const COMMAND_MAP: Record<string, OrderStatus> = {
  CONFIRM: OrderStatus.CONFIRMED,
  PREPARING: OrderStatus.PREPARING,
  READY: OrderStatus.READY,
  DELIVERED: OrderStatus.DELIVERED,
  CANCEL: OrderStatus.CANCELLED,
};

/**
 * Parses and executes a vendor status-update command.
 *
 * @param vendorPhone - The vendor's WhatsApp number
 * @param rawMessage - The raw text message from the vendor
 */
export async function handleVendorStatusCommand(
  vendorPhone: string,
  rawMessage: string,
): Promise<void> {
  const logCtx = { vendor: maskPhone(vendorPhone) };
  const text = rawMessage.trim().toUpperCase();
  const parts = text.split(/\s+/);

  if (parts.length < 2) {
    await sendTextMessage(
      vendorPhone,
      `Please include the order ID.\n\nExample: *CONFIRM ORD-A3F9B2*\n\nValid commands: CONFIRM, PREPARING, READY, DELIVERED, CANCEL`,
    );
    return;
  }

  const [command, shortId] = parts;
  const newStatus = command ? COMMAND_MAP[command] : undefined;

  if (!newStatus) {
    await sendTextMessage(
      vendorPhone,
      `Unknown command "*${command}*".\n\nValid commands:\n• CONFIRM\n• PREPARING\n• READY\n• DELIVERED\n• CANCEL`,
    );
    return;
  }

  const vendor = await vendorRepository.findByWhatsAppNumber(vendorPhone);
  if (!vendor) {
    logger.warn('Status command from unregistered vendor', logCtx);
    return;
  }

  // Find the order by the short ID (last 6 chars of UUID, prefixed ORD-)
  const normalised = (shortId ?? '').replace('ORD-', '');
  const { orders } = await orderRepository.findByVendor(vendor.id, { limit: 100 });
  const order = orders.find((o) => o.id.slice(-6).toUpperCase() === normalised);

  if (!order) {
    await sendTextMessage(vendorPhone, `Order *${shortId}* not found. Check the order ID and try again.`);
    return;
  }

  // Prevent status regression (e.g. DELIVERED → PREPARING)
  const statusOrder = [
    OrderStatus.PENDING_PAYMENT,
    OrderStatus.PAYMENT_CONFIRMED,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.READY,
    OrderStatus.DELIVERED,
  ];
  const currentIdx = statusOrder.indexOf(order.status as OrderStatus);
  const newIdx = statusOrder.indexOf(newStatus);

  if (newStatus !== OrderStatus.CANCELLED && currentIdx > newIdx) {
    await sendTextMessage(
      vendorPhone,
      `Cannot change order *${shortId}* from ${order.status} to ${newStatus} — that would be going backwards.`,
    );
    return;
  }

  // Use markDelivered for DELIVERED to also stamp the deliveredAt timestamp
  if (newStatus === OrderStatus.DELIVERED) {
    await orderRepository.markDelivered(order.id);
  } else {
    await orderRepository.updateStatus(order.id, newStatus);
  }

  logger.info('Order status updated by vendor', {
    orderId: order.id,
    from: order.status,
    to: newStatus,
    ...logCtx,
  });

  const customerPhone = order.customer.whatsappNumber;
  await sendTextMessage(customerPhone, msgPhysicalStatusUpdate(order.id, newStatus));
  await sendTextMessage(
    vendorPhone,
    `✅ Order *${shortId}* updated to *${newStatus}*. Customer has been notified.`,
  );
}
