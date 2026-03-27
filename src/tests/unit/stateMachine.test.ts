/**
 * Unit tests for the conversation state machine — both Flow A (physical) and Flow B (digital).
 * Pure functions, no DB or API calls.
 */
import { Product, Vendor } from '@prisma/client';
import { ConversationState, SessionData, OrderType, ProductType } from '../../types';
import {
  handleIdle,
  handleBrowsing,
  handlePhysicalOrdering,
  handleDigitalOrdering,
  handleAwaitingAddress,
  handleAwaitingPayment,
} from '../../services/order/stateMachine';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const physicalVendor = {
  id: 'v-physical', businessName: "Mama Tee's Kitchen", whatsappNumber: '+2348001111111',
  phoneNumber: '+2348001111111', vendorType: 'PHYSICAL_GOODS', apiKeyHash: 'h',
  isActive: true, isVerified: true, createdAt: new Date(), updatedAt: new Date(),
} as Vendor;

const digitalVendor = {
  id: 'v-digital', businessName: 'TechSkills by Tunde', whatsappNumber: '+2348002222222',
  phoneNumber: '+2348002222222', vendorType: 'DIGITAL_PRODUCTS', apiKeyHash: 'h',
  isActive: true, isVerified: true, createdAt: new Date(), updatedAt: new Date(),
} as Vendor;

const hybridVendor = {
  ...physicalVendor, id: 'v-hybrid', businessName: 'Hybrid Store', vendorType: 'HYBRID',
} as Vendor;

const makeProduct = (overrides: Partial<Product>): Product => ({
  id: 'p-1', vendorId: 'v-1', name: 'Test Product', description: null,
  price: 150000, category: 'General', productType: 'PHYSICAL', imageUrl: null,
  isAvailable: true, stockCount: null, deliveryType: null,
  deliveryContent: null, deliveryMessage: null,
  createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
} as Product);

const physicalProduct = makeProduct({ id: 'p-phys', name: 'Jollof Rice', price: 150000, productType: 'PHYSICAL' });
const digitalProduct = makeProduct({
  id: 'p-dig', name: 'Python Course', price: 1500000, productType: 'DIGITAL',
  deliveryType: 'LINK', deliveryContent: 'https://example.com/course',
  deliveryMessage: 'Welcome to the course!',
});

const emptySession: SessionData = { cart: [] };

// ─── IDLE ─────────────────────────────────────────────────────────────────────

describe('IDLE state', () => {
  test('any message shows physical catalog for physical vendor', () => {
    const r = handleIdle('hi', physicalVendor, [physicalProduct], emptySession);
    expect(r.nextState).toBe(ConversationState.BROWSING);
    expect(r.messages[0]).toContain("Mama Tee's Kitchen");
    expect(r.messages[0]).toContain('Jollof Rice');
    expect(r.nextData.cart).toHaveLength(0);
  });

  test('shows digital catalog for digital vendor', () => {
    const r = handleIdle('hi', digitalVendor, [digitalProduct], emptySession);
    expect(r.messages[0]).toContain('TechSkills by Tunde');
    expect(r.messages[0]).toContain('Python Course');
    expect(r.nextState).toBe(ConversationState.BROWSING);
  });

  test('HYBRID vendor shows type labels', () => {
    const r = handleIdle('hi', hybridVendor, [physicalProduct, digitalProduct], emptySession);
    expect(r.messages[0]).toContain('[PHYSICAL]');
    expect(r.messages[0]).toContain('[DIGITAL]');
  });
});

// ─── BROWSING ─────────────────────────────────────────────────────────────────

describe('BROWSING state', () => {
  const products = [physicalProduct, digitalProduct];

  test('selecting physical product transitions to ORDERING with pending item', () => {
    const r = handleBrowsing('1', physicalVendor, [physicalProduct], emptySession);
    expect(r.nextState).toBe(ConversationState.ORDERING);
    expect(r.nextData.pendingProductId).toBe('p-phys');
    expect(r.nextData.activeOrderType).toBe(OrderType.PHYSICAL);
    expect(r.messages[0]).toContain('How many');
  });

  test('selecting digital product transitions to ORDERING with product detail', () => {
    const r = handleBrowsing('1', digitalVendor, [digitalProduct], emptySession);
    expect(r.nextState).toBe(ConversationState.ORDERING);
    expect(r.nextData.selectedProductId).toBe('p-dig');
    expect(r.nextData.activeOrderType).toBe(OrderType.DIGITAL);
    expect(r.messages[0]).toContain('Python Course');
    expect(r.messages[0]).toContain('BUY');
  });

  test('out of range number returns error and stays in BROWSING', () => {
    const r = handleBrowsing('99', physicalVendor, [physicalProduct], emptySession);
    expect(r.nextState).toBe(ConversationState.BROWSING);
  });

  test('CANCEL resets to IDLE', () => {
    const r = handleBrowsing('CANCEL', physicalVendor, [physicalProduct], emptySession);
    expect(r.nextState).toBe(ConversationState.IDLE);
    expect(r.nextData.cart).toHaveLength(0);
  });

  test('MENU shows catalog again', () => {
    const r = handleBrowsing('MENU', physicalVendor, [physicalProduct], emptySession);
    expect(r.nextState).toBe(ConversationState.BROWSING);
    expect(r.messages[0]).toContain("Mama Tee's Kitchen");
  });

  test('HYBRID: selecting digital product from mixed list sets correct order type', () => {
    const r = handleBrowsing('2', hybridVendor, products, emptySession);
    expect(r.nextData.activeOrderType).toBe(OrderType.DIGITAL);
    expect(r.nextData.selectedProductId).toBe('p-dig');
  });
});

