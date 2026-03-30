/**
 * Smart Router — Phase 2: Single Number Webhook Routing
 *
 * ALL incoming messages to the single Pingmart WhatsApp number flow through here.
 * The router determines who is messaging and what to show them, in strict priority order:
 *
 *  1. Dedup          — ignore replayed Meta messages or Bull stall-retries
 *  2. Router state   — pending LANG_INIT / SHOP_OR_SELL replies
 *  3. Valid store code → start/switch customer shopping session  ← HIGHEST PRIORITY
 *                        (runs before vendor checks so any phone, including a vendor
 *                         owner, can tap a store link and land in the correct store)
 *  4. Vendor by ownerPhone   → vendor dashboard (Phase 5)
 *  5. Notification number    → vendor staff handler
 *  6. Active customer session → continue existing session
 *  7. v1 vendor by whatsappNumber (backward-compat) → vendor status commands
 *  8. Unknown sender         → "shop or sell?" screen
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
import { customerRepository } from '../repositories/customer.repository';
import { logger, maskPhone } from '../utils/logger';
import { ConversationState, SessionData } from '../types';
import { formatNaira } from '../utils/formatters';
import { Language } from '../i18n';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROUTER_STATE_TTL_SECS = 30 * 60; // 30 minutes

// Store codes are 4–20 characters: uppercase letters, digits, and underscores.
// Examples: "JAY02", "FRESHY_NG", "SHOP123".
// Must START with a letter or digit (not underscore) to avoid false matches on
// keyboard noise. Pure short words like "OK" or "NO" fall below the 4-char floor.
const STORE_CODE_REGEX = /^[A-Z0-9][A-Z0-9_]{3,19}$/;

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

  // ── 2. Pending router-state replies ──────────────────────────────────────
  const routerState = await redis.get(`router:state:${senderPhone}`);
  if (routerState === 'LANG_INIT') {
    await handleLangInitReply(senderPhone, message);
    return;
  }
  if (routerState === 'SHOP_OR_SELL') {
    await handleShopOrSellReply(senderPhone, message);
    return;
  }

  // ── 3. Message is a valid store code (highest-priority customer check) ──────
  // Store code detection runs BEFORE vendor-identity checks. This ensures that
  // anyone — including a vendor owner — can tap a store link and land in the
  // correct shopping session without their vendor role intercepting the request.
  // startCustomerSession handles same-store re-entry and cross-store switching.
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

  // ── 4. Sender is a registered vendor (v2 ownerPhone field) ────────────────
  // IMPORTANT: Before routing to vendor dashboard, check whether this phone
  // also has an active customer checkout session. A vendor owner shopping at
  // their own store (or another store) must stay in the customer flow —
  // routing based on phone alone would hijack their checkout with vendor commands.
  const vendorByOwnerPhone = await prisma.vendor.findUnique({
    where: { ownerPhone: senderPhone },
  });
  if (vendorByOwnerPhone) {
    // Look for a live customer session in an active (non-IDLE, non-BROWSING) state.
    // IDLE / BROWSING are low-commitment states where falling through to vendor
    // handling is acceptable. ORDERING, AWAITING_*, AWAITING_PAYMENT etc. are
    // in-progress checkout states that must not be interrupted.
    const activeCustomerSession = await prisma.conversationSession.findFirst({
      where: { whatsappNumber: senderPhone, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'desc' },
    });

    const checkoutStates: string[] = [
      ConversationState.ORDERING,
      ConversationState.AWAITING_ITEM_NOTE,
      ConversationState.AWAITING_ADDRESS,
      ConversationState.AWAITING_PAYMENT,
      ConversationState.COMPLETED,
    ];

    if (activeCustomerSession && checkoutStates.includes(activeCustomerSession.state)) {
      // Vendor-owner is mid-checkout — route to customer handler, not vendor dashboard.
      const sessionVendor = await vendorRepository.findById(activeCustomerSession.vendorId);
      if (sessionVendor) {
        logger.info('Router → customer checkout session (vendor owner shopping)', {
          from: maskPhone(senderPhone),
          state: activeCustomerSession.state,
        });
        await processIncomingMessage(senderPhone, message, sessionVendor.whatsappNumber, undefined);
        return;
      }
    }

    logger.info('Router → vendor dashboard (ownerPhone match)', { from: maskPhone(senderPhone) });
    await handleVendorMessage(senderPhone, message, vendorByOwnerPhone);
    return;
  }

  // ── 5. Sender is a notification number (vendor staff) ─────────────────────
  const notifRecord = await prisma.vendorNotificationNumber.findFirst({
    where: { phone: senderPhone, isActive: true },
    include: { vendor: true },
  });
  if (notifRecord) {
    logger.info('Router → vendor staff (notification number)', { from: maskPhone(senderPhone) });
    await handleVendorStaffMessage(senderPhone, message, notifRecord.vendor, notifRecord.isPrimary);
    return;
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

  // ── 8. Unknown sender — language selection first, then shop/sell ─────────
  logger.info('Router → unknown sender, showing language selection', { from: maskPhone(senderPhone) });
  await showLanguageSelectionScreen(senderPhone);
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
 * Starts or switches a customer's shopping session for a specific vendor.
 *
 * Priority:
 *  1. Paused store      → "not taking orders" message, exit
 *  2. Same-store re-entry (customer already has an active session for this vendor)
 *                       → show menu without resetting (language + cart preserved)
 *  3. Cross-store switch (active session exists for a DIFFERENT vendor)
 *                       → log switch, notify if previous cart had items, then continue
 *  4. Returning customer (VendorCustomer record for THIS vendor exists + completed order)
 *                       → personalised welcome with last-order reorder prompt
 *  5. New customer or first visit to this store
 *                       → reset session, delegate to processIncomingMessage for lang + menu
 *
 * Language preference is stored on the Customer record and is never touched here —
 * it persists automatically across store switches.
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

  // ── 2 & 3. Check for an existing active session (any vendor) ──────────────
  // Must run before creating/resetting so we can detect same-store re-entry
  // (no reset needed) and cross-store switches (notify + clear old cart).
  const existingSession = await prisma.conversationSession.findFirst({
    where: { whatsappNumber: phone, expiresAt: { gt: new Date() } },
    orderBy: { updatedAt: 'desc' },
  });

  if (existingSession) {
    // ── 2. Same store re-entry ─────────────────────────────────────────────
    // Customer tapped the same store link they're already in — treat as
    // returning to the homepage. Do NOT reset; preserve their cart and state.
    if (existingSession.vendorId === vendor.id) {
      logger.info('Router → same-store re-entry, showing menu (session preserved)', {
        from: maskPhone(phone),
        storeCode: vendor.storeCode,
      });
      await processIncomingMessage(phone, 'MENU', vendor.whatsappNumber, undefined);
      return;
    }

    // ── 3. Cross-store switch ──────────────────────────────────────────────
    const existingData = existingSession.sessionData as unknown as SessionData | undefined;
    const hadItems = (existingData?.cart?.length ?? 0) > 0;
    const oldVendor = await vendorRepository.findById(existingSession.vendorId);

    logger.info('[SESSION] Customer switched stores', {
      from: maskPhone(phone),
      oldStore: oldVendor?.storeCode ?? existingSession.vendorId,
      newStore: vendor.storeCode ?? vendor.id,
    });

    // Inform the customer their old cart is gone, but only if there was something in it.
    if (hadItems && oldVendor) {
      await messageQueue.add({
        to: phone,
        message:
          `Switching you to *${vendor.businessName}* 🛍️. ` +
          `Your previous cart from *${oldVendor.businessName}* has been cleared.`,
      });
    }
    // Fall through to paths 4 & 5 to start the new session.
  }

  // ── 4. Returning customer to THIS specific store ───────────────────────────
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

  // ── 5. New customer or first visit to this store ───────────────────────────
  await sessionRepository.reset(phone, vendor.id);
  await processIncomingMessage(phone, 'MENU', vendor.whatsappNumber, undefined);
}

/**
 * Shows the language-selection prompt to a brand-new sender.
 * This is always the FIRST thing a new phone sees before "shop or sell?".
 */
