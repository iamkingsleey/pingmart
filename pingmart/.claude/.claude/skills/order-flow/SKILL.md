# Order Flow Skill — Pingmart

## Overview
The customer order flow is the core commerce journey — from landing on a vendor's store to receiving an order confirmation. It must be smooth, fast, and handle edge cases gracefully.

## File Location
`src/services/router.service.ts` — state routing
`src/repositories/order.repository.ts` — order persistence
`src/services/whatsapp/templates.ts` — message templates

## Full Customer Journey

```
Store link tap → LANGUAGE_SELECT → IDLE (store welcome) → BROWSING (menu)
→ ORDERING (item + quantity) → CART_REVIEW → AWAITING_PAYMENT
→ [Paystack: COMPLETE] or [Bank Transfer: AWAITING_TRANSFER_CONFIRMATION → COMPLETE]
```

## State Handlers

### LANGUAGE_SELECT
- Shown only on first ever message from this phone number
- Display all 5 languages simultaneously
- After selection, save `session.language` and proceed to store welcome

### IDLE — Store Welcome
When a customer first arrives at a vendor store (via store code):
1. Show vendor's `welcomeMessage` (if set) or default greeting
2. Show business hours (if outside hours, show off-hours message)
3. Show menu summary (categories only, not full list)
4. Prompt: "Reply MENU to browse or type what you want"

### BROWSING — Menu Display
Format menu grouped by category:
```
🍽️ *Mama Tee's Kitchen*

🍚 Rice Dishes
1. Jollof Rice (Large) — ₦2,500
2. Fried Rice — ₦2,500

🍗 Proteins
3. Grilled Chicken (Half) — ₦3,500

🥤 Drinks
4. Chapman (Large) — ₦800

Type a number or product name to order
```

- Products numbered sequentially across categories
- Numbers are positional — do NOT use database IDs as display numbers
- Keep menu under 4096 chars (WhatsApp limit). If over limit, paginate with "Reply MORE for more"

### ORDERING — Item Selection
When customer selects an item:
1. Confirm the item name and price
2. Ask for quantity: "How many would you like?"
3. Optionally ask for special instructions if vendor has `specialInstructions` set

After quantity received:
- Add to `session.cartItems`
- Ask: "Anything else? Type MENU to add more or CART to review your order"
- Do NOT auto-advance to cart review — let customer keep adding

### CART_REVIEW
Show full cart with line totals:
```
🛒 *Your Order*

2x Jollof Rice (Large) — ₦5,000
1x Chapman (Large) — ₦800

*Total: ₦5,800*

Reply:
✅ *CONFIRM* — place order
✏️ *EDIT* — change items
❌ *CANCEL* — cancel order
```

### AWAITING_PAYMENT
Show available payment methods for this vendor:
- If `paystack`: Generate Paystack payment link
- If `bank_transfer`: Show bank name, account number, account name
- If `both`: Let customer choose

For bank transfer, send vendor a notification immediately with order details.

### Order Confirmation to Customer
```
✅ *Order Confirmed!*

Order #PM-00123
2x Jollof Rice — ₦5,000
1x Chapman — ₦800
Total: ₦5,800

We've notified Mama Tee's Kitchen. You'll receive an update soon! 🎉
```

### Order Notification to Vendor
Send to ALL numbers in `VendorNotificationNumber` table:
```
🔔 *New Order!*

Order #PM-00123
Customer: Ada (+234801...)

2x Jollof Rice (Large) — ₦5,000
1x Chapman (Large) — ₦800

*Total: ₦5,800*
Payment: Bank Transfer

Reply CONFIRM-00123 or REJECT-00123
```

## Cart Data Structure
```typescript
interface CartItem {
  productId: string;
  name: string;        // denormalized for display
  quantity: number;
  unitPrice: number;   // in kobo
  note?: string;       // special instructions
}
```
Stored as JSON in `ConversationSession.cartItems`.

## Order Record Creation
Only create the `Order` DB record when payment is confirmed — not at cart stage.
Order items are created in the same transaction as the order.

## Critical Rules
1. Never auto-select a product — always confirm with the customer before adding to cart
2. Numbers in menu are positional, not DB IDs — rebuild the mapping on each menu render
3. Always show prices in ₦ (naira) to customers — convert from kobo at display time
4. Total must always match sum of line items — never trust client-sent totals
5. Notify ALL vendor notification numbers, not just the primary vendor number
6. Reset session to IDLE after order is complete or cancelled
