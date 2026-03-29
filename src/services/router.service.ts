/**
 * Smart Router — Phase 2: Single Number Webhook Routing
 *
 * ALL incoming messages to the single Pingmart WhatsApp number flow through here.
 * The router determines who is messaging and what to show them, in strict priority order:
 *
 *  1. Dedup — ignore replayed Meta messages or Bull stall-retries
 *  2. Vendor by ownerPhone   → vendor dashboard (Phase 5)
 *  3. Notification number    → vendor staff handler
 *  4. Valid store code       → start/restart customer shopping session
 *  5. Active customer session → continue existing session
 *  6. v1 vendor by whatsappNumber (backward-compat) → vendor status commands
 *  7. Unknown sender         → "shop or sell?" screen
 *
 * "shop or sell?" state is tracked in Redis (not DB) — it only lasts until the
 * sender makes a choice, so a 30-minute TTL is more than enough.
 */
import { Vendor } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { redis } from '../utils/redis';
import { messageQueue } from '../queues/message.queue';
import { vendorRepository } from '../repositories/vendor.repository';
import { sessionRepository } from '../repositories/session.repository';
import { orderRepository } from '../repositories/order.repository';
import { processIncomingMessage } from './order/order.service';
import { handleVendorStatusCommand } from './delivery/physicalDelivery.service';
import { startVendorOnboarding, handleVendorOnboarding } from './vendor-onboarding.service';
import { handleVendorDashboard } from './vendor-management.service';
import { logger, maskPhone } from '../utils/logger';
import { ConversationState } from '../types';
import { formatNaira } from '../utils/formatters';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROUTER_STATE_TTL_SECS = 30 * 60; // 30 minutes

// Store codes are 4–20 alphanumeric characters (per spec). Shorter strings are
// more likely to be regular words ("OK", "NO") so we don't attempt a code lookup.
const STORE_CODE_REGEX = /^[A-Z0-9]{4,20}$/;

// ─── Public Entry Point ───────────────────────────────────────────────────────

/**
 * Routes a single inbound message to the correct handler.
 * Called from the incomingMessage Bull worker.
 *
 * @param senderPhone        E.164 sender phone number
 * @param message            Normalised text content
 * @param vendorWhatsAppNumber  The Pingmart display number (from Meta webhook metadata)
 * @param messageId          Meta message ID for dedup (may be empty string)
 */
