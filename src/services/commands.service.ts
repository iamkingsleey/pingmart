/**
 * Bot Commands Interceptor
 *
 * Intercepts all recognized bot commands before any routing or LLM logic.
 * Called from routeIncomingMessage() immediately after dedup and image/document
 * routing, before the LLM pipeline and role-based routing.
 *
 * Return contract:
 *   { handled: true }                        — command fully processed; caller MUST return
 *   { handled: false }                        — not a command; caller continues normally
 *   { handled: false, normalizedMessage: X }  — Pidgin alias normalized; caller uses X
 *
 * COMMANDS_REFERENCE_PATH: /pingmart/COMMANDS.md
 */
import { Vendor } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { redis } from '../utils/redis';
import { messageQueue } from '../queues/message.queue';
import { customerRepository } from '../repositories/customer.repository';
import { handleVendorDashboard } from './vendor-management.service';
import { clearHistory } from '../utils/conversationHistory';
import { t, Language } from '../i18n';
import { formatOrderId, formatNaira } from '../utils/formatters';
import { logger, maskPhone } from '../utils/logger';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROUTER_STATE_TTL_SECS = 30 * 60; // 30 minutes — must match router.service.ts

// ─── Token set ────────────────────────────────────────────────────────────────
//
// Only exact-match (full normalized message) tokens are listed here.
// Primary commands already handled by existing code (DONE, CART, CLEAR, CANCEL,
// SKIP, EDITED, HANDLED) are intentionally excluded — the interceptor only handles
// NEW commands and the Pidgin aliases defined in COMMANDS.md.
//
// Note: CATALOGUE is handled as a vendor command here; customers sending CATALOGUE
// are not intercepted and fall through to BROWSE_COMMAND_ALIASES → MENU.
const INTERCEPT_TOKENS = new Set([
  // Alias-only (normalize and pass-through — no DB lookup needed)
  'HOME',          // → MENU
  'COMOT',         // → CANCEL (Pidgin alias)
  'MY CART',       // → CART  (Pidgin alias)
  'I DON FINISH',  // → DONE  (Pidgin alias)
  // Global commands (fully handled by interceptor)
  'RESET',
  'HELP',
  'ASSIST',        // alias for HELP
  'LANGUAGE',
  'CHANGE LANGUAGE',
  // Customer commands (fully handled by interceptor)
  'ORDERS',
  // Vendor commands (handled by interceptor; non-vendors fall through to NLU)
  'DASHBOARD',
  'ADD',
  'CATALOGUE',
  'HOURS',
  'PAUSE',
  'CLOSE SHOP',
  'RESUME',
  'OPEN SHOP',
]);

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CommandResult {
  /** true = interceptor sent a response; caller must return immediately */
  handled: boolean;
  /** if set, use this normalized form as the effective message for downstream routing */
  normalizedMessage?: string;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Intercepts recognized commands before any routing or LLM logic runs.
 *
 * Fast exit for ~99% of messages (not in INTERCEPT_TOKENS) — no DB or Redis
 * access. Only commands that actually match pay the DB-lookup cost.
 */
export async function interceptCommand(
  phone: string,
  rawMessage: string,
): Promise<CommandResult> {
  const upper = rawMessage.trim().toUpperCase().replace(/\s+/g, ' ');

  // Fast path — covers the vast majority of messages with zero I/O
  if (!INTERCEPT_TOKENS.has(upper)) return { handled: false };

  // ── Alias normalization: pass-through with canonical form ─────────────────
  // These are unambiguous Pidgin aliases that map 1-to-1 to a primary command
  // already handled by the existing routing. No DB lookup needed.
  if (upper === 'HOME')          return { handled: false, normalizedMessage: 'MENU' };
  if (upper === 'COMOT')         return { handled: false, normalizedMessage: 'CANCEL' };
  if (upper === 'MY CART')       return { handled: false, normalizedMessage: 'CART' };
  if (upper === 'I DON FINISH')  return { handled: false, normalizedMessage: 'DONE' };

  // ── Role detection — needed for all commands that follow ──────────────────
  const [customer, vendor] = await Promise.all([
    customerRepository.findByWhatsAppNumber(phone),
    prisma.vendor.findUnique({ where: { ownerPhone: phone } }),
  ]);
  const language = (customer?.language ?? 'en') as Language;

  // ── RESET ─────────────────────────────────────────────────────────────────
  // Nuclear option — wipes session, Redis keys, and language preference,
  // then shows language selection so the user starts completely fresh.
  if (upper === 'RESET') {
    await handleReset(phone, !!customer, !!vendor);
    logger.info('RESET command: session wiped', { from: maskPhone(phone) });
    return { handled: true };
  }

  // ── HELP / ASSIST ─────────────────────────────────────────────────────────
  if (upper === 'HELP' || upper === 'ASSIST') {
    await handleHelp(phone, language, !!customer, !!vendor);
    return { handled: true };
  }

  // ── LANGUAGE / CHANGE LANGUAGE ────────────────────────────────────────────
  // For active customer sessions, let processIncomingMessage handle it —
  // the existing handler preserves the cart while the language changes.
  // For vendors and unknown senders, show the router-level language screen.
  if (upper === 'LANGUAGE' || upper === 'CHANGE LANGUAGE') {
    if (customer && !vendor) {
      const activeSession = await prisma.conversationSession.findFirst({
        where: { whatsappNumber: phone, expiresAt: { gt: new Date() } },
      });
      if (activeSession) return { handled: false }; // fall through to existing handler
    }
    await showLanguageSelection(phone);
    return { handled: true };
  }

  // ── ORDERS ────────────────────────────────────────────────────────────────
  // Shows the customer's last 5 orders across all stores.
  if (upper === 'ORDERS') {
    if (!customer) return { handled: false }; // unknown sender — fall through
    await handleOrders(phone, language, customer.id);
    return { handled: true };
  }

  // ── Vendor-only commands ──────────────────────────────────────────────────
  // Non-vendors fall through to NLU so natural-language phrases containing
  // these words ("I want to pause my order", "open shop near me") are handled
  // correctly by the LLM classifier rather than rejected silently.
  if (!vendor) return { handled: false };

  // Delegate to handleVendorDashboard — vendor-management.service.ts recognizes
  // these shorthand tokens in handleTopLevelCommand and routes to the right function.
  switch (upper) {
    case 'DASHBOARD':
    case 'ADD':
    case 'CATALOGUE':
    case 'HOURS':
    case 'PAUSE':
    case 'CLOSE SHOP':
    case 'RESUME':
    case 'OPEN SHOP':
      await handleVendorDashboard(phone, upper, vendor as Vendor);
      return { handled: true };
    default:
      return { handled: false };
  }
}

// ─── RESET ────────────────────────────────────────────────────────────────────

async function handleReset(
  phone: string,
  hasCustomer: boolean,
  _hasVendor: boolean,
): Promise<void> {
  await Promise.all([
    // Delete all active conversation sessions for this phone across all stores
    prisma.conversationSession.deleteMany({ where: { whatsappNumber: phone } }),
    // Clear all Redis keys associated with this phone
    redis.del(`router:state:${phone}`),
    redis.del(`vendor:cmd:${phone}`),
    redis.del(`lang:switch:${phone}`),
    redis.del(`vendor:lang:${phone}`),
    clearHistory(phone),
  ]);

  // Reset language preference so language selection is shown again
  if (hasCustomer) {
    await prisma.customer.update({
      where: { whatsappNumber: phone },
      data: { languageSet: false, language: 'en' },
    });
  }

  // Show the language selection screen — this is the first step of a fresh session
  await showLanguageSelection(phone);
}

// ─── HELP ─────────────────────────────────────────────────────────────────────

async function handleHelp(
  phone: string,
  language: Language,
  isCustomer: boolean,
  isVendor: boolean,
): Promise<void> {
  const role = isVendor ? 'vendor' : isCustomer ? 'customer' : 'unknown';
  await messageQueue.add({
    to: phone,
    message: t(`help_${role}`, language),
  });
}

// ─── ORDERS ───────────────────────────────────────────────────────────────────

async function handleOrders(
  phone: string,
  language: Language,
  customerId: string,
): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { customerId },
    include: { vendor: { select: { businessName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  if (!orders.length) {
    await messageQueue.add({
      to: phone,
      message: t('cmd_orders_none', language),
    });
    return;
  }

  const STATUS_EMOJI: Record<string, string> = {
    PENDING_PAYMENT:   '⏳',
    PAYMENT_PENDING:   '⏳',
    PAYMENT_CONFIRMED: '💳',
    CONFIRMED:         '✅',
    PREPARING:         '👨‍🍳',
    READY:             '🚀',
    OUT_FOR_DELIVERY:  '🚚',
    DELIVERED:         '✅',
    DIGITAL_SENT:      '📦',
    CANCELLED:         '❌',
    EXPIRED:           '❌',
  };

  const lines = orders.map((o, i) => {
    const emoji = STATUS_EMOJI[o.status] ?? '📦';
    const id    = formatOrderId(o.id);
    const amt   = formatNaira(o.totalAmount);
    const store = (o.vendor as any)?.businessName ?? '';
    return `${i + 1}. *${id}* — ${amt} ${emoji} | ${store}`;
  });

  await messageQueue.add({
    to: phone,
    message: t('cmd_orders_list', language, {
      count: String(orders.length),
      lines: lines.join('\n'),
    }),
  });
}

// ─── Language selection (inline — avoids circular import from router.service.ts) ─
// Two-step flow: step 1 asks English or other; step 2 shows 4-option list.
// Must stay in sync with showLanguageSelectionScreen() in router.service.ts.

async function showLanguageSelection(phone: string): Promise<void> {
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
