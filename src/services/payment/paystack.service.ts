/**
 * Paystack payment service — transaction initialization and verification.
 */
import fetch from 'node-fetch';
import { env } from '../../config/env';
import { PAYSTACK_BASE_URL } from '../../config/constants';
import { logger, maskReference } from '../../utils/logger';
import { PaystackInitializeRequest, PaystackInitializeResponse, PaystackVerifyResponse } from '../../types/paystack';

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
