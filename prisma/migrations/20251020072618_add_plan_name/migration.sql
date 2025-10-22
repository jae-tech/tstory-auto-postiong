/*
  Warnings:

  - Added the required column `planName` to the `raw_plans` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable: 먼저 NULL 허용으로 컬럼 추가
ALTER TABLE "raw_plans" ADD COLUMN "planName" VARCHAR(255);

-- 기존 데이터에 planId를 planName으로 복사 (임시 값)
UPDATE "raw_plans" SET "planName" = "planId" WHERE "planName" IS NULL;

-- NOT NULL 제약 조건 추가
ALTER TABLE "raw_plans" ALTER COLUMN "planName" SET NOT NULL;
