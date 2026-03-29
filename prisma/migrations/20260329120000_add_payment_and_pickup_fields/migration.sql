-- Migration: add_payment_and_pickup_fields
-- Adds virtual account fields, payment method, new order statuses,
-- pickup locations model, and delivery options to vendor.

-- ─── OrderStatus enum — new values ──────────────────────────────────────────
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_PENDING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PAID';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- ─── Order — new payment and pickup fields ───────────────────────────────────
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "paymentMethod"        TEXT,
  ADD COLUMN IF NOT EXISTS "virtualBankName"       TEXT,
  ADD COLUMN IF NOT EXISTS "virtualAccountNumber"  TEXT,
  ADD COLUMN IF NOT EXISTS "virtualAccountExpiry"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveryType"          TEXT,
  ADD COLUMN IF NOT EXISTS "pickupLocationId"      TEXT;

-- ─── Vendor — delivery options ───────────────────────────────────────────────
ALTER TABLE "vendors"
  ADD COLUMN IF NOT EXISTS "deliveryOptions" TEXT NOT NULL DEFAULT 'delivery';

-- ─── PickupLocation ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pickup_locations" (
  "id"         TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "vendorId"   TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "address"    TEXT NOT NULL,
  "landmark"   TEXT,
  "city"       TEXT NOT NULL,
  "state"      TEXT NOT NULL,
  "hoursStart" TEXT,
  "hoursEnd"   TEXT,
  "isActive"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pickup_locations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "pickup_locations"
  ADD CONSTRAINT "pickup_locations_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_pickupLocationId_fkey"
  FOREIGN KEY ("pickupLocationId") REFERENCES "pickup_locations"("id")
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "pickup_locations_vendorId_isActive_idx"
  ON "pickup_locations"("vendorId", "isActive");
