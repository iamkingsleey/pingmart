/**
 * Order service — the central orchestrator.
 *
 * Processes incoming customer messages through the state machine,
 * creates orders, triggers payments, and routes post-payment fulfillment
 * to the correct delivery path (physical or digital).
 *
 * Language flow:
 *   1. Brand-new customer (isNew=true) → LANGUAGE_SELECTION state
 *   2. Customer replies 1–5 → language saved to DB, catalog shown in chosen language
 *   3. All subsequent messages use customer.language from DB
 */
import { Vendor } from '@prisma/client';
import { prisma } from '../../repositories/prisma';
import { sessionRepository } from '../../repositories/session.repository';
import { orderRepository } from '../../repositories/order.repository';
import { customerRepository } from '../../repositories/customer.repository';
import { productRepository } from '../../repositories/product.repository';
import { vendorRepository } from '../../repositories/vendor.repository';
import { initializeTransaction, createDedicatedVirtualAccount } from '../payment/paystack.service';
import { decryptBankAccount } from '../../utils/crypto';
import { env } from '../../config/env';
import {
  msgPhysicalPaymentLink,
  msgDigitalPaymentLink,
  msgPhysicalOrderConfirmedCustomer,
  msgNewPhysicalOrder,
  msgError,
  msgPhysicalWelcome,
  msgDigitalWelcome,
  msgAskQuantity,
  msgPayWithTransferDetails,
  msgBankTransferInstructions,
  msgVendorBankTransferClaim,
  msgDeliveryOrPickup,
  msgPickupLocationList,
  msgPickupLocationConfirmed,
  msgLanguageSwitchPrompt,
} from '../whatsapp/templates';
import { pickupLocationRepository } from '../../repositories/pickupLocation.repository';
import { paymentTimeoutQueue } from '../../queues/paymentTimeout.queue';
import {
  handleIdle,
  handleBrowsing,
  handlePhysicalOrdering,
  handleDigitalOrdering,
  handleAwaitingItemNote,
  handleAwaitingAddress,
  handleAwaitingPayment,
  handleCompleted,
  TransitionResult,
} from './stateMachine';
import {
  ConversationState,
  SessionData,
  OrderType,
  ProductType,
  CartItem,
  InteractiveButton,
  InteractiveListSection,
} from '../../types';
import { t, Language, LANGUAGE_CODES } from '../../i18n';
import { calculateCartTotal, formatNaira, formatCartSummary, formatOrderId } from '../../utils/formatters';
import { generatePaystackReference } from '../../utils/crypto';
import { logger, maskPhone, maskReference } from '../../utils/logger';
import { messageQueue } from '../../queues/message.queue';
import { digitalDeliveryQueue } from '../../queues/digitalDelivery.queue';
import { normaliseMessage } from '../nlp-router.service';
import { generateNotFoundResponse, generateContextAwareAnswer, detectMessageLanguage } from '../llm.service';
import { detectEscalationTrigger, triggerHumanEscalation } from '../escalation.service';
import { getStoreStatus } from '../../utils/working-hours';
import { offHoursContactRepository } from '../../repositories/offHoursContact.repository';
import { sessionTimeoutQueue } from '../../queues/sessionTimeout.queue';
import { SessionTimeoutJobData } from '../../jobs/sessionTimeout.job';
import { redis } from '../../utils/redis';
import { notifyVendorNumbers } from '../vendor-notify.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** States where inactivity nudge + auto-cancel should fire */
const TIMEOUT_ACTIVE_STATES: ConversationState[] = [
  ConversationState.BROWSING,
  ConversationState.ORDERING,
  ConversationState.AWAITING_ITEM_NOTE,
  ConversationState.AWAITING_ADDRESS,
  ConversationState.AWAITING_PAYMENT,
];

/**
 * Schedules a 10-min nudge job (and later a 5-min cancel job) for the session.
 * Clears any existing jobs first so each message resets the timer.
 * Writes a nonce to the session so stale jobs self-skip when the customer responds.
 */
async function scheduleSessionTimeout(
  from: string,
  vendorId: string,
  state: ConversationState,
  data: SessionData,
): Promise<void> {
  const nudgeJobId = `timeout:nudge:${from}:${vendorId}`;
  const cancelJobId = `timeout:cancel:${from}:${vendorId}`;

  // Cancel any pending timeout jobs so the timer resets from now
  const [existingNudge, existingCancel] = await Promise.all([
    sessionTimeoutQueue.getJob(nudgeJobId),
    sessionTimeoutQueue.getJob(cancelJobId),
  ]);
  await Promise.all([existingNudge?.remove(), existingCancel?.remove()]);

  if (!TIMEOUT_ACTIVE_STATES.includes(state)) return; // no timeout for IDLE / COMPLETED

  const nonce = Math.random().toString(36).slice(2, 10);
  // Persist nonce — the timeout job compares this to detect fresh messages
  await sessionRepository.upsert(from, vendorId, state, { ...data, timeoutNonce: nonce });

  await sessionTimeoutQueue.add(
    { from, vendorId, nonce, type: 'nudge' } satisfies SessionTimeoutJobData,
    { delay: 10 * 60 * 1000, jobId: nudgeJobId, removeOnComplete: true, removeOnFail: true },
  );
}

function isLanguageChangeKeyword(text: string): boolean {
  const n = text.trim().toUpperCase().replace(/\s+/g, ' ');
  return n === 'LANGUAGE' || n === 'CHANGE LANGUAGE';
}

// ─── Incoming Message Processor ───────────────────────────────────────────────

