-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'OUT_FOR_DELIVERY';

-- AlterTable
ALTER TABLE "conversation_sessions" ADD COLUMN     "customerId" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "acceptedPayments" TEXT NOT NULL DEFAULT 'both',
ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "businessContext" TEXT,
ADD COLUMN     "businessType" TEXT NOT NULL DEFAULT 'general',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "faqs" TEXT,
ADD COLUMN     "isPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ownerName" TEXT,
ADD COLUMN     "ownerPhone" TEXT,
ADD COLUMN     "paystackSecretKey" TEXT,
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN     "specialInstructions" TEXT,
ADD COLUMN     "storeCode" TEXT,
ADD COLUMN     "subscriptionEndsAt" TIMESTAMP(3),
ADD COLUMN     "welcomeMessage" TEXT;

-- CreateTable
CREATE TABLE "vendor_customers" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "lastOrderAt" TIMESTAMP(3),
    "reorderOptOut" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "vendor_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_setup_sessions" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "step" TEXT NOT NULL DEFAULT 'WELCOME',
    "collectedData" JSONB NOT NULL DEFAULT '{}',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_setup_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_notification_numbers" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_notification_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_customers_vendorId_customerId_key" ON "vendor_customers"("vendorId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_setup_sessions_vendorId_key" ON "vendor_setup_sessions"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_notification_numbers_vendorId_phone_key" ON "vendor_notification_numbers"("vendorId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_storeCode_key" ON "vendors"("storeCode");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_ownerPhone_key" ON "vendors"("ownerPhone");

-- AddForeignKey
ALTER TABLE "vendor_customers" ADD CONSTRAINT "vendor_customers_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_customers" ADD CONSTRAINT "vendor_customers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_setup_sessions" ADD CONSTRAINT "vendor_setup_sessions_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_notification_numbers" ADD CONSTRAINT "vendor_notification_numbers_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

