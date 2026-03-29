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
 *
 * Phase 6 additions:
 *   - Vendor lookup now also works for notification-number phones (not just ownerPhone/whatsappNumber)
 *   - Double-confirmation guard: if order is already CONFIRMED, tells the responder
 *     "already confirmed by another manager" instead of a generic "going backwards" error
 *   - After a CONFIRM, all other active notification numbers are cross-notified
 */
import { prisma } from '../../repositories/prisma';
import { orderRepository } from '../../repositories/order.repository';
import { vendorRepository } from '../../repositories/vendor.repository';
import { sendTextMessage } from '../whatsapp/whatsapp.service';
import { msgPhysicalStatusUpdate } from '../whatsapp/templates';
import { getOtherNotificationPhones } from '../vendor-notify.service';
import { resolveEscalation } from '../escalation.service';
import { logger, maskPhone } from '../../utils/logger';
import { OrderStatus } from '../../types';

const COMMAND_MAP: Record<string, OrderStatus> = {
  CONFIRM: OrderStatus.CONFIRMED,
  PREPARING: OrderStatus.PREPARING,
  READY: OrderStatus.READY,
  DELIVERED: OrderStatus.DELIVERED,
  CANCEL: OrderStatus.CANCELLED,
};

// Statuses that mean an order is already confirmed or further along
const ALREADY_CONFIRMED_STATUSES = new Set<string>([
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.DELIVERED,
  OrderStatus.DIGITAL_SENT,
]);

/**
 * Parses and executes a vendor status-update command.
 * Works for both the vendor's registered phone and active notification numbers.
 *
 * @param vendorPhone - The phone that sent the command (may be a notification number)
 * @param rawMessage  - The raw text message from the vendor
 */
export async function handleVendorStatusCommand(
  vendorPhone: string,
  rawMessage: string,
): Promise<void> {
  const logCtx = { vendor: maskPhone(vendorPhone) };
  const text = rawMessage.trim().toUpperCase();

  // ── HANDLED — resolve pending customer escalation ─────────────────────────
  if (text === 'HANDLED') {
    // Vendor lookup for HANDLED (same pattern as status commands below)
    let handledVendor = await vendorRepository.findByWhatsAppNumber(vendorPhone);
    if (!handledVendor) {
      const notifRecord = await prisma.vendorNotificationNumber.findFirst({
        where: { phone: vendorPhone, isActive: true },
        include: { vendor: true },
      });
      handledVendor = notifRecord?.vendor ?? null;
    }
    if (handledVendor) {
      await resolveEscalation(vendorPhone, handledVendor);
    }
    return;
  }

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

  // ── Vendor lookup — try whatsappNumber first, then notification numbers ────
  let vendor = await vendorRepository.findByWhatsAppNumber(vendorPhone);
  if (!vendor) {
    const notifRecord = await prisma.vendorNotificationNumber.findFirst({
      where: { phone: vendorPhone, isActive: true },
      include: { vendor: true },
    });
    vendor = notifRecord?.vendor ?? null;
  }
  if (!vendor) {
    logger.warn('Status command from unregistered phone', logCtx);
    return;
  }

  // Find the order by short ID (last 6 chars of UUID, optionally prefixed ORD-)
  const normalised = (shortId ?? '').replace('ORD-', '');
  const { orders } = await orderRepository.findByVendor(vendor.id, { limit: 100 });
  const order = orders.find((o) => o.id.slice(-6).toUpperCase() === normalised);

  if (!order) {
    await sendTextMessage(vendorPhone, `Order *${shortId}* not found. Check the order ID and try again.`);
    return;
  }

  // ── Double-confirmation guard ─────────────────────────────────────────────
  // When multiple managers receive the same order alert, they may both try to confirm.
  // Whichever one acts second should get a clear "already handled" message.
  if (command === 'CONFIRM' && ALREADY_CONFIRMED_STATUSES.has(order.status)) {
    await sendTextMessage(
      vendorPhone,
      `✅ Order *${shortId}* was already confirmed by another manager. No action needed.`,
    );
    return;
  }

  // ── Prevent status regression (e.g. DELIVERED → PREPARING) ───────────────
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

  // ── Apply status update ────────────────────────────────────────────────────
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

  // Notify customer
  const customerPhone = order.customer.whatsappNumber;
  await sendTextMessage(customerPhone, msgPhysicalStatusUpdate(order.id, newStatus));

  // Confirm back to the manager who acted
  await sendTextMessage(
    vendorPhone,
    `✅ Order *${shortId}* updated to *${newStatus}*. Customer has been notified.`,
  );

  // ── Cross-notify other managers on CONFIRM ────────────────────────────────
  // Let all other notification numbers know this order is taken care of,
  // so they don't attempt a duplicate confirmation.
  if (newStatus === OrderStatus.CONFIRMED) {
    const others = await getOtherNotificationPhones(vendor.id, vendorPhone);
    await Promise.all(
      others.map((p) =>
        sendTextMessage(
          p,
          `ℹ️ Order *${shortId}* has been confirmed by another manager. No action needed.`,
        ),
      ),
    );
  }
}
