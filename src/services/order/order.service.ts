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
import { calculateCartTotal, formatNaira, formatCartSummary } from '../../utils/formatters';
import { generatePaystackReference } from '../../utils/crypto';
import { logger, maskPhone, maskReference } from '../../utils/logger';
import { messageQueue } from '../../queues/message.queue';
import { digitalDeliveryQueue } from '../../queues/digitalDelivery.queue';
import { normaliseMessage } from '../nlp-router.service';
import { generateNotFoundResponse } from '../llm.service';
import { getStoreStatus } from '../../utils/working-hours';
import { offHoursContactRepository } from '../../repositories/offHoursContact.repository';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isLanguageChangeKeyword(text: string): boolean {
  const n = text.trim().toUpperCase().replace(/\s+/g, ' ');
  return n === 'LANGUAGE' || n === 'CHANGE LANGUAGE';
}

// ─── Incoming Message Processor ───────────────────────────────────────────────

export async function processIncomingMessage(
  from: string,
  rawMessage: string,
  vendorWhatsAppNumber: string,
): Promise<void> {
  const ctx = { from: maskPhone(from), vendor: maskPhone(vendorWhatsAppNumber) };

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
    const products = await productRepository.findAvailableByVendor(vendor.id);
    const language = (customer.language as Language) ?? 'en';

    if (!products.length) {
      await enqueue(from, t('no_items_available', language, { vendorName: vendor.businessName }));
      return;
    }

    const session = await sessionRepository.findActive(from, vendor.id);
    const currentState = (session?.state ?? ConversationState.IDLE) as ConversationState;
    const currentData = (session?.sessionData ?? { cart: [] }) as unknown as SessionData;

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
        return;
      }
    }

    // ── NLU normalisation — skip only LANGUAGE_SELECTION and AWAITING_ADDRESS ─
    // (AWAITING_ADDRESS is free text; address like "22 Jollof St" could be misclassified)
    const skipNlpStates: ConversationState[] = [
      ConversationState.LANGUAGE_SELECTION,
      ConversationState.AWAITING_ADDRESS,
    ];
    const { text: messageToProcess } = skipNlpStates.includes(currentState)
      ? { text: rawMessage }
      : await normaliseMessage(rawMessage, products, currentState);

    // ── Bug 1: PRICE intercept — handle before state machine, works in any state ─
    if (messageToProcess.startsWith('PRICE:')) {
      const productId = messageToProcess.slice(6);
      if (productId === 'NOT_FOUND') {
        const productNames = products.map((p) => p.name);
        const reply = await generateNotFoundResponse(rawMessage, productNames, vendor.businessName);
        await enqueue(from, reply);
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
        }
      }
      return;
    }

    const result = await runStateMachine(messageToProcess, currentState, currentData, vendor, products, language);

    await sessionRepository.upsert(from, vendor.id, result.nextState, result.nextData);

    for (const msg of result.messages) await enqueue(from, msg);

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
    ? msgDigitalWelcome(vendor.businessName, products, language)
    : msgPhysicalWelcome(vendor.businessName, products, isHybrid, language);

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
