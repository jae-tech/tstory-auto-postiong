/*
  Warnings:

  - You are about to drop the column `planId` on the `raw_plans` table. All the data in the column will be lost.
  - Added the required column `sourceSite` to the `raw_plans` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."raw_plans_planId_idx";

-- DropIndex
DROP INDEX "public"."raw_plans_planId_key";

-- AlterTable
ALTER TABLE "raw_plans" DROP COLUMN "planId",
ADD COLUMN     "detailUrl" VARCHAR(500),
ADD COLUMN     "sourceSite" VARCHAR(100) NOT NULL;

-- CreateIndex
CREATE INDEX "raw_plans_sourceSite_idx" ON "raw_plans"("sourceSite");
