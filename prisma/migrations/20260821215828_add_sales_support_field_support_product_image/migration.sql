/*
  Warnings:

  - The values [SYSTEM_ADMIN] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.
  - The values [TIER5_SALES_SUPPORT] on the enum `UserTier` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('MERCHANDISER', 'PROMOTER', 'DBSR', 'VSR', 'SALES_REPRESENTATIVE', 'SSR', 'ATSM', 'TSM', 'ZONAL_SALES_MANAGER', 'SALES_HEAD', 'SALES_SUPPORT', 'FIELD_SUPPORT', 'WAREHOUSE_ADMIN', 'GENERAL_MANAGER');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TABLE "InviteToken" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "public"."UserRole_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "UserTier_new" AS ENUM ('TIER1', 'TIER2', 'TIER3', 'TIER4', 'TIER5_SALES_HEAD', 'TIER5_SALES_SUPPORT', 'TIER5_FIELD_SUPPORT', 'TIER6_GM', 'WAREHOUSE_ADMIN');
ALTER TABLE "User" ALTER COLUMN "tier" TYPE "UserTier_new" USING ("tier"::text::"UserTier_new");
ALTER TYPE "UserTier" RENAME TO "UserTier_old";
ALTER TYPE "UserTier_new" RENAME TO "UserTier";
DROP TYPE "public"."UserTier_old";
COMMIT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "imageUrl" TEXT;
