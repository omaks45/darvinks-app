-- Store the admin users somewhere safe then clear the conflicting enum values
-- We'll restore them after the migration runs
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "_old_role" TEXT;
ALTER TABLE "InviteToken" ADD COLUMN IF NOT EXISTS "_old_role" TEXT;

UPDATE "User" SET "_old_role" = role::text WHERE "role" = 'SYSTEM_ADMIN';
UPDATE "InviteToken" SET "_old_role" = role::text WHERE "role" = 'SYSTEM_ADMIN';

-- Set them to a valid value that won't be dropped
UPDATE "User" SET "role" = 'SALES_HEAD', "tier" = 'TIER5_SALES_HEAD'
WHERE "role" = 'SYSTEM_ADMIN' OR "tier" = 'TIER5_SYSTEM_ADMIN';

UPDATE "InviteToken" SET "role" = 'SALES_HEAD'
WHERE "role" = 'SYSTEM_ADMIN';