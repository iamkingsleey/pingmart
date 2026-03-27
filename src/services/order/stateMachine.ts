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
 */
import { Product, Vendor } from '@prisma/client';
import { ConversationState, SessionData, CartItem, ProductType, OrderType } from '../../types';
import { MAX_CART_ITEMS } from '../../config/constants';
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
): TransitionResult {
  const isHybrid = vendor.vendorType === 'HYBRID';
  const allDigital = products.every((p) => p.productType === 'DIGITAL');

  const welcomeMsg = allDigital
    ? msgDigitalWelcome(vendor.businessName, products)
    : msgPhysicalWelcome(vendor.businessName, products, isHybrid);

  return {
    messages: [welcomeMsg],
    nextState: ConversationState.BROWSING,
    nextData: { cart: [] },
  };
}

// ─── BROWSING ─────────────────────────────────────────────────────────────────

/**
 * Customer is viewing the catalog and should reply with an item number.
 * For HYBRID vendors, the selected product type determines which flow to enter.
 */
export function handleBrowsing(
  message: string,
  vendor: Vendor,
  products: Product[],
  currentData: SessionData,
): TransitionResult {
  const n = norm(message);

  if (isCancelKeyword(n)) {
    return { messages: ['Order cancelled. Type MENU to start again! 👋'], nextState: ConversationState.IDLE, nextData: { cart: [] } };
  }

  if (isMenuKeyword(message)) {
    return handleIdle(message, vendor, products, currentData);
  }

  const index = parseIndex(message, products.length);
  if (index === null) {
    return {
      messages: [`Please reply with the *number* of the item you'd like (1–${products.length}), or type *MENU* to see the list again.`],
      nextState: ConversationState.BROWSING,
      nextData: currentData,
    };
  }

  const selected = products[index - 1];
  if (!selected) {
    return { messages: [`That item doesn't exist. Reply with a number between 1 and ${products.length}.`], nextState: ConversationState.BROWSING, nextData: currentData };
  }

  // ── Digital product selected → enter Flow B ──────────────────────────────
  if (selected.productType === 'DIGITAL') {
    return {
      messages: [msgDigitalProductDetail(selected)],
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
    messages: [msgAskQuantity(selected.name, selected.price)],
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
): TransitionResult {
  const n = norm(message);

  if (isCancelKeyword(n)) {
    return { messages: ['Order cancelled. Type MENU to browse again! 👋'], nextState: ConversationState.IDLE, nextData: { cart: [] } };
  }

  if (n === 'CLEAR') {
    return { messages: ['Cart cleared! Reply with a number to start adding items again.'], nextState: ConversationState.BROWSING, nextData: { cart: [], activeOrderType: OrderType.PHYSICAL } };
  }

  // "DONE" → proceed to address collection
  if (n === 'DONE' || n === 'CHECKOUT') {
    if (!currentData.cart.length) {
      return { messages: ['Your cart is empty! Select at least one item first.'], nextState: ConversationState.BROWSING, nextData: currentData };
    }
    return {
      messages: [msgAskDeliveryAddress(currentData.cart)],
      nextState: ConversationState.AWAITING_ADDRESS,
      nextData: currentData,
    };
  }

  // Expecting a quantity for the pending item
  if (currentData.pendingProductId) {
    const qty = parseQuantity(message);
    if (!qty) {
      return { messages: [`Please enter a valid quantity (e.g. *1*, *2*, *3*).`], nextState: ConversationState.ORDERING, nextData: currentData };
    }

    const totalQty = currentData.cart.reduce((s, i) => s + i.quantity, 0) + qty;
    if (totalQty > MAX_CART_ITEMS) {
      return { messages: [`Sorry, max ${MAX_CART_ITEMS} items per order. Type *DONE* to checkout.`], nextState: ConversationState.ORDERING, nextData: currentData };
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
      messages: [msgItemAdded(currentData.pendingProductName ?? 'Item', qty, newCart)],
      nextState: ConversationState.ORDERING,
      nextData: updatedData,
    };
  }

  // No pending item — customer may be selecting another item by number
  // (Only allow physical products — can't mix with digital in one order)
  const physicalProducts = products.filter((p) => p.productType === 'PHYSICAL');
  const index = parseIndex(message, physicalProducts.length);
  if (index !== null) {
    const sel = physicalProducts[index - 1];
    if (sel) {
      return {
        messages: [msgAskQuantity(sel.name, sel.price)],
        nextState: ConversationState.ORDERING,
        nextData: { ...currentData, pendingProductId: sel.id, pendingProductName: sel.name, pendingProductPrice: sel.price },
      };
    }
  }

  // Fallback
  return {
    messages: [
      currentData.cart.length
        ? `You have ${currentData.cart.length} item(s) in your cart.\n\nReply with a number to add more, *DONE* to checkout, or *CLEAR* to start over.`
        : `Reply with a number to add an item, or type *MENU* to see the catalog.`,
    ],
    nextState: ConversationState.ORDERING,
    nextData: currentData,
  };
}

// ─── ORDERING (Flow B — Digital) ─────────────────────────────────────────────

/**
 * Customer has seen the product detail card and we're waiting for BUY or MENU.
 */
export function handleDigitalOrdering(
  message: string,
  vendor: Vendor,
  products: Product[],
  currentData: SessionData,
): TransitionResult {
  const n = norm(message);

  if (isCancelKeyword(n) || n === 'MENU') {
    return handleIdle(message, vendor, products, { cart: [] });
  }

  if (n === 'BUY' || n === 'YES' || n === 'CONFIRM') {
    if (!currentData.selectedProductId) {
      return handleIdle(message, vendor, products, { cart: [] });
    }
    const product = products.find((p) => p.id === currentData.selectedProductId);
    if (!product) {
      return handleIdle(message, vendor, products, { cart: [] });
    }

    // Build a single-item cart for the digital product
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

  // Unknown response while viewing product
  return {
    messages: [`Reply *BUY* to purchase, *MENU* to go back to the catalog, or *CANCEL* to exit.`],
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
): TransitionResult {
  const n = norm(message);

  if (isCancelKeyword(n)) {
    return { messages: ['Order cancelled. Type MENU to start again.'], nextState: ConversationState.IDLE, nextData: { cart: [] } };
  }

  const dataWithAddr = currentData as SessionData & { deliveryAddress?: string };

  // If we already have an address, we're in confirmation mode
  if (dataWithAddr.deliveryAddress) {
    return handleAddressConfirmation(message, currentData);
  }

  if (message.trim().length < 10) {
    return {
      messages: ['Please send your *full delivery address*.\n\nExample: "12 Adeola Odeku Street, Victoria Island, Lagos"'],
      nextState: ConversationState.AWAITING_ADDRESS,
      nextData: currentData,
    };
  }

  const address = message.trim();
  return {
    messages: [msgConfirmAddress(address, currentData.cart)],
    nextState: ConversationState.AWAITING_ADDRESS,
    nextData: { ...currentData, deliveryAddress: address },
  };
}

function handleAddressConfirmation(message: string, currentData: SessionData): TransitionResult {
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
      messages: ['No problem! Please send your correct delivery address:'],
      nextState: ConversationState.AWAITING_ADDRESS,
      nextData: { ...currentData, deliveryAddress: undefined },
    };
  }

  return {
    messages: ['Reply *YES* to confirm your order, or *NO* to change your address.'],
    nextState: ConversationState.AWAITING_ADDRESS,
    nextData: currentData,
  };
}

// ─── AWAITING_PAYMENT ─────────────────────────────────────────────────────────

export function handleAwaitingPayment(
  message: string,
  currentData: SessionData,
): TransitionResult {
  const n = norm(message);

  if (isCancelKeyword(n)) {
    return { messages: ['Order cancelled. Type MENU to start a new order.'], nextState: ConversationState.IDLE, nextData: { cart: [] } };
  }

  return {
    messages: [
      `We're waiting for your payment confirmation. 💳\n\n` +
      `Once received, your order will be processed immediately!\n\n` +
      `If you haven't paid yet, please use the payment link we sent.\n` +
      `Type *CANCEL* to start over.`,
    ],
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
): TransitionResult {
  // Treat any message after completion as starting a fresh session
  return handleIdle(_message, vendor, products, { cart: [] });
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
