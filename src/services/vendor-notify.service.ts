/**
 * Vendor Notification Service — Phase 6
 *
 * Sends order alerts to ALL active VendorNotificationNumber records for a vendor.
 * Falls back to the vendor's legacy whatsappNumber if none are registered.
 *
 * This is the single place that implements multi-number fan-out so every other
 * service (order, delivery, etc.) can call one function instead of querying
 * notification numbers themselves.
 */
import { prisma } from '../repositories/prisma';
import { messageQueue } from '../queues/message.queue';

/**
 * Sends `message` to every active notification number for `vendorId`.
 * If no notification numbers exist, falls back to `fallbackPhone`
 * (the vendor's legacy whatsappNumber field).
 * All sends are concurrent.
 */
export async function notifyVendorNumbers(
  vendorId: string,
  fallbackPhone: string,
  message: string,
): Promise<void> {
  const numbers = await prisma.vendorNotificationNumber.findMany({
    where: { vendorId, isActive: true },
  });

  if (numbers.length === 0) {
    await messageQueue.add({ to: fallbackPhone, message });
    return;
  }

  await Promise.all(numbers.map((n) => messageQueue.add({ to: n.phone, message })));
}

/**
 * Returns all active notification phone numbers for `vendorId`,
 * excluding `excludePhone`. Used to notify "other managers" when one
 * manager takes an action (e.g. confirms an order).
 */
export async function getOtherNotificationPhones(
  vendorId: string,
  excludePhone: string,
): Promise<string[]> {
  const numbers = await prisma.vendorNotificationNumber.findMany({
    where: { vendorId, isActive: true },
  });
  return numbers.map((n) => n.phone).filter((p) => p !== excludePhone);
}
