// prisma/backfill-lagos-region.ts
//
// One-time backfill: updates all User, Customer, Location and
// CompetitorReport rows with region LAGOS_1 or LAGOS_2 to SOUTH_WEST.
//
// Run ONCE after deploying the region.util.ts change:
//   npm run migrate:lagos
//
// Safe to re-run — rows already set to SOUTH_WEST are unaffected.

import * as fs   from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg }     from '@prisma/adapter-pg';

//  Load DATABASE_URL from .env
function loadDatabaseUrl(): string {
    const envPath = path.join(process.cwd(), '.env');

    let envContent: string;
    try {
        envContent = fs.readFileSync(envPath, 'utf8');
    } catch {
        throw new Error(`.env file not found at: ${envPath}`);
    }

    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;

        if (trimmed.startsWith('DATABASE_URL=')) {
        let value = trimmed.slice('DATABASE_URL='.length).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (!value) throw new Error('DATABASE_URL is empty in .env file');
        return value;
        }
    }

    throw new Error('DATABASE_URL not found in .env file');
    }

    const DATABASE_URL = loadDatabaseUrl();
    process.env.DATABASE_URL = DATABASE_URL;

    // Prisma client (matches seed.ts exactly)
    const adapter = new PrismaPg({ connectionString: DATABASE_URL });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = new (PrismaClient as any)({ adapter });

    // Backfill
    const LEGACY_REGIONS = ['LAGOS_1', 'LAGOS_2'];
    const NEW_REGION     = 'SOUTH_WEST';

    async function main() {
    console.log('Backfilling LAGOS_1/LAGOS_2 → SOUTH_WEST...\n');
    console.log(`   Using DB: ${DATABASE_URL.substring(0, 40)}...`);

    const userResult = await prisma.user.updateMany({
        where: { region: { in: LEGACY_REGIONS } },
        data:  { region: NEW_REGION },
    });
    console.log(`\nUsers updated:             ${userResult.count}`);

    const customerResult = await prisma.customer.updateMany({
        where: { region: { in: LEGACY_REGIONS } },
        data:  { region: NEW_REGION },
    });
    console.log(`Customers updated:          ${customerResult.count}`);

    const locationResult = await prisma.location.updateMany({
        where: { region: { in: LEGACY_REGIONS } },
        data:  { region: NEW_REGION },
    });
    console.log(`Locations updated:          ${locationResult.count}`);

    const reportResult = await prisma.competitorReport.updateMany({
        where: { region: { in: LEGACY_REGIONS } },
        data:  { region: NEW_REGION },
    });
    console.log(`Competitor reports updated: ${reportResult.count}`);

    console.log('\nBackfill complete.');
    console.log('   LAGOS_1 and LAGOS_2 are now deprecated enum values.');
    console.log('   region.util.ts maps lagos → SOUTH_WEST going forward.\n');
}

main()
    .catch((err: Error) => {
        console.error('Backfill failed:', err.message ?? err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });