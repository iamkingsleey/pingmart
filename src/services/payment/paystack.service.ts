/**
 * Paystack payment service — transaction initialization and verification.
 */
import fetch from 'node-fetch';
import { env } from '../../config/env';
import { PAYSTACK_BASE_URL } from '../../config/constants';
import { logger, maskReference } from '../../utils/logger';
import {
  PaystackInitializeRequest,
  PaystackInitializeResponse,
  PaystackVerifyResponse,
  PaystackDedicatedAccountRequest,
  PaystackDedicatedAccountResponse,
  PaystackCreateCustomerResponse,
} from '../../types/paystack';

const AUTH = `Bearer ${env.PAYSTACK_SECRET_KEY}`;

/**
 * Creates a Paystack payment session and returns the authorization URL.
 * @param email - Customer email (required by Paystack; we use a placeholder)
 * @param amountKobo - Amount in kobo
 * @param reference - Our unique order reference
 */
export async function initializeTransaction(
  email: string,
  amountKobo: number,
  reference: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  logger.info('Initializing Paystack transaction', { reference: maskReference(reference) });

  const body: PaystackInitializeRequest = { email, amount: amountKobo, reference, metadata };
  const res = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error('Paystack initialize failed', { status: res.status, reference: maskReference(reference) });
    throw new Error(`Paystack initialize: ${res.status} — ${err}`);
  }

  const result = (await res.json()) as PaystackInitializeResponse;
  if (!result.status || !result.data?.authorization_url) {
    throw new Error('Paystack returned invalid response');
  }

  logger.info('Paystack transaction initialized', { reference: maskReference(reference) });
  return result.data.authorization_url;
}

/**
 * Creates a Paystack customer (required before assigning a dedicated virtual account).
 * Returns the customer_code needed for the dedicated account call.
 */
async function createOrFetchCustomer(
  email: string,
  phone: string,
  secretKey: string,
): Promise<string> {
  const res = await fetch(`${PAYSTACK_BASE_URL}/customer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, phone, first_name: 'Customer' }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Paystack create customer: ${res.status} — ${err}`);
  }
  const result = (await res.json()) as PaystackCreateCustomerResponse;
  return result.data.customer_code;
}

/**
 * Assigns a dedicated virtual bank account to a customer for this order.
 * The vendor's own Paystack secret key is used (per-vendor key model).
 *
 * @param vendorSecretKey - Vendor's decrypted Paystack secret key
 * @param customerPhone   - Customer phone in E.164 format (+2348012345678)
 * @param orderId         - Used to build a unique placeholder email per order
 * @returns { bankName, accountNumber } to display to the customer
 */
export async function createDedicatedVirtualAccount(
  vendorSecretKey: string,
  customerPhone: string,
  orderId: string,
): Promise<{ bankName: string; accountNumber: string }> {
  logger.info('Creating dedicated virtual account', { order: orderId.slice(-8) });

  const email = `${customerPhone.replace('+', '')}-${orderId.slice(-8)}@orb.placeholder.com`;
  const customerCode = await createOrFetchCustomer(email, customerPhone, vendorSecretKey);

  // Paystack test-mode bank is 'test-bank'; live uses 'wema-bank' or 'titan-paystack'
  const preferredBank = vendorSecretKey.startsWith('sk_live_') ? 'wema-bank' : 'test-bank';

  const body: PaystackDedicatedAccountRequest = {
    customer: customerCode,
    preferred_bank: preferredBank,
  };

  const res = await fetch(`${PAYSTACK_BASE_URL}/dedicated_account`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${vendorSecretKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error('Paystack dedicated account failed', { order: orderId.slice(-8), status: res.status });
    throw new Error(`Paystack dedicated account: ${res.status} — ${err}`);
  }

  const result = (await res.json()) as PaystackDedicatedAccountResponse;
  if (!result.status || !result.data?.account_number) {
    throw new Error('Paystack dedicated account: invalid response');
  }

  logger.info('Dedicated virtual account created', { order: orderId.slice(-8) });
  return {
    bankName: result.data.bank.name,
    accountNumber: result.data.account_number,
  };
}

export async function verifyTransaction(
  reference: string,
): Promise<{ success: boolean; amountKobo: number }> {
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: AUTH } },
  );
  if (!res.ok) throw new Error(`Paystack verify: ${res.status}`);

  const result = (await res.json()) as PaystackVerifyResponse;
  return {
    success: result.status && result.data?.status === 'success',
    amountKobo: result.data?.amount ?? 0,
  };
}
