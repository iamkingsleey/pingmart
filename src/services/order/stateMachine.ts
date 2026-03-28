/**
 * Conversation State Machine — the routing brain of the WhatsApp bot.
 *
 * Supports two distinct flows:
 *
 * FLOW A — Physical Goods:
 *   IDLE → BROWSING → ORDERING → AWAITING_ADDRESS → AWAITING_PAYMENT
 *   Supports multi-item cart, quantity selection, delivery address collection.
 *
 * FLOW B — Digital Products:
 *   IDLE → BROWSING → ORDERING (product detail) → AWAITING_PAYMENT
 *   One product per order. No delivery address. Instant delivery after payment.
 *
 * HYBRID vendors run Flow A or Flow B depending on the product the customer selects.
 * Physical and digital items can't be mixed in one order — the session locks to
 * the flow type of the first product selected.
 *
 * All handlers are pure functions (no side effects) to keep them testable.
 * Every handler accepts a `language` parameter and uses t() for all messages.
 */
import { Product, Vendor } from '@prisma/client';
import { ConversationState, SessionData, CartItem, ProductType, OrderType } from '../../types';
import { MAX_CART_ITEMS } from '../../config/constants';
import { t, Language } from '../../i18n';
import { formatNaira } from '../../utils/formatters';
import {
  msgPhysicalWelcome,
  msgDigitalWelcome,
  msgAskQuantity,
  msgItemAdded,
  msgAskDeliveryAddress,
  msgConfirmAddress,
  msgDigitalProductDetail,
} from '../whatsapp/templates';

// ─── Return Type ──────────────────────────────────────────────────────────────

export interface TransitionResult {
  messages: string[];
  nextState: ConversationState;
  nextData: SessionData;
  /**
   * If set, the order service should create an order and generate a payment link.
   * The activeOrderType tells it which flow to use.
   */
  shouldCreateOrder?: boolean;
}

// ─── Input Normalisation ──────────────────────────────────────────────────────

function norm(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toUpperCase();
}

function isCancelKeyword(text: string): boolean {
  return ['CANCEL', 'STOP', 'QUIT', 'EXIT', 'BACK'].includes(norm(text));
}

function isMenuKeyword(text: string): boolean {
  return ['MENU', '0', 'HI', 'HELLO', 'START', 'HEY', 'CATALOG'].includes(norm(text));
}

function parseIndex(text: string, max: number): number | null {
  const n = parseInt(text.trim(), 10);
  return isNaN(n) || n < 1 || n > max ? null : n;
}

function parseQuantity(text: string): number | null {
  const n = parseInt(text.trim(), 10);
  return isNaN(n) || n < 1 || n > 99 ? null : n;
}

// ─── IDLE ─────────────────────────────────────────────────────────────────────

export function handleIdle(
  _message: string,
  vendor: Vendor,
  products: Product[],
  _currentData: SessionData,
  lang: Language = 'en',
): TransitionResult {
  const isHybrid = vendor.vendorType === 'HYBRID';
  const allDigital = products.every((p) => p.productType === 'DIGITAL');

  const welcomeMsg = allDigital
    ? msgDigitalWelcome(vendor.businessName, products, lang)
    : msgPhysicalWelcome(vendor.businessName, products, isHybrid, lang);

  return {
    messages: [welcomeMsg],
    nextState: ConversationState.BROWSING,
    nextData: { cart: [] },
  };
}

// ─── BROWSING ─────────────────────────────────────────────────────────────────

export function handleBrowsing(
  message: string,
  vendor: Vendor,
  products: Product[],
  currentData: SessionData,
  lang: Language = 'en',
): TransitionResult {
  const n = norm(message);

  // ── PRICE:<productId> — injected by NLP router for price enquiries ─────────
  if (message.startsWith('PRICE:')) {
    const productId = message.slice(6);
    const product = products.find((p) => p.id === productId);
    if (product) {
      return {
        messages: [t('price_info', lang, { name: product.name, price: formatNaira(product.price) })],
        nextState: ConversationState.BROWSING,
        nextData: currentData,
      };
    }
  }

  if (isCancelKeyword(n)) {
    return {
      messages: [t('cancel_confirm', lang)],
      nextState: ConversationState.IDLE,
      nextData: { cart: [] },
    };
  }

  if (isMenuKeyword(message)) {
    return handleIdle(message, vendor, products, currentData, lang);
  }

  const index = parseIndex(message, products.length);
  if (index === null) {
    return {
      messages: [t('browsing_invalid', lang, { max: String(products.length) })],
      nextState: ConversationState.BROWSING,
      nextData: currentData,
    };
  }

  const selected = products[index - 1];
  if (!selected) {
    return {
      messages: [t('browsing_invalid_item', lang, { max: String(products.length) })],
      nextState: ConversationState.BROWSING,
      nextData: currentData,
    };
  }

  // ── Digital product selected → enter Flow B ──────────────────────────────
  if (selected.productType === 'DIGITAL') {
    return {
      messages: [msgDigitalProductDetail(selected, lang)],
      nextState: ConversationState.ORDERING,
      nextData: {
        cart: [],
        activeOrderType: OrderType.DIGITAL,
        selectedProductId: selected.id,
      },
    };
  }

  // ── Physical product selected → enter Flow A ──────────────────────────────
  return {
    messages: [msgAskQuantity(selected.name, selected.price, lang)],
    nextState: ConversationState.ORDERING,
    nextData: {
      cart: currentData.cart,
      activeOrderType: OrderType.PHYSICAL,
      pendingProductId: selected.id,
      pendingProductName: selected.name,
      pendingProductPrice: selected.price,
    },
  };
}

