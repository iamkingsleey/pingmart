/**
 * WhatsApp message templates for both Physical (Flow A) and Digital (Flow B) vendors.
 *
 * All messages are plain text — no HTML. Designed to feel warm and human,
 * appropriate for the Nigerian informal market.
 * Currency: ₦ (Naira). Never NGN or $.
 */
import { Product } from '@prisma/client';
import { CartItem, OrderStatus, ProductType } from '../../types';
import {
  formatNaira,
  formatCartSummary,
  formatOrderId,
  formatTimestamp,
  productTypeLabel,
} from '../../utils/formatters';
import { groupByCategory } from '../../repositories/product.repository';
import { OrderWithDetails } from '../../repositories/order.repository';

// ─── Shared / General ─────────────────────────────────────────────────────────

export function msgFallback(): string {
  return (
    `Hmm, I didn't quite get that. 😅\n\n` +
    `Type *MENU* to see our catalog and start ordering, or *CANCEL* to start over.\n\n` +
    `Need help? Contact us directly.`
  );
}

export function msgSessionExpired(): string {
  return (
    `Your session expired due to inactivity — no worries! 😊\n\n` +
    `Type *MENU* or send any message to start a fresh order.`
  );
}

export function msgError(): string {
  return `Oops! Something went wrong on our end. 😔 Please try again in a moment.`;
}

export function msgOrderCancelled(orderId: string): string {
  return (
    `❌ Order *${formatOrderId(orderId)}* has been cancelled.\n\n` +
    `If payment was made, a refund will be processed. Contact us if you have questions.`
  );
}

// ─── Flow A: Physical Orders — Customer Messages ──────────────────────────────

/**
 * Welcome message + numbered product list for a physical or hybrid vendor.
 * HYBRID: products are labelled [DIGITAL] / [PHYSICAL] so customers understand.
 */
export function msgPhysicalWelcome(businessName: string, products: Product[], isHybrid = false): string {
  const grouped = groupByCategory(products);
  const lines: string[] = [`Welcome to *${businessName}*! 👋\n`];

  if (isHybrid) {
    lines.push(`We sell both physical items and digital products. All listed below:\n`);
  } else {
    lines.push(`Here's what we have for you today:\n`);
  }

  let index = 1;
  for (const [category, items] of grouped) {
    lines.push(`🏷️ *${category}*`);
    for (const item of items) {
      const typeTag = isHybrid ? ` ${productTypeLabel(item.productType as ProductType)}` : '';
      lines.push(`${index}. ${item.name}${typeTag} — ${formatNaira(item.price)}`);
      if (item.description) lines.push(`   _${item.description}_`);
      index++;
    }
    lines.push('');
  }

  lines.push(`Reply with a *number* to order, or type *0* to see this list again.`);
  lines.push(`Type *CANCEL* to start over.`);

  return lines.join('\n');
}

export function msgAskQuantity(productName: string, unitPrice: number): string {
  return (
    `You selected: *${productName}* — ${formatNaira(unitPrice)}\n\n` +
    `How many would you like? (Reply with a number, e.g. *2*)`
  );
}

export function msgItemAdded(productName: string, quantity: number, cart: CartItem[]): string {
  const preview = cart
    .map((i) => `• ${i.name} x${i.quantity} — ${formatNaira(i.unitPrice * i.quantity)}`)
    .join('\n');
  const total = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

  return (
    `✅ Added *${quantity}x ${productName}* to your cart!\n\n` +
    `*Your cart:*\n${preview}\n\nSubtotal: *${formatNaira(total)}*\n\n` +
    `Reply with another item number to add more.\n` +
    `Type *DONE* to checkout, or *CLEAR* to start your cart over.`
  );
}

export function msgAskDeliveryAddress(cart: CartItem[]): string {
  return (
    `Almost there! 🚀\n\n` +
    `*Your cart:*\n${formatCartSummary(cart)}\n\n` +
    `Now, please send your *delivery address* so we know where to bring your order. 🏠`
  );
}