export async function processIncomingMessage(
  from: string,
  rawMessage: string,
  vendorWhatsAppNumber: string,
  messageId?: string,
): Promise<void> {
  const ctx = { from: maskPhone(from), vendor: maskPhone(vendorWhatsAppNumber) };

  // ── Deduplication: prevent the same message from being processed twice ───────
  // Bull marks a job as "stalled" when processIncomingMessage takes >30s (e.g. slow
  // Claude API during generateNotFoundResponse). The retry then runs against a session
  // that was partially updated by the first run, producing a different code path and
  // a second bot reply. SET NX guarantees only one run per Meta message ID wins.
  if (messageId) {
    const claimed = await redis.set(`msg:${messageId}`, '1', 'EX', 3600, 'NX');
    if (!claimed) {
      logger.info('Duplicate message skipped', { msgId: messageId.slice(-8) });
      return;
    }
  }

  // ── Language switch reply — handle before any other processing ────────────
  // These are interactive button payloads from the mid-conversation language prompt.
  const trimmedMsg = rawMessage.trim();
  const switchLangMatch = trimmedMsg.match(/^SWITCH_LANG:(\w+)$/i);
  if (switchLangMatch) {
    const newLang = switchLangMatch[1]!.toLowerCase() as Language;
    await customerRepository.updateLanguage(from, newLang);
    await redis.del(`lang:switch:${from}`);
    logger.info('Customer switched language mid-conversation', { from: maskPhone(from), lang: newLang });
    // Fall through — process normally with updated language
  } else if (trimmedMsg.toUpperCase() === 'KEEP_LANG') {
    await redis.del(`lang:switch:${from}`);
    logger.info('Customer kept current language', { from: maskPhone(from) });
    return;
  }

  try {
    const vendor = await vendorRepository.findByWhatsAppNumber(vendorWhatsAppNumber);
    if (!vendor?.isActive) { logger.warn('Message for unknown/inactive vendor', ctx); return; }

    const { customer } = await customerRepository.findOrCreate(from);

    // ── VendorCustomer junction — always upsert early ────────────────────────
    // Must happen before the language guard so it is recorded on the very first
    // interaction, regardless of whether the customer is selecting a language.
    await prisma.vendorCustomer.upsert({
      where: { vendorId_customerId: { vendorId: vendor.id, customerId: customer.id } },
      create: { vendorId: vendor.id, customerId: customer.id },
      update: {},
    });

    // ── Language selection gate — runs before the hours check ─────────────────
    // Two distinct cases when languageSet is false:
    //
    //   A) No active LANGUAGE_SELECTION session → first touch, show the prompt.
    //   B) Session is already in LANGUAGE_SELECTION → customer is replying with
    //      their choice. Fast-path straight to processLanguageSelection so we
    //      save the language and proceed to the store welcome.  The hours check
    //      is intentionally skipped here — processLanguageSelection handles it
    //      internally AFTER saving the language, ensuring the choice is always
    //      persisted even if the store is currently closed.
    if (!customer.languageSet) {
      const existingSession = await sessionRepository.findActive(from, vendor.id);

      if (existingSession?.state === ConversationState.LANGUAGE_SELECTION) {
        // Case B — process the language reply directly.
        const products = await productRepository.findAvailableByVendor(vendor.id);
        if (!products.length) {
          await enqueue(from, t('no_items_available', 'en', { vendorName: vendor.businessName }));
          return;
        }
        const storeStatusEarly = getStoreStatus(vendor);
        await processLanguageSelection(from, rawMessage, vendor, products, storeStatusEarly);
        return;
      }

      // Case A — no prompt shown yet; set state and show it now.
      await sessionRepository.upsert(from, vendor.id, ConversationState.LANGUAGE_SELECTION, { cart: [] });
      await sendLanguageSelectionList(from, vendor.businessName);
      return;
    }

    // ── Business hours — soft notice only, never blocks ──────────────────────
    // Store hours affect the notice shown to the customer, nothing else.
    // Browsing, ordering, and payment all work regardless of the time.
    const storeStatus = getStoreStatus(vendor);

    const products = await productRepository.findAvailableByVendor(vendor.id);
    const language = (customer.language as Language) ?? 'en';

    if (!products.length) {
      await enqueue(from, t('no_items_available', language, { vendorName: vendor.businessName }));
      return;
    }

    const session = await sessionRepository.findActive(from, vendor.id);
    const currentState = (session?.state ?? ConversationState.IDLE) as ConversationState;
    let currentData = (session?.sessionData ?? { cart: [] }) as unknown as SessionData;

    // ── "LANGUAGE" / "CHANGE LANGUAGE" at any time → re-open language menu ─
    if (isLanguageChangeKeyword(rawMessage)) {
      await sessionRepository.upsert(from, vendor.id, ConversationState.LANGUAGE_SELECTION, { cart: [] });
      await sendLanguageSelectionList(from, vendor.businessName);
      logger.info('Language change requested', { from: maskPhone(from) });
      return;
    }

    // ── Language selection in progress ────────────────────────────────────
    if (currentState === ConversationState.LANGUAGE_SELECTION) {
      await processLanguageSelection(from, rawMessage, vendor, products, storeStatus);
      return;
    }

    // ── Soft closed notice — shown once on first entry, never blocks ─────────
    // If the store is closed and the customer just arrived (IDLE / no session),
    // prepend a soft notice then continue straight into the full shopping flow.
    if (!storeStatus.isOpen && (currentState === ConversationState.IDLE || !session)) {
      await offHoursContactRepository.record(from, vendor.id);
      await enqueue(
        from,
        `🕐 We're currently closed. We open at *${storeStatus.opensAt}* (Lagos time).\n\n` +
        `But feel free to browse and place your order — *${vendor.businessName}* will attend to it as soon as we're back open! 😊`,
      );
      // Mark the session so the off-hours flag is carried through to order confirmation
      const closedData: SessionData = { cart: [], orderedWhileClosed: true, storeOpensAt: storeStatus.opensAt };
      await sessionRepository.upsert(from, vendor.id, ConversationState.BROWSING, closedData);
      currentData = closedData;
    }

    logger.info('Processing message', { ...ctx, state: currentState, lang: language, msgLen: rawMessage.length });

    // ── Reorder reply handler — check before NLU/state machine ───────────────
    const reorderHandled = await handleReorderReply(from, rawMessage, vendor.id, customer.id, products);
    if (reorderHandled) return;

    // ── Returning-customer reorder confirmation (set by router on store-link tap) ──
    // YES → pre-fill cart with last completed order; anything else → clear flag and fall through
    if (currentData.awaitingReorderConfirmation) {
      const upper = rawMessage.trim().toUpperCase();
      if (upper === 'YES') {
        const lastOrder = await orderRepository.findLastCompleted(customer.id, vendor.id);
        if (lastOrder?.orderItems.length) {
          const cart: CartItem[] = [];
          for (const oi of lastOrder.orderItems) {
            const currentProduct = products.find((p) => p.id === oi.productId);
            if (currentProduct) {
              cart.push({
                productId: currentProduct.id,
                name: currentProduct.name,
                quantity: oi.quantity,
                unitPrice: currentProduct.price,
                productType: currentProduct.productType as ProductType,
              });
            }
          }
          if (cart.length) {
            const cartLines = formatCartSummary(cart);
            const total = formatNaira(calculateCartTotal(cart));
            const newData: SessionData = { cart, activeOrderType: OrderType.PHYSICAL };
            await sessionRepository.upsert(from, vendor.id, ConversationState.ORDERING, newData);
            await enqueue(
              from,
              `Perfect! I've loaded your last order: 🛒\n\n${cartLines}\n\nTotal: *${total}*\n\nReply *DONE* to checkout or *CLEAR* to start fresh.`,
            );
            await scheduleSessionTimeout(from, vendor.id, ConversationState.ORDERING, newData);
            return;
          }
        }
        // Last order items no longer available — clear flag, show menu
        currentData = { ...currentData, awaitingReorderConfirmation: undefined };
        await sessionRepository.upsert(from, vendor.id, ConversationState.BROWSING, currentData);
        const menuResult = await runStateMachine('MENU', ConversationState.IDLE, currentData, vendor, products, language);
        await sessionRepository.upsert(from, vendor.id, menuResult.nextState, menuResult.nextData);
        for (const msg of menuResult.messages) await enqueue(from, msg);
        return;
      }
      // Any other reply: clear the flag and continue normal processing
      currentData = { ...currentData, awaitingReorderConfirmation: undefined };
      await sessionRepository.upsert(from, vendor.id, currentState, currentData);
    }

    // ── Delivery / Pickup choice (shown after cart confirmed) ─────────────────
    if (currentData.awaitingDeliveryChoice) {
      const upper = rawMessage.trim().toUpperCase();
      if (upper === 'DELIVERY') {
        const newData: SessionData = { ...currentData, awaitingDeliveryChoice: undefined, deliveryType: 'delivery' };
        await sessionRepository.upsert(from, vendor.id, ConversationState.AWAITING_PAYMENT, newData);
        await createOrderAndInitiatePayment(customer.id, vendor, newData, from, language);
        return;
      }
      if (upper === 'PICKUP') {
        const locations = await pickupLocationRepository.findActiveByVendor(vendor.id);
        if (!locations.length) {
          const newData: SessionData = { ...currentData, awaitingDeliveryChoice: undefined, deliveryType: 'delivery' };
          await sessionRepository.upsert(from, vendor.id, ConversationState.AWAITING_PAYMENT, newData);
          await enqueue(from, `Sorry, no pickup locations are available right now. We'll deliver to you instead! 🚚`);
          await createOrderAndInitiatePayment(customer.id, vendor, newData, from, language);
          return;
        }
        if (locations.length === 1) {
          const loc = locations[0]!;
          const addr = loc.landmark ? `${loc.address} (${loc.landmark})` : loc.address;
          await enqueue(from, msgPickupLocationConfirmed(loc.name, addr, language));
          const newData: SessionData = { ...currentData, awaitingDeliveryChoice: undefined, deliveryType: 'pickup', selectedPickupLocationId: loc.id };
          await sessionRepository.upsert(from, vendor.id, ConversationState.AWAITING_PAYMENT, newData);
          await createOrderAndInitiatePayment(customer.id, vendor, newData, from, language);
          return;
        }
        // Multiple locations — show list
        const { message: listMsg, sections } = msgPickupLocationList(locations);
        await enqueueList(from, listMsg, sections, '📍 Choose Location');
        const newData: SessionData = { ...currentData, awaitingDeliveryChoice: undefined, awaitingPickupChoice: true };
        await sessionRepository.upsert(from, vendor.id, ConversationState.AWAITING_PAYMENT, newData);
        await scheduleSessionTimeout(from, vendor.id, ConversationState.AWAITING_PAYMENT, newData);
        return;
      }
      // Unrecognised reply — re-prompt
      const { message: delivMsg, buttons: delivButtons } = msgDeliveryOrPickup(language);
      await enqueueButtons(from, delivMsg, delivButtons);
      return;
    }

    // ── Pickup location selection ─────────────────────────────────────────────
    if (currentData.awaitingPickupChoice) {
      // Payload is "PICKUP_LOC:<uuid>" from the list message
      const pickupMatch = rawMessage.trim().match(/^PICKUP_LOC:(.+)$/i);
      if (pickupMatch) {
        const locationId = pickupMatch[1]!;
        const loc = await pickupLocationRepository.findById(locationId);
        if (loc && loc.vendorId === vendor.id) {
          const addr = loc.landmark ? `${loc.address} (${loc.landmark})` : loc.address;
          await enqueue(from, msgPickupLocationConfirmed(loc.name, addr, language));
          const newData: SessionData = { ...currentData, awaitingPickupChoice: undefined, deliveryType: 'pickup', selectedPickupLocationId: locationId };
          await sessionRepository.upsert(from, vendor.id, ConversationState.AWAITING_PAYMENT, newData);
          await createOrderAndInitiatePayment(customer.id, vendor, newData, from, language);
          return;
        }
      }
      // Invalid selection — re-prompt
      const locations = await pickupLocationRepository.findActiveByVendor(vendor.id);
      const { message: listMsg, sections } = msgPickupLocationList(locations);
      await enqueueList(from, listMsg, sections, '📍 Choose Location');
      return;
    }

    // ── Customer PAID command — bank transfer claim ────────────────────────────
    if (rawMessage.trim().toUpperCase() === 'PAID' && currentState === ConversationState.AWAITING_PAYMENT) {
      // Find the most recent PAYMENT_PENDING bank-transfer order for this customer/vendor
      const lastOrder = await orderRepository.findLast(customer.id, vendor.id);
      if (lastOrder && lastOrder.status === 'PAYMENT_PENDING' && lastOrder.paymentMethod === 'bank_transfer') {
        const orderDetail = await orderRepository.findByIdWithDetails(lastOrder.id);
        if (orderDetail) {
          const { message: claimMsg, buttons: claimButtons } = msgVendorBankTransferClaim(orderDetail);
          await notifyVendorNumbers(vendor.id, vendor.whatsappNumber, claimMsg, claimButtons);
          await enqueue(from, `✅ Got it! We've notified *${vendor.businessName}* to confirm your payment. We'll update you shortly. 🙏`);
          logger.info('Bank transfer claim sent to vendor', { orderId: lastOrder.id, customer: maskPhone(from) });
          return;
        }
      }
      // No matching order — let the state machine handle it
    }

    // ── Affirmative reply after not-found: "yes" → show menu ─────────────────
    // When the bot asks "would you like to see the menu?" after a not-found reply,
    // any affirmative answer (yes, ok, sure, please…) should show the catalog.
    if (currentData.awaitingMenuConfirmation) {
      const affirmative = /^\s*(yes|yeah|yep|yea|ok|okay|sure|please|alright|go ahead|show me)\b/i.test(rawMessage);
      if (affirmative) {
        const result = await runStateMachine('MENU', ConversationState.IDLE, { ...currentData, awaitingMenuConfirmation: undefined }, vendor, products, language);
        await sessionRepository.upsert(from, vendor.id, result.nextState, result.nextData);
        for (const msg of result.messages) await enqueue(from, msg);
        await scheduleSessionTimeout(from, vendor.id, result.nextState, result.nextData);
        return;
      }
      // Non-affirmative reply — clear the flag and continue normal processing
      await sessionRepository.upsert(from, vendor.id, currentState, { ...currentData, awaitingMenuConfirmation: undefined });
    }

    // ── Bug 3: YES after availability check → add the pending NLU product ─────
    if (rawMessage.trim().toUpperCase() === 'YES' && currentData.nlpPendingProductId) {
      const pendingProduct = products.find((p) => p.id === currentData.nlpPendingProductId);
      if (pendingProduct) {
        const newData: SessionData = {
          ...currentData,
          nlpPendingProductId: undefined,
          pendingProductId: pendingProduct.id,
          pendingProductName: pendingProduct.name,
          pendingProductPrice: pendingProduct.price,
          activeOrderType: OrderType.PHYSICAL,
        };
        await sessionRepository.upsert(from, vendor.id, ConversationState.ORDERING, newData);
        await enqueue(from, msgAskQuantity(pendingProduct.name, pendingProduct.price, language));
        await scheduleSessionTimeout(from, vendor.id, ConversationState.ORDERING, newData);
        return;
      }
    }

    // ── Escalation keyword check — runs before NLU so triggers always win ────
    // Checks the raw message for explicit human-contact phrases ("speak to human",
    // "manager", "complaint", etc.) before any normalisation.
    // Skip free-text states (address, item note) where trigger words could be incidental.
    const freeTextStates = [ConversationState.AWAITING_ADDRESS, ConversationState.AWAITING_ITEM_NOTE];
    if (!freeTextStates.includes(currentState) && detectEscalationTrigger(rawMessage)) {
      const pendingOrder = await orderRepository.findLast(customer.id, vendor.id);
      await triggerHumanEscalation({
        customerPhone: from,
        customerName: customer.name ?? 'Customer',
        lastMessage: rawMessage,
        reason: 'Requested human assistance',
        vendor,
        orderId: pendingOrder?.id,
        orderTotal: pendingOrder?.totalAmount ?? undefined,
      });
      await scheduleSessionTimeout(from, vendor.id, currentState, currentData);
      return;
    }

    // ── NLU normalisation — skip only LANGUAGE_SELECTION, AWAITING_ADDRESS, and AWAITING_ITEM_NOTE ─
    // (free-text states must not be classified — address like "22 Jollof St" could be misclassified)
    const skipNlpStates: ConversationState[] = [
      ConversationState.LANGUAGE_SELECTION,
      ConversationState.AWAITING_ADDRESS,
      ConversationState.AWAITING_ITEM_NOTE,
    ];

    // ── Mid-conversation language detection ───────────────────────────────────
    // Detect if the customer switched to a different language since they picked one.
    // Skip free-text states where trigger words could be incidental (address, item note).
    // Also skip if there's already a pending switch prompt outstanding.
    if (!skipNlpStates.includes(currentState)) {
      const pendingLangSwitch = await redis.get(`lang:switch:${from}`);
      if (!pendingLangSwitch) {
        const detected = await detectMessageLanguage(rawMessage);
        if (detected && detected !== language) {
          await redis.setex(`lang:switch:${from}`, 5 * 60, detected);
          const { message: switchMsg, buttons: switchButtons } = msgLanguageSwitchPrompt(detected, language);
          await enqueueButtons(from, switchMsg, switchButtons);
          logger.info('Language switch prompt sent', { from: maskPhone(from), detected, current: language });
          return;
        }
      }
    }
    let messageToProcess = rawMessage;
    let nlpIntent: string | null = null;
    let nlpResult: Awaited<ReturnType<typeof normaliseMessage>> | null = null;
    if (!skipNlpStates.includes(currentState)) {
      nlpResult = await normaliseMessage(rawMessage, products, currentState);
      messageToProcess = nlpResult.text;
      nlpIntent = nlpResult.intent.intent;
    }

    // ── Confusion loop: track consecutive UNKNOWN intents ─────────────────────
    // Reset on any recognised intent; increment on UNKNOWN.
    // After 3 consecutive UNKNOWNs, escalate to a human before processing further.
    if (nlpIntent !== null) {
      if (nlpIntent === 'UNKNOWN') {
        const count = (currentData.consecutiveUnknownCount ?? 0) + 1;
        currentData = { ...currentData, consecutiveUnknownCount: count };
        if (count >= 3) {
          currentData = { ...currentData, consecutiveUnknownCount: 0 };
          await sessionRepository.upsert(from, vendor.id, currentState, currentData);
          const pendingOrder = await orderRepository.findLast(customer.id, vendor.id);
          await triggerHumanEscalation({
            customerPhone: from,
            customerName: customer.name ?? 'Customer',
            lastMessage: rawMessage,
            reason: 'Confusion loop — bot failed to understand 3 times in a row',
            vendor,
            orderId: pendingOrder?.id,
            orderTotal: pendingOrder?.totalAmount ?? undefined,
          });
          await messageQueue.add({
            to: from,
            message:
              `Hmm, I'm having a bit of trouble understanding — my apologies! 😅\n\n` +
              `Let me get a real person to help you out.\n\n` +
              `Notifying the *${vendor.businessName}* team now...`,
          });
          await scheduleSessionTimeout(from, vendor.id, currentState, currentData);
          return;
        }
        await sessionRepository.upsert(from, vendor.id, currentState, currentData);
      } else {
        // Non-UNKNOWN intent — reset the counter
        if (currentData.consecutiveUnknownCount) {
          currentData = { ...currentData, consecutiveUnknownCount: 0 };
        }
      }
    }

    // ── Bug 1: PRICE intercept — handle before state machine, works in any state ─
    if (messageToProcess.startsWith('PRICE:')) {
      const productId = messageToProcess.slice(6);
      if (productId === 'NOT_FOUND') {
        // Clear any stale pending product; set flag so an affirmative reply shows the menu
        const notFoundData: SessionData = { ...currentData, nlpPendingProductId: undefined, awaitingMenuConfirmation: true };
        await sessionRepository.upsert(from, vendor.id, currentState, notFoundData);
        const productNames = products.map((p) => p.name);
        const reply = await generateNotFoundResponse(rawMessage, productNames, vendor.businessName, vendor);
        await enqueue(from, reply);
        await scheduleSessionTimeout(from, vendor.id, currentState, notFoundData);
      } else {
        const product = products.find((p) => p.id === productId);
        if (product) {
          const newData: SessionData = { ...currentData, nlpPendingProductId: product.id };
          await sessionRepository.upsert(from, vendor.id, currentState, newData);
          await enqueue(
            from,
            `✅ Yes, we have *${product.name}* — ${formatNaira(product.price)}!\n\n` +
            `Would you like to add it to your cart? Reply *YES* to add it or type *MENU* to see everything.`,
          );
          await scheduleSessionTimeout(from, vendor.id, currentState, newData);
        }
      }
      return;
    }

    // ── Bug 2: ORDER:NOT_FOUND — clear stale selections, reply, stop early ───────
    if (messageToProcess === 'ORDER:NOT_FOUND') {
      // Clear all stale product state; set flag so an affirmative reply shows the menu
      const notFoundData: SessionData = {
        ...currentData,
        nlpPendingProductId: undefined,
        pendingProductId: undefined,
        pendingProductName: undefined,
        pendingProductPrice: undefined,
        awaitingMenuConfirmation: true,
      };
      await sessionRepository.upsert(from, vendor.id, currentState, notFoundData);
      const productNames = products.map((p) => p.name);
      const reply = await generateNotFoundResponse(rawMessage, productNames, vendor.businessName, vendor);
      await enqueue(from, reply);
      await scheduleSessionTimeout(from, vendor.id, currentState, notFoundData);
      // Handled by intent router — do not continue to state machine
      return;
    }

    // ── Global intent override: MENU/GREETING/CANCEL escape any stuck state ─────
    // This prevents "Please enter a quantity" when the customer navigates away mid-flow.
    if (nlpIntent === 'MENU' || nlpIntent === 'GREETING') {
      // Run from IDLE so handleIdle shows the full catalog; preserve cart data
      const result = await runStateMachine('MENU', ConversationState.IDLE, currentData, vendor, products, language);
      await sessionRepository.upsert(from, vendor.id, result.nextState, result.nextData);
      for (const msg of result.messages) await enqueue(from, msg);
      await scheduleSessionTimeout(from, vendor.id, result.nextState, result.nextData);
      return;
    }
    if (nlpIntent === 'CANCEL') {
      const result = await runStateMachine('CANCEL', currentState, currentData, vendor, products, language);
      await sessionRepository.upsert(from, vendor.id, result.nextState, result.nextData);
      for (const msg of result.messages) await enqueue(from, msg);
      await scheduleSessionTimeout(from, vendor.id, result.nextState, result.nextData);
      return;
    }

    // ── If ORDER intent has an inline note, inject into session data ──────────
    if (nlpIntent === 'ORDER' && nlpResult) {
      const orderIntent = nlpResult.intent as Extract<typeof nlpResult.intent, { intent: 'ORDER' }>;
      if (orderIntent.note && !currentData.pendingNote) {
        currentData = { ...currentData, pendingNote: orderIntent.note };
      }
    }

    // ── MULTI_SELECT — comma/space-separated product indices ──────────────────
    if (messageToProcess.startsWith('MULTI_SELECT:')) {
      const indices = messageToProcess.slice(13).split(',').map(Number);
      const physicalProducts = products.filter(p => p.productType === 'PHYSICAL');
      const selected = indices
        .map(i => physicalProducts[i - 1])
        .filter((p): p is NonNullable<typeof p> => Boolean(p));

      if (!selected.length) {
        await enqueue(from, t('browsing_invalid', language, { max: String(products.length) }));
        await scheduleSessionTimeout(from, vendor.id, currentState, currentData);
        return;
      }

      const [first, ...rest] = selected;
      const newData: SessionData = {
        ...currentData,
        pendingProductId: first.id,
        pendingProductName: first.name,
        pendingProductPrice: first.price,
        pendingMultiQueue: rest.map(p => ({ productId: p.id, name: p.name, price: p.price })),
        activeOrderType: OrderType.PHYSICAL,
      };

      const queuePreviews = [first, ...rest]
        .map((p, i) => `${i + 1}\uFE0F\u20E3 *${p.name}*`)
        .join('\n');

      await sessionRepository.upsert(from, vendor.id, ConversationState.ORDERING, newData);
      await enqueue(
        from,
        `\uD83D\uDED2 Got it! Let me sort the quantities:\n\n${queuePreviews}\n\n` +
        `Starting with *${first.name}* \u2014 how many? (Reply with a number)`,
      );
      await scheduleSessionTimeout(from, vendor.id, ConversationState.ORDERING, newData);
      return;
    }

    // ── MULTI_ORDER — multiple items with quantities in one message ────────────
    if (messageToProcess === 'MULTI_ORDER' && nlpResult) {
      const multiIntent = nlpResult.intent as Extract<typeof nlpResult.intent, { intent: 'MULTI_ORDER' }>;
      const addedLines: string[] = [];
      const notFoundNames: string[] = [];
      let cart = [...currentData.cart];

      for (const item of multiIntent.items) {
        const match = products.find(
          p =>
            p.name.toLowerCase().includes(item.productHint.toLowerCase()) ||
            item.productHint.toLowerCase().includes(p.name.toLowerCase()),
        );
        if (match) {
          const qty = item.quantity ?? 1;
          const existing = cart.find(c => c.productId === match.id);
          if (existing) {
            cart = cart.map(c => c.productId === match.id ? { ...c, quantity: c.quantity + qty } : c);
          } else {
            cart.push({
              productId: match.id,
              name: match.name,
              quantity: qty,
              unitPrice: match.price,
              productType: match.productType as ProductType,
            });
          }
          addedLines.push(`\u2705 ${qty}x *${match.name}* \u2014 ${formatNaira(qty * match.price)}`);
        } else {
          notFoundNames.push(item.productHint);
        }
      }

      if (!addedLines.length) {
        const productNames = products.map(p => p.name);
        const reply = await generateNotFoundResponse(
          (nlpResult.intent as Extract<typeof nlpResult.intent, { intent: 'MULTI_ORDER' }>).items.map((i) => i.productHint).join(', '),
          productNames,
          vendor.businessName,
          vendor,
        );
        await enqueue(from, reply);
        await scheduleSessionTimeout(from, vendor.id, currentState, currentData);
        return;
      }

      let response = `\uD83D\uDED2 Added to your cart:\n${addedLines.join('\n')}`;
      if (notFoundNames.length) {
        response += `\n\n\u274C Sorry, we don't have: ${notFoundNames.join(', ')}`;
      }
      response += `\n\nReply *DONE* to checkout, keep adding items, or *CART* to review.`;

      const newData: SessionData = { ...currentData, cart, activeOrderType: OrderType.PHYSICAL };
      await sessionRepository.upsert(from, vendor.id, ConversationState.ORDERING, newData);
      await enqueue(from, response);
      await scheduleSessionTimeout(from, vendor.id, ConversationState.ORDERING, newData);
      return;
    }

    // ── MODIFY_CART — remove / update_quantity / increment ────────────────────
    if (messageToProcess === 'MODIFY_CART' && nlpResult) {
      const modIntent = nlpResult.intent as Extract<typeof nlpResult.intent, { intent: 'MODIFY_CART' }>;
      const { action, productHint, quantity = 1 } = modIntent;

      if (!currentData.cart.length) {
        await enqueue(from, `Your cart is empty. Type *MENU* to browse items. \uD83D\uDED2`);
        return;
      }

      const cartMatch = currentData.cart.find(
        item =>
          item.name.toLowerCase().includes(productHint.toLowerCase()) ||
          productHint.toLowerCase().includes(item.name.toLowerCase().split(' ')[0]),
      );

      if (!cartMatch) {
        await enqueue(from, `I couldn't find *${productHint}* in your cart. Type *CART* to see what's in there. \uD83D\uDED2`);
        await scheduleSessionTimeout(from, vendor.id, currentState, currentData);
        return;
      }

      let newCart = [...currentData.cart];
      let responseMsg = '';

      if (action === 'remove') {
        newCart = newCart.filter(i => i.productId !== cartMatch.productId);
        responseMsg = `\u2705 *${cartMatch.name}* removed from your cart.`;
      } else if (action === 'update_quantity') {
        if (quantity <= 0) {
          newCart = newCart.filter(i => i.productId !== cartMatch.productId);
          responseMsg = `\u2705 *${cartMatch.name}* removed from your cart.`;
        } else {
          newCart = newCart.map(i => i.productId === cartMatch.productId ? { ...i, quantity } : i);
          responseMsg = `\u2705 Updated *${cartMatch.name}* to ${quantity}x.`;
        }
      } else if (action === 'increment') {
        newCart = newCart.map(i =>
          i.productId === cartMatch.productId ? { ...i, quantity: i.quantity + quantity } : i,
        );
        responseMsg = `\u2705 Added ${quantity} more *${cartMatch.name}* to your cart.`;
      }

      const cartSummary = newCart.length
        ? `\n\n\uD83D\uDED2 *Your cart:*\n${newCart.map(i => `\u2022 ${i.name} x${i.quantity} \u2014 ${formatNaira(i.unitPrice * i.quantity)}`).join('\n')}\nTotal: *${formatNaira(newCart.reduce((s, i) => s + i.unitPrice * i.quantity, 0))}*`
        : `\n\nYour cart is now empty. Type *MENU* to start adding items.`;

      const newState = newCart.length ? currentState : ConversationState.BROWSING;
      const newData: SessionData = { ...currentData, cart: newCart };
      await sessionRepository.upsert(from, vendor.id, newState, newData);
      await enqueue(from, responseMsg + cartSummary);
      await scheduleSessionTimeout(from, vendor.id, newState, newData);
      return;
    }

    // ── REPEAT_ORDER — reload last completed order into cart ──────────────────
    if (messageToProcess === 'REPEAT_ORDER') {
      const lastOrder = await orderRepository.findLastCompleted(customer.id, vendor.id);
      if (!lastOrder?.orderItems.length) {
        await enqueue(from, `You don't have any previous orders yet! Type *MENU* to see what we have. \uD83D\uDE0A`);
        return;
      }

      const cart: CartItem[] = [];
      for (const oi of lastOrder.orderItems) {
        const currentProduct = products.find(p => p.id === oi.productId);
        if (currentProduct) {
          cart.push({
            productId: currentProduct.id,
            name: currentProduct.name,
            quantity: oi.quantity,
            unitPrice: currentProduct.price,
            productType: currentProduct.productType as ProductType,
          });
        }
      }

      if (!cart.length) {
        await enqueue(from, `Hmm, the items from your last order aren't available anymore. Type *MENU* to see what's on today. \uD83D\uDE0A`);
        return;
      }

      const cartLines = cart.map(i => `\u2022 ${i.name} x${i.quantity} \u2014 ${formatNaira(i.unitPrice * i.quantity)}`).join('\n');
      const total = formatNaira(cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0));
      const newData: SessionData = { cart, activeOrderType: OrderType.PHYSICAL };
      await sessionRepository.upsert(from, vendor.id, ConversationState.ORDERING, newData);
      await enqueue(from, `Perfect! I've loaded your last order: \uD83D\uDED2\n\n${cartLines}\n\nTotal: *${total}*\n\nReply *DONE* to checkout or *CLEAR* to start fresh.`);
      await scheduleSessionTimeout(from, vendor.id, ConversationState.ORDERING, newData);
      return;
    }

    // ── SHOW_CHEAPEST — show the lowest-priced available product ─────────────
    if (messageToProcess === 'SHOW_CHEAPEST') {
      const cheapest = [...products].sort((a, b) => a.price - b.price)[0];
      if (!cheapest) {
        await enqueue(from, `No products available right now. \uD83D\uDE14`);
        return;
      }
      await enqueue(
        from,
        `\uD83D\uDCB0 Our most affordable item is *${cheapest.name}* at *${formatNaira(cheapest.price)}*!\n\n` +
        `To order it, type its number from the menu or type *MENU* to browse everything.`,
      );
      await scheduleSessionTimeout(from, vendor.id, currentState, currentData);
      return;
    }

    // ── SHOW_POPULAR — show the most ordered product ──────────────────────────
    if (messageToProcess === 'SHOW_POPULAR') {
      const popular = await productRepository.findMostPopular(vendor.id);
      if (!popular) {
        await enqueue(
          from,
          `\uD83D\uDD25 Everything is popular here! Type *MENU* to browse and pick your favourite. \uD83D\uDE0A`,
        );
        await scheduleSessionTimeout(from, vendor.id, currentState, currentData);
        return;
      }
      await enqueue(
        from,
        `\uD83D\uDD25 Our most popular item is *${popular.name}* at *${formatNaira(popular.price)}*!\n\n` +
        `To order it, type its number from the menu.`,
      );
      await scheduleSessionTimeout(from, vendor.id, currentState, currentData);
      return;
    }

    // ── ORDER STATUS — show most recent order status ──────────────────────────
    const normMsg = messageToProcess.trim().toUpperCase().replace(/\s+/g, ' ');
    if (normMsg === 'ORDER STATUS' || normMsg === 'STATUS') {
      const lastOrder = await orderRepository.findLast(customer.id, vendor.id);
      if (!lastOrder) {
        await enqueue(from, `You haven't placed any orders with us yet. Type *MENU* to start browsing. 😊`);
        await scheduleSessionTimeout(from, vendor.id, currentState, currentData);
        return;
      }
      const STATUS_EMOJI: Partial<Record<string, string>> = {
        PENDING_PAYMENT: '⏳',
        PAYMENT_CONFIRMED: '💳',
        CONFIRMED: '✅',
        PREPARING: '👨‍🍳',
        READY: '🚀',
        OUT_FOR_DELIVERY: '🚚',
        DELIVERED: '✅',
        DIGITAL_SENT: '📦',
        CANCELLED: '❌',
      };
      const emoji = STATUS_EMOJI[lastOrder.status] ?? '📦';
      const statusLabel = lastOrder.status.replace(/_/g, ' ');
      await enqueue(
        from,
        `${emoji} *Order ${formatOrderId(lastOrder.id)}*\nStatus: *${statusLabel}*\n\nType *MENU* to browse or order again.`,
      );
      await scheduleSessionTimeout(from, vendor.id, currentState, currentData);
      return;
    }

    // ── HELP — list available commands ────────────────────────────────────────
    if (normMsg === 'HELP') {
      await enqueue(
        from,
        `📋 *Available Commands*\n\n` +
        `*MENU* — Browse today's items\n` +
        `*CART* — View your current cart\n` +
        `*CANCEL* — Cancel and start over\n` +
        `*ORDER STATUS* — Check your latest order\n` +
        `*LANGUAGE* — Change your language\n\n` +
        `You can also just type what you want! 😊`,
      );
      await scheduleSessionTimeout(from, vendor.id, currentState, currentData);
      return;
    }

    // ── UNKNOWN intent + vendor context → context-aware answer ────────────────
    // When the LLM couldn't classify the message AND the vendor has provided
    // businessContext, generate a smart answer instead of passing raw text to
    // the state machine (which would just send a generic error).
    if (nlpIntent === 'UNKNOWN' && vendor.businessContext) {
      const productNames = products.map((p) => p.name);
      const reply = await generateContextAwareAnswer(rawMessage, vendor.businessName, productNames, vendor);
      await enqueue(from, reply);
      await scheduleSessionTimeout(from, vendor.id, currentState, currentData);
      return;
    }

    const result = await runStateMachine(messageToProcess, currentState, currentData, vendor, products, language);

    await sessionRepository.upsert(from, vendor.id, result.nextState, result.nextData);

    // Send each message; attach interactive buttons to the LAST message if provided
    for (let i = 0; i < result.messages.length; i++) {
      const isLast = i === result.messages.length - 1;
      if (isLast && result.buttons?.length) {
        await enqueueButtons(from, result.messages[i]!, result.buttons);
      } else {
        await enqueue(from, result.messages[i]!);
      }
    }
    await scheduleSessionTimeout(from, vendor.id, result.nextState, result.nextData);

    if (result.shouldCreateOrder) {
      // For physical orders: if vendor has pickup available, ask customer first
      if (result.nextData.activeOrderType !== OrderType.DIGITAL && !result.nextData.deliveryType) {
        const vendorDeliveryOptions = (vendor as typeof vendor & { deliveryOptions?: string }).deliveryOptions ?? 'delivery';
        if (vendorDeliveryOptions === 'both') {
          const { message: delivMsg, buttons: delivButtons } = msgDeliveryOrPickup(language);
          await enqueueButtons(from, delivMsg, delivButtons);
          await sessionRepository.upsert(from, vendor.id, ConversationState.AWAITING_PAYMENT, {
            ...result.nextData,
            awaitingDeliveryChoice: true,
          });
          await scheduleSessionTimeout(from, vendor.id, ConversationState.AWAITING_PAYMENT, result.nextData);
          return;
        } else if (vendorDeliveryOptions === 'pickup') {
          // Pickup only — show locations directly
          const locations = await pickupLocationRepository.findActiveByVendor(vendor.id);
          if (locations.length === 1) {
            const loc = locations[0]!;
            const addr = loc.landmark ? `${loc.address} (${loc.landmark})` : loc.address;
            await enqueue(from, msgPickupLocationConfirmed(loc.name, addr, language));
            await sessionRepository.upsert(from, vendor.id, ConversationState.AWAITING_PAYMENT, {
              ...result.nextData,
              deliveryType: 'pickup',
              selectedPickupLocationId: loc.id,
            });
            await createOrderAndInitiatePayment(customer.id, vendor, { ...result.nextData, deliveryType: 'pickup', selectedPickupLocationId: loc.id }, from, language);
            return;
          }
          const { message: listMsg, sections } = msgPickupLocationList(locations);
          await enqueueList(from, listMsg, sections, '📍 Choose Location');
          await sessionRepository.upsert(from, vendor.id, ConversationState.AWAITING_PAYMENT, {
            ...result.nextData,
            awaitingPickupChoice: true,
          });
          await scheduleSessionTimeout(from, vendor.id, ConversationState.AWAITING_PAYMENT, result.nextData);
          return;
        }
        // deliveryOptions === 'delivery' — fall through to normal flow
      }
      await createOrderAndInitiatePayment(customer.id, vendor, result.nextData, from, language);
    }
  } catch (err) {
    logger.error('Error processing message', { ...ctx, error: (err as Error).message });
    await enqueue(from, msgError());
  }
}

