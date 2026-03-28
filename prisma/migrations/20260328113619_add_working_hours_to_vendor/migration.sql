-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "acceptOffHoursOrders" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timezone" TEXT DEFAULT 'Africa/Lagos',
ADD COLUMN     "workingDays" TEXT DEFAULT '1,2,3,4,5,6',
ADD COLUMN     "workingHoursEnd" TEXT DEFAULT '21:00',
ADD COLUMN     "workingHoursStart" TEXT DEFAULT '08:00';

-- CreateTable
CREATE TABLE "off_hours_contacts" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "contactedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedOpen" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "off_hours_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "off_hours_contacts_vendorId_notifiedOpen_idx" ON "off_hours_contacts"("vendorId", "notifiedOpen");

-- CreateIndex
CREATE INDEX "off_hours_contacts_vendorId_contactedAt_idx" ON "off_hours_contacts"("vendorId", "contactedAt");

-- AddForeignKey
ALTER TABLE "off_hours_contacts" ADD CONSTRAINT "off_hours_contacts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
