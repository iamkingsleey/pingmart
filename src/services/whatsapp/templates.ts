/**
 * WhatsApp message templates for both Physical (Flow A) and Digital (Flow B) vendors.
 *
 * Every customer-facing function accepts an optional `lang` parameter.
 * Vendor-facing messages (order alerts, delivery failures) stay in English
 * because vendors do not yet have a language preference.
 */
import { Product } from '@prisma/client';
import { CartItem, OrderStatus, ProductType, InteractiveButton, InteractiveListSection } from '../../types';
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
  description?: string,
): string {
  const grouped = groupByCategory(products);
  const lines: string[] = [t('welcome_header', lang, { vendorName: businessName }), ''];

  if (description) {
    lines.push(description, '');
  }

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
    .map((oi) => {
      const note = (oi as any).notes;
      const notePart = note ? ` _(${note})_` : '';
      return `• ${oi.product.name} x${oi.quantity} — ${formatNaira(oi.unitPrice * oi.quantity)}${notePart}`;
    })
    .join('\n');

  const customerName = order.customer.name ?? 'Unknown customer';
  const maskedPhone = order.customer.whatsappNumber.replace(/(\+\d{3})\d+(\d{4})/, '$1***$2');
  const generalNote = order.notes ? `\n\n📝 *Note:* ${order.notes}` : '';

  return (
    `🔔 *NEW ORDER!*\n\n` +
    `Order ID: *${formatOrderId(order.id)}*\n` +
    `Time: ${formatTimestamp(order.createdAt)}\n\n` +
    `*Customer:* ${customerName} (${maskedPhone})\n\n` +
    `*Items:*\n${itemLines}${generalNote}\n\n` +
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
  description?: string,
): string {
  const lines: string[] = [t('digital_welcome_header', lang, { vendorName: businessName }), ''];

  if (description) {
    lines.push(description, '');
  }

  lines.push(t('digital_welcome_subtitle', lang), '');

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

// ─── Payment: Paystack Pay with Transfer (Virtual Account) ────────────────────

/**
 * Sent to customer after a dedicated virtual account is created for their order.
 * Instructs them to transfer the exact amount to the account shown.
 */
export function msgPayWithTransferDetails(
  bankName: string,
  accountNumber: string,
  amount: number,
  orderId: string,
  expiresInMinutes: number = 30,
  _lang: Language = 'en',
): string {
  return (
    `💳 *Pay by Bank Transfer*\n\n` +
    `Please transfer *${formatNaira(amount)}* to the account below:\n\n` +
    `🏦 *Bank:* ${bankName}\n` +
    `💳 *Account Number:* ${accountNumber}\n\n` +
    `📌 Order: *${formatOrderId(orderId)}*\n\n` +
    `⏰ This account expires in *${expiresInMinutes} minutes*. ` +
    `Transfer the *exact amount* — your order will be confirmed automatically.\n\n` +
    `Reply *STATUS* at any time to check your order.`
  );
}

/**
 * Sent to customer when their 30-minute payment window lapses.
 * Returns both the message string and Reply Buttons for retry.
 */
export function msgTransferPaymentExpired(
  orderId: string,
  _lang: Language = 'en',
): { message: string; buttons: InteractiveButton[] } {
  return {
    message:
      `⏰ *Payment Window Expired*\n\n` +
      `The transfer window for order *${formatOrderId(orderId)}* has closed.\n\n` +
      `No payment was received. Would you like to try again?`,
    buttons: [
      { id: `RETRY_ORDER ${orderId}`, title: '🔄 Try Again' },
      { id: 'MENU', title: '🛍️ Browse Menu' },
    ],
  };
}

// ─── Payment: Manual Bank Transfer ────────────────────────────────────────────

/**
 * Sent to customer at checkout when vendor uses manual bank transfer.
 * Shows vendor's bank details and instructs them to notify after paying.
 */
export function msgBankTransferInstructions(
  bankName: string,
  accountNumber: string,
  accountName: string,
  amount: number,
  orderId: string,
  _lang: Language = 'en',
): string {
  return (
    `🏦 *Bank Transfer Details*\n\n` +
    `Please transfer *${formatNaira(amount)}* to:\n\n` +
    `🏦 *Bank:* ${bankName}\n` +
    `💳 *Account:* ${accountNumber}\n` +
    `👤 *Name:* ${accountName}\n\n` +
    `📌 Order: *${formatOrderId(orderId)}*\n\n` +
    `After transferring, reply *PAID* to notify us. ` +
    `The vendor will confirm and your order will be processed. ✅`
  );
}

/**
 * Sent to vendor when a customer claims they've made a bank transfer.
 * Includes CONFIRM and REJECT Reply Buttons.
 */
export function msgVendorBankTransferClaim(
  order: OrderWithDetails,
): { message: string; buttons: InteractiveButton[] } {
  const itemLines = order.orderItems
    .map((oi) => `• ${oi.product.name} x${oi.quantity} — ${formatNaira(oi.unitPrice * oi.quantity)}`)
    .join('\n');
  const customerName = order.customer.name ?? 'A customer';
  const maskedPhone = order.customer.whatsappNumber.replace(/(\+\d{3})\d+(\d{4})/, '$1***$2');

  return {
    message:
      `💬 *Payment Claim*\n\n` +
      `${customerName} (${maskedPhone}) says they've transferred payment for:\n\n` +
      `${itemLines}\n\n` +
      `*Total: ${formatNaira(order.totalAmount)}*\n` +
      `📌 Order: *${formatOrderId(order.id)}*\n\n` +
      `Did you receive this payment?`,
    buttons: [
      { id: `CONFIRM_BANK ${formatOrderId(order.id)}`, title: '✅ Yes, Received' },
      { id: `REJECT_BANK ${formatOrderId(order.id)}`,  title: '❌ Not Received' },
    ],
  };
}

/** Sent to customer after vendor confirms receipt of bank transfer */
export function msgBankTransferConfirmed(
  orderId: string,
  businessName: string,
  _lang: Language = 'en',
): string {
  return (
    `✅ *Payment Confirmed!*\n\n` +
    `*${businessName}* has confirmed receipt of your payment.\n\n` +
    `Your order *${formatOrderId(orderId)}* is being processed! ` +
    `We'll keep you updated. 🙏`
  );
}

/** Sent to customer after vendor rejects bank transfer claim */
export function msgBankTransferRejected(
  orderId: string,
  _lang: Language = 'en',
): { message: string; buttons: InteractiveButton[] } {
  return {
    message:
      `❌ *Payment Not Confirmed*\n\n` +
      `Unfortunately, *${formatOrderId(orderId)}* could not be confirmed.\n\n` +
      `The vendor did not receive your transfer. Please check your bank and try again, ` +
      `or contact the store for assistance.`,
    buttons: [
      { id: 'MENU', title: '🛍️ Browse Menu' },
    ],
  };
}

// ─── Delivery / Pickup Choice ─────────────────────────────────────────────────

/**
 * Reply Buttons asking customer to choose delivery or pickup at checkout.
 */
export function msgDeliveryOrPickup(_lang: Language = 'en'): { message: string; buttons: InteractiveButton[] } {
  return {
    message: `🚚 *How would you like to receive your order?*`,
    buttons: [
      { id: 'DELIVERY', title: '🚚 Home Delivery' },
      { id: 'PICKUP',   title: '📍 Pickup at Location' },
    ],
  };
}

/**
 * List message for customer to choose a pickup location.
 */
export function msgPickupLocationList(
  locations: Array<{ id: string; name: string; address: string; landmark?: string | null }>,
): { message: string; sections: InteractiveListSection[] } {
  return {
    message: `📍 *Choose a pickup location:*`,
    sections: [
      {
        title: 'Available Locations',
        rows: locations.map((loc) => ({
          id: `PICKUP_LOC:${loc.id}`,
          title: loc.name,
          description: loc.landmark ? `${loc.address} — ${loc.landmark}` : loc.address,
        })),
      },
    ],
  };
}

/**
 * Confirmation of the chosen pickup location.
 */
export function msgPickupLocationConfirmed(
  locationName: string,
  address: string,
  _lang: Language = 'en',
): string {
  return (
    `📍 *Pickup Location Confirmed*\n\n` +
    `You'll collect your order from:\n` +
    `*${locationName}*\n` +
    `${address}\n\n` +
    `Proceeding to payment...`
  );
}

/** Alert to vendor when digital delivery fails after all retries — English only */
// Language names in each language for the switch prompt
const LANG_NAMES: Record<Language, Record<Language, string>> = {
  en:  { en: 'English', pid: 'Pidgin', ig: 'Igbo', yo: 'Yorùbá', ha: 'Hausa' },
  pid: { en: 'English', pid: 'Pidgin', ig: 'Igbo', yo: 'Yorùbá', ha: 'Hausa' },
  ig:  { en: 'Bekee',   pid: 'Pidgin', ig: 'Igbo', yo: 'Yorùbá', ha: 'Hausa' },
  yo:  { en: 'Gẹ̀ẹ́sì',  pid: 'Pidgin', ig: 'Igbo', yo: 'Yorùbá', ha: 'Hausa' },
  ha:  { en: 'Turanci', pid: 'Pidgin', ig: 'Igbo', yo: 'Yorùbá', ha: 'Hausa' },
};

const LANG_SWITCH_PROMPTS: Record<Language, string> = {
  en:  `I noticed you may prefer {lang}. Would you like to switch?`,
  pid: `I don see say you dey yarn {lang}. You wan switch? 🌍`,
  ig:  `Ahụrụ m na ị na-asụ {lang}. Ịchọrọ ịgbanwe?`,
  yo:  `Mo ti rii pé o ń sọ {lang}. Ṣé o fẹ́ yipada?`,
  ha:  `Na lura kuna magana {lang}. Kuna son canzawa?`,
};

/**
 * Prompt sent when mid-conversation language detection fires.
 * The message is written in the DETECTED language, not the current session language.
 */
export function msgLanguageSwitchPrompt(
  detected: Language,
  current: Language,
): { message: string; buttons: InteractiveButton[] } {
  const detectedName = (LANG_NAMES[detected] ?? LANG_NAMES.en)[detected] ?? detected;
  const currentName  = (LANG_NAMES[detected] ?? LANG_NAMES.en)[current]  ?? current;
  const promptTemplate = LANG_SWITCH_PROMPTS[detected] ?? LANG_SWITCH_PROMPTS.en;
  const message = (promptTemplate as string).replace('{lang}', detectedName);

  return {
    message,
    buttons: [
      { id: `SWITCH_LANG:${detected}`, title: `✅ Yes, use ${detectedName}` },
      { id: 'KEEP_LANG',               title: `❌ No, keep ${currentName}`  },
    ],
  };
}

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
