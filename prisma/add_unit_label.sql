-- Migration: add unitLabel column to Product table
-- Run this BEFORE re-seeding.
-- Safe to run on a live database — adds the column with a default so no existing
-- row is touched, then the seed script will overwrite every value correctly.

ALTER TABLE "Product"
    ADD COLUMN IF NOT EXISTS "unitLabel" TEXT NOT NULL DEFAULT 'unit';