export function msgConfirmAddress(address: string, cart: CartItem[]): string {
  return (
    `📍 *Delivery address:* ${address}\n\n` +
    `${formatCartSummary(cart)}\n\n` +
    `Is everything correct? Reply *YES* to proceed to payment, or *NO* to change your address.`
  );
}

export function msgPhysicalPaymentLink(paymentUrl: string, total: number, orderId: string): string {
  return (
    `💳 *Time to pay!*\n\n` +
    `Order: *${formatOrderId(orderId)}*\n` +
    `Amount: *${formatNaira(total)}*\n\n` +
    `👉 Complete your payment here:\n${paymentUrl}\n\n` +
    `Your order will be confirmed as soon as we receive your payment. ⏰\n` +
    `This link expires in 30 minutes.`
  );
}

export function msgPhysicalOrderConfirmedCustomer(orderId: string, businessName: string, cart: CartItem[]): string {
  return (
    `🎉 *Payment received! Your order is confirmed.*\n\n` +
    `Order ID: *${formatOrderId(orderId)}*\n` +
    `From: ${businessName}\n\n` +
    `*What you ordered:*\n${formatCartSummary(cart)}\n\n` +
    `We'll keep you updated as your order progresses. Thank you! 🙏`
  );
}

// ─── Flow A: Physical Orders — Status Updates ─────────────────────────────────

const PHYSICAL_STATUS_MESSAGES: Partial<Record<OrderStatus, (id: string) => string>> = {
  [OrderStatus.CONFIRMED]: (id) =>
    `✅ Your order *${formatOrderId(id)}* has been confirmed by the vendor!\n\nWe're getting it ready for you.`,
  [OrderStatus.PREPARING]: (id) =>
    `👨‍🍳 Your order *${formatOrderId(id)}* is now being prepared.\n\nWon't be long! 😊`,
  [OrderStatus.READY]: (id) =>
    `🚀 Your order *${formatOrderId(id)}* is ready and on its way!\n\nPlease be available to receive it.`,
  [OrderStatus.DELIVERED]: (id) =>
    `✅ Your order *${formatOrderId(id)}* has been delivered!\n\nWe hope you enjoy it. Thank you for choosing us! 🙏\n\nFeel free to order again anytime.`,
  [OrderStatus.CANCELLED]: (id) =>
    `❌ Your order *${formatOrderId(id)}* has been cancelled.\n\nIf you paid, a refund will be processed shortly.`,
};

export function msgPhysicalStatusUpdate(orderId: string, status: OrderStatus): string {
  const fn = PHYSICAL_STATUS_MESSAGES[status];
  return fn ? fn(orderId) : `Your order ${formatOrderId(orderId)} status: ${status}`;
}

// ─── Flow A: Physical Orders — Vendor Messages ────────────────────────────────

export function msgNewPhysicalOrder(order: OrderWithDetails): string {
  const itemLines = order.orderItems
    .map((oi) => `• ${oi.product.name} x${oi.quantity} — ${formatNaira(oi.unitPrice * oi.quantity)}`)
    .join('\n');

  const customerName = order.customer.name ?? 'Unknown customer';
  const maskedPhone = order.customer.whatsappNumber.replace(/(\+\d{3})\d+(\d{4})/, '$1***$2');

  return (
    `🔔 *NEW ORDER!*\n\n` +
    `Order ID: *${formatOrderId(order.id)}*\n` +
    `Time: ${formatTimestamp(order.createdAt)}\n\n` +
    `*Customer:* ${customerName} (${maskedPhone})\n\n` +
    `*Items:*\n${itemLines}\n\n` +
    `*Total: ${formatNaira(order.totalAmount)}*\n\n` +
    `📍 *Delivery address:* [see dashboard — address not logged]\n\n` +
    `Reply *CONFIRM ${formatOrderId(order.id)}* to accept, or *CANCEL ${formatOrderId(order.id)}* to cancel.`
  );
}

// Note: We intentionally DO NOT include the delivery address in the WhatsApp
// notification to the vendor — it's visible in the dashboard. This prevents
// sensitive address data from appearing in WhatsApp chat logs.

// ─── Flow B: Digital Orders — Customer Messages ───────────────────────────────

