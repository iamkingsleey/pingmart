# Payment Handler Skill — Pingmart

## Overview
Pingmart supports two payment methods: Paystack (card/bank transfer via Paystack) and direct bank transfer. Each vendor can accept one or both. Payment logic must be secure, atomic, and never expose sensitive data.

## File Location
`src/services/payment/` — payment service logic
`src/webhooks/paystack.webhook.ts` — Paystack webhook handler
`src/repositories/order.repository.ts` — order status updates

## Payment Methods

### 1. Paystack
Vendors provide their own `sk_live_` or `sk_test_` key during onboarding.
- Stored AES-256-GCM encrypted in `vendor.paystackSecretKey`
- Decrypt at runtime, use to initialize Paystack transaction
- Each transaction is tied to a specific order ID
- Payment confirmed via Paystack webhook (NOT by trusting client response)

**Flow:**
```
Generate payment link → Customer pays → Paystack webhook fires →
Verify signature → Update order status → Notify vendor + customer
```

**Never confirm payment without webhook verification.** Customers can forge redirect URLs.

### 2. Direct Bank Transfer
Vendor provides: bank name, account number, account name.
- Account number stored AES-256-GCM encrypted in `vendor.bankAccountNumber`
- Displayed to customer at checkout (decrypted at display time)
- Payment confirmation is MANUAL — vendor must confirm receipt

**Flow:**
```
Show bank details to customer → Customer transfers → Customer notifies bot →
Bot notifies vendor → Vendor confirms via CONFIRM-{orderID} reply
```

## Paystack Webhook Verification
ALWAYS verify the `x-paystack-signature` header before processing:

```typescript
import crypto from 'crypto';

function verifyPaystackSignature(payload: string, signature: string, secret: string): boolean {
  const hash = crypto
    .createHmac('sha512', secret)
    .update(payload)
    .digest('hex');
  return hash === signature;
}
```

Reject any webhook that fails signature verification with 400. Log the attempt.

## Encryption / Decryption
All sensitive payment data uses AES-256-GCM:

```typescript
// File: src/utils/crypto.ts
// Key loaded from ENCRYPTION_KEY env variable (64-char hex = 32 bytes)

export function encryptBankAccount(plaintext: string): string { ... }
export function decryptBankAccount(ciphertext: string): string { ... }
```

**Rules:**
- Encrypt BEFORE saving to DB
- Decrypt ONLY at the moment of display — never store decrypted value in memory longer than needed
- Never log decrypted payment data
- Never return decrypted account numbers in API responses

## Order Status Lifecycle
```
PENDING → PAYMENT_PENDING → PAID → CONFIRMED → COMPLETED
                         ↓
                      CANCELLED / REJECTED
```

Status transitions must be atomic DB updates with timestamp logging.

## Adding a New Payment Method (e.g. Flutterwave)
1. Add `flutterwaveSecretKey` field to Vendor model in Prisma schema
2. Add `flutterwave` as an option in `acceptedPayments` field
3. Encrypt key same way as Paystack key
4. Add Flutterwave webhook handler at `/webhooks/flutterwave`
5. Add signature verification before any processing
6. Update vendor onboarding PAYMENT_SETUP step to offer Flutterwave
7. Update the `payment-handler` SKILL.md with new method details

## Refund Handling
Refunds are currently manual (vendor-initiated). If a refund is requested:
1. Vendor or admin triggers refund via Paystack dashboard directly
2. Bot does not handle refunds automatically yet
3. Log refund requests in the Order record as a note

## Nigerian Bank Codes Reference
Common Nigerian banks for bank transfer setup:
- GTBank: 058
- Access Bank: 044
- Zenith Bank: 057
- First Bank: 011
- UBA: 033
- Kuda: 090267
- OPay: 100004
- Moniepoint: 100022

## Security Checklist Before Touching Payment Code
- [ ] Secrets loaded from env variables only — never hardcoded
- [ ] Webhook signature verified before processing
- [ ] All financial data encrypted at rest
- [ ] No sensitive data in logs
- [ ] Order totals calculated server-side — never trust client-submitted amounts
- [ ] Payment status updated only after webhook confirmation — never on redirect
