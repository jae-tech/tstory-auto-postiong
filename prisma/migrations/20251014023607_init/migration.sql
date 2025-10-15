-- CreateEnum
CREATE TYPE "PostType" AS ENUM ('NEW_POST', 'REVISION');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "raw_plans" (
    "id" SERIAL NOT NULL,
    "planId" VARCHAR(255) NOT NULL,
    "dataHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mvno" VARCHAR(100) NOT NULL,
    "network" VARCHAR(50) NOT NULL,
    "technology" VARCHAR(50) NOT NULL,
    "pricePromo" INTEGER NOT NULL,
    "priceOriginal" INTEGER,
    "promotionDurationMonths" INTEGER,
    "promotionEndDate" TIMESTAMP(3),
    "dataBaseGB" DOUBLE PRECISION NOT NULL,
    "dataPostSpeedMbps" INTEGER,
    "talkMinutes" INTEGER NOT NULL,
    "smsCount" INTEGER NOT NULL,
    "benefitSummary" TEXT,

    CONSTRAINT "raw_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranking_snapshots" (
    "id" SERIAL NOT NULL,
    "rankingHash" VARCHAR(64) NOT NULL,
    "analysisDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "topCount" INTEGER NOT NULL DEFAULT 10,
    "analysisData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ranking_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_queue" (
    "id" SERIAL NOT NULL,
    "postType" "PostType" NOT NULL DEFAULT 'NEW_POST',
    "originalPostId" VARCHAR(255),
    "rankingSnapshotId" INTEGER,
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

-- CreateTable
CREATE TABLE "_RankedPlans" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_RankedPlans_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "raw_plans_planId_key" ON "raw_plans"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "raw_plans_dataHash_key" ON "raw_plans"("dataHash");

-- CreateIndex
CREATE INDEX "raw_plans_planId_idx" ON "raw_plans"("planId");

-- CreateIndex
CREATE INDEX "raw_plans_dataHash_idx" ON "raw_plans"("dataHash");

-- CreateIndex
CREATE INDEX "raw_plans_mvno_idx" ON "raw_plans"("mvno");

-- CreateIndex
CREATE INDEX "raw_plans_network_idx" ON "raw_plans"("network");

-- CreateIndex
CREATE INDEX "raw_plans_technology_idx" ON "raw_plans"("technology");

-- CreateIndex
CREATE INDEX "raw_plans_pricePromo_idx" ON "raw_plans"("pricePromo");

-- CreateIndex
CREATE INDEX "raw_plans_createdAt_idx" ON "raw_plans"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ranking_snapshots_rankingHash_key" ON "ranking_snapshots"("rankingHash");

-- CreateIndex
CREATE INDEX "ranking_snapshots_rankingHash_idx" ON "ranking_snapshots"("rankingHash");

-- CreateIndex
CREATE INDEX "ranking_snapshots_analysisDate_idx" ON "ranking_snapshots"("analysisDate" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "post_queue_rankingSnapshotId_key" ON "post_queue"("rankingSnapshotId");

-- CreateIndex
CREATE INDEX "post_queue_status_idx" ON "post_queue"("status");

-- CreateIndex
CREATE INDEX "post_queue_postType_idx" ON "post_queue"("postType");

-- CreateIndex
CREATE INDEX "post_queue_scheduledAt_idx" ON "post_queue"("scheduledAt");

-- CreateIndex
CREATE INDEX "post_queue_createdAt_idx" ON "post_queue"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "_RankedPlans_B_index" ON "_RankedPlans"("B");

-- AddForeignKey
ALTER TABLE "post_queue" ADD CONSTRAINT "post_queue_rankingSnapshotId_fkey" FOREIGN KEY ("rankingSnapshotId") REFERENCES "ranking_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RankedPlans" ADD CONSTRAINT "_RankedPlans_A_fkey" FOREIGN KEY ("A") REFERENCES "ranking_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RankedPlans" ADD CONSTRAINT "_RankedPlans_B_fkey" FOREIGN KEY ("B") REFERENCES "raw_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
