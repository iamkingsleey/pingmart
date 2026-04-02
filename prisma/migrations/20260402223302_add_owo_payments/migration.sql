-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_OWO_PAYMENT';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "owoFundRequestId" TEXT;

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "owoBeneficiaryId" TEXT;