// ─── ORDERING (Flow A — Physical) ────────────────────────────────────────────

export function handlePhysicalOrdering(
  message: string,
  _vendor: Vendor,
  products: Product[],
  currentData: SessionData,
  lang: Language = 'en',
): TransitionResult {
  const n = norm(message);

  if (isCancelKeyword(n)) {
    return {
      messages: [t('cancel_confirm_ordering', lang)],
      nextState: ConversationState.IDLE,
      nextData: { cart: [] },
    };
  }

  if (n === 'CLEAR') {
    return {
      messages: [t('cart_cleared', lang)],
      nextState: ConversationState.BROWSING,
      nextData: { cart: [], activeOrderType: OrderType.PHYSICAL },
    };
  }

  // "DONE" → proceed to address collection
  if (n === 'DONE' || n === 'CHECKOUT') {
    if (!currentData.cart.length) {
      return {
        messages: [t('cart_empty_checkout', lang)],
        nextState: ConversationState.BROWSING,
        nextData: currentData,
      };
    }
    return {
      messages: [msgAskDeliveryAddress(currentData.cart, lang)],
      nextState: ConversationState.AWAITING_ADDRESS,
      nextData: currentData,
    };
  }

  // Expecting a quantity for the pending item
  if (currentData.pendingProductId) {
    const qty = parseQuantity(message);
    if (!qty) {
      return {
        messages: [t('invalid_quantity', lang)],
        nextState: ConversationState.ORDERING,
        nextData: currentData,
      };
    }

    const totalQty = currentData.cart.reduce((s, i) => s + i.quantity, 0) + qty;
    if (totalQty > MAX_CART_ITEMS) {
      return {
        messages: [t('max_cart_exceeded', lang, { max: String(MAX_CART_ITEMS) })],
        nextState: ConversationState.ORDERING,
        nextData: currentData,
      };
    }

    const newCart = addToCart(currentData.cart, {
      productId: currentData.pendingProductId,
      name: currentData.pendingProductName ?? 'Item',
      quantity: qty,
      unitPrice: currentData.pendingProductPrice ?? 0,
      productType: ProductType.PHYSICAL,
    });

    const updatedData: SessionData = {
      ...currentData,
      cart: newCart,
      pendingProductId: undefined,
      pendingProductName: undefined,
      pendingProductPrice: undefined,
    };

    return {
      messages: [msgItemAdded(currentData.pendingProductName ?? 'Item', qty, newCart, lang)],
      nextState: ConversationState.ORDERING,
      nextData: updatedData,
    };
  }

  // No pending item — customer may be selecting another item by number
  const physicalProducts = products.filter((p) => p.productType === 'PHYSICAL');
  const index = parseIndex(message, physicalProducts.length);
  if (index !== null) {
    const sel = physicalProducts[index - 1];
    if (sel) {
      return {
        messages: [msgAskQuantity(sel.name, sel.price, lang)],
        nextState: ConversationState.ORDERING,
        nextData: {
          ...currentData,
          pendingProductId: sel.id,
          pendingProductName: sel.name,
          pendingProductPrice: sel.price,
        },
      };
    }
  }

  // Fallback
  const msg = currentData.cart.length
    ? t('cart_status_items', lang, { count: String(currentData.cart.length) })
    : t('cart_status_empty', lang);

  return {
    messages: [msg],
    nextState: ConversationState.ORDERING,
    nextData: currentData,
  };
}

// ─── ORDERING (Flow B — Digital) ─────────────────────────────────────────────

