/**
 * Pidgin Phrases — sourced from /pingmart/PIDGIN.md
 *
 * Single source of truth for all hardcoded Nigerian Pidgin strings used by
 * the Pingmart bot. Organised by the sections in PIDGIN.md.
 *
 * Usage:
 *   import { PIDGIN_CONFIRMATIONS } from '../constants/pidgin-phrases';
 *   await send(phone, PIDGIN_CONFIRMATIONS.itemAddedToCart(2, 'Jollof Rice'));
 *
 * These strings are also referenced by src/i18n/translations.ts (pid block).
 * Keep both files in sync when updating a phrase.
 */

// ─── Confirmations & Acknowledgements ────────────────────────────────────────
// Sourced from PIDGIN.md § "Confirmations & Acknowledgements"

export const PIDGIN_CONFIRMATIONS = {
  /** ✅ I don add {qty}x {product} to your cart! */
  itemAddedToCart: (qty: number | string, product: string): string =>
    `✅ I don add ${qty}x ${product} to your cart!`,

  /** 🎉 Order don land! {vendor} go see am now. Your order number na #{id}. */
  orderConfirmed: (vendor: string, id: string): string =>
    `🎉 Order don land! ${vendor} go see am now. Your order number na #${id}.`,

  /** 💚 E don do! I don confirm your payment of ₦{amount}. Your order dey move! 🚀 */
  paymentReceived: (amount: string): string =>
    `💚 E don do! I don confirm your payment of ₦${amount}. Your order dey move! 🚀`,

  /** 🚀 {storeName} don dey live for Pingmart! Share your link make customers find you. */
  storeIsLive: (storeName: string): string =>
    `🚀 ${storeName} don dey live for Pingmart! Share your link make customers find you.`,

  /** Chai! E get small wahala. Abeg try again or type HELP. */
  somethingWentWrong: (): string =>
    `Chai! E get small wahala. Abeg try again or type HELP.`,

  /** ⏰ {storeName} don close for now. But drop your order — dem go see am when dem open. */
  storeClosed: (storeName: string): string =>
    `⏰ ${storeName} don close for now. But drop your order — dem go see am when dem open.`,

  /** Your cart empty still. Send item number wey you wan buy. */
  cartEmpty: (): string =>
    `Your cart empty still. Send item number wey you wan buy.`,

  /** Your shop don pause. Customers no go see am till you send OPEN SHOP. */
  storePaused: (): string =>
    `Your shop don pause. Customers no go see am till you send OPEN SHOP.`,

  /** Your shop don come back live! Customers fit shop again. */
  storeResumed: (): string =>
    `Your shop don come back live! Customers fit shop again.`,

  /** E don reset! Make we start from the beginning. */
  resetConfirmed: (): string =>
    `E don reset! Make we start from the beginning.`,
} as const;

// ─── Greetings ────────────────────────────────────────────────────────────────
// Sourced from PIDGIN.md § "Greetings"

export const PIDGIN_GREETING_REPLIES: Record<string, string> = {
  'HOW FAR':          'I dey! Wetin you wan do today?',
  'HOW YOU DEY':      'I dey kampe! Wetin I fit do for you?',
  'HOW BODI':         'Body dey inside cloth 😄 Wetin you need?',
  'GOOD MORNING':     'Good morning! I dey here. Wetin you wan do today?',
  'SUP':              'I dey! Wetin dey sup?',
  'I DON COME BACK':  'Welcome back! You wan continue from where you stop?',
  'I DEY':            'E good! How I fit help you?',
  'I DEY FINE':       'E good well well! Wetin you wan do?',
  'I DEY KAMPE':      'Na so! Wetin I fit do for you today?',
};

// ─── Reactions & Emphasis ─────────────────────────────────────────────────────
// Sourced from PIDGIN.md § "Reactions & Emphasis"

export const PIDGIN_REACTIONS = {
  CHAI:           'Chai!',
  GBAM:           'Gbam!',
  GBAMSOLUTELY:   'Gbamsolutely!',
  NA_SO:          'Na so!',
  EHEN:           'Ehen',
  E_CHOKE:        'E choke!',
  OPOR:           'Opor!',
  YOU_SABI:       'You sabi!',
  YOU_KNOW_BALL:  'You know ball!',
  YOU_TOO_MUCH:   'Na you too much! 😄',
  E_DON_DO:       'E don do!',
  SHARP_SHARP:    'Sharp sharp!',
} as const;

// ─── Compliments & Positive Reinforcement ────────────────────────────────────
// Sourced from PIDGIN.md § "Compliments & Positive Reinforcement"

export const PIDGIN_COMPLIMENTS = {
  afterSetup:       'You sabi! Your store don set up sharp sharp.',
  firstOrder:       'Na you biko! First order don land 🎉',
  manyProducts:     'E choke! Opor products dey your catalogue.',
  correctInput:     'Gbam! I don understand.',
  userFiguredItOut: 'You know ball! Na exactly wetin I mean.',
} as const;

// ─── Commerce & Shopping ─────────────────────────────────────────────────────
// Sourced from PIDGIN.md § "Requests & Shopping" + "Commerce & Store Expressions"

export const PIDGIN_SHOPPING = {
  /** Bot response when customer says "Dash me" (asks for free item) */
  dashMeReply: (price: string): string =>
    `Haha, e no dey like that 😄 But the price na ₦${price} — e worth am!`,

  /** Bot response when customer says "I no get" (can't afford / broke) */
  noGetReply: (): string =>
    `No wahala. You fit save am for later or check if dem get something wey fit your budget.`,

  /** Help prompt */
  helpMe: (): string =>
    `No wahala, I dey here. Wetin you need help with?`,
} as const;
