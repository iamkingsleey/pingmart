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
import { startVendorOnboarding, handleVendorOnboarding, handleVendorProductPhoto, handleVendorDocument } from './vendor-onboarding.service';
import { handleVendorDashboard } from './vendor-management.service';
import { handleSupportCustomerMessage, showSupportWelcome } from './support-customer.service';
import { handleSupportVendorDashboard } from './support-vendor.service';
import { sendTypingIndicator } from './whatsapp/whatsapp.service';
import { customerRepository } from '../repositories/customer.repository';
import { logger, maskPhone } from '../utils/logger';
import { ConversationState, SessionData } from '../types';
import { formatNaira } from '../utils/formatters';
import { t, Language } from '../i18n';
import { interceptCommand } from './commands.service';
import { resolveStoreVocabulary, applyVocabulary } from '../utils/store-vocabulary';
import { appendToHistory, getHistory } from '../utils/conversationHistory';
import {
  classifyIntent,
  isStructuredCommand,
  IntentContext,
} from './llm.service';
import {
  LLM_CONFIDENCE_THRESHOLD,
  INTENT_CACHE_TTL_SECS,
} from '../config/constants';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROUTER_STATE_TTL_SECS = 30 * 60; // 30 minutes

// Store codes are 4–20 characters: uppercase letters, digits, and underscores.
// Examples: "JAY02", "FRESHY_NG", "SHOP123".
// Must START with a letter or digit (not underscore) to avoid false matches on
// keyboard noise. Pure short words like "OK" or "NO" fall below the 4-char floor.
const STORE_CODE_REGEX = /^[A-Z0-9][A-Z0-9_]{3,19}$/;

// ─── Clarifying questions (low-confidence fallback) ───────────────────────────

const CLARIFYING_QUESTIONS: Record<Language, string> = {
  en:  `I want to make sure I understand — could you say that a different way? 😊`,
  pid: `Help me understand — wetin exactly you mean? 🙂`,
  ig:  `Biko, gwa m ọzọ — ọ bụ gịnị ka ị chọrọ?`,
  yo:  `Jọwọ sọ fún mi lẹẹkansi — kini gangan o tumọ?`,
  ha:  `Don Allah, sake faɗa — menene ainihin kake nufi?`,
};

/**
 * Builds a lightweight IntentContext for the pipeline by making the minimum
 * number of DB/Redis reads necessary to establish role, step, and language.
 * Runs in parallel where possible; fails safe to { role: 'unknown' }.
 */
async function buildIntentContext(phone: string): Promise<IntentContext> {
  try {
    const [routerState, vendorLang] = await Promise.all([
      redis.get(`router:state:${phone}`),
      redis.get(`vendor:lang:${phone}`),
    ]);

    // Is this a registered vendor?
    const vendor = await prisma.vendor.findUnique({
      where: { ownerPhone: phone },
      select: { id: true, businessName: true, mode: true },
    });

    if (vendor) {
      const setupSession = await prisma.vendorSetupSession.findUnique({
        where: { vendorId: vendor.id },
        select: { step: true, completedAt: true, collectedData: true },
      });
      if (setupSession && !setupSession.completedAt) {
        return {
          role:      'vendor_onboarding',
          step:      setupSession.step ?? undefined,
          flow:      'onboarding',
          language:  vendorLang ?? 'en',
          storeName: (setupSession.collectedData as Record<string, unknown> | null)
            ?.businessName as string | undefined,
        };
      }
      return {
        role:      (vendor as any).mode === 'SUPPORT' ? 'vendor_support_dashboard' : 'vendor_dashboard',
        flow:      'dashboard',
        language:  vendorLang ?? 'en',
        storeName: vendor.businessName,
      };
    }

    // Is there an active customer session?
    const activeSession = await prisma.conversationSession.findFirst({
      where:   { whatsappNumber: phone, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'desc' },
      select:  { state: true, sessionData: true, vendorId: true },
    });

    if (activeSession) {
      const customer = await customerRepository.findByWhatsAppNumber(phone);
      const data = (activeSession.sessionData ?? {}) as unknown as SessionData;
      const sessionVendor = await vendorRepository.findById(activeSession.vendorId);
      return {
        role:      (sessionVendor as any)?.mode === 'SUPPORT' ? 'support_customer' : 'customer',
        step:      activeSession.state,
        flow:      (sessionVendor as any)?.mode === 'SUPPORT' ? 'support' : 'shopping',
        language:  (customer?.language as string | undefined) ?? 'en',
        storeName: sessionVendor?.businessName,
        cartItems: data.cart?.map((i) => ({ name: i.name, qty: i.quantity })),
      };
    }

    // Unknown sender — may be at any language selection step or shop/sell screen
    if (routerState === 'LANG_INIT' || routerState === 'LANG_INIT_ALT' || routerState === 'SHOP_OR_SELL') {
      const customer = await customerRepository.findByWhatsAppNumber(phone);
      return {
        role:     'onboarding',
        step:     routerState,
        flow:     'onboarding',
        language: (customer?.language as string | undefined) ?? 'en',
      };
    }

    return { role: 'unknown', language: 'en' };
  } catch {
    return { role: 'unknown', language: 'en' };
  }
}

