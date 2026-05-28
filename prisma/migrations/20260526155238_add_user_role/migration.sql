/*
  Warnings:

  - Added the required column `role` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `roleLabel` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MERCHANDISER', 'PROMOTER', 'DBSR', 'VSR', 'SALES_REPRESENTATIVE', 'SSR', 'ATSM', 'TSM', 'ZONAL_SALES_MANAGER', 'SALES_HEAD', 'SYSTEM_ADMIN', 'WAREHOUSE_ADMIN', 'GENERAL_MANAGER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL,
ADD COLUMN     "roleLabel" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");