// ─── Language Selection List ──────────────────────────────────────────────────

async function sendLanguageSelectionList(from: string, vendorName: string): Promise<void> {
  await enqueueList(
    from,
    `👋 Welcome to *${vendorName}*!\n\nPlease choose your preferred language to continue:`,
    [
      {
        title: '🌍 Available Languages',
        rows: [
          { id: 'en',  title: '🇬🇧 English'  },
          { id: 'pid', title: '🇳🇬 Pidgin'   },
          { id: 'ig',  title: 'Igbo'          },
          { id: 'yo',  title: 'Yorùbá'        },
          { id: 'ha',  title: 'Hausa'         },
        ],
      },
    ],
    'Choose Language',
    '🛍️ Language Selection',
  );
}

// ─── Language Selection Handler ───────────────────────────────────────────────

async function processLanguageSelection(
  from: string,
  message: string,
  vendor: Vendor,
  products: import('@prisma/client').Product[],
  storeStatus: import('../../utils/working-hours').StoreStatus,
): Promise<void> {
  const choice = message.trim();
  const language = LANGUAGE_CODES[choice];

  if (!language) {
    // Keep state as LANGUAGE_SELECTION, re-prompt in English
    await enqueue(from, t('invalid_lang_choice', 'en'));
    return;
  }

  // Save the customer's language preference
  await customerRepository.updateLanguage(from, language);
  logger.info('Language selected', { from: maskPhone(from), language });

  // 1. Confirm language choice in their language
  await enqueue(from, t('lang_selected', language));

  // 2. Send store confirmation (name, description, hours, payment)
  const storeConfirmMsg = buildStoreConfirmMessage(vendor);
  await enqueue(from, storeConfirmMsg);

  // 3. If the store is currently closed, show a soft notice then continue.
  //    Never block — the customer should always be able to browse and order.
  let sessionData: SessionData = { cart: [] };
  if (!storeStatus.isOpen) {
    await offHoursContactRepository.record(from, vendor.id);
    await enqueue(
      from,
      `🕐 We're currently closed. We open at *${storeStatus.opensAt}* (Lagos time).\n\n` +
      `But feel free to browse and place your order — *${vendor.businessName}* will attend to it as soon as we're back open! 😊`,
    );
    sessionData = { cart: [], orderedWhileClosed: true, storeOpensAt: storeStatus.opensAt };
  }

  // 4. Show the catalogue and enter BROWSING state
  const isHybrid = vendor.vendorType === 'HYBRID';
  const allDigital = products.every((p) => p.productType === 'DIGITAL');
  const welcomeMsg = allDigital
    ? msgDigitalWelcome(vendor.businessName, products, language, vendor.description ?? undefined)
    : msgPhysicalWelcome(vendor.businessName, products, isHybrid, language, vendor.description ?? undefined);

  await sessionRepository.upsert(from, vendor.id, ConversationState.BROWSING, sessionData);
  await enqueue(from, welcomeMsg);
}

