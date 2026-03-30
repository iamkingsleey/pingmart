/**
 * Central TypeScript types for the WhatsApp Order Bot.
 * Enums mirror the Prisma schema — kept in sync manually.
 */

// ─── Vendor ───────────────────────────────────────────────────────────────────

export enum VendorType {
  PHYSICAL_GOODS = 'PHYSICAL_GOODS',
  DIGITAL_PRODUCTS = 'DIGITAL_PRODUCTS',
  HYBRID = 'HYBRID',
}

// ─── Product ──────────────────────────────────────────────────────────────────

export enum ProductType {
  PHYSICAL = 'PHYSICAL',
  DIGITAL = 'DIGITAL',
}

export enum DeliveryType {
  LINK = 'LINK',
  FILE = 'FILE',
}

// ─── Order ────────────────────────────────────────────────────────────────────

export enum OrderType {
  PHYSICAL = 'PHYSICAL',
  DIGITAL = 'DIGITAL',
}

export enum OrderStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PAYMENT_CONFIRMED = 'PAYMENT_CONFIRMED',
  PAID = 'PAID',
  CONFIRMED = 'CONFIRMED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  DELIVERED = 'DELIVERED',
  DIGITAL_SENT = 'DIGITAL_SENT',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  REJECTED = 'REJECTED',
}

// ─── Conversation State Machine ───────────────────────────────────────────────

export enum ConversationState {
  LANGUAGE_SELECTION = 'LANGUAGE_SELECTION',
  IDLE = 'IDLE',
  BROWSING = 'BROWSING',
  ORDERING = 'ORDERING',
  AWAITING_ITEM_NOTE = 'AWAITING_ITEM_NOTE',
  AWAITING_ADDRESS = 'AWAITING_ADDRESS',
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  COMPLETED = 'COMPLETED',
}

// ─── Session Data ─────────────────────────────────────────────────────────────

/** A single item in the customer's cart */
export interface CartItem {
  productId: string;
  name: string;
  quantity: number;
  /** Unit price in kobo at time of selection */
  unitPrice: number;
  productType: ProductType;
  note?: string;
}

/**
 * Session JSON blob stored in ConversationSession.sessionData.
 * Physical flow uses cart + delivery fields.
 * Digital flow uses selectedProductId + activeOrderType.
 */
export interface SessionData {
  // ── Session identity ──────────────────────────────────────────────────────
  /**
   * Always 'customer' — every ConversationSession belongs to a customer.
   * Vendor state is tracked separately (Redis vendor:cmd:{phone} + VendorSetupSession).
   * Stored explicitly so any handler can assert the role without ambiguity,
   * and so logs make the session type immediately clear.
   *
   * Optional only to handle sessions created before this field was added;
   * sessionRepository always sets it. Treat absent as 'customer'.
   */
  role?: 'customer';

  // ── Shared ────────────────────────────────────────────────────────────────
  cart: CartItem[];
  /** Which order flow this session is in (set when first product selected) */
  activeOrderType?: OrderType;

  // ── Physical flow state ───────────────────────────────────────────────────
  /** Product currently being added (awaiting quantity input) */
  pendingProductId?: string;
  pendingProductName?: string;
  pendingProductPrice?: number;
  /** Captured delivery address, stored before order confirmation */
  deliveryAddress?: string;

  // ── Digital flow state ────────────────────────────────────────────────────
  /** Digital product the customer is viewing/buying */
  selectedProductId?: string;

  // ── NLU state ─────────────────────────────────────────────────────────────
  /** Product shown during an availability check — waiting for customer YES/NO */
  nlpPendingProductId?: string;
  /**
   * Set after a not-found response that asks "would you like to see the menu?".
   * An affirmative reply (yes, ok, sure, please…) is treated as MENU instead of CONFIRM.
   */
  awaitingMenuConfirmation?: boolean;
  pendingMultiQueue?: Array<{ productId: string; name: string; price: number }>;
  pendingNote?: string;
  pendingNoteForProductId?: string;
  /**
   * Random nonce written to the session when a timeout job is scheduled.
   * If the customer responds, a new nonce is written — the old job sees a mismatch and skips.
   */
  timeoutNonce?: string;
  /**
   * Set when a returning customer taps their store link again and the router shows
   * the "want the same again?" welcome. YES pre-fills cart; anything else clears it.
   */
  awaitingReorderConfirmation?: boolean;
  /**
   * Tracks how many consecutive NLU UNKNOWN intents have occurred in this session.
   * After 3 consecutive UNKNOWNs the bot triggers human escalation (Phase 8).
   * Reset to 0 on any non-UNKNOWN intent.
   */
  consecutiveUnknownCount?: number;

