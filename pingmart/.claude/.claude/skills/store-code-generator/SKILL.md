# Store Code Generator Skill — Pingmart

## Overview
Every vendor on Pingmart gets a unique store code. This code is embedded in a WhatsApp deep link that customers tap to land directly on that vendor's store. It is the core routing mechanism for the single-number multi-vendor architecture.

## How It Works
```
Vendor "Mama Tee's Kitchen" → storeCode: "MAMATEE"
Deep link: https://wa.me/2348XXXXXXXXX?text=MAMATEE
Customer taps link → WhatsApp opens with "MAMATEE" pre-filled → bot routes to Mama Tee's store
```

## File Location
Store code generation lives in `src/services/vendor-onboarding.service.ts`
Store code lookup lives in `src/services/router.service.ts` (incoming message routing)

## Generation Rules

### Algorithm
1. Take the business name
2. Remove special characters, spaces, punctuation
3. Convert to UPPERCASE
4. Take first 8 characters max
5. Check DB for uniqueness
6. If taken, append a 2-digit number suffix: `MAMATEE01`, `MAMATEE02`

```typescript
function generateStoreCode(businessName: string): string {
  return businessName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')  // remove non-alphanumeric
    .substring(0, 8);            // max 8 chars
}
```

### Uniqueness Check
```typescript
async function ensureUniqueCode(baseCode: string): Promise<string> {
  let code = baseCode;
  let suffix = 1;

  while (await prisma.vendor.findUnique({ where: { storeCode: code } })) {
    code = `${baseCode.substring(0, 6)}${String(suffix).padStart(2, '0')}`;
    suffix++;
  }
  return code;
}
```

### Rules
- Minimum 3 characters, maximum 8 characters
- Only uppercase letters and digits: `[A-Z0-9]`
- No spaces, hyphens, underscores, or special characters
- Must be globally unique across ALL vendors
- Case-insensitive on input: customer can type `mamatee` or `MAMATEE` — normalize to uppercase before lookup

## Incoming Message Routing
When a customer sends a message, the router checks if it matches a store code:

```typescript
// Normalize incoming message before checking
const normalized = message.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const vendor = await prisma.vendor.findUnique({ where: { storeCode: normalized } });
if (vendor) {
  // Route to this vendor's store
}
```

This means customers can type the code with spaces, lowercase, or minor typos — always normalize first.

## Deep Link Format
```
https://wa.me/{E164_NUMBER_WITHOUT_PLUS}?text={STORECODE}
```

Example:
```
https://wa.me/2348012345678?text=MAMATEE
```

Note: `wa.me` links use the number WITHOUT the `+` prefix.

## Vendor Instructions After Going Live
After store code is assigned, send the vendor:
```
🎉 Your store is live!

Your store code: *MAMATEE*

Share this link with customers:
https://wa.me/2348XXXXXXXXX?text=MAMATEE

Add it to your:
• Instagram bio
• WhatsApp status
• Business card
• Any social media

Customers who tap the link will land directly on your store. 🛍️
```

## Store Code Changes
Vendors should NOT change their store code after going live — existing links shared with customers will break. If a name change is needed, advise the vendor to create a new listing.

If a store code MUST be changed:
1. Update `vendor.storeCode` in DB
2. Send vendor a message with the new link
3. Log the change with old and new code for audit purposes