/**
 * Builds the "you're now in [store]" confirmation message shown immediately
 * after a customer selects their language — before the product catalogue.
 * Includes store name, optional description, hours, and payment method.
 */
function buildStoreConfirmMessage(vendor: Vendor): string {
  const paymentLabel: Record<string, string> = {
    paystack: 'Card / Transfer (Paystack)',
    bank:     'Bank Transfer',
    both:     'Card / Transfer (Paystack) or Bank Transfer',
  };
  const payment = paymentLabel[vendor.acceptedPayments ?? 'both'] ?? 'Bank Transfer';

  const days = (vendor.workingDays ?? '1,2,3,4,5,6')
    .split(',')
    .map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Number(d.trim())] ?? d)
    .join(', ');
  const hours = `${vendor.workingHoursStart ?? '08:00'} – ${vendor.workingHoursEnd ?? '21:00'}`;

  const descLine = vendor.description?.trim() ? `\n_${vendor.description.trim()}_\n` : '';

  // Keep the store-confirmed text in English for now — vendor-facing info
  // (hours, payment) is always stored in English. A future task can translate
  // the labels once vendor language preference is tracked in the DB.
  return (
    `🛍️ *Welcome to ${vendor.businessName}!*\n` +
    descLine +
    `\n🕐 *Hours:* ${days}, ${hours}` +
    `\n💳 *Payment:* ${payment}`
  );
}

