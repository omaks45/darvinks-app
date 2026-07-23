
// One-time backfill: updates all User and Customer rows with region
// LAGOS_1 or LAGOS_2 to SOUTH_WEST, reflecting the decision that Lagos
// is now a single unified South West territory rather than two separate
// regional codes.
//
// Run ONCE after deploying the region.util.ts change:
//   npx ts-node -r tsconfig-paths/register prisma/migrations/backfill-lagos-region.ts
//
// Safe to re-run — rows already set to SOUTH_WEST are unaffected.
// Do NOT run this before confirming the region.util.ts change is deployed,
// as that would create a mismatch between existing logic and the new data.

import * as fs from 'fs';
import * as path from 'path';

function loadDatabaseUrl(): string {
  const envPath = path.join(process.cwd(), '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('DATABASE_URL=')) {
      let value = trimmed.slice('DATABASE_URL='.length).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return value;
    }
  }
  throw new Error('DATABASE_URL not found in .env');
}

const DATABASE_URL = loadDatabaseUrl();
process.env.DATABASE_URL = DATABASE_URL;

import { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new (PrismaClient as any)({ datasourceUrl: DATABASE_URL });

const LEGACY_REGIONS = ['LAGOS_1', 'LAGOS_2'];
const NEW_REGION = 'SOUTH_WEST';

async function main() {
  console.log('Backfilling LAGOS_1/LAGOS_2 → SOUTH_WEST...\n');

  // ── Users ─────────────────────────────────────────────────────────────────
  const userResult = await prisma.user.updateMany({
    where:  { region: { in: LEGACY_REGIONS } },
    data:   { region: NEW_REGION },
  });
  console.log(`Users updated: ${userResult.count}`);

  // ── Customers ─────────────────────────────────────────────────────────────
  const customerResult = await prisma.customer.updateMany({
    where:  { region: { in: LEGACY_REGIONS } },
    data:   { region: NEW_REGION },
  });
  console.log(`Customers updated: ${customerResult.count}`);

  // ── Locations ─────────────────────────────────────────────────────────────
  const locationResult = await prisma.location.updateMany({
    where:  { region: { in: LEGACY_REGIONS } },
    data:   { region: NEW_REGION },
  });
  console.log(`Locations updated: ${locationResult.count}`);

  // ── Competitor Reports ────────────────────────────────────────────────────
  const reportResult = await prisma.competitorReport.updateMany({
    where:  { region: { in: LEGACY_REGIONS } },
    data:   { region: NEW_REGION },
  });
  console.log(`Competitor reports updated: ${reportResult.count}`);

  console.log('\nBackfill complete. LAGOS_1 and LAGOS_2 are now deprecated.');
  console.log('   No new rows will receive those values — region.util.ts maps');
  console.log('   lagos → SOUTH_WEST going forward.\n');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());