export function handleDigitalOrdering(
  message: string,
  vendor: Vendor,
  products: Product[],
  currentData: SessionData,
  lang: Language = 'en',
): TransitionResult {
  const n = norm(message);

  if (isCancelKeyword(n) || n === 'MENU') {
    return handleIdle(message, vendor, products, { cart: [] }, lang);
  }

  if (n === 'BUY' || n === 'YES' || n === 'CONFIRM') {
    if (!currentData.selectedProductId) {
      return handleIdle(message, vendor, products, { cart: [] }, lang);
    }
    const product = products.find((p) => p.id === currentData.selectedProductId);
    if (!product) {
      return handleIdle(message, vendor, products, { cart: [] }, lang);
    }

    const cart: CartItem[] = [{
      productId: product.id,
      name: product.name,
      quantity: 1,
      unitPrice: product.price,
      productType: ProductType.DIGITAL,
    }];

    return {
      messages: [], // Payment link is sent by order service after order creation
      nextState: ConversationState.AWAITING_PAYMENT,
      nextData: { cart, activeOrderType: OrderType.DIGITAL, selectedProductId: product.id },
      shouldCreateOrder: true,
    };
  }

  return {
    messages: [t('digital_buy_prompt', lang)],
    nextState: ConversationState.ORDERING,
    nextData: currentData,
  };
}

// ─── AWAITING_ADDRESS (Flow A only) ──────────────────────────────────────────

export function handleAwaitingAddress(
  message: string,
  _vendor: Vendor,
  _products: Product[],
  currentData: SessionData,
  lang: Language = 'en',
): TransitionResult {
  const n = norm(message);

  if (isCancelKeyword(n)) {
    return {
      messages: [t('cancel_address', lang)],
      nextState: ConversationState.IDLE,
      nextData: { cart: [] },
    };
  }

  const dataWithAddr = currentData as SessionData & { deliveryAddress?: string };

  if (dataWithAddr.deliveryAddress) {
    return handleAddressConfirmation(message, currentData, lang);
  }

  if (message.trim().length < 10) {
    return {
      messages: [t('address_too_short', lang)],
      nextState: ConversationState.AWAITING_ADDRESS,
      nextData: currentData,
    };
  }

  const address = message.trim();
  return {
    messages: [msgConfirmAddress(address, currentData.cart, lang)],
    nextState: ConversationState.AWAITING_ADDRESS,
    nextData: { ...currentData, deliveryAddress: address },
  };
}

function handleAddressConfirmation(
  message: string,
  currentData: SessionData,
  lang: Language = 'en',
): TransitionResult {
  const n = norm(message);

  if (['YES', 'Y', 'CONFIRM', 'OK', 'OKAY'].includes(n)) {
    return {
      messages: [], // Payment link sent by order service
      nextState: ConversationState.AWAITING_PAYMENT,
      nextData: currentData,
      shouldCreateOrder: true,
    };
  }

  if (['NO', 'N', 'CHANGE'].includes(n)) {
    return {
      messages: [t('address_change_prompt', lang)],
      nextState: ConversationState.AWAITING_ADDRESS,
      nextData: { ...currentData, deliveryAddress: undefined },
    };
  }

  return {
    messages: [t('address_confirm_prompt', lang)],
    nextState: ConversationState.AWAITING_ADDRESS,
    nextData: currentData,
  };
}

// ─── AWAITING_PAYMENT ─────────────────────────────────────────────────────────

export function handleAwaitingPayment(
  message: string,
  currentData: SessionData,
  lang: Language = 'en',
): TransitionResult {
  const n = norm(message);

  if (isCancelKeyword(n)) {
    return {
      messages: [t('cancel_awaiting_payment', lang)],
      nextState: ConversationState.IDLE,
      nextData: { cart: [] },
    };
  }

  return {
    messages: [t('awaiting_payment', lang)],
    nextState: ConversationState.AWAITING_PAYMENT,
    nextData: currentData,
  };
}

// ─── COMPLETED ───────────────────────────────────────────────────────────────

export function handleCompleted(
  _message: string,
  vendor: Vendor,
  products: Product[],
  _currentData: SessionData,
  lang: Language = 'en',
): TransitionResult {
  return handleIdle(_message, vendor, products, { cart: [] }, lang);
}

// ─── Cart Helper ──────────────────────────────────────────────────────────────

function addToCart(cart: CartItem[], item: CartItem): CartItem[] {
  const existing = cart.find((i) => i.productId === item.productId);
  if (existing) {
    return cart.map((i) =>
      i.productId === item.productId ? { ...i, quantity: i.quantity + item.quantity } : i,
    );
  }
  return [...cart, item];
}
