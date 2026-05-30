/*
  Warnings:

  - You are about to drop the column `annualTargets` on the `User` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "AccountOrigin" AS ENUM ('SELF_REGISTERED', 'PROVISIONED');

-- CreateEnum
CREATE TYPE "TargetPeriod" AS ENUM ('ANNUAL', 'QUARTERLY', 'MONTHLY', 'WEEKLY');

-- AlterTable
ALTER TABLE "User" DROP COLUMN "annualTargets",
ADD COLUMN     "accountOrigin" "AccountOrigin" NOT NULL DEFAULT 'SELF_REGISTERED',
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "provisionedById" TEXT,
ALTER COLUMN "team" DROP NOT NULL,
ALTER COLUMN "region" DROP NOT NULL,
ALTER COLUMN "state" DROP NOT NULL,
ALTER COLUMN "dateOfBirth" DROP NOT NULL;

-- CreateTable
CREATE TABLE "TargetAssignment" (
    "id" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedToId" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "period" "TargetPeriod" NOT NULL DEFAULT 'ANNUAL',
    "year" INTEGER NOT NULL,
    "quarter" INTEGER,
    "month" INTEGER,
    "week" INTEGER,
    "targetCartons" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetAssignment_assignedById_idx" ON "TargetAssignment"("assignedById");

-- CreateIndex
CREATE INDEX "TargetAssignment_assignedToId_idx" ON "TargetAssignment"("assignedToId");

-- CreateIndex
CREATE INDEX "TargetAssignment_category_idx" ON "TargetAssignment"("category");

-- CreateIndex
CREATE INDEX "TargetAssignment_year_idx" ON "TargetAssignment"("year");

-- CreateIndex
CREATE UNIQUE INDEX "TargetAssignment_assignedToId_category_period_year_quarter__key" ON "TargetAssignment"("assignedToId", "category", "period", "year", "quarter", "month", "week");

-- CreateIndex
CREATE INDEX "User_accountOrigin_idx" ON "User"("accountOrigin");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_provisionedById_fkey" FOREIGN KEY ("provisionedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetAssignment" ADD CONSTRAINT "TargetAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetAssignment" ADD CONSTRAINT "TargetAssignment_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
