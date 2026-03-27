/**
 * Paystack API request/response types.
 */

export interface PaystackInitializeRequest {
  email: string;
  amount: number; // kobo
  reference: string;
  callback_url?: string;
  metadata?: Record<string, unknown>;
}

export interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export interface PaystackWebhookPayload {
  event: string;
  data: PaystackTransactionData;
}

export interface PaystackTransactionData {
  id: number;
  domain: string;
  status: 'success' | 'failed' | 'abandoned';
  reference: string;
  amount: number; // kobo
  message: string | null;
  gateway_response: string;
  paid_at: string;
  created_at: string;
  channel: string;
  currency: string;
  customer: {
    id: number;
    first_name: string | null;
    last_name: string | null;
    email: string;
    phone: string | null;
  };
  metadata?: Record<string, unknown>;
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: PaystackTransactionData & { fees: number };
}
