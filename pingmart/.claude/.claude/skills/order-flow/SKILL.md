# Order Flow Skill — Pingmart

## Overview
The customer order flow is the core commerce journey — from landing on a vendor's store to receiving a payment-confirmed message. Supports physical, digital, and hybrid product types; three payment methods; and delivery or pickup at checkout.

## File Locations
- `src/services/order/order.service.ts` — main message processor + order creation
- `src/services/order/stateMachine.ts` — state transition handlers
- `src/repositories/order.repository.ts` — order persistence
- `src/services/whatsapp/templates.ts` — all message templates
- `src/repositories/pickupLocation.repository.ts` — pickup branch data

## Full Customer Journey

### Physical Orders
```
Store link tap → LANGUAGE_SELECT → IDLE → BROWSING (menu)
→ ORDERING (item + quantity) → AWAITING_ITEM_NOTE? → AWAITING_ADDRESS
→ [Delivery or Pickup choice if vendor has both] → AWAITING_PAYMENT
→ [paystack_transfer: virtual account details + 30-min timeout]
   OR [bank_transfer: bank details, customer sends PAID, vendor confirms]
   OR [paystack_link: payment URL]
→ Payment confirmed → Customer confirmation + Vendor notification → COMPLETED
```

### Digital Orders
```
BROWSING → ORDERING (product detail) → AWAITING_PAYMENT → paystack_link payment URL
→ Paystack webhook → Instant delivery → COMPLETED
```

## Delivery / Pickup Flow

### After cart confirmation (AWAITING_ADDRESS → AWAITING_PAYMENT):
- `vendor.deliveryOptions = 'delivery'` → skip choice, proceed to payment
- `vendor.deliveryOptions = 'pickup'` → show location(s) directly
- `vendor.deliveryOptions = 'both'` → show Reply Buttons: 🚚 Home Delivery | 📍 Pickup at Location

### Pickup location selection:
- 1 active location → confirm automatically
- 2+ locations → WhatsApp List Message (id format: `PICKUP_LOC:<uuid>`)

Session fields set during this flow:
- `awaitingDeliveryChoice: true` while waiting for delivery/pickup choice
- `awaitingPickupChoice: true` while waiting for location selection
- `deliveryType: 'delivery' | 'pickup'`
- `selectedPickupLocationId: string`

## Freemium Pickup Location Limit
```
vendor.plan === 'free' → max 2 active pickup locations
paid plans → unlimited
```
Enforce in pickup location management with `pickupLocationRepository.countActive()`.

## Payment Method Routing (order.service.ts)
```
Digital order → always 'paystack_link'
Physical + vendor.paystackSecretKey + acceptedPayments !== 'bank' → 'paystack_transfer'
Physical + vendor.bankAccountNumber → 'bank_transfer'
Fallback → 'paystack_link'
```

## State Handlers (stateMachine.ts)

### IDLE — Store Welcome
1. Show vendor's `welcomeMessage` or default greeting
2. Check business hours (off-hours = record + return hours message)
3. Show menu summary grouped by category

### BROWSING — Menu Display
```
🏷️ *Category*
1. Product Name — ₦2,500
   _description_
```
Products numbered sequentially across categories.

### ORDERING — Item Selection
1. Confirm item name + price
2. Ask for quantity
3. Ask for special instructions if `specialInstructions` set on vendor

### AWAITING_ADDRESS (physical only)
1. Show cart summary
2. Ask for delivery address
3. Confirm address with YES/NO buttons
4. YES → `shouldCreateOrder = true`

### AWAITING_PAYMENT
Handles customer replies:
- `PAID` → find PAYMENT_PENDING bank_transfer order, send msgVendorBankTransferClaim to vendor
- `DELIVERY` / `PICKUP` → delivery choice (when `awaitingDeliveryChoice`)
- `PICKUP_LOC:<uuid>` → pickup location selected (when `awaitingPickupChoice`)
- `RETRY_ORDER <orderId>` → re-initiate payment after expiry (resets to ORDERING)

## Vendor Notification on New Order
Sent to ALL VendorNotificationNumber records:
```
🔔 NEW ORDER!
Order ID: ORD-XXXXXX
Time: ...
Customer: Name (masked phone)
Items: ...
Total: ₦X,XXX
📍 Delivery to: [dashboard] OR 📍 Pickup at: [Branch Name — Address]
Reply CONFIRM ORD-XXXXX to accept
```
Buttons: ✅ Confirm | ❌ Reject | 📞 Contact Customer

## Cart Data Structure
```typescript
interface CartItem {
  productId: string;
  name: string;       // denormalized snapshot
  quantity: number;
  unitPrice: number;  // in kobo at order time
  note?: string;
}
```

## Order Record — Key Fields
```
paystackReference     unique, used for Paystack webhook lookup
paymentMethod         'paystack_transfer' | 'bank_transfer' | 'paystack_link'
virtualBankName       set for paystack_transfer orders
virtualAccountNumber  set for paystack_transfer orders
virtualAccountExpiry  30 minutes from order creation
deliveryType          'delivery' | 'pickup'
pickupLocationId      FK to PickupLocation (pickup orders only)
```

## Critical Rules
1. Totals always calculated server-side — never trust client amounts
2. Order DB record is created when checkout confirmed (not at cart stage)
3. Digital orders use paystack_link only — no bank transfer
4. Idempotency: markPaymentProcessed() uses conditional updateMany (false→true)
5. Notify ALL vendor notification numbers, not just the primary
6. Phone numbers are always masked in logs: maskPhone()
7. Monetary values stored in kobo — convert to ₦ at display only
