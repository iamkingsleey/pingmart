/**
 * Mono OWO Payment Service
 *
 * Handles all interactions with the Mono OWO API for WhatsApp-native payment requests.
 * Gated behind OWO_PAYMENTS_ENABLED — all functions return safe fallback values when
 * the flag is false, so callers never need to check the flag themselves.
 *
 * API base: https://api.withmono.com/owo/v1
 * Auth:     mono-sec-key header (MONO_SECRET_KEY — never logged)
 *
 * ⚠️  DO NOT activate until MONO_SECRET_KEY and OWO_PAYMENTS_ENABLED=true are set.
 */

import fetch from 'node-fetch';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// ─── Constants ────────────────────────────────────────────────────────────────

const OWO_BASE = 'https://api.withmono.com/owo/v1';

// ─── Types ────────────────────────────────────────────────────────────────────

export type OwoUserStatus = 'ACTIVE' | 'PENDING_ACTIVATION' | 'NOT_FOUND';

export interface OwoBeneficiaryResult {
  beneficiaryId: string;
}

export interface OwoFundRequest {
  id:        string;
  reference: string;
  status:    string;
  amount:    number;
  currency:  string;
}

export interface OwoPayment {
  id:            string;
  fundRequestId: string;
  amount:        number;
  status:        string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Normalises a WhatsApp phone number to the 234XXXXXXXXXX format Mono expects.
 * Strips leading +, replaces local 0 prefix with country code 234.
 */
function normalizePhone(phone: string): string {
  // Remove leading +
  let p = phone.replace(/^\+/, '');
  // Replace leading 0 with 234 (local Nigerian format)
  if (p.startsWith('0')) p = '234' + p.slice(1);
  return p;
}

/**
 * Shared fetch wrapper for OWO API calls.
 * Always uses the mono-sec-key header; never logs the key itself.
 */
async function owoFetch(
  path: string,
  options: { method?: string; body?: object } = {},
): Promise<{ ok: boolean; status: number; data: unknown }> {
  if (!env.MONO_SECRET_KEY) {
    throw new Error('MONO_SECRET_KEY is not set');
  }

  const res = await fetch(`${OWO_BASE}${path}`, {
    method:  options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'mono-sec-key': env.MONO_SECRET_KEY,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { ok: res.ok, status: res.status, data };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks whether a customer has an active OWO account.
 *
 * GET /users/status?phone={234phone}
 *
 * Returns ACTIVE if the customer can receive OWO payment requests.
 * Returns NOT_FOUND if we should silently skip OWO and fall back to other options.
 * Returns PENDING_ACTIVATION if their account exists but isn't fully set up.
 *
 * All errors resolve to NOT_FOUND so callers degrade gracefully.
 */
export async function checkUserStatus(phone: string): Promise<OwoUserStatus> {
  if (!env.OWO_PAYMENTS_ENABLED) return 'NOT_FOUND';

  try {
    const normalised = normalizePhone(phone);
    const { ok, status, data } = await owoFetch(`/users/status?phone=${normalised}`);

    if (!ok) {
      if (status === 404) return 'NOT_FOUND';
      logger.warn('OWO checkUserStatus non-200', { status });
      return 'NOT_FOUND';
    }

    const payload = data as { status?: string };
    const s = (payload?.status ?? '').toUpperCase();

    if (s === 'ACTIVE')             return 'ACTIVE';
    if (s === 'PENDING_ACTIVATION') return 'PENDING_ACTIVATION';
    return 'NOT_FOUND';
  } catch (err) {
    logger.warn('OWO checkUserStatus error — degrading gracefully', {
      error: (err as Error).message,
    });
    return 'NOT_FOUND';
  }
}

/**
 * Links a vendor payout account as a Mono beneficiary.
 *
 * POST /beneficiaries/link
 *
 * Called during vendor onboarding to register their bank account.
 * The returned beneficiary ID should be stored on the Vendor record
 * (vendor.owoBeneficiaryId) for future payouts.
 *
 * @param phone         Vendor WhatsApp number (234 format, no +)
 * @param bvn           Vendor BVN for KYC verification
 * @param accountName   Name on the bank account
 * @param nipCode       NIP bank code (e.g. "044" for Access Bank)
 * @param accountNumber Bank account number
 */
export async function linkVendorBeneficiary(
  phone:         string,
  bvn:           string,
  accountName:   string,
  nipCode:       string,
  accountNumber: string,
): Promise<OwoBeneficiaryResult> {
  if (!env.OWO_PAYMENTS_ENABLED) {
    throw new Error('OWO_PAYMENTS_ENABLED is false');
  }

  const { ok, status, data } = await owoFetch('/beneficiaries/link', {
    method: 'POST',
    body: {
      phone:          normalizePhone(phone),
      bvn,
      account_name:   accountName,
      nip_code:       nipCode,
      account_number: accountNumber,
    },
  });

  if (!ok) {
    logger.error('OWO linkVendorBeneficiary failed', { status });
    throw new Error(`OWO API ${status}: failed to link beneficiary`);
  }

  const payload = data as { data?: { id?: string } };
  const id = payload?.data?.id;
  if (!id) throw new Error('OWO linkVendorBeneficiary: no beneficiary ID in response');

  logger.info('OWO vendor beneficiary linked');
  return { beneficiaryId: id };
}

/**
 * Creates a one-time OWO fund request (payment request to the customer).
 *
 * POST /fund-requests
 *
 * The returned fund request ID must be stored on the order (order.owoFundRequestId)
 * so the Mono webhook can look it up when payment is received.
 *
 * @param phone         Customer's phone number
 * @param orderId       Used as the unique reference (8-32 chars)
 * @param amountNaira   Amount in naira — converted to kobo internally
 * @param description   Human-readable description shown to the customer
 */
export async function initiatePayment(
  phone:       string,
  orderId:     string,
  amountNaira: number,
  description: string,
): Promise<OwoFundRequest> {
  if (!env.OWO_PAYMENTS_ENABLED) {
    throw new Error('OWO_PAYMENTS_ENABLED is false');
  }

  const amountKobo = amountNaira * 100;

  const { ok, status, data } = await owoFetch('/fund-requests', {
    method: 'POST',
    body: {
      type:        'onetime',
      phone:       normalizePhone(phone),
      reference:   orderId,
      amount:      amountKobo,
      currency:    'NGN',
      description,
    },
  });

  if (!ok) {
    logger.error('OWO initiatePayment failed', { status });
    throw new Error(`OWO API ${status}: failed to initiate payment`);
  }

  const payload = data as { data?: OwoFundRequest };
  const fundRequest = payload?.data;
  if (!fundRequest?.id) throw new Error('OWO initiatePayment: no fund request ID in response');

  logger.info('OWO fund request created', { orderId, fundRequestId: fundRequest.id });
  return fundRequest;
}

/**
 * Fetches the current status of an OWO fund request.
 *
 * GET /fund-requests/{id}
 *
 * Use for manual status polling if the webhook is delayed.
 */
export async function getPaymentStatus(fundRequestId: string): Promise<OwoFundRequest | null> {
  if (!env.OWO_PAYMENTS_ENABLED) return null;

  try {
    const { ok, data } = await owoFetch(`/fund-requests/${fundRequestId}`);
    if (!ok) return null;
    const payload = data as { data?: OwoFundRequest };
    return payload?.data ?? null;
  } catch (err) {
    logger.warn('OWO getPaymentStatus error', { fundRequestId, error: (err as Error).message });
    return null;
  }
}

/**
 * Lists all payments made against a fund request.
 *
 * GET /fund-requests/{fundRequestId}/payments
 *
 * Use as a polling fallback to verify completion if the webhook was missed.
 */
export async function getPaymentsByFundRequest(fundRequestId: string): Promise<OwoPayment[]> {
  if (!env.OWO_PAYMENTS_ENABLED) return [];

  try {
    const { ok, data } = await owoFetch(`/fund-requests/${fundRequestId}/payments`);
    if (!ok) return [];
    const payload = data as { data?: OwoPayment[] };
    return payload?.data ?? [];
  } catch (err) {
    logger.warn('OWO getPaymentsByFundRequest error', { fundRequestId, error: (err as Error).message });
    return [];
  }
}