// ─── ORDERING — Flow A (Physical) ─────────────────────────────────────────────

describe('ORDERING state — Physical (Flow A)', () => {
  const sessionWithPending: SessionData = {
    cart: [], activeOrderType: OrderType.PHYSICAL,
    pendingProductId: 'p-phys', pendingProductName: 'Jollof Rice', pendingProductPrice: 150000,
  };

  test('valid quantity adds item to cart', () => {
    const r = handlePhysicalOrdering('2', physicalVendor, [physicalProduct], sessionWithPending);
    expect(r.nextData.cart).toHaveLength(1);
    expect(r.nextData.cart[0]!.quantity).toBe(2);
    expect(r.nextData.pendingProductId).toBeUndefined();
    expect(r.messages[0]).toContain('2x Jollof Rice');
  });

  test('quantity 0 is rejected', () => {
    const r = handlePhysicalOrdering('0', physicalVendor, [physicalProduct], sessionWithPending);
    expect(r.nextData.cart).toHaveLength(0);
    expect(r.messages[0]).toContain('valid quantity');
  });

  test('non-numeric quantity is rejected', () => {
    const r = handlePhysicalOrdering('lots', physicalVendor, [physicalProduct], sessionWithPending);
    expect(r.nextData.cart).toHaveLength(0);
  });

  test('DONE with items transitions to AWAITING_ADDRESS', () => {
    const sessionWithItem: SessionData = {
      cart: [{ productId: 'p-phys', name: 'Jollof Rice', quantity: 1, unitPrice: 150000, productType: ProductType.PHYSICAL }],
      activeOrderType: OrderType.PHYSICAL,
    };
    const r = handlePhysicalOrdering('DONE', physicalVendor, [physicalProduct], sessionWithItem);
    expect(r.nextState).toBe(ConversationState.AWAITING_ADDRESS);
    expect(r.messages[0]).toContain('delivery address');
  });

  test('DONE with empty cart stays in BROWSING', () => {
    const r = handlePhysicalOrdering('DONE', physicalVendor, [physicalProduct], { cart: [] });
    expect(r.nextState).toBe(ConversationState.BROWSING);
    expect(r.messages[0]).toContain('empty');
  });

  test('adding same item twice merges quantities', () => {
    const sessionWithExisting: SessionData = {
      cart: [{ productId: 'p-phys', name: 'Jollof Rice', quantity: 1, unitPrice: 150000, productType: ProductType.PHYSICAL }],
      activeOrderType: OrderType.PHYSICAL,
      pendingProductId: 'p-phys', pendingProductName: 'Jollof Rice', pendingProductPrice: 150000,
    };
    const r = handlePhysicalOrdering('2', physicalVendor, [physicalProduct], sessionWithExisting);
    expect(r.nextData.cart).toHaveLength(1); // Still 1 unique item
    expect(r.nextData.cart[0]!.quantity).toBe(3); // 1 + 2
  });

  test('CLEAR empties cart and goes to BROWSING', () => {
    const sessionWithItem: SessionData = {
      cart: [{ productId: 'p-phys', name: 'Jollof Rice', quantity: 1, unitPrice: 150000, productType: ProductType.PHYSICAL }],
    };
    const r = handlePhysicalOrdering('CLEAR', physicalVendor, [physicalProduct], sessionWithItem);
    expect(r.nextState).toBe(ConversationState.BROWSING);
    expect(r.nextData.cart).toHaveLength(0);
  });
});

// ─── ORDERING — Flow B (Digital) ─────────────────────────────────────────────

