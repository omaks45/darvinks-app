-- CreateEnum
CREATE TYPE "TargetCategory" AS ENUM ('CREAM', 'SOAP', 'LOTION', 'MTN', 'SALES', 'COLLECTION');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "TargetAssignment" ADD COLUMN     "isStale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentAssignmentId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "reportsToId" TEXT;

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "region" "Region" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationTarget" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "category" "TargetCategory" NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "targetValue" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_region_idx" ON "Location"("region");

-- CreateIndex
CREATE INDEX "Location_state_idx" ON "Location"("state");

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_state_key" ON "Location"("name", "state");

-- CreateIndex
CREATE INDEX "LocationTarget_periodMonth_idx" ON "LocationTarget"("periodMonth");

-- CreateIndex
CREATE INDEX "LocationTarget_locationId_idx" ON "LocationTarget"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationTarget_locationId_category_periodMonth_key" ON "LocationTarget"("locationId", "category", "periodMonth");

-- CreateIndex
CREATE INDEX "Customer_locationId_idx" ON "Customer"("locationId");

-- CreateIndex
CREATE INDEX "TargetAssignment_parentAssignmentId_idx" ON "TargetAssignment"("parentAssignmentId");

-- CreateIndex
CREATE INDEX "User_reportsToId_idx" ON "User"("reportsToId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetAssignment" ADD CONSTRAINT "TargetAssignment_parentAssignmentId_fkey" FOREIGN KEY ("parentAssignmentId") REFERENCES "TargetAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondarySale" ADD CONSTRAINT "SecondarySale_kdAccountId_fkey" FOREIGN KEY ("kdAccountId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationTarget" ADD CONSTRAINT "LocationTarget_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationTarget" ADD CONSTRAINT "LocationTarget_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
