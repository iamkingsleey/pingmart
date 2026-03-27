/**
 * @file types/index.ts
 * @description TypeScript types matching the Pingmart backend API responses.
 * Mirrors the Prisma schema and backend DTOs exactly.
 */

export type VendorType = 'PHYSICAL_GOODS' | 'DIGITAL_PRODUCTS' | 'HYBRID';
export type ProductType = 'PHYSICAL' | 'DIGITAL';
export type DeliveryType = 'LINK' | 'FILE';
export type OrderType = 'PHYSICAL' | 'DIGITAL';

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_CONFIRMED'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'DELIVERED'
  | 'DIGITAL_SENT'
  | 'CANCELLED';

// ─── Vendor ──────────────────────────────────────────────────────────────────

export interface Vendor {
  id: string;
  businessName: string;
  whatsappNumber: string;
  phoneNumber: string;
  vendorType: VendorType;
  isActive: boolean;
  isVerified?: boolean;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  bankTransferInstructions?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Product ─────────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  vendorId: string;
  name: string;
  description?: string | null;
  price: number; // kobo
  category?: string | null;
  productType: ProductType;
  imageUrl?: string | null;
  isAvailable: boolean;
  stockCount?: number | null;
  deliveryType?: DeliveryType | null;
  deliveryContent?: string | null;
  deliveryMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Customer ────────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  whatsappNumber: string;
  name?: string | null;
}

// ─── Order ───────────────────────────────────────────────────────────────────

export interface OrderItem {
  id: string;
  productId: string;
  product: {
    id: string;
    name: string;
    productType: ProductType;
  };
  quantity: number;
  unitPrice: number; // kobo
}

export interface Order {
  id: string;
  vendorId: string;
  customer: Customer;
  orderType: OrderType;
  status: OrderStatus;
  totalAmount: number; // kobo
  deliveryAddress?: string | null;
  notes?: string | null;
  paystackReference?: string | null;
  paymentProcessed: boolean;
  digitalDelivered: boolean;
  orderItems: OrderItem[];
  createdAt: string;
  updatedAt: string;
}

// ─── API response wrappers ────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: { code: string; message: string };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface UpdateVendorDto {
  businessName?: string;
  phoneNumber?: string;
  isActive?: boolean;
  bankAccountNumber?: string;
}

export interface CreateProductDto {
  name: string;
  description?: string;
  price: number; // kobo
  category?: string;
  productType: ProductType;
  imageUrl?: string;
  isAvailable: boolean;
  stockCount?: number;
  deliveryType?: DeliveryType;
  deliveryContent?: string;
  deliveryMessage?: string;
}

export interface UpdateProductDto {
  name?: string;
  description?: string;
  price?: number; // kobo
  category?: string;
  imageUrl?: string;
  isAvailable?: boolean;
  stockCount?: number;
  deliveryType?: DeliveryType;
  deliveryContent?: string;
  deliveryMessage?: string;
}

export interface OrdersResponse {
  orders: Order[];
  total: number;
}

// ─── Auth stored in localStorage ─────────────────────────────────────────────

export interface AuthState {
  apiKey: string;
  vendorId: string;
}
