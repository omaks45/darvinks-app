UPDATE "User" SET "role" = 'SALES_SUPPORT', "tier" = 'TIER5_SALES_SUPPORT'
WHERE "_old_role" = 'SYSTEM_ADMIN';

UPDATE "InviteToken" SET "role" = 'SALES_SUPPORT'
WHERE "_old_role" = 'SYSTEM_ADMIN';

-- Clean up temp columns
ALTER TABLE "User" DROP COLUMN IF EXISTS "_old_role";
ALTER TABLE "InviteToken" DROP COLUMN IF EXISTS "_old_role";