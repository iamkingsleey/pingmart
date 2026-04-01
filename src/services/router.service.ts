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
import { startVendorOnboarding, handleVendorOnboarding, handleVendorProductPhoto } from './vendor-onboarding.service';
import { handleVendorDashboard } from './vendor-management.service';
import { handleSupportCustomerMessage, showSupportWelcome } from './support-customer.service';
import { handleSupportVendorDashboard } from './support-vendor.service';
import { customerRepository } from '../repositories/customer.repository';
import { logger, maskPhone } from '../utils/logger';
import { ConversationState, SessionData } from '../types';
import { formatNaira } from '../utils/formatters';
import { Language } from '../i18n';
import { resolveStoreVocabulary, applyVocabulary } from '../utils/store-vocabulary';

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
 * @param senderPhone          E.164 sender phone number
 * @param message              Normalised text content (empty string for image messages)
 * @param vendorWhatsAppNumber The Pingmart display number (from Meta webhook metadata)
 * @param messageId            Meta message ID for dedup (may be empty string)
 * @param imageMediaId         WhatsApp media ID when the message is an image
 * @param imageCaption         Caption attached to the image, if any
 */
export async function routeIncomingMessage(
  senderPhone: string,
  message: string,
  _vendorWhatsAppNumber: string,
  messageId: string,
  imageMediaId?: string,
  imageCaption?: string,
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

  logger.info('Router: routing message', { from: maskPhone(senderPhone), hasImage: !!imageMediaId });

  // ── 1b. Image message routing ─────────────────────────────────────────────
  // Image messages have an empty text payload. Route them straight to the
  // dedicated image handler so they never fall through to the text paths.
  if (imageMediaId) {
    await routeImageMessage(senderPhone, imageMediaId, imageCaption ?? '');
    return;
  }

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

  // ── 2b. Router button IDs — handle even without Redis state ──────────────
  // If the SHOP_OR_SELL Redis key expired between the time we sent the buttons
  // and the time the user tapped (> 30 min gap, or a Redis flush), we still
  // want to honour the button tap rather than falling through to unrecognised
  // sender logic and showing the language screen again.
  const msgUpper = message.trim().toUpperCase();
  if (msgUpper === 'SELL_ON_PINGMART' || msgUpper === 'SHOP_FROM_STORE') {
    await handleShopOrSellReply(senderPhone, message);
    return;
  }

  // ── 3. Message is a valid store code (highest-priority customer check) ──────
  // Store code detection runs BEFORE vendor-identity checks so that anyone —
  // including a vendor owner — can tap a store link and land correctly.
  //
  // Special case: if the store code is the vendor's OWN store, treat it as the
  // vendor accessing their dashboard (e.g. tapping their own share link).
  // If it is a DIFFERENT vendor's store, stamp them as a customer for that
  // store — a vendor can also shop at a competitor's store.
  //
  // Guard: router button IDs (SELL_ON_PINGMART, SHOP_FROM_STORE) technically
  // match STORE_CODE_REGEX. Exclude them explicitly so a stale/missing Redis
  // SHOP_OR_SELL state never misroutes a button tap as a store code lookup.
  const ROUTER_BUTTON_IDS = new Set(['SELL_ON_PINGMART', 'SHOP_FROM_STORE']);
  const potentialCode = message.trim().toUpperCase();
  if (!ROUTER_BUTTON_IDS.has(potentialCode) && STORE_CODE_REGEX.test(potentialCode)) {
    const vendorByCode = await prisma.vendor.findFirst({
      where: { storeCode: potentialCode, isActive: true },
    });
    if (vendorByCode) {
      if (vendorByCode.ownerPhone === senderPhone) {
        // Vendor tapped their own store link → vendor dashboard
        logger.info('Router → vendor dashboard (own store code)', {
          from: maskPhone(senderPhone),
          storeCode: potentialCode,
        });
        await handleVendorMessage(senderPhone, message, vendorByCode);
        return;
      }
      // Different vendor's store → customer flow
      logger.info('Router → customer session (store code)', {
        from: maskPhone(senderPhone),
        storeCode: potentialCode,
      });
      await startCustomerSession(senderPhone, vendorByCode);
      return;
    }
  }

  // ── 4. Sender is a registered vendor (v2 ownerPhone field) ────────────────
  // Only route to the vendor dashboard when there is NO active customer session
  // at a DIFFERENT vendor's store. Role is determined by the store code the
  // customer sent — not re-evaluated on every subsequent message.
  //
  // This prevents the dashboard from hijacking a vendor who:
  //   • is mid-language-selection after sending a competitor's store code
  //   • is browsing / ordering at another store
  //   • has any live session state at a store that is not their own
  const vendorByOwnerPhone = await prisma.vendor.findUnique({
    where: { ownerPhone: senderPhone },
  });
  if (vendorByOwnerPhone) {
    const activeCustomerSession = await prisma.conversationSession.findFirst({
      where: { whatsappNumber: senderPhone, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'desc' },
    });

    // Any active session at a store that is NOT the vendor's own store means
    // this sender is currently acting as a customer — protect every state
    // (LANGUAGE_SELECTION, BROWSING, ORDERING, AWAITING_*, etc.).
    if (activeCustomerSession && activeCustomerSession.vendorId !== vendorByOwnerPhone.id) {
      const sessionVendor = await vendorRepository.findById(activeCustomerSession.vendorId);
      if (sessionVendor) {
        logger.info('Router → customer session (vendor shopping at different store)', {
          from: maskPhone(senderPhone),
          state: activeCustomerSession.state,
          sessionStore: sessionVendor.storeCode ?? sessionVendor.id,
        });
        if ((sessionVendor as any).mode === 'SUPPORT') {
          await handleSupportCustomerMessage(senderPhone, message, sessionVendor);
        } else {
          await processIncomingMessage(senderPhone, message, sessionVendor.whatsappNumber, undefined);
        }
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
      if ((vendor as any).mode === 'SUPPORT') {
        await handleSupportCustomerMessage(senderPhone, message, vendor);
      } else {
        await processIncomingMessage(senderPhone, message, vendor.whatsappNumber, undefined);
      }
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
  // Normalise: strip whitespace and force uppercase so comparisons are never
  // tripped up by casing differences or invisible Unicode characters.
  const choice = message.trim().toUpperCase();
  await redis.del(`router:state:${phone}`);

  // Accept both button IDs (primary) and legacy numeric replies (fallback)
  const isSell = choice === 'SELL_ON_PINGMART' || choice === '2';
  const isShop = choice === 'SHOP_FROM_STORE'  || choice === '1';

  if (isShop) {
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

  if (isSell) {
    await startVendorOnboarding(phone);
    return;
  }

  // Unrecognised reply — log and show the screen again
  logger.warn('Router: unrecognised SHOP_OR_SELL reply', {
    from: maskPhone(phone),
    raw: JSON.stringify(message),
  });
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

  // Phase 5: full vendor dashboard (mode-aware)
  if ((vendor as any).mode === 'SUPPORT') {
    await handleSupportVendorDashboard(phone, message, vendor);
  } else {
    await handleVendorDashboard(phone, message, vendor);
  }
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
      if ((vendor as any).mode === 'SUPPORT') {
        await showSupportWelcome(phone, vendor);
      } else {
        await processIncomingMessage(phone, 'MENU', vendor.whatsappNumber, undefined);
      }
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
          message: applyVocabulary(
            `👋 Welcome back, ${name}! Great to see you again at *${vendor.businessName}* 🛍️\n\n` +
            `Your last order: ${itemSummary} (${total})\n\n` +
            `Want the same again? Reply *YES* to reorder instantly\n` +
            `or *MENU* to browse everything 😊`,
            resolveStoreVocabulary(vendor.businessType),
          ),
        });
        return;
      }
    }
  }

  // ── 5. New customer or first visit to this store ───────────────────────────
  await sessionRepository.reset(phone, vendor.id);
  if ((vendor as any).mode === 'SUPPORT') {
    await showSupportWelcome(phone, vendor);
  } else {
    await processIncomingMessage(phone, 'MENU', vendor.whatsappNumber, undefined);
  }
}

