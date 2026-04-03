-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "businessCategory" TEXT,
ADD COLUMN     "licenseDocumentType" TEXT,
ADD COLUMN     "licenseDocumentUrl" TEXT,
ADD COLUMN     "licenseExpiryDate" TIMESTAMP(3),
ADD COLUMN     "licenseRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verificationStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