/**
 * Pipeline Step 4 — LLM intent classification on every natural-language message.
 *
 * Returns { shouldContinue: true } in all normal cases.
 * Returns { shouldContinue: false } only when confidence is below
 * LLM_CONFIDENCE_THRESHOLD AND intent is 'unknown' — in that case a
 * clarifying question has already been sent and routing should stop.
 */
async function runLLMPipeline(
  phone: string,
  message: string,
): Promise<{ shouldContinue: boolean }> {
  // Structured commands (button taps, numeric selections) skip classification
  // but message is still added to history above in routeIncomingMessage.
  if (isStructuredCommand(message)) {
    return { shouldContinue: true };
  }

  // Build context with minimum DB reads
  const [context, history] = await Promise.all([
    buildIntentContext(phone),
    getHistory(phone),
  ]);

  // ── Cart number short-circuit ──────────────────────────────────────────────
  // During catalogue browsing or cart-building, a bare number (or
  // comma-/and-separated list) is always a product selection — never confusion,
  // escalation, or off-topic. Bypass the LLM entirely so the product-selection
  // handler receives the message unmodified.
  const CART_STEPS = new Set(['BROWSING', 'ORDERING', 'AWAITING_ITEM_NOTE']);
  const isCartStep = context.step != null && CART_STEPS.has(context.step);
  const isNumberInput = /^[\d\s,and]+$/i.test(message.trim());
  if (isCartStep && isNumberInput) {
    return { shouldContinue: true };
  }

  // Classify intent (Haiku — fast + cheap)
  const classification = await classifyIntent(message, { ...context, history });

  // Cache so handlers can retrieve the pre-computed result without a second LLM call
  await redis.setex(
    `intent:last:${phone}`,
    INTENT_CACHE_TTL_SECS,
    JSON.stringify(classification),
  ).catch(() => {});

  // ── Confidence gate ────────────────────────────────────────────────────────
  // Only intercept when we genuinely have no idea what the user means.
  // Confidence < threshold AND intent === 'unknown' = truly ambiguous message.
  if (
    classification.confidence < LLM_CONFIDENCE_THRESHOLD &&
    classification.intent === 'unknown'
  ) {
    const lang = (context.language ?? 'en') as Language;
    const clarification =
      classification.suggestedReply ||
      CLARIFYING_QUESTIONS[lang] ||
      CLARIFYING_QUESTIONS.en;
    await messageQueue.add({ to: phone, message: clarification });
    return { shouldContinue: false };
  }

  return { shouldContinue: true };
}

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
 * @param documentMediaId      WhatsApp media ID when the message is a document (xlsx, csv, etc.)
 * @param documentFileName     Original filename reported by WhatsApp
 * @param documentMimeType     MIME type reported by WhatsApp
 */
