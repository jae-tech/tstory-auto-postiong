-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "raw_plans" (
    "id" SERIAL NOT NULL,
    "planId" VARCHAR(255) NOT NULL,
    "planName" VARCHAR(500) NOT NULL,
    "carrier" VARCHAR(100) NOT NULL,
    "dataAmount" VARCHAR(100),
    "price" INTEGER,
    "promotionEndDate" TIMESTAMP(3),
    "rawData" JSONB NOT NULL,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "crawledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raw_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_queue" (
    "id" SERIAL NOT NULL,
    "rawPlanId" INTEGER,
    "title" VARCHAR(500) NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "tags" TEXT[],
    "status" "PostStatus" NOT NULL DEFAULT 'PENDING',
    "failureLog" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "raw_plans_planId_key" ON "raw_plans"("planId");

-- CreateIndex
CREATE INDEX "raw_plans_planId_idx" ON "raw_plans"("planId");

-- CreateIndex
CREATE INDEX "raw_plans_isProcessed_idx" ON "raw_plans"("isProcessed");

-- CreateIndex
CREATE INDEX "raw_plans_crawledAt_idx" ON "raw_plans"("crawledAt" DESC);

-- CreateIndex
CREATE INDEX "raw_plans_carrier_idx" ON "raw_plans"("carrier");

-- CreateIndex
CREATE INDEX "post_queue_status_idx" ON "post_queue"("status");

-- CreateIndex
CREATE INDEX "post_queue_scheduledAt_idx" ON "post_queue"("scheduledAt");

-- CreateIndex
CREATE INDEX "post_queue_createdAt_idx" ON "post_queue"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "post_queue" ADD CONSTRAINT "post_queue_rawPlanId_fkey" FOREIGN KEY ("rawPlanId") REFERENCES "raw_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