  // ── Delivery / Pickup flow ────────────────────────────────────────────────
  /** 'delivery' | 'pickup' — chosen at checkout */
  deliveryType?: 'delivery' | 'pickup';
  /** Set while waiting for customer to choose delivery or pickup */
  awaitingDeliveryChoice?: boolean;
  /** Set while waiting for customer to select a pickup location from the list */
  awaitingPickupChoice?: boolean;
  /** ID of the PickupLocation the customer selected */
  selectedPickupLocationId?: string;

  // ── Payment method flow ───────────────────────────────────────────────────
  /** 'paystack_transfer' | 'bank_transfer' — chosen or defaulted at checkout */
  chosenPaymentMethod?: string;

  // ── Off-hours flag ────────────────────────────────────────────────────────
  /**
   * Set to true when the customer placed an order while the store was closed.
   * Used to add an off-hours note to the order confirmation and vendor alert.
   */
  orderedWhileClosed?: boolean;
  /** Human-readable opening time stored at order time, e.g. "9:00 AM" */
  storeOpensAt?: string;
}

// ─── API Contracts ────────────────────────────────────────────────────────────

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: { code: string; message: string };
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateVendorDto {
  businessName: string;
  whatsappNumber: string;
  phoneNumber: string;
  vendorType: VendorType;
}

export interface UpdateVendorDto {
  businessName?: string;
  phoneNumber?: string;
  isActive?: boolean;
  /** Plain-text account number — encrypted with AES-256-GCM before persisting */
  bankAccountNumber?: string;
}

export interface CreateProductDto {
  name: string;
  description?: string;
  /** Price in kobo */
  price: number;
  category?: string;
  productType: ProductType;
  imageUrl?: string;
  // Physical only
  stockCount?: number;
  // Digital only
  deliveryType?: DeliveryType;
  deliveryContent?: string;
  deliveryMessage?: string;
}

export interface UpdateProductDto {
  name?: string;
  description?: string;
  price?: number;
  category?: string;
  imageUrl?: string;
  isAvailable?: boolean;
  stockCount?: number;
  deliveryType?: DeliveryType;
  deliveryContent?: string;
  deliveryMessage?: string;
}

export interface OrderFilterDto {
  status?: OrderStatus;
  orderType?: OrderType;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

// ─── Queue Job Payloads ───────────────────────────────────────────────────────

export interface InteractiveButton {
  id: string;
  title: string;
}

export interface InteractiveListRow {
  id: string;
  title: string;
  description?: string;
}

export interface InteractiveListSection {
  title: string;
  rows: InteractiveListRow[];
}

export interface WhatsAppMessageJob {
  to: string;
  message: string;
  buttons?: InteractiveButton[];
  /** When set, sends a WhatsApp list message instead of a plain text or button message */
  listSections?: InteractiveListSection[];
  /** The button label on the list message (max 20 chars). Required when listSections is set. */
  listButtonText?: string;
  /** Optional header text for the list message */
  listHeader?: string;
}

export interface IncomingMessageJob {
  from: string;
  message: string;
  vendorWhatsAppNumber: string;
  messageId: string;
  timestamp: string;
}

export interface PaymentProcessingJob {
  paystackReference: string;
  event: string;
}

/** Job payload for delivering a digital product to a customer */
export interface DigitalDeliveryJob {
  orderId: string;
  customerPhone: string;
  vendorPhone: string;
  /** Vendor DB id — used to fan-out the sale notification to all active notification numbers */
  vendorId?: string;
  productName: string;
  deliveryContent: string;
  deliveryMessage: string;
  /** Customer's chosen language — defaults to 'en' if absent */
  language?: string;
}
