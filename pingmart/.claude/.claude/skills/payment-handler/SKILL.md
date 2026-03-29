# Payment Handler Skill — Pingmart

## Overview
Pingmart supports three payment methods: Paystack Pay with Transfer (virtual account), Paystack Link (card), and manual Bank Transfer. Each vendor chooses their preferred method during onboarding. Payment logic is secure, atomic, and never exposes sensitive data.

## File Locations
- `src/services/payment/paystack.service.ts` — Paystack API calls (initialize, verify, createDedicatedVirtualAccount)
- `src/webhooks/paystack.webhook.ts` — Paystack webhook handler
- `src/repositories/order.repository.ts` — order status updates
- `src/queues/paymentTimeout.queue.ts` — 30-min virtual account expiry queue
- `src/queues/workers/paymentTimeout.worker.ts` — expiry job processor
- `src/services/delivery/physicalDelivery.service.ts` — vendor CONFIRM_BANK / REJECT_BANK commands

## Payment Methods

### 1. Paystack Pay with Transfer (Virtual Account) — `paystack_transfer`
Vendor uses their Paystack secret key. Each order gets a dedicated virtual bank account.

**Flow:**
```
Cart confirmed → createDedicatedVirtualAccount() → Store account on Order →
Send msgPayWithTransferDetails to customer → Schedule 30-min timeout job →
Paystack webhook fires (channel: dedicated_nuban) → findByVirtualAccount() →
markPaymentProcessed() → enqueue payment job → handlePaymentConfirmed()
```

**Timeout flow:**
```
30 minutes elapse, no payment → paymentTimeout worker fires →
expirePaymentPending() → order → EXPIRED → msgTransferPaymentExpired (with buttons)
```

**Key point:** The `dedicated_nuban` webhook does NOT include our `paystackReference`. Look up the order via `virtualAccountNumber` instead.

### 2. Paystack Link (card / regular bank transfer) — `paystack_link`
Used for digital products and as fallback if virtual account creation fails.

**Flow:**
```
initializeTransaction() → Send payment URL → Customer pays →
Paystack webhook fires (charge.success, standard channel) →
findByPaystackReference() → markPaymentProcessed() → handlePaymentConfirmed()
```

### 3. Manual Bank Transfer — `bank_transfer`
Vendor provides bank name, account number (AES-256-GCM encrypted), account name.

**Flow:**
```
Cart confirmed → Decrypt account number → msgBankTransferInstructions → order → PAYMENT_PENDING →
Customer transfers, replies PAID → Bot notifies vendor with CONFIRM/REJECT buttons (msgVendorBankTransferClaim) →
Vendor replies CONFIRM_BANK ORD-XXXXX → markBankTransferPaid() → handlePaymentConfirmed() →
OR vendor replies REJECT_BANK ORD-XXXXX → rejectBankTransfer() → msgBankTransferRejected → customer
```

**Vendor commands:**
- `CONFIRM_BANK ORD-XXXXXX` → confirms payment received
- `REJECT_BANK ORD-XXXXXX` → rejects payment claim

## Payment Method Selection Logic (order.service.ts)
```typescript
// Digital orders always use paystack_link
if (orderType === DIGITAL) → 'paystack_link'

// Physical: prefer paystack_transfer if vendor has Paystack key
else if (vendor.paystackSecretKey && vendor.acceptedPayments !== 'bank') → 'paystack_transfer'
else if (vendor.bankAccountNumber) → 'bank_transfer'
else → 'paystack_link' // fallback
```

## Vendor Onboarding — Payment Setup
During onboarding (PAYMENT_SETUP step), vendor is shown Reply Buttons:
- ⚡ Paystack Transfer → asks for `sk_live_` / `sk_test_` key
- 🏦 Bank Transfer → asks for `Bank Name | Account Number | Account Name`

Button IDs: `PAYMENT_METHOD:paystack_transfer` and `PAYMENT_METHOD:bank_transfer`

## Paystack Webhook Verification
ALWAYS verify `x-paystack-signature` before processing:
```typescript
import crypto from 'crypto';
function verifyPaystackSignature(payload: Buffer, signature: string, secret: string): boolean {
  const hash = crypto.createHmac('sha512', secret).update(payload).digest('hex');
  return hash === signature;
}
```
Reject any webhook that fails with 401.

## Dedicated Account Lookup
```typescript
// For dedicated_nuban webhooks (no reference in payload):
const accountNumber = payload.data.authorization?.receiver_bank_account_number;
const order = await orderRepository.findByVirtualAccount(accountNumber);
```

## Encryption / Decryption
All sensitive payment data uses AES-256-GCM (`src/utils/crypto.ts`):
- `encryptBankAccount(plaintext, keyHex)` → `iv:authTag:ciphertext`
- `decryptBankAccount(encrypted, keyHex)` → plaintext

**Rules:**
- Encrypt BEFORE saving to DB
- Decrypt ONLY at display time — never log decrypted values
- Never return decrypted account numbers in API responses

## Order Status Lifecycle
```
PENDING_PAYMENT   → Order created (default)
PAYMENT_PENDING   → Virtual account / bank transfer setup, awaiting payment
PAID              → Bank transfer confirmed by vendor
PAYMENT_CONFIRMED → Paystack webhook confirmed (card/link payments)
CONFIRMED         → Vendor accepted the order
PREPARING         → Vendor is preparing
READY             → Ready for pickup/delivery
OUT_FOR_DELIVERY  → On the way
DELIVERED         → Physically delivered
DIGITAL_SENT      → Digital product sent
CANCELLED         → Cancelled
EXPIRED           → 30-min virtual account window elapsed
REJECTED          → Vendor rejected bank transfer claim
```

## Security Checklist Before Touching Payment Code
- [ ] Secrets loaded from env variables only — never hardcoded
- [ ] Webhook signature verified before any processing
- [ ] All financial data encrypted at rest (AES-256-GCM)
- [ ] No sensitive data in logs (use maskPhone, maskReference)
- [ ] Order totals calculated server-side — never trust client amounts
- [ ] Payment status updated only after webhook/vendor confirmation
- [ ] Idempotency guard (markPaymentProcessed) prevents double-processing

## Nigerian Bank Codes Reference
- GTBank: 058 | Access Bank: 044 | Zenith Bank: 057 | First Bank: 011
- UBA: 033 | Kuda: 090267 | OPay: 100004 | Moniepoint: 100022

## Paystack Test Mode Guide
1. Use `sk_test_*` key during onboarding
2. For virtual account: preferred_bank is automatically set to `test-bank` for test keys
3. Use Paystack Transfer Simulator: Dashboard → Tools → Transfer Simulator
4. Test `charge.success` webhook: Dashboard → API & Webhooks → Send Test Event
5. For `dedicated_nuban` channel: use Transfer Simulator → pick the virtual account number
6. Verify webhook locally with ngrok: `ngrok http 3001` then set webhook URL in Paystack Dashboard
7. Check signature with PAYSTACK_WEBHOOK_SECRET from your .env (separate from secret key)