async function showLanguageSelectionScreen(phone: string): Promise<void> {
  await redis.setex(`router:state:${phone}`, ROUTER_STATE_TTL_SECS, 'LANG_INIT');
  await messageQueue.add({
    to: phone,
    message:
      `👋 Welcome to *Pingmart*!\n\n` +
      `Please choose your language / Biko họrọ asụsụ gị:\n\n` +
      `1️⃣ English\n` +
      `2️⃣ Pidgin\n` +
      `3️⃣ Igbo\n` +
      `4️⃣ Yoruba\n` +
      `5️⃣ Hausa\n\n` +
      `Reply with a number (1–5)`,
  });
}

/**
 * Handles the reply to the language-selection prompt.
 * Saves the chosen language to the Customer record, then shows "shop or sell?".
 */
async function handleLangInitReply(phone: string, message: string): Promise<void> {
  const LANG_MAP: Record<string, Language> = {
    '1': 'en',
    '2': 'pid',
    '3': 'ig',
    '4': 'yo',
    '5': 'ha',
  };
  const choice = message.trim();
  const lang = LANG_MAP[choice];

  if (!lang) {
    // Unrecognised reply — show language screen again
    await showLanguageSelectionScreen(phone);
    return;
  }

  // Persist language to Customer record (create if first visit)
  await customerRepository.findOrCreate(phone);
  await customerRepository.updateLanguage(phone, lang);

  // Clear LANG_INIT state and proceed to shop/sell
  await redis.del(`router:state:${phone}`);
  await showShopOrSellScreen(phone);
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
