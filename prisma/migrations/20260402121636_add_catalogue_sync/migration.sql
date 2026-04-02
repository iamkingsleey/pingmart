-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "whatsappCatalogueId" TEXT;

-- CreateTable
CREATE TABLE "catalogue_sync_logs" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "whatsappProductId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "lastSyncedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalogue_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalogue_sync_logs_vendorId_syncStatus_idx" ON "catalogue_sync_logs"("vendorId", "syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "catalogue_sync_logs_vendorId_productId_key" ON "catalogue_sync_logs"("vendorId", "productId");

-- AddForeignKey
ALTER TABLE "catalogue_sync_logs" ADD CONSTRAINT "catalogue_sync_logs_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue_sync_logs" ADD CONSTRAINT "catalogue_sync_logs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