/**
 * Shows the language-selection prompt to a brand-new sender.
 * This is always the FIRST thing a new phone sees before "shop or sell?".
 * Sent as a List Message so the customer can tap instead of typing a number.
 */
async function showLanguageSelectionScreen(phone: string): Promise<void> {
  await redis.setex(`router:state:${phone}`, ROUTER_STATE_TTL_SECS, 'LANG_INIT');
  await messageQueue.add({
    to: phone,
    message: `👋 Welcome to *Pingmart*!\n\nPlease choose your language to continue:`,
    listSections: [
      {
        title: '🌍 Select Your Language',
        rows: [
          { id: 'en',  title: '🇬🇧 English'  },
          { id: 'pid', title: '🇳🇬 Pidgin'   },
          { id: 'ig',  title: 'Igbo'          },
          { id: 'yo',  title: 'Yorùbá'        },
          { id: 'ha',  title: 'Hausa'         },
        ],
      },
    ],
    listButtonText: 'Choose Language',
  });
}

/**
 * Handles the reply to the language-selection prompt.
 * Accepts both list row IDs (en, pid, ig, yo, ha) and legacy numeric keys (1-5).
 * Saves the chosen language to the Customer record, then shows "shop or sell?".
 */
async function handleLangInitReply(phone: string, message: string): Promise<void> {
  const LANG_MAP: Record<string, Language> = {
    // List row IDs (primary — sent by the interactive list)
    'en': 'en', 'pid': 'pid', 'ig': 'ig', 'yo': 'yo', 'ha': 'ha',
    // Legacy numeric fallback (plain text replies still work)
    '1': 'en',  '2': 'pid',  '3': 'ig',  '4': 'yo',  '5': 'ha',
  };
  const choice = message.trim().toLowerCase();
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
 * Sent as Reply Buttons so the customer taps instead of typing.
 * Sets Redis state so their next message is handled as a reply to this prompt.
 */
async function showShopOrSellScreen(phone: string): Promise<void> {
  await redis.setex(`router:state:${phone}`, ROUTER_STATE_TTL_SECS, 'SHOP_OR_SELL');
  await messageQueue.add({
    to: phone,
    message:
      `👋 Welcome to *Pingmart*!\n\n` +
      `What would you like to do today?`,
    buttons: [
      { id: 'SELL_ON_PINGMART', title: '🏪 Sell on Pingmart' },
      { id: 'SHOP_FROM_STORE',  title: '🛍️ Shop from a store' },
    ],
  });
}

/**
 * Handles an inbound image message.
 *
 * Vendors who are in the ADDING_PRODUCTS step with productInputMode === 'photos'
 * get their product photo extracted. Everyone else receives the standard
 * "type MENU to browse" nudge.
 */
async function routeImageMessage(
  phone: string,
  imageMediaId: string,
  caption: string,
): Promise<void> {
  const vendor = await prisma.vendor.findUnique({ where: { ownerPhone: phone } });
  if (vendor) {
    const setupSession = await prisma.vendorSetupSession.findUnique({
      where: { vendorId: vendor.id },
    });
    if (setupSession && !setupSession.completedAt && setupSession.step === 'ADDING_PRODUCTS') {
      const data = (setupSession.collectedData ?? {}) as Record<string, unknown>;
      if (data.productInputMode === 'photos') {
        await handleVendorProductPhoto(phone, imageMediaId, caption, vendor, setupSession);
        return;
      }
    }
  }

  // Default: helpful nudge to customers (and vendors not in photo mode)
  const customer = await customerRepository.findByWhatsAppNumber(phone);
  const lang = (customer?.language as Language | undefined) ?? 'en';
  await messageQueue.add({
    to: phone,
    message: `Thanks for the image! 📸 To order or browse products, just type *MENU*. 😊`,
  });
  logger.info('Image routed to fallback nudge', { from: maskPhone(phone), lang });
}
