-- ─── WhatsApp Order Bot v2 — Initial Migration ───────────────────────────────
--
-- Creates all tables, enums, and indexes for:
--   - Physical goods vendors (food, fashion, provisions)
--   - Digital product vendors (courses, ebooks, coaching)
--   - Hybrid vendors (both types in one catalog)
--
-- All monetary values in KOBO (integer). Display as ₦ at application layer.
-- Phone numbers in E.164 international format: +2348012345678

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "VendorType" AS ENUM (
    'PHYSICAL_GOODS',
    'DIGITAL_PRODUCTS',
    'HYBRID'
);

CREATE TYPE "ProductType" AS ENUM (
    'PHYSICAL',
    'DIGITAL'
);

CREATE TYPE "DeliveryType" AS ENUM (
    'LINK',
    'FILE'
);

CREATE TYPE "OrderType" AS ENUM (
    'PHYSICAL',
    'DIGITAL'
);

CREATE TYPE "OrderStatus" AS ENUM (
    'PENDING_PAYMENT',
    'PAYMENT_CONFIRMED',
    'CONFIRMED',
    'PREPARING',
    'READY',
    'DELIVERED',
    'DIGITAL_SENT',
    'CANCELLED'
);

CREATE TYPE "ConversationState" AS ENUM (
    'IDLE',
    'BROWSING',
    'ORDERING',
    'AWAITING_ADDRESS',
    'AWAITING_PAYMENT',
    'COMPLETED'
);

-- ─── Vendors ──────────────────────────────────────────────────────────────────

