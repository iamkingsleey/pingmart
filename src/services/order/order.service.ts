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
import { initializeTransaction } from '../payment/paystack.service';
import {
  msgPhysicalPaymentLink,
  msgDigitalPaymentLink,
  msgPhysicalOrderConfirmedCustomer,
  msgNewPhysicalOrder,
  msgError,
  msgPhysicalWelcome,
  msgDigitalWelcome,
  msgAskQuantity,
} from '../whatsapp/templates';
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
} from '../../types';
import { t, Language, LANGUAGE_CODES } from '../../i18n';
import { calculateCartTotal, formatNaira, formatCartSummary, formatOrderId } from '../../utils/formatters';
import { generatePaystackReference } from '../../utils/crypto';
import { logger, maskPhone, maskReference } from '../../utils/logger';
import { messageQueue } from '../../queues/message.queue';
import { digitalDeliveryQueue } from '../../queues/digitalDelivery.queue';
import { normaliseMessage } from '../nlp-router.service';
import { generateNotFoundResponse } from '../llm.service';
import { getStoreStatus } from '../../utils/working-hours';
import { offHoursContactRepository } from '../../repositories/offHoursContact.repository';
import { sessionTimeoutQueue } from '../../queues/sessionTimeout.queue';
import { SessionTimeoutJobData } from '../../jobs/sessionTimeout.job';
import { redis } from '../../utils/redis';

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

  try {
    const vendor = await vendorRepository.findByWhatsAppNumber(vendorWhatsAppNumber);
    if (!vendor?.isActive) { logger.warn('Message for unknown/inactive vendor', ctx); return; }

    // ── Working hours gate — respond before any other processing ─────────────
    const storeStatus = getStoreStatus(vendor);
    if (!storeStatus.isOpen) {
      await messageQueue.add(
        {
          to: from,
          message:
            `Hi! 👋 We're currently closed.\n\n` +
            `🕐 We open at *${storeStatus.opensAt}* (Lagos time).\n\n` +
            `Your message has been noted — feel free to browse our menu when we open. Type *MENU* anytime. 😊`,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true },
      );
      await offHoursContactRepository.record(from, vendor.id);
      logger.info('Off-hours message received', {
        customer: maskPhone(from),
        vendorId: vendor.id,
        storeStatus: storeStatus.message,
      });
      return;
    }

    const { customer } = await customerRepository.findOrCreate(from);

    // Upsert VendorCustomer junction — creates on first interaction, no-op afterwards
    await prisma.vendorCustomer.upsert({
      where: { vendorId_customerId: { vendorId: vendor.id, customerId: customer.id } },
      create: { vendorId: vendor.id, customerId: customer.id },
      update: {},
    });

    const products = await productRepository.findAvailableByVendor(vendor.id);
    const language = (customer.language as Language) ?? 'en';

    if (!products.length) {
      await enqueue(from, t('no_items_available', language, { vendorName: vendor.businessName }));
      return;
    }

    const session = await sessionRepository.findActive(from, vendor.id);
    const currentState = (session?.state ?? ConversationState.IDLE) as ConversationState;
    let currentData = (session?.sessionData ?? { cart: [] }) as unknown as SessionData;

    // ── Customer hasn't chosen a language yet → show language selection ───
    if (!customer.languageSet && !session) {
      const prompt = t('lang_select_prompt', 'en', { vendorName: vendor.businessName });
      await sessionRepository.upsert(from, vendor.id, ConversationState.LANGUAGE_SELECTION, { cart: [] });
      await enqueue(from, prompt);
      return;
    }

    // ── "LANGUAGE" / "CHANGE LANGUAGE" at any time → re-open language menu ─
    if (isLanguageChangeKeyword(rawMessage)) {
      const prompt = t('lang_select_prompt', 'en', { vendorName: vendor.businessName });
      await sessionRepository.upsert(from, vendor.id, ConversationState.LANGUAGE_SELECTION, { cart: [] });
      await enqueue(from, prompt);
      logger.info('Language change requested', { from: maskPhone(from) });
      return;
    }

    // ── Language selection in progress ────────────────────────────────────
    if (currentState === ConversationState.LANGUAGE_SELECTION) {
      await processLanguageSelection(from, rawMessage, vendor, products);
      return;
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

    // ── NLU normalisation — skip only LANGUAGE_SELECTION, AWAITING_ADDRESS, and AWAITING_ITEM_NOTE ─
    // (free-text states must not be classified — address like "22 Jollof St" could be misclassified)
    const skipNlpStates: ConversationState[] = [
      ConversationState.LANGUAGE_SELECTION,
      ConversationState.AWAITING_ADDRESS,
      ConversationState.AWAITING_ITEM_NOTE,
    ];
    let messageToProcess = rawMessage;
    let nlpIntent: string | null = null;
    let nlpResult: Awaited<ReturnType<typeof normaliseMessage>> | null = null;
    if (!skipNlpStates.includes(currentState)) {
      nlpResult = await normaliseMessage(rawMessage, products, currentState);
      messageToProcess = nlpResult.text;
      nlpIntent = nlpResult.intent.intent;
    }

    // ── Bug 1: PRICE intercept — handle before state machine, works in any state ─
    if (messageToProcess.startsWith('PRICE:')) {
      const productId = messageToProcess.slice(6);
      if (productId === 'NOT_FOUND') {
        // Clear any stale pending product; set flag so an affirmative reply shows the menu
        const notFoundData: SessionData = { ...currentData, nlpPendingProductId: undefined, awaitingMenuConfirmation: true };
        await sessionRepository.upsert(from, vendor.id, currentState, notFoundData);
        const productNames = products.map((p) => p.name);
        const reply = await generateNotFoundResponse(rawMessage, productNames, vendor.businessName);
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
      const reply = await generateNotFoundResponse(rawMessage, productNames, vendor.businessName);
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

    const result = await runStateMachine(messageToProcess, currentState, currentData, vendor, products, language);

    await sessionRepository.upsert(from, vendor.id, result.nextState, result.nextData);

    for (const msg of result.messages) await enqueue(from, msg);
    await scheduleSessionTimeout(from, vendor.id, result.nextState, result.nextData);

    if (result.shouldCreateOrder) {
      await createOrderAndInitiatePayment(customer.id, vendor, result.nextData, from, language);
    }
  } catch (err) {
    logger.error('Error processing message', { ...ctx, error: (err as Error).message });
    await enqueue(from, msgError());
  }
}

// ─── Language Selection Handler ───────────────────────────────────────────────

async function processLanguageSelection(
  from: string,
  message: string,
  vendor: Vendor,
  products: import('@prisma/client').Product[],
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

  // Confirm in their chosen language
  await enqueue(from, t('lang_selected', language));

  // Show the catalog immediately
  const isHybrid = vendor.vendorType === 'HYBRID';
  const allDigital = products.every((p) => p.productType === 'DIGITAL');
  const welcomeMsg = allDigital
    ? msgDigitalWelcome(vendor.businessName, products, language, vendor.description ?? undefined)
    : msgPhysicalWelcome(vendor.businessName, products, isHybrid, language, vendor.description ?? undefined);

  await sessionRepository.upsert(from, vendor.id, ConversationState.BROWSING, { cart: [] });
  await enqueue(from, welcomeMsg);
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

  const order = await orderRepository.create({
    vendorId: vendor.id,
    customerId,
    orderType,
    cart,
    totalAmount,
    deliveryAddress: deliveryAddress ?? undefined,
    paystackReference: reference,
  });

  logger.info('Order created', { orderId: order.id, orderType, reference: maskReference(reference) });

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

  if (order.orderType === 'DIGITAL') {
    await handleDigitalPaymentConfirmed(orderDetail, vendor.whatsappNumber, customerPhone, language);
  } else {
    await handlePhysicalPaymentConfirmed(orderDetail, vendor, customerPhone, language);
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
): Promise<void> {
  const cart = order.orderItems.map((oi) => ({
    productId: oi.productId,
    name: oi.product.name,
    quantity: oi.quantity,
    unitPrice: oi.unitPrice,
    productType: oi.product.productType as ProductType,
  }));

  await enqueue(customerPhone, msgPhysicalOrderConfirmedCustomer(order.id, vendor.businessName, cart, language));
  await enqueue(vendor.whatsappNumber, msgNewPhysicalOrder(order));
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

// ─── Queue Helper ─────────────────────────────────────────────────────────────

async function enqueue(to: string, message: string): Promise<void> {
  await messageQueue.add(
    { to, message },
    { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true },
  );
}
