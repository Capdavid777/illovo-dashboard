/*
  Warnings:

  - You are about to drop the column `targetRevenue` on the `DailyMetric` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "DailyMetric" DROP COLUMN "targetRevenue",
ADD COLUMN     "target" INTEGER,
ALTER COLUMN "revenue" DROP NOT NULL,
ALTER COLUMN "occupancy" DROP NOT NULL,
ALTER COLUMN "arr" DROP NOT NULL;