CREATE TABLE "vendors" (
    "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
    "businessName"   TEXT        NOT NULL,
    -- E.164 format, unique — used to route incoming WhatsApp messages
    "whatsappNumber" TEXT        NOT NULL,
    "phoneNumber"    TEXT        NOT NULL,
    "vendorType"     "VendorType" NOT NULL DEFAULT 'PHYSICAL_GOODS',
    -- bcrypt hash of the API key. Raw key shown once at registration only.
    "apiKeyHash"     TEXT        NOT NULL,
    "isActive"       BOOLEAN     NOT NULL DEFAULT TRUE,
    "isVerified"     BOOLEAN     NOT NULL DEFAULT FALSE,
    "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendors_whatsappNumber_key" ON "vendors"("whatsappNumber");

-- ─── Products ─────────────────────────────────────────────────────────────────

CREATE TABLE "products" (
    "id"              TEXT         NOT NULL DEFAULT gen_random_uuid()::TEXT,
    "vendorId"        TEXT         NOT NULL,
    "name"            TEXT         NOT NULL,
    "description"     TEXT,
    -- Price in kobo. ₦1,500 = 150000
    "price"           INTEGER      NOT NULL,
    "category"        TEXT         NOT NULL DEFAULT 'General',
    "productType"     "ProductType" NOT NULL DEFAULT 'PHYSICAL',
    "imageUrl"        TEXT,
    "isAvailable"     BOOLEAN      NOT NULL DEFAULT TRUE,

    -- Physical: null = unlimited stock; 0 = out of stock
    "stockCount"      INTEGER,

    -- Digital-only fields (NULL for physical products)
    "deliveryType"    "DeliveryType",
    -- Cloudinary URL or external link sent to the customer after payment
    "deliveryContent" TEXT,
    -- Custom post-purchase message (e.g. "Welcome aboard! Join our Telegram: ...")
    "deliveryMessage" TEXT,

    "createdAt"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "products_vendorId_idx"              ON "products"("vendorId");
CREATE INDEX "products_vendorId_isAvailable_idx"  ON "products"("vendorId", "isAvailable");
CREATE INDEX "products_vendorId_productType_idx"  ON "products"("vendorId", "productType");

ALTER TABLE "products"
    ADD CONSTRAINT "products_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE;

-- ─── Customers ────────────────────────────────────────────────────────────────

CREATE TABLE "customers" (
    "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
    "whatsappNumber" TEXT        NOT NULL,
    "name"           TEXT,
    "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customers_whatsappNumber_key" ON "customers"("whatsappNumber");

-- ─── Orders ───────────────────────────────────────────────────────────────────

CREATE TABLE "orders" (
    "id"                TEXT         NOT NULL DEFAULT gen_random_uuid()::TEXT,
    "vendorId"          TEXT         NOT NULL,
    "customerId"        TEXT         NOT NULL,
    "orderType"         "OrderType"  NOT NULL DEFAULT 'PHYSICAL',
    "status"            "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    -- Total amount in kobo
    "totalAmount"       INTEGER      NOT NULL,
    -- Delivery address for physical orders (NULL for digital)
    "deliveryAddress"   TEXT,
    "notes"             TEXT,
    -- Unique Paystack reference — used for idempotent webhook processing
    "paystackReference" TEXT         NOT NULL,
    -- Flipped to TRUE after first successful payment webhook to prevent double-processing
    "paymentProcessed"  BOOLEAN      NOT NULL DEFAULT FALSE,
    -- For digital orders: TRUE once the delivery link/file has been sent
    "digitalDelivered"  BOOLEAN      NOT NULL DEFAULT FALSE,
    "createdAt"         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "orders_pkey"               PRIMARY KEY ("id"),
    CONSTRAINT "orders_paystackRef_unique" UNIQUE ("paystackReference")
);

CREATE INDEX "orders_vendorId_idx"   ON "orders"("vendorId");
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");
CREATE INDEX "orders_status_idx"     ON "orders"("status");
CREATE INDEX "orders_orderType_idx"  ON "orders"("orderType");
CREATE INDEX "orders_reference_idx"  ON "orders"("paystackReference");

ALTER TABLE "orders"
    ADD CONSTRAINT "orders_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id");

ALTER TABLE "orders"
    ADD CONSTRAINT "orders_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id");

-- ─── Order Items ──────────────────────────────────────────────────────────────

CREATE TABLE "order_items" (
    "id"        TEXT    NOT NULL DEFAULT gen_random_uuid()::TEXT,
    "orderId"   TEXT    NOT NULL,
    "productId" TEXT    NOT NULL,
    "quantity"  INTEGER NOT NULL,
    -- Price snapshot in kobo at the moment the order was placed.
    -- Preserves historical accuracy even if the product price changes later.
    "unitPrice" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE;

ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id");

-- ─── Conversation Sessions ────────────────────────────────────────────────────

CREATE TABLE "conversation_sessions" (
    "id"             TEXT                NOT NULL DEFAULT gen_random_uuid()::TEXT,
    "whatsappNumber" TEXT                NOT NULL,
    "vendorId"       TEXT                NOT NULL,
    "state"          "ConversationState" NOT NULL DEFAULT 'IDLE',
    -- JSON blob: { cart, pendingProductId, deliveryAddress, activeOrderType, ... }
    "sessionData"    JSONB               NOT NULL DEFAULT '{}',
    "expiresAt"      TIMESTAMPTZ         NOT NULL,
    "updatedAt"      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

    CONSTRAINT "conversation_sessions_pkey" PRIMARY KEY ("id"),
    -- One active session per customer per vendor
    CONSTRAINT "conversation_sessions_whatsapp_vendor_unique"
        UNIQUE ("whatsappNumber", "vendorId")
);

CREATE INDEX "conversation_sessions_whatsappNumber_idx" ON "conversation_sessions"("whatsappNumber");
CREATE INDEX "conversation_sessions_expiresAt_idx"      ON "conversation_sessions"("expiresAt");

ALTER TABLE "conversation_sessions"
    ADD CONSTRAINT "conversation_sessions_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id");

ALTER TABLE "conversation_sessions"
    ADD CONSTRAINT "conversation_sessions_whatsappNumber_fkey"
    FOREIGN KEY ("whatsappNumber") REFERENCES "customers"("whatsappNumber");
