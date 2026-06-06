/*
  Warnings:

  - The values [TIER5_WAREHOUSE] on the enum `UserTier` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "UserTier_new" AS ENUM ('TIER1', 'TIER2', 'TIER3', 'TIER4', 'TIER5_SALES_HEAD', 'TIER5_SYSTEM_ADMIN', 'TIER6_GM', 'WAREHOUSE_ADMIN');
ALTER TABLE "User" ALTER COLUMN "tier" TYPE "UserTier_new" USING ("tier"::text::"UserTier_new");
ALTER TYPE "UserTier" RENAME TO "UserTier_old";
ALTER TYPE "UserTier_new" RENAME TO "UserTier";
DROP TYPE "public"."UserTier_old";
COMMIT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLogoutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PasswordResetOtp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasswordResetOtp_userId_idx" ON "PasswordResetOtp"("userId");

-- AddForeignKey
ALTER TABLE "PasswordResetOtp" ADD CONSTRAINT "PasswordResetOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
