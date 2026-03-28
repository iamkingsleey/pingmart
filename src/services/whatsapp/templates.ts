/**
 * WhatsApp message templates for both Physical (Flow A) and Digital (Flow B) vendors.
 *
 * Every customer-facing function accepts an optional `lang` parameter.
 * Vendor-facing messages (order alerts, delivery failures) stay in English
 * because vendors do not yet have a language preference.
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
import { t, Language } from '../../i18n';

// ─── Shared / General ─────────────────────────────────────────────────────────

export function msgFallback(lang: Language = 'en'): string {
  return t('fallback', lang);
}

export function msgSessionExpired(lang: Language = 'en'): string {
  return t('session_expired', lang);
}

export function msgError(): string {
  // Error messages stay in English — they fire in catch blocks where language
  // may not be available yet.
  return "Oops! Something went wrong on our end. 😔 Please try again in a moment.";
}

export function msgOrderCancelled(orderId: string): string {
  return (
    `❌ Order *${formatOrderId(orderId)}* has been cancelled.\n\n` +
    `If payment was made, a refund will be processed. Contact us if you have questions.`
  );
}

// ─── Flow A: Physical Orders — Customer Messages ──────────────────────────────

export function msgPhysicalWelcome(
  businessName: string,
  products: Product[],
  isHybrid = false,
  lang: Language = 'en',
): string {
  const grouped = groupByCategory(products);
  const lines: string[] = [t('welcome_header', lang, { vendorName: businessName }), ''];

  lines.push(
    isHybrid
      ? t('welcome_hybrid_subtitle', lang)
      : t('welcome_subtitle', lang),
    '',
  );

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

  lines.push(t('welcome_footer', lang));
  return lines.join('\n');
}

export function msgAskQuantity(
  productName: string,
  unitPrice: number,
  lang: Language = 'en',
): string {
  return t('ask_quantity', lang, { name: productName, price: formatNaira(unitPrice) });
}

export function msgItemAdded(
  productName: string,
  quantity: number,
  cart: CartItem[],
  lang: Language = 'en',
): string {
  const cartLines = cart
    .map((i) => `• ${i.name} x${i.quantity} — ${formatNaira(i.unitPrice * i.quantity)}`)
    .join('\n');
  const subtotal = formatNaira(cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0));

  return t('item_added', lang, {
    qty: String(quantity),
    name: productName,
    cartLines,
    subtotal,
  });
}

export function msgAskDeliveryAddress(cart: CartItem[], lang: Language = 'en'): string {
  return t('ask_address', lang, { cartSummary: formatCartSummary(cart) });
}

export function msgConfirmAddress(
  address: string,
  cart: CartItem[],
  lang: Language = 'en',
): string {
  return t('confirm_address', lang, {
    address,
    cartSummary: formatCartSummary(cart),
  });
}

export function msgPhysicalPaymentLink(
  paymentUrl: string,
  total: number,
  orderId: string,
  lang: Language = 'en',
): string {
  return t('physical_payment_link', lang, {
    orderId: formatOrderId(orderId),
    amount: formatNaira(total),
    paymentUrl,
  });
}

export function msgPhysicalOrderConfirmedCustomer(
  orderId: string,
  businessName: string,
  cart: CartItem[],
  lang: Language = 'en',
): string {
  return t('order_confirmed_customer', lang, {
    orderId: formatOrderId(orderId),
    vendorName: businessName,
    cartSummary: formatCartSummary(cart),
  });
}

// ─── Flow A: Physical Orders — Status Updates ─────────────────────────────────
// Status updates are sent by the vendor dashboard — kept in English for now.

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

export function msgDigitalWelcome(
  businessName: string,
  products: Product[],
  lang: Language = 'en',
): string {
  const lines: string[] = [
    t('digital_welcome_header', lang, { vendorName: businessName }),
    '',
    t('digital_welcome_subtitle', lang),
    '',
  ];

  let index = 1;
  for (const product of products) {
    lines.push(`${index}. *${product.name}* — ${formatNaira(product.price)}`);
    if (product.description) lines.push(`   _${product.description}_`);
    index++;
  }

  lines.push('', t('digital_welcome_footer', lang));
  return lines.join('\n');
}

export function msgDigitalProductDetail(
  product: Product,
  lang: Language = 'en',
): string {
  return t('digital_product_detail', lang, {
    name: product.name,
    description: product.description ?? 'No description provided.',
    price: formatNaira(product.price),
  });
}

export function msgDigitalPaymentLink(
  paymentUrl: string,
  productName: string,
  price: number,
  orderId: string,
  lang: Language = 'en',
): string {
  return t('digital_payment_link', lang, {
    productName,
    orderId: formatOrderId(orderId),
    amount: formatNaira(price),
    paymentUrl,
  });
}

/**
 * Instant delivery message sent to customer after Paystack payment is confirmed.
 */
export function msgDigitalDelivery(
  productName: string,
  deliveryContent: string,
  customMessage: string,
  orderId: string,
  lang: Language = 'en',
): string {
  return t('digital_delivery', lang, {
    productName,
    orderId: formatOrderId(orderId),
    deliveryMessage: customMessage,
    deliveryContent,
  });
}

/**
 * Fallback message if automatic digital delivery fails after all retries.
 */
export function msgDigitalDeliveryFailed(orderId: string, lang: Language = 'en'): string {
  return t('digital_delivery_failed', lang, { orderId: formatOrderId(orderId) });
}

/** Vendor notification for a digital sale (no action required) — English only */
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

/** Alert to vendor when digital delivery fails after all retries — English only */
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
