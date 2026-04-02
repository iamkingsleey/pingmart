-- CreateTable
CREATE TABLE "booking_reminders" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerPhone" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "reminderTime" TIMESTAMP(3) NOT NULL,
    "appointmentTime" TIMESTAMP(3) NOT NULL,
    "bullJobId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pidgin_learning_log" (
    "id" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "inferredMeaning" TEXT,
    "context" TEXT,
    "sessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pidgin_learning_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_reminders_bookingId_idx" ON "booking_reminders"("bookingId");

-- CreateIndex
CREATE INDEX "booking_reminders_sent_reminderTime_idx" ON "booking_reminders"("sent", "reminderTime");

-- CreateIndex
CREATE INDEX "pidgin_learning_log_status_idx" ON "pidgin_learning_log"("status");

-- CreateIndex
CREATE INDEX "pidgin_learning_log_createdAt_idx" ON "pidgin_learning_log"("createdAt");

-- AddForeignKey
ALTER TABLE "booking_reminders" ADD CONSTRAINT "booking_reminders_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