export async function routeIncomingMessage(
  senderPhone: string,
  message: string,
  _vendorWhatsAppNumber: string,
  messageId: string,
  imageMediaId?: string,
  imageCaption?: string,
  documentMediaId?: string,
  documentFileName?: string,
  documentMimeType?: string,
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

  logger.info('Router: routing message', {
    from: maskPhone(senderPhone),
    hasImage: !!imageMediaId,
    hasDocument: !!documentMediaId,
  });

  // ── 1b. Image message routing ─────────────────────────────────────────────
  // Image messages have an empty text payload. Route them straight to the
  // dedicated image handler so they never fall through to the text paths.
  if (imageMediaId) {
    await routeImageMessage(senderPhone, imageMediaId, imageCaption ?? '');
    return;

  // ── 1c. Document message routing ─────────────────────────────────────────
  // Excel/CSV uploads: route to the vendor document handler when the vendor is
  // in ADDING_PRODUCTS mode. All other senders get a standard nudge.
  } else if (documentMediaId) {
    await routeDocumentMessage(senderPhone, documentMediaId, documentFileName ?? '', documentMimeType ?? '');
    return;
  }

  // ── Command interceptor — runs before any routing or LLM logic ──────────
  // Handles RESET, HELP/ASSIST, ORDERS, LANGUAGE (non-customer), and all
  // vendor shorthand commands. Also normalizes Pidgin aliases (HOME→MENU,
  // COMOT→CANCEL, MY CART→CART, I DON FINISH→DONE) into their canonical form.
  // Source of truth for all commands: /pingmart/COMMANDS.md
  const cmdResult = await interceptCommand(senderPhone, message);
  if (cmdResult.handled) return;
  const effectiveMessage = cmdResult.normalizedMessage ?? message;

  // ── Pipeline: history tracking + LLM classification ──────────────────────
  // Step 1: Record user message in conversation history (all messages, always).
  // Step 4: Run LLM intent classification on natural-language messages.
  // Skipped for images/documents (already returned above).
  await appendToHistory(senderPhone, 'user', effectiveMessage);
  const pipelineResult = await runLLMPipeline(senderPhone, effectiveMessage);
  if (!pipelineResult.shouldContinue) return;

  // ── 2. Pending router-state replies ──────────────────────────────────────
  const routerState = await redis.get(`router:state:${senderPhone}`);
  if (routerState === 'LANG_INIT') {
    await handleLangInitReply(senderPhone, effectiveMessage, messageId);
    return;
  }
  if (routerState === 'LANG_INIT_ALT') {
    await handleLangAltListReply(senderPhone, effectiveMessage, messageId);
    return;
  }
  if (routerState === 'SHOP_OR_SELL') {
    await handleShopOrSellReply(senderPhone, effectiveMessage);
    return;
  }

  // ── 2b. Router button IDs — handle even without Redis state ──────────────
  // If the SHOP_OR_SELL Redis key expired between the time we sent the buttons
  // and the time the user tapped (> 30 min gap, or a Redis flush), we still
  // want to honour the button tap rather than falling through to unrecognised
  // sender logic and showing the language screen again.
  const msgUpper = effectiveMessage.trim().toUpperCase();
  if (msgUpper === 'SELL_ON_PINGMART' || msgUpper === 'SHOP_FROM_STORE' || msgUpper === 'SETUP_SUPPORT_CHANNEL') {
    await handleShopOrSellReply(senderPhone, effectiveMessage);
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
  const ROUTER_BUTTON_IDS = new Set(['SELL_ON_PINGMART', 'SHOP_FROM_STORE', 'SETUP_SUPPORT_CHANNEL']);
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
          await handleSupportCustomerMessage(senderPhone, effectiveMessage, sessionVendor);
        } else {
          await processIncomingMessage(senderPhone, effectiveMessage, sessionVendor.whatsappNumber, undefined);
        }
        return;
      }
    }

    logger.info('Router → vendor dashboard (ownerPhone match)', { from: maskPhone(senderPhone) });
    await handleVendorMessage(senderPhone, effectiveMessage, vendorByOwnerPhone);
    return;
  }

  // ── 5. Sender is a notification number (vendor staff) ─────────────────────
  const notifRecord = await prisma.vendorNotificationNumber.findFirst({
    where: { phone: senderPhone, isActive: true },
    include: { vendor: true },
  });
  if (notifRecord) {
    logger.info('Router → vendor staff (notification number)', { from: maskPhone(senderPhone) });
    await handleVendorStaffMessage(senderPhone, effectiveMessage, notifRecord.vendor, notifRecord.isPrimary);
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
        await handleSupportCustomerMessage(senderPhone, effectiveMessage, vendor);
      } else {
        await processIncomingMessage(senderPhone, effectiveMessage, vendor.whatsappNumber, undefined);
      }
      return;
    }
  }

  // ── 7. v1 backward-compat: vendor by old whatsappNumber field ─────────────
  // Handles vendors whose ownerPhone hasn't been set yet (pre-Phase 9 migration).
  const v1Vendor = await vendorRepository.findByWhatsAppNumber(senderPhone);
  if (v1Vendor) {
    logger.info('Router → v1 vendor (whatsappNumber match)', { from: maskPhone(senderPhone) });
    await handleVendorStatusCommand(senderPhone, effectiveMessage);
    return;
  }

  // ── 8. Unknown sender — check DB before showing language selection ─────────
  // A returning customer whose session expired (e.g. next-day visit) has no
  // active ConversationSession but DOES have a Customer record with their
  // language already saved. Skip language selection for them and go straight
  // to the shop/sell screen using their saved language.
  const returningCustomer = await prisma.customer.findUnique({
    where: { whatsappNumber: senderPhone },
    select: { language: true, languageSet: true },
  });
  if (returningCustomer?.languageSet && returningCustomer.language) {
    const savedLang = returningCustomer.language as Language;
    logger.info('Router → returning customer (no active session), skipping language selection', {
      from: maskPhone(senderPhone),
      language: savedLang,
    });
    await showShopOrSellScreen(senderPhone, savedLang);
    return;
  }

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

  // Resolve the customer's saved language for translated responses
  const customer = await customerRepository.findByWhatsAppNumber(phone);
  const lang: Language = (customer?.language as Language | undefined) ?? 'en';
  const s = INTENT_STRINGS[lang];

  // Accept both list row IDs (primary) and legacy numeric replies (fallback)
  const isSell    = choice === 'SELL_ON_PINGMART'      || choice === '2';
  const isSupport = choice === 'SETUP_SUPPORT_CHANNEL' || choice === '3';
  const isShop    = choice === 'SHOP_FROM_STORE'        || choice === '1';

  if (isSell) {
    await startVendorOnboarding(phone, false);
    return;
  }

  if (isSupport) {
    await startVendorOnboarding(phone, true);
    return;
  }

  if (isShop) {
    await messageQueue.add({ to: phone, message: s.shopRedirect });
    return;
  }

  // Unrecognised reply — log and show the screen again with correct language
  logger.warn('Router: unrecognised SHOP_OR_SELL reply', {
    from: maskPhone(phone),
    raw: JSON.stringify(message),
  });
  await showShopOrSellScreen(phone, lang);
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
        const custLang = (customer.language ?? 'en') as Language;
        await messageQueue.add({
          to: phone,
          message: applyVocabulary(
            t('welcome_back_reorder', custLang, { name, vendorName: vendor.businessName, itemSummary, total }),
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
 * Step 1 of the new two-step language selection flow.
 *
 * Sends a two-button message that asks whether the user wants to continue
 * in English (one tap) or pick from the full alternative-language list.
 * English is asked first because the welcome text is already in English,
 * so most users only need a single tap.
 */
async function showLanguageSelectionScreen(phone: string): Promise<void> {
  await redis.setex(`router:state:${phone}`, ROUTER_STATE_TTL_SECS, 'LANG_INIT');
  await messageQueue.add({
    to: phone,
    message: `👋 Welcome to *Pingmart*!\n\nDo you want to continue in English?`,
    buttons: [
      { id: 'LANG_CONFIRM_EN', title: '✅ Yes, English'   },
      { id: 'LANG_SWITCH',     title: '🌍 Other language' },
    ],
  });
}

/**
 * Step 2 (alternate path): shows the 4-option language list when the user
 * tapped "Other language" in step 1. English is excluded — they just declined it.
 */
async function showAltLanguageList(phone: string): Promise<void> {
  await redis.setex(`router:state:${phone}`, ROUTER_STATE_TTL_SECS, 'LANG_INIT_ALT');
  await messageQueue.add({
    to: phone,
    message: `🌍 Which language do you prefer?`,
    listSections: [
      {
        title: 'Choose your language',
        rows: [
          { id: 'pid', title: '🇳🇬 Pidgin' },
          { id: 'ig',  title: 'Igbo'        },
          { id: 'yo',  title: 'Yorùbá'      },
          { id: 'ha',  title: 'Hausa'       },
        ],
      },
    ],
    listButtonText: 'Choose Language',
  });
}

/**
 * Handles the reply to step 1 of the language selection flow (LANG_INIT state).
 *
 * Accepts:
 *   LANG_CONFIRM_EN — user wants English → proceed directly
 *   LANG_SWITCH     — user wants a different language → show 4-option list
 *   1               — legacy numeric fallback for English
 *   2–5             — legacy numeric fallback for Pidgin/Igbo/Yorùbá/Hausa
 */
async function handleLangInitReply(phone: string, message: string, messageId: string): Promise<void> {
  const upper = message.trim().toUpperCase();

  // ── English confirmation ───────────────────────────────────────────────────
  if (upper === 'LANG_CONFIRM_EN' || upper === 'EN' || upper === '1') {
    await _proceedWithLanguage(phone, 'en', messageId);
    return;
  }

  // ── "Other language" button → show 4-option alt list ─────────────────────
  if (upper === 'LANG_SWITCH') {
    await showAltLanguageList(phone);
    return;
  }

  // ── Legacy direct-language selection (numeric or code) ────────────────────
  const LANG_MAP: Record<string, Language> = {
    'PID': 'pid', 'IG': 'ig', 'YO': 'yo', 'HA': 'ha',
    '2': 'pid',   '3': 'ig',  '4': 'yo',  '5': 'ha',
  };
  const lang = LANG_MAP[upper];
  if (lang) {
    await _proceedWithLanguage(phone, lang, messageId);
    return;
  }

  // Unrecognised reply — show step-1 screen again
  await showLanguageSelectionScreen(phone);
}

/**
 * Handles the reply to step 2 of the language selection flow (LANG_INIT_ALT state).
 *
 * Accepts list row IDs (pid, ig, yo, ha) or legacy numeric fallback (2–5).
 */
async function handleLangAltListReply(phone: string, message: string, messageId: string): Promise<void> {
  const LANG_MAP: Record<string, Language> = {
    'pid': 'pid', 'ig': 'ig', 'yo': 'yo', 'ha': 'ha',
    'PID': 'pid', 'IG': 'ig', 'YO': 'yo', 'HA': 'ha',
    '2': 'pid',   '3': 'ig',  '4': 'yo',  '5': 'ha',
  };
  const lang = LANG_MAP[message.trim()];

  if (!lang) {
    // Unrecognised — show alt list again
    await showAltLanguageList(phone);
    return;
  }

  await _proceedWithLanguage(phone, lang, messageId);
}

/**
 * Shared helper: clears router state, shows the shop/sell screen, and persists
 * the chosen language to the Customer record (async, non-blocking).
 *
 * Performance-critical path — this is the first response after the user engages.
 */
async function _proceedWithLanguage(phone: string, lang: Language, messageId: string): Promise<void> {
  const t0 = Date.now();

  // Typing indicator — immediate, fire-and-forget
  sendTypingIndicator(messageId).catch(() => {});

  // Clear state + send intent screen in parallel — do NOT await DB first
  await Promise.all([
    redis.del(`router:state:${phone}`),
    showShopOrSellScreen(phone, lang),
  ]);

  logger.info('Language selection → intent screen sent', {
    from: maskPhone(phone),
    lang,
    ms: Date.now() - t0,
  });

  // Persist language to Customer record async — never blocks the reply
  Promise.all([
    customerRepository.findOrCreate(phone),
    customerRepository.updateLanguage(phone, lang),
  ]).catch((err) =>
    logger.error('_proceedWithLanguage: language persist failed', { from: maskPhone(phone), err }),
  );
}

// ─── Intent selection translations (3-option screen) ─────────────────────────

const INTENT_STRINGS: Record<Language, {
  question:      string;
  sellLabel:     string;
  sellDesc:      string;
  supportLabel:  string;
  supportDesc:   string;
  shopLabel:     string;
  shopDesc:      string;
  shopRedirect:  string;
}> = {
  en: {
    question:     `What brings you to Pingmart today?`,
    sellLabel:    `🏪 Open a product store`,
    sellDesc:     `Sell physical or digital products on WhatsApp`,
    supportLabel: `🛠️ Set up support channel`,
    supportDesc:  `Manage bookings & enquiries for your service business`,
    shopLabel:    `🛍️ Shop from a store`,
    shopDesc:     `Browse and buy from a vendor's store`,
    shopRedirect:
      `To shop, you need a store link from a vendor.\n\n` +
      `Ask the vendor to share their Pingmart link with you —\n` +
      `it looks like this: *wa.me/234XXXXXXX?text=STORECODE*\n\n` +
      `Once you tap their link, you'll land directly in their store. 🛍️`,
  },
  pid: {
    question:     `Wetin carry you come Pingmart?`,
    sellLabel:    `🏪 I wan open shop`,
    sellDesc:     `Start selling your products for Pingmart`,
    supportLabel: `🛠️ I get service biz`,
    supportDesc:  `Set up bookings and customer support`,
    shopLabel:    `🛍️ I wan buy something`,
    shopDesc:     `Shop from vendor wey dey sell for here`,
    shopRedirect:
      `To shop, you need store link from vendor.\n\n` +
      `Ask the vendor make dem share their Pingmart link with you —\n` +
      `e go look like this: *wa.me/234XXXXXXX?text=STORECODE*\n\n` +
      `Once you tap their link, you go enter their store straight. 🛍️`,
  },
  ig: {
    question:     `Gịnị ka ị chọrọ ime taa?`,
    sellLabel:    `🏪 Imeghe ụlọ ahịa`,
    sellDesc:     `Ree ihe gị na WhatsApp`,
    supportLabel: `🛠️ Iji maka ọrụ m`,
    supportDesc:  `Njikwa ndépụta na ajụjụ ndị ahịa`,
    shopLabel:    `🛍️ Achọrọ m ịzụ ihe`,
    shopDesc:     `Zụta ihe site n'ụlọ ahịa onye na-ere`,
    shopRedirect:
      `Iji zụta ihe, ị chọrọ njikọ ụlọ ahịa sitere n'aka onye na-ere ahịa.\n\n` +
      `Jụọ onye na-ere ahịa ka ha kesaa njikọ Pingmart ha —\n` +
      `ọ dị ka nke a: *wa.me/234XXXXXXX?text=STORECODE*\n\n` +
      `Ozugbo ị pịa njikọ ha, ị ga-abata n'ụlọ ahịa ha ozugbo. 🛍️`,
  },
  yo: {
    question:     `Kini o fẹ ṣe loni?`,
    sellLabel:    `🏪 Mo fẹ ṣeto ile itaja`,
    sellDesc:     `Ta awọn ọja rẹ lori WhatsApp`,
    supportLabel: `🛠️ Mo fẹ lo fun iṣẹ mi`,
    supportDesc:  `Ṣakoso awọn ipinnu lati pade ati ibeere`,
    shopLabel:    `🛍️ Mo fẹ ra nkan`,
    shopDesc:     `Ra nkan lati ile itaja olutaja`,
    shopRedirect:
      `Lati ra nkan, o nilo ọna asopọ itaja lati ọdọ olutaja.\n\n` +
      `Bi olutaja lati pin ọna asopọ Pingmart wọn pẹlu rẹ —\n` +
      `o dabi eyi: *wa.me/234XXXXXXX?text=STORECODE*\n\n` +
      `Ni kete ti o tẹ ọna asopọ wọn, iwọ yoo wọ inu itaja wọn taara. 🛍️`,
  },
  ha: {
    question:     `Menene kake son yi yau?`,
    sellLabel:    `🏪 Ina son buɗe shago`,
    sellDesc:     `Sayar da kayayyaki akan WhatsApp`,
    supportLabel: `🛠️ Don kasuwancina`,
    supportDesc:  `Sarrafa alƙawari da tambayoyin abokan ciniki`,
    shopLabel:    `🛍️ Ina son siya`,
    shopDesc:     `Siya daga kantin mai siyarwa`,
    shopRedirect:
      `Don siya, kuna buƙatar hanyar shiga kantin daga mai siyarwa.\n\n` +
      `Buƙaci mai siyarwa ya raba hanyar Pingmart tare da ku —\n` +
      `yana kama haka: *wa.me/234XXXXXXX?text=STORECODE*\n\n` +
      `Da zarar kun danna hanyarsu, za ku shiga kantin su kai tsaye. 🛍️`,
  },
};

/**
 * Shows the Pingmart intent selection screen (3 options: product store, support
 * channel, shop). Sent as a List Message so labels and descriptions both show.
 * No welcome message — that appeared on the language selection screen.
 */
async function showShopOrSellScreen(phone: string, lang: Language = 'en'): Promise<void> {
  const s = INTENT_STRINGS[lang];
  await redis.setex(`router:state:${phone}`, ROUTER_STATE_TTL_SECS, 'SHOP_OR_SELL');
  await messageQueue.add({
    to: phone,
    message: s.question,
    listSections: [
      {
        title: 'Choose an option',
        rows: [
          { id: 'SELL_ON_PINGMART',      title: s.sellLabel,    description: s.sellDesc    },
          { id: 'SETUP_SUPPORT_CHANNEL', title: s.supportLabel, description: s.supportDesc },
          { id: 'SHOP_FROM_STORE',       title: s.shopLabel,    description: s.shopDesc    },
        ],
      },
    ],
    listButtonText: 'Get started',
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

/**
 * Handles an inbound document message (Excel, CSV, etc.).
 *
 * Vendors in ADDING_PRODUCTS step (sheet mode, or not yet chosen a mode) get
 * their file downloaded and parsed — same preview+confirm flow as Google Sheets.
 * Everyone else receives a standard "can't process files" nudge.
 */
async function routeDocumentMessage(
  phone: string,
  documentMediaId: string,
  fileName: string,
  mimeType: string,
): Promise<void> {
  const vendor = await prisma.vendor.findUnique({ where: { ownerPhone: phone } });
  if (vendor) {
    const setupSession = await prisma.vendorSetupSession.findUnique({
      where: { vendorId: vendor.id },
    });
    if (setupSession && !setupSession.completedAt && setupSession.step === 'ADDING_PRODUCTS') {
      const data = (setupSession.collectedData ?? {}) as Record<string, unknown>;
      // Accept documents in sheet mode, or when no mode has been chosen yet
      if (data.productInputMode === 'sheet' || !data.productInputMode) {
        await handleVendorDocument(phone, documentMediaId, fileName, mimeType, vendor, setupSession);
        return;
      }
    }
  }

  // Default: nudge (document uploads aren't supported for customers or other vendor states)
  await messageQueue.add({
    to: phone,
    message: `Thanks for the file! To order or browse, just type *MENU*. 😊`,
  });
  logger.info('Document routed to fallback nudge', { from: maskPhone(phone) });
}