// ─── State Machine Router ─────────────────────────────────────────────────────

async function runStateMachine(
  message: string,
  state: ConversationState,
  data: SessionData,
  vendor: Vendor,
  products: import('@prisma/client').Product[],
  language: Language,
): Promise<TransitionResult> {
  switch (state) {
    case ConversationState.IDLE:
      return handleIdle(message, vendor, products, data, language);

    case ConversationState.BROWSING:
      return handleBrowsing(message, vendor, products, data, language);

    case ConversationState.ORDERING:
      if (data.activeOrderType === OrderType.DIGITAL || data.selectedProductId) {
        return handleDigitalOrdering(message, vendor, products, data, language);
      }
      return handlePhysicalOrdering(message, vendor, products, data, language);

    case ConversationState.AWAITING_ITEM_NOTE:
      return handleAwaitingItemNote(message, vendor, products, data, language);

    case ConversationState.AWAITING_ADDRESS:
      return handleAwaitingAddress(message, vendor, products, data, language);

    case ConversationState.AWAITING_PAYMENT:
      return handleAwaitingPayment(message, data, language);

    case ConversationState.COMPLETED:
      return handleCompleted(message, vendor, products, data, language);

    default:
      logger.warn('Unknown session state — resetting to IDLE', { state });
      return handleIdle(message, vendor, products, data, language);
  }
}

