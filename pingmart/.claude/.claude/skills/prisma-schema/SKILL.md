# Prisma Schema Skill — Pingmart

## Overview
Pingmart uses PostgreSQL via Prisma ORM. The schema supports multi-tenant vendor isolation, financial data integrity, and backward compatibility with v1 (single-vendor) data.

## File Location
`prisma/schema.prisma` — schema definition
`prisma/migrations/` — migration history (never edit these files manually)
`src/repositories/prisma.ts` — shared Prisma client singleton

## Core Models

| Model | Purpose |
|---|---|
| `Vendor` | Store owner — the business on Pingmart |
| `Customer` | Shopper — identified by WhatsApp number |
| `VendorCustomer` | Many-to-many: customer ↔ vendor relationship |
| `Product` | Item in a vendor's catalog |
| `Order` | A confirmed purchase |
| `OrderItem` | Line items within an order |
| `PickupLocation` | Vendor's physical collection branches |
| `ConversationSession` | Bot state per customer per vendor |
| `VendorSetupSession` | Vendor onboarding state |
| `VendorNotificationNumber` | Additional numbers that receive order alerts |
| `OffHoursContact` | Customers who messaged outside working hours |

## Key New Fields (migration 20260329)

**Order:**
- `paymentMethod String?` — 'paystack_transfer' | 'bank_transfer' | 'paystack_link'
- `virtualBankName / virtualAccountNumber / virtualAccountExpiry` — for Paystack Pay with Transfer
- `deliveryType String?` — 'delivery' | 'pickup'
- `pickupLocationId String?` — FK to PickupLocation

**Vendor:**
- `deliveryOptions String` — 'delivery' | 'pickup' | 'both' (default: 'delivery')

**OrderStatus enum new values:** `PAYMENT_PENDING`, `PAID`, `EXPIRED`, `REJECTED`

**PickupLocation model:**
```prisma
model PickupLocation {
  id         String   @id @default(uuid())
  vendorId   String
  name       String
  address    String
  landmark   String?
  city       String
  state      String
  hoursStart String?
  hoursEnd   String?
  isActive   Boolean  @default(true)
  vendor     Vendor   @relation(...)
  orders     Order[]
}
```

## Multi-Tenant Isolation Rules
Every query that involves customer data MUST be scoped to a vendor:

```typescript
// CORRECT — scoped to vendor
const session = await prisma.conversationSession.findFirst({
  where: { phone: customerPhone, vendorId: vendor.id }
});

// WRONG — could return another vendor's customer session
const session = await prisma.conversationSession.findFirst({
  where: { phone: customerPhone }
});
```

**Never query orders, sessions, or products without a vendorId filter.**

## Monetary Values — ALWAYS Kobo
```
All prices, totals, and amounts are stored as INTEGER in KOBO.
₦1,500 → stored as 150000 (kobo)
```

Convert at the application layer — never store naira floats.

```typescript
// Storing
const priceKobo = Math.round(priceNaira * 100);

// Displaying
const priceDisplay = `₦${(priceKobo / 100).toLocaleString('en-NG')}`;
```

## Adding a New Field to Existing Model

1. Add the field to `schema.prisma` with a sensible default (required for non-nullable fields on tables with existing data)
2. Run `npx prisma migrate dev --name describe_the_change`
3. Update the relevant repository type definitions
4. Update any service that creates/updates that model
5. Do NOT use `prisma migrate reset` in production — it drops all data

```prisma
// Good — has a default so existing rows are backfilled
newField  String  @default("default_value")

// Risky — requires all existing rows to have a value
newField  String  // nullable alternative: String?
```

## Adding a New Model

1. Define the model in `schema.prisma`
2. Add relations to existing models if needed
3. Run `npx prisma migrate dev --name add_model_name`
4. Run `npx prisma generate` to update the Prisma client types
5. Create a repository file: `src/repositories/modelname.repository.ts`
6. Never write raw SQL queries — use Prisma's type-safe query builder

## Prisma Client Singleton
Always import from the shared singleton — never instantiate `new PrismaClient()` in service files:

```typescript
// CORRECT
import { prisma } from '../repositories/prisma';

// WRONG — creates connection pool leak
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
```

## Transactions
Use transactions for any operation that modifies multiple tables:

```typescript
await prisma.$transaction([
  prisma.order.create({ data: orderData }),
  prisma.orderItem.createMany({ data: itemsData }),
  prisma.conversationSession.update({ where: { id }, data: { state: 'COMPLETE', cartItems: [] } }),
]);
```

## Sensitive Fields — Encrypted at Rest
These fields are ALWAYS stored encrypted (AES-256-GCM) — never plaintext:
- `Vendor.paystackSecretKey`
- `Vendor.bankAccountNumber`

If you add new sensitive fields, run them through `encryptBankAccount()` / `decryptBankAccount()` in `src/utils/crypto.ts`.

## v1 ↔ v2 Backward Compatibility
The schema has both v1 fields (single-vendor era) and v2 fields (multi-tenant):
- `Vendor.whatsappNumber` — v1 primary identifier (kept for compatibility)
- `Vendor.ownerPhone` — v2 vendor management number (new)
- `Vendor.storeCode` — v2 store routing code (new)

Do NOT remove v1 fields until a full data migration is complete and verified.

## Production Migration
On Railway, migrations run automatically on deploy via:
```
npx prisma migrate deploy
```
This runs pending migrations only — never destructive unless the migration itself is.

## Prisma Studio (local only)
```
npm run studio
```
Opens a GUI at localhost:5555 to browse and edit data. Never run in production.
