-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'VOICE', 'IMAGE', 'INTERACTIVE');

-- CreateTable
CREATE TABLE "interaction_logs" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT,
    "customerPhoneMasked" TEXT NOT NULL,
    "sessionId" TEXT,
    "messageType" "MessageType" NOT NULL DEFAULT 'TEXT',
    "rawInput" TEXT NOT NULL,
    "detectedLanguage" TEXT,
    "detectedIntent" TEXT,
    "confidenceScore" DOUBLE PRECISION,
    "resolvedIntent" TEXT,
    "wasCorrect" BOOLEAN,
    "flowState" TEXT,
    "responseTimeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interaction_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "language_patterns" (
    "id" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "exampleInputs" TEXT[],
    "preferredResponse" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "language_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uncertain_interactions" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT,
    "customerPhoneMasked" TEXT NOT NULL,
    "rawInput" TEXT NOT NULL,
    "detectedLanguage" TEXT,
    "suggestedIntent" TEXT,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "flowState" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedIntent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uncertain_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_intelligence" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productIds" TEXT[],
    "language" TEXT,
    "messageCount" INTEGER NOT NULL,
    "askedForHelp" BOOLEAN NOT NULL DEFAULT false,
    "hourOfDay" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_intelligence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interaction_logs_vendorId_createdAt_idx" ON "interaction_logs"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "interaction_logs_detectedLanguage_detectedIntent_idx" ON "interaction_logs"("detectedLanguage", "detectedIntent");

-- CreateIndex
CREATE INDEX "interaction_logs_confidenceScore_idx" ON "interaction_logs"("confidenceScore");

-- CreateIndex
CREATE INDEX "interaction_logs_createdAt_idx" ON "interaction_logs"("createdAt");

-- CreateIndex
CREATE INDEX "language_patterns_language_idx" ON "language_patterns"("language");

-- CreateIndex
CREATE INDEX "language_patterns_useCount_idx" ON "language_patterns"("useCount");

-- CreateIndex
CREATE UNIQUE INDEX "language_patterns_language_intent_key" ON "language_patterns"("language", "intent");

-- CreateIndex
CREATE INDEX "uncertain_interactions_resolved_confidenceScore_idx" ON "uncertain_interactions"("resolved", "confidenceScore");

-- CreateIndex
CREATE INDEX "uncertain_interactions_createdAt_idx" ON "uncertain_interactions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "order_intelligence_orderId_key" ON "order_intelligence"("orderId");

-- CreateIndex
CREATE INDEX "order_intelligence_vendorId_idx" ON "order_intelligence"("vendorId");

-- CreateIndex
CREATE INDEX "order_intelligence_vendorId_hourOfDay_idx" ON "order_intelligence"("vendorId", "hourOfDay");

-- CreateIndex
CREATE INDEX "order_intelligence_productIds_idx" ON "order_intelligence"("productIds");

-- AddForeignKey
ALTER TABLE "interaction_logs" ADD CONSTRAINT "interaction_logs_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uncertain_interactions" ADD CONSTRAINT "uncertain_interactions_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_intelligence" ADD CONSTRAINT "order_intelligence_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