// ─── Order Creation + Payment ─────────────────────────────────────────────────

async function createOrderAndInitiatePayment(
  customerId: string,
  vendor: Vendor,
  sessionData: SessionData,
  customerPhone: string,
  language: Language,
): Promise<void> {
  const ctx = { customer: maskPhone(customerPhone) };
  const { cart, deliveryAddress, activeOrderType } = sessionData as SessionData & { deliveryAddress?: string };

  if (!cart?.length) { logger.error('shouldCreateOrder=true but cart is empty', ctx); return; }

  const orderType = activeOrderType ?? OrderType.PHYSICAL;
  const totalAmount = calculateCartTotal(cart);
  const reference = generatePaystackReference();

  // ── Determine payment method ───────────────────────────────────────────────
  // Digital orders always go through Paystack link (can't do bank transfer for instant delivery).
  // Physical: prefer paystack_transfer if vendor has a Paystack key; otherwise bank_transfer.
  let paymentMethod = sessionData.chosenPaymentMethod;
  if (!paymentMethod) {
    if (orderType === OrderType.DIGITAL) {
      paymentMethod = 'paystack_link';
    } else if (vendor.paystackSecretKey && vendor.acceptedPayments !== 'bank') {
      paymentMethod = 'paystack_transfer';
    } else if (vendor.bankAccountNumber) {
      paymentMethod = 'bank_transfer';
    } else {
      paymentMethod = 'paystack_link'; // fallback
    }
  }

  // ── Delivery type ──────────────────────────────────────────────────────────
  const deliveryType = sessionData.deliveryType ?? 'delivery';
  const pickupLocationId = sessionData.selectedPickupLocationId ?? undefined;

  const order = await orderRepository.create({
    vendorId: vendor.id,
    customerId,
    orderType,
    cart,
    totalAmount,
    deliveryAddress: deliveryType === 'delivery' ? (deliveryAddress ?? undefined) : undefined,
    paystackReference: reference,
    paymentMethod,
    deliveryType,
    pickupLocationId,
  });

  logger.info('Order created', { orderId: order.id, orderType, paymentMethod, reference: maskReference(reference) });

  // ── Route payment by method ────────────────────────────────────────────────

  if (paymentMethod === 'bank_transfer') {
    await handleBankTransferCheckout(order, vendor, customerPhone, totalAmount, language);
    return;
  }

  if (paymentMethod === 'paystack_transfer' && vendor.paystackSecretKey) {
    await handlePaystackTransferCheckout(order, vendor, customerPhone, totalAmount, language);
    return;
  }

  // Default: Paystack payment link
  const placeholderEmail = `${customerPhone.replace('+', '')}@orb.placeholder.com`;
  const paymentUrl = await initializeTransaction(placeholderEmail, totalAmount, reference, {
    orderId: order.id,
    orderType,
    vendorId: vendor.id,
  });

  if (orderType === OrderType.DIGITAL) {
    const productName = cart[0]?.name ?? 'Product';
    await enqueue(customerPhone, msgDigitalPaymentLink(paymentUrl, productName, totalAmount, order.id, language));
  } else {
    await enqueue(customerPhone, msgPhysicalPaymentLink(paymentUrl, totalAmount, order.id, language));
  }

  logger.info('Payment link sent', { orderId: order.id, reference: maskReference(reference) });
}

