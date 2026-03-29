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
  PAYMENT_CONFIRMED = 'PAYMENT_CONFIRMED',
  CONFIRMED = 'CONFIRMED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  DELIVERED = 'DELIVERED',
  DIGITAL_SENT = 'DIGITAL_SENT',
  CANCELLED = 'CANCELLED',
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

export interface WhatsAppMessageJob {
  to: string;
  message: string;
  buttons?: InteractiveButton[];
}

export interface InteractiveButton {
  id: string;
  title: string;
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
  productName: string;
  deliveryContent: string;
  deliveryMessage: string;
  /** Customer's chosen language — defaults to 'en' if absent */
  language?: string;
}
