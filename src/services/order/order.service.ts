/**
 * Order service — the central orchestrator.
 *
 * Processes incoming customer messages through the state machine,
 * creates orders, triggers payments, and routes post-payment fulfillment
 * to the correct delivery path (physical or digital).
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
} from '../../types';
import { calculateCartTotal } from '../../utils/formatters';
import { generatePaystackReference } from '../../utils/crypto';
import { logger, maskPhone, maskReference } from '../../utils/logger';
import { messageQueue } from '../../queues/message.queue';
import { digitalDeliveryQueue } from '../../queues/digitalDelivery.queue';

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

    const customer = await customerRepository.findOrCreate(from);
    const products = await productRepository.findAvailableByVendor(vendor.id);

    if (!products.length) {
      await enqueue(from, `Sorry, ${vendor.businessName} has no items available right now. Please check back later.`);
      return;
    }

    const session = await sessionRepository.findActive(from, vendor.id);
    const currentState = (session?.state ?? ConversationState.IDLE) as ConversationState;
    const currentData = (session?.sessionData ?? { cart: [] }) as unknown as SessionData;

    logger.info('Processing message', { ...ctx, state: currentState, msgLen: rawMessage.length });

    const result = await runStateMachine(rawMessage, currentState, currentData, vendor, products);

    await sessionRepository.upsert(from, vendor.id, result.nextState, result.nextData);

    for (const msg of result.messages) await enqueue(from, msg);

    if (result.shouldCreateOrder) {
      await createOrderAndInitiatePayment(customer.id, vendor, result.nextData, from);
    }
  } catch (err) {
    logger.error('Error processing message', { ...ctx, error: (err as Error).message });
    await enqueue(from, msgError());
  }
}

// ─── State Machine Router ─────────────────────────────────────────────────────

async function runStateMachine(
  message: string,
  state: ConversationState,
  data: SessionData,
  vendor: Vendor,
  products: import('@prisma/client').Product[],
): Promise<TransitionResult> {
  switch (state) {
    case ConversationState.IDLE:
      return handleIdle(message, vendor, products, data);

    case ConversationState.BROWSING:
      return handleBrowsing(message, vendor, products, data);

    case ConversationState.ORDERING:
      // Route to the correct flow based on what's in the session
      if (data.activeOrderType === OrderType.DIGITAL || data.selectedProductId) {
        return handleDigitalOrdering(message, vendor, products, data);
      }
      return handlePhysicalOrdering(message, vendor, products, data);

    case ConversationState.AWAITING_ADDRESS:
      return handleAwaitingAddress(message, vendor, products, data);

    case ConversationState.AWAITING_PAYMENT:
      return handleAwaitingPayment(message, data);

    case ConversationState.COMPLETED:
      return handleCompleted(message, vendor, products, data);

    default:
      logger.warn('Unknown session state — resetting to IDLE', { state });
      return handleIdle(message, vendor, products, data);
  }
}

// ─── Order Creation + Payment ─────────────────────────────────────────────────

async function createOrderAndInitiatePayment(
  customerId: string,
  vendor: Vendor,
  sessionData: SessionData,
  customerPhone: string,
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

  // Generate Paystack payment link
  const placeholderEmail = `${customerPhone.replace('+', '')}@orb.placeholder.com`;
  const paymentUrl = await initializeTransaction(placeholderEmail, totalAmount, reference, {
    orderId: order.id,
    orderType,
    vendorId: vendor.id,
  });

  // Send the appropriate payment message based on order type
  if (orderType === OrderType.DIGITAL) {
    const productName = cart[0]?.name ?? 'Product';
    await enqueue(customerPhone, msgDigitalPaymentLink(paymentUrl, productName, totalAmount, order.id));
  } else {
    await enqueue(customerPhone, msgPhysicalPaymentLink(paymentUrl, totalAmount, order.id));
  }

  logger.info('Payment link sent', { orderId: order.id, reference: maskReference(reference) });
}

// ─── Payment Confirmed Handler ────────────────────────────────────────────────

/**
 * Called by the payment queue worker after the webhook handler has already:
 *  1. Verified the Paystack signature
 *  2. Found the order in the database
 *  3. Atomically flipped paymentProcessed false→true (idempotency guard)
 *
 * This function performs the fulfillment — it does NOT re-check idempotency
 * because the webhook handler already did that before enqueueing the job.
 */
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

  if (order.orderType === 'DIGITAL') {
    await handleDigitalPaymentConfirmed(orderDetail, vendor.whatsappNumber, customerPhone);
  } else {
    await handlePhysicalPaymentConfirmed(orderDetail, vendor, customerPhone);
  }

  // Reset customer session
  await sessionRepository.reset(customerPhone, vendor.id);
}

// ─── Physical: Post-Payment ───────────────────────────────────────────────────

async function handlePhysicalPaymentConfirmed(
  order: import('../../repositories/order.repository').OrderWithDetails,
  vendor: Vendor,
  customerPhone: string,
): Promise<void> {
  const cart = order.orderItems.map((oi) => ({
    productId: oi.productId,
    name: oi.product.name,
    quantity: oi.quantity,
    unitPrice: oi.unitPrice,
    productType: oi.product.productType as ProductType,
  }));

  // Confirm to customer
  await enqueue(customerPhone, msgPhysicalOrderConfirmedCustomer(order.id, vendor.businessName, cart));

  // Alert vendor with full order details
  await enqueue(vendor.whatsappNumber, msgNewPhysicalOrder(order));
}

// ─── Digital: Post-Payment ────────────────────────────────────────────────────

async function handleDigitalPaymentConfirmed(
  order: import('../../repositories/order.repository').OrderWithDetails,
  vendorPhone: string,
  customerPhone: string,
): Promise<void> {
  const orderItem = order.orderItems[0];
  if (!orderItem) { logger.error('Digital order has no items', { orderId: order.id }); return; }

  const product = await productRepository.findById(orderItem.productId);
  if (!product?.deliveryContent) {
    logger.error('Digital product has no deliveryContent', { productId: orderItem.productId, orderId: order.id });
    await enqueue(customerPhone, msgError());
    return;
  }

  // Enqueue in the high-priority digital delivery queue
  // The worker handles retries and failure alerting
  await digitalDeliveryQueue.add(
    {
      orderId: order.id,
      customerPhone,
      vendorPhone,
      productName: product.name,
      deliveryContent: product.deliveryContent,
      deliveryMessage: product.deliveryMessage ?? `Here is your ${product.name}. Enjoy!`,
    },
    {
      attempts: 5, // More retries for digital — customer paid and is waiting
      backoff: { type: 'exponential', delay: 1000 },
      priority: 1, // Highest priority in the queue
    },
  );

  logger.info('Digital delivery job enqueued', {
    orderId: order.id,
    customer: maskPhone(customerPhone),
  });
}

// ─── Queue Helper ─────────────────────────────────────────────────────────────

async function enqueue(to: string, message: string): Promise<void> {
  await messageQueue.add({ to, message }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true });
}
