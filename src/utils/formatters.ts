/**
 * Display formatters for monetary values, cart, orders, and phone numbers.
 * Money is ALWAYS stored in kobo — convert to ₦ only at display time.
 */
import { KOBO_PER_NAIRA, NAIRA_DECIMAL_PLACES } from '../config/constants';
import { CartItem, ProductType } from '../types';

/** 150000 kobo → "₦1,500" (no trailing .00 for whole naira amounts) */
export function formatNaira(kobo: number): string {
  const naira = kobo / KOBO_PER_NAIRA;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: 0,
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

/**
 * Returns a context-aware emoji for a product based on keyword matching
 * against its name and category. Case-insensitive. No LLM needed.
 *
 * Shared utility — use everywhere products are displayed:
 * vendor preview, order confirmation, catalogue listing, vendor dashboard.
 */
export function productNameEmoji(name: string, category = ''): string {
  const text = `${name} ${category}`.toLowerCase();

  // ── Gender detection ───────────────────────────────────────────────────────
  const isMale   = /\b(men|male|senator|agbada|kaftan|polo)\b/.test(text);
  const isFemale = /\b(women|female|ladies|girl)\b/.test(text);

  // ── Shoes ──────────────────────────────────────────────────────────────────
  if (/\b(sneaker|trainer|canvas)\b/.test(text))                    return '👟';
  if (/\b(heel|pump|stiletto|wedge)\b/.test(text))                  return '👠';
  if (/\b(sandal|slipper)\b/.test(text))                            return isMale ? '👞' : '👠';
  if (/\b(shoe|boot|loafer|oxford|moccasin)\b/.test(text))         return isFemale ? '👠' : '👞';

  // ── Clothing — gender-aware ───────────────────────────────────────────────
  if (/\b(suit|blazer)\b/.test(text))                               return '🤵';
  if (/\b(trouser|chino|jogger|short|pant)\b/.test(text))          return '👖';
  if (/\b(skirt)\b/.test(text))                                     return '🩱';
  if (/\b(blouse)\b/.test(text))                                    return '👚';
  if (/\b(dress|gown|ankara)\b/.test(text))                        return isMale ? '👔' : '👗';
  if (/\b(polo|shirt|top|senator|agbada|kaftan|buba|dashiki)\b/.test(text)) return isMale ? '👔' : '👚';
  if (/\b(native|wear|fabric|cloth|fashion|apparel|two.?piece)\b/.test(text))
    return isMale ? '👔' : isFemale ? '👗' : '👕';

  // ── Accessories ───────────────────────────────────────────────────────────
  if (/\b(bag|handbag|purse|tote|backpack|clutch)\b/.test(text))   return '👜';
  if (/\b(watch|wristwatch)\b/.test(text))                         return '⌚';
  if (/\b(cap|hat|beanie|beret|fez)\b/.test(text))                 return '🧢';

  // ── Food & drinks ─────────────────────────────────────────────────────────
  if (/\b(rice|jollof|meal|food|stew|soup|pasta)\b/.test(text))    return '🍛';
  if (/\b(chicken|meat|fish|beef|protein|turkey|suya|kebab)\b/.test(text)) return '🍗';
  if (/\b(drink|juice|water|soda|smoothie|beverage)\b/.test(text)) return '🥤';
  if (/\b(cake|pastry|bread|biscuit|donut|cookie|snack|pie)\b/.test(text)) return '🎂';

  // ── Beauty & skincare ─────────────────────────────────────────────────────
  if (/\b(cream|lotion|moisturis|serum|sunscreen)\b/.test(text))   return '🧴';
  if (/\b(perfume|fragrance|cologne|scent|spray)\b/.test(text))    return '🌸';
  if (/\b(makeup|lipstick|foundation|blush|mascara|liner)\b/.test(text)) return '💄';
  if (/\b(hair|wig|extension|braid|weave|lace|closure)\b/.test(text)) return '💇';

  // ── Electronics ───────────────────────────────────────────────────────────
  if (/\b(phone|charger|cable|sim|powerbank)\b/.test(text))        return '📱';
  if (/\b(laptop|computer|pc|desktop|tablet|ipad)\b/.test(text))   return '💻';
  if (/\b(earphone|headphone|airpod|earbud|speaker)\b/.test(text)) return '🎧';

  // ── Fallback ──────────────────────────────────────────────────────────────
  return '📦';
}