// ─── Paystack Pay with Transfer ───────────────────────────────────────────────

async function handlePaystackTransferCheckout(
  order: import('../../repositories/order.repository').Order,
  vendor: Vendor,
  customerPhone: string,
  totalAmount: number,
  language: Language,
): Promise<void> {
  try {
    const decryptedKey = decryptBankAccount(vendor.paystackSecretKey!, env.ENCRYPTION_KEY);
    const { bankName, accountNumber } = await createDedicatedVirtualAccount(decryptedKey, customerPhone, order.id);

    // Persist virtual account details on the order
    const expiry = new Date(Date.now() + 30 * 60 * 1000);
    await prisma.order.update({
      where: { id: order.id },
      data: {
        virtualBankName: bankName,
        virtualAccountNumber: accountNumber,
        virtualAccountExpiry: expiry,
        status: 'PAYMENT_PENDING',
      },
    });

    // Schedule 30-minute expiry job
    await paymentTimeoutQueue.add(
      { orderId: order.id, customerPhone, vendorId: vendor.id, language },
      { delay: 30 * 60 * 1000, jobId: `pay-timeout:${order.id}`, removeOnComplete: true },
    );

    await enqueue(customerPhone, msgPayWithTransferDetails(bankName, accountNumber, totalAmount, order.id, 30, language));
    logger.info('Virtual account issued', { orderId: order.id, customer: maskPhone(customerPhone) });
  } catch (err) {
    // Virtual account creation failed — fall back to Paystack link
    logger.error('Virtual account creation failed — falling back to link', {
      orderId: order.id,
      error: (err as Error).message,
    });
    const placeholderEmail = `${customerPhone.replace('+', '')}@orb.placeholder.com`;
    const paymentUrl = await initializeTransaction(placeholderEmail, totalAmount, order.paystackReference, {
      orderId: order.id,
      vendorId: vendor.id,
    });
    await enqueue(customerPhone, msgPhysicalPaymentLink(paymentUrl, totalAmount, order.id, language));
  }
}

// ─── Manual Bank Transfer Checkout ───────────────────────────────────────────

async function handleBankTransferCheckout(
  order: import('../../repositories/order.repository').Order,
  vendor: Vendor,
  customerPhone: string,
  totalAmount: number,
  language: Language,
): Promise<void> {
  const accountNumber = decryptBankAccount(vendor.bankAccountNumber!, env.ENCRYPTION_KEY);

  // Mark order as PAYMENT_PENDING
  await prisma.order.update({ where: { id: order.id }, data: { status: 'PAYMENT_PENDING' } });

  await enqueue(
    customerPhone,
    msgBankTransferInstructions(
      vendor.bankName ?? 'Our Bank',
      accountNumber,
      vendor.bankAccountName ?? 'Store Account',
      totalAmount,
      order.id,
      language,
    ),
  );

  logger.info('Bank transfer instructions sent', { orderId: order.id, customer: maskPhone(customerPhone) });
}

// ─── Payment Confirmed Handler ────────────────────────────────────────────────