describe('ORDERING state — Digital (Flow B)', () => {
  const sessionWithProduct: SessionData = {
    cart: [], activeOrderType: OrderType.DIGITAL,
    selectedProductId: 'p-dig',
  };

  test('BUY creates order and transitions to AWAITING_PAYMENT', () => {
    const r = handleDigitalOrdering('BUY', digitalVendor, [digitalProduct], sessionWithProduct);
    expect(r.nextState).toBe(ConversationState.AWAITING_PAYMENT);
    expect(r.shouldCreateOrder).toBe(true);
    expect(r.nextData.cart).toHaveLength(1);
    expect(r.nextData.cart[0]!.productType).toBe(ProductType.DIGITAL);
  });

  test('YES is also accepted as BUY', () => {
    const r = handleDigitalOrdering('yes', digitalVendor, [digitalProduct], sessionWithProduct);
    expect(r.shouldCreateOrder).toBe(true);
  });

  test('MENU returns to catalog', () => {
    const r = handleDigitalOrdering('MENU', digitalVendor, [digitalProduct], sessionWithProduct);
    expect(r.nextState).toBe(ConversationState.BROWSING);
    expect(r.shouldCreateOrder).toBeUndefined();
  });

  test('unknown reply asks to clarify', () => {
    const r = handleDigitalOrdering('maybe', digitalVendor, [digitalProduct], sessionWithProduct);
    expect(r.nextState).toBe(ConversationState.ORDERING);
    expect(r.messages[0]).toContain('BUY');
  });
});

// ─── AWAITING_ADDRESS ─────────────────────────────────────────────────────────

describe('AWAITING_ADDRESS state', () => {
  const sessionWithCart: SessionData = {
    cart: [{ productId: 'p-phys', name: 'Jollof Rice', quantity: 1, unitPrice: 150000, productType: ProductType.PHYSICAL }],
    activeOrderType: OrderType.PHYSICAL,
  };

  test('full address triggers confirmation prompt', () => {
    const addr = '12 Adeola Odeku Street, Victoria Island, Lagos';
    const r = handleAwaitingAddress(addr, physicalVendor, [physicalProduct], sessionWithCart);
    expect(r.nextState).toBe(ConversationState.AWAITING_ADDRESS);
    expect((r.nextData as SessionData & { deliveryAddress?: string }).deliveryAddress).toBe(addr);
    expect(r.messages[0]).toContain('YES');
  });

  test('short address is rejected', () => {
    const r = handleAwaitingAddress('Lagos', physicalVendor, [physicalProduct], sessionWithCart);
    expect(r.nextState).toBe(ConversationState.AWAITING_ADDRESS);
    expect(r.messages[0]).toContain('full delivery address');
  });

  test('YES on confirmation triggers order creation', () => {
    const dataWithAddr = { ...sessionWithCart, deliveryAddress: '12 Adeola Odeku, VI, Lagos' };
    const r = handleAwaitingAddress('YES', physicalVendor, [physicalProduct], dataWithAddr);
    expect(r.nextState).toBe(ConversationState.AWAITING_PAYMENT);
    expect(r.shouldCreateOrder).toBe(true);
  });

  test('NO on confirmation re-asks for address', () => {
    const dataWithAddr = { ...sessionWithCart, deliveryAddress: '12 Adeola Odeku, VI, Lagos' };
    const r = handleAwaitingAddress('no', physicalVendor, [physicalProduct], dataWithAddr);
    expect(r.nextState).toBe(ConversationState.AWAITING_ADDRESS);
    expect((r.nextData as SessionData & { deliveryAddress?: string }).deliveryAddress).toBeUndefined();
  });
});

// ─── AWAITING_PAYMENT ─────────────────────────────────────────────────────────

describe('AWAITING_PAYMENT state', () => {
  test('any message reminds about pending payment', () => {
    const r = handleAwaitingPayment('hello', emptySession);
    expect(r.nextState).toBe(ConversationState.AWAITING_PAYMENT);
    expect(r.messages[0]).toContain('payment');
  });

  test('CANCEL from AWAITING_PAYMENT resets to IDLE', () => {
    const r = handleAwaitingPayment('CANCEL', emptySession);
    expect(r.nextState).toBe(ConversationState.IDLE);
    expect(r.nextData.cart).toHaveLength(0);
  });
});

// ─── Session Expiry (handled in repository — test the concept) ────────────────

describe('Session data structure', () => {
  test('empty session has no cart items', () => {
    expect(emptySession.cart).toHaveLength(0);
    expect(emptySession.activeOrderType).toBeUndefined();
  });

  test('digital session correctly identifies order type', () => {
    const digitalSession: SessionData = { cart: [], activeOrderType: OrderType.DIGITAL, selectedProductId: 'p-dig' };
    expect(digitalSession.activeOrderType).toBe(OrderType.DIGITAL);
    expect(digitalSession.selectedProductId).toBe('p-dig');
  });
});