export async function routeIncomingMessage(
  senderPhone: string,
  message: string,
  _vendorWhatsAppNumber: string,
  messageId: string,
): Promise<void> {
  // ── 1. Dedup ──────────────────────────────────────────────────────────────
  // Prevents double-processing from Meta retries AND Bull stall-retries.
  // The processIncomingMessage path gets messageId=undefined so it skips its
  // own dedup (the router already claimed the key for this message).
  if (messageId) {
    const claimed = await redis.set(`msg:${messageId}`, '1', 'EX', 3600, 'NX');
    if (!claimed) {
      logger.info('Router: duplicate message skipped', { msgId: messageId.slice(-8) });
      return;
    }
  }

  logger.info('Router: routing message', { from: maskPhone(senderPhone) });

  // ── 2. Pending "shop or sell?" reply ─────────────────────────────────────
  const routerState = await redis.get(`router:state:${senderPhone}`);
  if (routerState === 'SHOP_OR_SELL') {
    await handleShopOrSellReply(senderPhone, message);
    return;
  }

  // ── 3. Sender is a registered vendor (v2 ownerPhone field) ────────────────
  const vendorByOwnerPhone = await prisma.vendor.findUnique({
    where: { ownerPhone: senderPhone },
  });
  if (vendorByOwnerPhone) {
    logger.info('Router → vendor dashboard (ownerPhone match)', { from: maskPhone(senderPhone) });
    await handleVendorMessage(senderPhone, message, vendorByOwnerPhone);
    return;
  }

  // ── 4. Sender is a notification number (vendor staff) ─────────────────────
  const notifRecord = await prisma.vendorNotificationNumber.findFirst({
    where: { phone: senderPhone, isActive: true },
    include: { vendor: true },
  });
  if (notifRecord) {
    logger.info('Router → vendor staff (notification number)', { from: maskPhone(senderPhone) });
    await handleVendorStaffMessage(senderPhone, message, notifRecord.vendor, notifRecord.isPrimary);
    return;
  }

  // ── 5. Message is a valid store code ─────────────────────────────────────
  const potentialCode = message.trim().toUpperCase();
  if (STORE_CODE_REGEX.test(potentialCode)) {
    const vendorByCode = await prisma.vendor.findFirst({
      where: { storeCode: potentialCode, isActive: true },
    });
    if (vendorByCode) {
      logger.info('Router → customer session (store code)', {
        from: maskPhone(senderPhone),
        storeCode: potentialCode,
      });
      await startCustomerSession(senderPhone, vendorByCode);
      return;
    }
  }

  // ── 6. Active customer session exists ─────────────────────────────────────
  const activeSession = await prisma.conversationSession.findFirst({
    where: { whatsappNumber: senderPhone, expiresAt: { gt: new Date() } },
    orderBy: { updatedAt: 'desc' },
  });
  if (activeSession) {
    const vendor = await vendorRepository.findById(activeSession.vendorId);
    if (vendor) {
      logger.info('Router → existing customer session', { from: maskPhone(senderPhone) });
      // Pass undefined for messageId — dedup was already handled above
      await processIncomingMessage(senderPhone, message, vendor.whatsappNumber, undefined);
      return;
    }
  }

  // ── 7. v1 backward-compat: vendor by old whatsappNumber field ─────────────
  // Handles vendors whose ownerPhone hasn't been set yet (pre-Phase 9 migration).
  const v1Vendor = await vendorRepository.findByWhatsAppNumber(senderPhone);
  if (v1Vendor) {
    logger.info('Router → v1 vendor (whatsappNumber match)', { from: maskPhone(senderPhone) });
    await handleVendorStatusCommand(senderPhone, message);
    return;
  }

  // ── 8. Unknown sender — show shop or sell screen ──────────────────────────
  logger.info('Router → unknown sender, showing shop/sell screen', { from: maskPhone(senderPhone) });
  await showShopOrSellScreen(senderPhone);
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * Handles the reply to the "shop or sell?" prompt.
 * Clears the Redis state so the next message goes through normal routing.
 */
async function handleShopOrSellReply(phone: string, message: string): Promise<void> {
  const choice = message.trim();
  await redis.del(`router:state:${phone}`);

  if (choice === '1') {
    await messageQueue.add({
      to: phone,
      message:
        `To shop, you need a store link from a vendor.\n\n` +
        `Ask the vendor to share their Pingmart link with you —\n` +
        `it looks like this: *wa.me/234XXXXXXX?text=STORECODE*\n\n` +
        `Once you tap their link, you'll land directly in their store. 🛍️`,
    });
    return;
  }

  if (choice === '2') {
    await startVendorOnboarding(phone);
    return;
  }

  // Unrecognised reply — show the screen again
  await showShopOrSellScreen(phone);
}

/**
 * Routes a message from a registered vendor.
 * If the vendor is mid-onboarding, routes to the onboarding handler.
 * Otherwise routes to the Phase 5 vendor dashboard (management commands).
 */
async function handleVendorMessage(
  phone: string,
  message: string,
  vendor: Vendor,
): Promise<void> {
  // Check if vendor is mid-onboarding (setup session exists and not yet complete)
  const setupSession = await prisma.vendorSetupSession.findUnique({
    where: { vendorId: vendor.id },
  });
  if (setupSession && !setupSession.completedAt) {
    await handleVendorOnboarding(phone, message, vendor, setupSession);
    return;
  }

  // Phase 5: full vendor dashboard
  await handleVendorDashboard(phone, message, vendor);
}

/**
 * Routes a message from a vendor staff (notification number).
 * Primary notification numbers get full vendor management access.
 * Non-primary (branch/staff) numbers only receive order notifications.
 */
async function handleVendorStaffMessage(
  phone: string,
  message: string,
  vendor: Vendor,
  isPrimary: boolean,
): Promise<void> {
  if (isPrimary) {
    // Primary notification number = vendor owner's backup number
    await handleVendorStatusCommand(phone, message);
    return;
  }
  // Staff-only notification numbers cannot manage the store (yet)
  await messageQueue.add({
    to: phone,
    message:
      `ℹ️ This number is registered to receive order alerts from *${vendor.businessName}*.\n\n` +
      `Store management is available from the vendor's registered number.`,
  });
}

/**
 * Starts or restarts a customer's shopping session for a specific vendor.
 *
 * Priority:
 *  1. Paused store → "not taking orders" message
 *  2. Returning customer (VendorCustomer record exists) → personalized welcome with last-order reorder prompt
 *  3. New customer → reset session and let processIncomingMessage handle language selection + menu
 */
async function startCustomerSession(phone: string, vendor: Vendor): Promise<void> {
  // ── 1. Paused store ────────────────────────────────────────────────────────
  if (vendor.isPaused) {
    await messageQueue.add({
      to: phone,
      message:
        `😔 *${vendor.businessName}* is not taking orders right now.\n\n` +
        `We'll be back soon! Check back later or message us directly for enquiries.`,
    });
    return;
  }

  // ── 2. Returning customer check ────────────────────────────────────────────
  const customer = await prisma.customer.findUnique({ where: { whatsappNumber: phone } });
  if (customer) {
    const vendorCustomer = await prisma.vendorCustomer.findUnique({
      where: { vendorId_customerId: { vendorId: vendor.id, customerId: customer.id } },
    });
    if (vendorCustomer) {
      const lastOrder = await orderRepository.findLastCompleted(customer.id, vendor.id);
      if (lastOrder?.orderItems.length) {
        const itemSummary = lastOrder.orderItems
          .map((oi) => `${oi.quantity}x ${(oi as any).product?.name ?? 'item'}`)
          .join(', ');
        const total = formatNaira(lastOrder.totalAmount);
        const name = customer.name ?? 'there';

        await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, {
          cart: [],
          awaitingReorderConfirmation: true,
        });
        await messageQueue.add({
          to: phone,
          message:
            `👋 Welcome back, ${name}! Great to see you again at *${vendor.businessName}* 🛍️\n\n` +
            `Your last order: ${itemSummary} (${total})\n\n` +
            `Want the same again? Reply *YES* to reorder instantly\n` +
            `or *MENU* to browse everything 😊`,
        });
        return;
      }
    }
  }

  // ── 3. New customer or first visit to this store ───────────────────────────
  await sessionRepository.reset(phone, vendor.id);
  await processIncomingMessage(phone, 'MENU', vendor.whatsappNumber, undefined);
}

/**
 * Shows the Pingmart "shop or sell?" landing screen to an unknown sender.
 * Sets Redis state so their next message is handled as a reply to this prompt.
 */
async function showShopOrSellScreen(phone: string): Promise<void> {
  await redis.setex(`router:state:${phone}`, ROUTER_STATE_TTL_SECS, 'SHOP_OR_SELL');
  await messageQueue.add({
    to: phone,
    message:
      `👋 Welcome to *Pingmart*!\n\n` +
      `What brings you here today?\n\n` +
      `1️⃣ I want to shop from a store\n` +
      `2️⃣ I want to sell on Pingmart\n\n` +
      `Reply with *1* or *2*`,
  });
}