export async function handlePaymentConfirmed(paystackReference: string): Promise<void> {
  const ctx = { reference: maskReference(paystackReference) };

  const order = await orderRepository.findByPaystackReference(paystackReference);
  if (!order) { logger.warn('Payment fulfillment: order not found', ctx); return; }

  logger.info('Payment confirmed — running fulfillment', { orderId: order.id, orderType: order.orderType, ...ctx });

  const orderDetail = await orderRepository.findByIdWithDetails(order.id);
  if (!orderDetail) { logger.error('Could not load order after payment', { orderId: order.id }); return; }

  const vendor = await vendorRepository.findById(order.vendorId);
  if (!vendor) { logger.error('Could not find vendor for order', { orderId: order.id }); return; }

  const customerPhone = orderDetail.customer.whatsappNumber;

  // Retrieve customer's language preference for post-payment messages
  const customerRecord = await customerRepository.findByWhatsAppNumber(customerPhone);
  const language = (customerRecord?.language as Language) ?? 'en';

  // Read off-hours flag from session BEFORE reset — used to tailor confirmation messages
  const activeSession = await sessionRepository.findActive(customerPhone, vendor.id);
  const sessionData = activeSession?.sessionData as unknown as SessionData | undefined;
  const orderedWhileClosed = sessionData?.orderedWhileClosed ?? false;
  const storeOpensAt = sessionData?.storeOpensAt;

  if (order.orderType === 'DIGITAL') {
    await handleDigitalPaymentConfirmed(orderDetail, vendor.whatsappNumber, customerPhone, language);
  } else {
    await handlePhysicalPaymentConfirmed(
      orderDetail, vendor, customerPhone, language,
      order.status === 'PAID', orderedWhileClosed, storeOpensAt,
    );
  }

  // Update VendorCustomer analytics — increment order count and record last order time
  await prisma.vendorCustomer.upsert({
    where: { vendorId_customerId: { vendorId: order.vendorId, customerId: order.customerId } },
    create: { vendorId: order.vendorId, customerId: order.customerId, totalOrders: 1, lastOrderAt: new Date() },
    update: { totalOrders: { increment: 1 }, lastOrderAt: new Date() },
  });

  await sessionRepository.reset(customerPhone, vendor.id);
}

// ─── Physical: Post-Payment ───────────────────────────────────────────────────

async function handlePhysicalPaymentConfirmed(
  order: import('../../repositories/order.repository').OrderWithDetails,
  vendor: Vendor,
  customerPhone: string,
  language: Language,
  isBankTransfer = false,
  orderedWhileClosed = false,
  storeOpensAt?: string,
): Promise<void> {
  const cart = order.orderItems.map((oi) => ({
    productId: oi.productId,
    name: oi.product.name,
    quantity: oi.quantity,
    unitPrice: oi.unitPrice,
    productType: oi.product.productType as ProductType,
  }));

  await enqueue(
    customerPhone,
    msgPhysicalOrderConfirmedCustomer(
      order.id, vendor.businessName, cart, language, orderedWhileClosed, storeOpensAt,
    ),
  );

  // Build vendor notification — include off-hours flag and bank-transfer note if applicable
  const offHoursNote = orderedWhileClosed
    ? `\n\n⏰ *Order placed while store was closed* — please attend to this when you resume.`
    : '';
  const bankNote = isBankTransfer ? `\n\n💳 *Payment method:* Bank transfer (confirmed)` : '';
  const vendorMsg = msgNewPhysicalOrder(order) + offHoursNote + bankNote;

  await notifyVendorNumbers(vendor.id, vendor.whatsappNumber, vendorMsg, [
    { id: `CONFIRM ${formatOrderId(order.id)}`, title: '✅ Confirm' },
    { id: `REJECT ${formatOrderId(order.id)}`,  title: '❌ Reject' },
    { id: `CONTACT ${formatOrderId(order.id)}`, title: '📞 Contact Customer' },
  ]);
}

// ─── Digital: Post-Payment ────────────────────────────────────────────────────

async function handleDigitalPaymentConfirmed(
  order: import('../../repositories/order.repository').OrderWithDetails,
  vendorPhone: string,
  customerPhone: string,
  language: Language,
): Promise<void> {
  const orderItem = order.orderItems[0];
  if (!orderItem) { logger.error('Digital order has no items', { orderId: order.id }); return; }

  const product = await productRepository.findById(orderItem.productId);
  if (!product?.deliveryContent) {
    logger.error('Digital product has no deliveryContent', { productId: orderItem.productId, orderId: order.id });
    await enqueue(customerPhone, msgError());
    return;
  }

  await digitalDeliveryQueue.add(
    {
      orderId: order.id,
      customerPhone,
      vendorPhone,
      vendorId: order.vendorId,
      productName: product.name,
      deliveryContent: product.deliveryContent,
      deliveryMessage: product.deliveryMessage ?? `Here is your ${product.name}. Enjoy!`,
      language,
    },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      priority: 1,
    },
  );

  logger.info('Digital delivery job enqueued', {
    orderId: order.id,
    customer: maskPhone(customerPhone),
    language,
  });
}

// ─── Reorder Reply Handler ────────────────────────────────────────────────────

async function handleReorderReply(
  from: string,
  rawMessage: string,
  vendorId: string,
  customerId: string,
  products: import('@prisma/client').Product[],
): Promise<boolean> {
  const upper = rawMessage.trim().toUpperCase();

  // Opt-out: STOP or OPT OUT
  if (upper === 'STOP' || upper === 'OPT OUT') {
    const nudge = await orderRepository.findRecentReorderNudge(customerId, vendorId);
    if (nudge) {
      await customerRepository.setReorderOptOut(from, true);
      await enqueue(from, "Got it! You won't receive reorder reminders anymore. You can always type *MENU* to order anytime. 👍");
      logger.info('Customer opted out of reorder reminders', { customer: maskPhone(from) });
      return true;
    }
  }

  // NO reply to a reorder nudge
  if (upper === 'NO') {
    const nudge = await orderRepository.findRecentReorderNudge(customerId, vendorId);
    if (nudge) {
      await enqueue(from, `No problem! Type *MENU* anytime you're ready to order. 😊`);
      return true;
    }
  }

  // YES reply to a reorder nudge — pre-fill cart with last order items
  if (upper === 'YES') {
    const nudge = await orderRepository.findRecentReorderNudge(customerId, vendorId);
    if (nudge) {
      // Build cart from last order items — only include still-available products
      const cart: CartItem[] = [];
      for (const oi of nudge.orderItems) {
        const currentProduct = products.find((p) => p.id === oi.productId);
        if (currentProduct) {
          cart.push({
            productId: currentProduct.id,
            name: currentProduct.name,
            quantity: oi.quantity,
            unitPrice: currentProduct.price,
            productType: currentProduct.productType as ProductType,
          });
        }
      }

      if (!cart.length) {
        await enqueue(from, `Sorry, the items from your last order are no longer available. Type *MENU* to see what's on today. 😊`);
        return true;
      }

      const cartLines = formatCartSummary(cart);
      const total = formatNaira(calculateCartTotal(cart));

      const newData: SessionData = { cart, activeOrderType: OrderType.PHYSICAL };
      await sessionRepository.upsert(from, vendorId, ConversationState.ORDERING, newData);
      await enqueue(
        from,
        `Perfect! I've added your last order to your cart. 🛒\n\n${cartLines}\n\nTotal: *${total}*\n\nReply *DONE* to checkout or *CLEAR* to start fresh.`,
      );

      logger.info('Reorder cart pre-filled', { customer: maskPhone(from), items: cart.length });
      return true;
    }
  }

  return false;
}

// ─── Queue Helpers ────────────────────────────────────────────────────────────

const QUEUE_OPTS = { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true } as const;

async function enqueue(to: string, message: string): Promise<void> {
  await messageQueue.add({ to, message }, QUEUE_OPTS);
}

async function enqueueButtons(to: string, message: string, buttons: InteractiveButton[]): Promise<void> {
  await messageQueue.add({ to, message, buttons }, QUEUE_OPTS);
}

async function enqueueList(
  to: string,
  message: string,
  sections: InteractiveListSection[],
  listButtonText: string,
  listHeader?: string,
): Promise<void> {
  await messageQueue.add({ to, message, listSections: sections, listButtonText, listHeader }, QUEUE_OPTS);
}
