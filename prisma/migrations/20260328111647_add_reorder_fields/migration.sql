-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "reorderOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "reorderSentAt" TIMESTAMP(3);