export function msgDigitalWelcome(businessName: string, products: Product[]): string {
  const lines: string[] = [
    `Welcome to *${businessName}*! 📚\n`,
    `Here's what we offer:\n`,
  ];

  let index = 1;
  for (const product of products) {
    lines.push(`${index}. *${product.name}* — ${formatNaira(product.price)}`);
    if (product.description) lines.push(`   _${product.description}_`);
    index++;
  }

  lines.push(`\nReply with a *number* to learn more or purchase.`);
  lines.push(`Type *CANCEL* to exit.`);

  return lines.join('\n');
}

export function msgDigitalProductDetail(product: Product): string {
  return (
    `📌 *${product.name}*\n\n` +
    `${product.description ?? 'No description provided.'}\n\n` +
    `💰 Price: *${formatNaira(product.price)}*\n\n` +
    `Reply *BUY* to purchase, or *MENU* to go back to the catalog.`
  );
}

export function msgDigitalPaymentLink(paymentUrl: string, productName: string, price: number, orderId: string): string {
  return (
    `💳 *Complete your purchase*\n\n` +
    `Product: *${productName}*\n` +
    `Order: *${formatOrderId(orderId)}*\n` +
    `Amount: *${formatNaira(price)}*\n\n` +
    `👉 Pay here:\n${paymentUrl}\n\n` +
    `You'll receive *instant access* as soon as your payment is confirmed. 🎉`
  );
}

/**
 * Instant delivery message sent to customer after Paystack payment is confirmed.
 * This is the most important message in the digital flow.
 */
export function msgDigitalDelivery(
  productName: string,
  deliveryContent: string,
  customMessage: string,
  orderId: string,
): string {
  return (
    `🎉 *Payment confirmed! Here's your purchase.*\n\n` +
    `*${productName}*\n` +
    `Order: *${formatOrderId(orderId)}*\n\n` +
    `${customMessage}\n\n` +
    `🔗 *Access link:*\n${deliveryContent}\n\n` +
    `Questions? Reply to this message and we'll be happy to help! 🙏`
  );
}

/**
 * Fallback message if automatic digital delivery fails after all retries.
 * Vendor is also notified separately.
 */
export function msgDigitalDeliveryFailed(orderId: string): string {
  return (
    `We've confirmed your payment for order *${formatOrderId(orderId)}*, ` +
    `but we ran into a technical issue sending your product automatically.\n\n` +
    `Our team has been alerted and will send your product to you manually within a few minutes.\n\n` +
    `We're very sorry for the inconvenience! 🙏`
  );
}

/** Vendor notification for a digital sale (no action required) */
export function msgNewDigitalSale(order: OrderWithDetails): string {
  const productName = order.orderItems[0]?.product.name ?? 'Unknown product';
  const customerName = order.customer.name ?? 'A customer';
  const maskedPhone = order.customer.whatsappNumber.replace(/(\+\d{3})\d+(\d{4})/, '$1***$2');

  return (
    `💰 *New digital sale!*\n\n` +
    `Order ID: *${formatOrderId(order.id)}*\n` +
    `Product: *${productName}*\n` +
    `Customer: ${customerName} (${maskedPhone})\n` +
    `Amount: *${formatNaira(order.totalAmount)}*\n` +
    `Time: ${formatTimestamp(order.createdAt)}\n\n` +
    `✅ Product has been delivered automatically. No action needed.`
  );
}

/** Alert to vendor when digital delivery fails after all retries */
export function msgDigitalDeliveryFailedVendorAlert(order: OrderWithDetails): string {
  const productName = order.orderItems[0]?.product.name ?? 'Unknown product';
  const maskedPhone = order.customer.whatsappNumber.replace(/(\+\d{3})\d+(\d{4})/, '$1***$2');

  return (
    `⚠️ *DELIVERY FAILURE — Action Required!*\n\n` +
    `Order ID: *${formatOrderId(order.id)}*\n` +
    `Product: *${productName}*\n` +
    `Customer: ${maskedPhone}\n\n` +
    `Automatic delivery failed after multiple attempts.\n` +
    `Please send the product to the customer manually as soon as possible.\n\n` +
    `Payment has been confirmed. 💰`
  );
}
