/**
 * Display formatters for monetary values, cart, orders, and phone numbers.
 * Money is ALWAYS stored in kobo — convert to ₦ only at display time.
 */
import { KOBO_PER_NAIRA, NAIRA_DECIMAL_PLACES } from '../config/constants';
import { CartItem, ProductType } from '../types';

/** 150000 kobo → "₦1,500.00" */
export function formatNaira(kobo: number): string {
  const naira = kobo / KOBO_PER_NAIRA;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: NAIRA_DECIMAL_PLACES,
    maximumFractionDigits: NAIRA_DECIMAL_PLACES,
  })}`;
}

/** ₦1,500 naira → 150000 kobo */
export function nairaToKobo(naira: number): number {
  return Math.round(naira * KOBO_PER_NAIRA);
}

/** Sum all items in cart. Returns kobo. */
export function calculateCartTotal(cart: CartItem[]): number {
  return cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

/**
 * Formats a cart as a human-readable list with total.
 * Used in order summaries and payment messages.
 */
export function formatCartSummary(cart: CartItem[]): string {
  const lines = cart.map(
    (item, i) =>
      `${i + 1}. ${item.name} x${item.quantity} — ${formatNaira(item.unitPrice * item.quantity)}`,
  );
  lines.push(`\n💰 Total: ${formatNaira(calculateCartTotal(cart))}`);
  return lines.join('\n');
}

/** Formats a Date in WAT (Nigeria, UTC+1) */
export function formatTimestamp(date: Date): string {
  return date.toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** last 6 chars of UUID → "ORD-A3F9B2" */
export function formatOrderId(id: string): string {
  return `ORD-${id.slice(-6).toUpperCase()}`;
}

/**
 * Normalises Nigerian phone numbers to international format.
 * 08012345678 → +2348012345678
 */
export function normalisePhone(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('234')) return `+${cleaned}`;
  if (cleaned.startsWith('0') && cleaned.length === 11) return `+234${cleaned.slice(1)}`;
  return `+${cleaned}`;
}

/**
 * Product type label for HYBRID catalog display.
 * Shows "[DIGITAL]" or "[PHYSICAL]" tag so customers understand what they're buying.
 */
export function productTypeLabel(type: ProductType): string {
  return type === ProductType.DIGITAL ? '📲 [DIGITAL]' : '📦 [PHYSICAL]';
}
