// prisma/seed-locations.ts
//
// Seeds the Location table with real Nigerian towns/markets, grouped by
// state and region. Run once after the phase3-locations-targets migration.
// Idempotent — uses upsert on the (name, state) unique constraint, so it's
// safe to re-run if new towns are added later without duplicating existing
// rows or wiping LocationTarget data that already references them.
//
// LAGOS NOTE: LAGOS_1 and LAGOS_2 have been merged into SOUTH_WEST as of
// July 2026. All Lagos towns are now seeded under SOUTH_WEST to match
// region.util.ts (which maps 'lagos' → SOUTH_WEST). Do not use LAGOS_1 or
// LAGOS_2 here — they are deprecated enum values kept only for schema
// backwards compatibility. Using them would immediately conflict with the
// backfill migration and the current resolveRegion() behaviour.

import * as fs from 'fs';
import * as path from 'path';

function loadDatabaseUrl(): string {
    const envPath = path.join(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('DATABASE_URL=')) {
        let value = trimmed.slice('DATABASE_URL='.length).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        return value;
        }
    }
    throw new Error('DATABASE_URL not found in .env file');
    }

    const DATABASE_URL = loadDatabaseUrl();
    process.env.DATABASE_URL = DATABASE_URL;

    import { PrismaClient, Region } from '@prisma/client';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = new (PrismaClient as any)({ datasourceUrl: DATABASE_URL });

    interface LocationSeed {
    name:   string;
    state:  string;
    region: Region;
    }

    const LOCATIONS: LocationSeed[] = [
    // ── Team Bright ─────────────────────────────────────────────────────────

    // North Bright — Kogi
    { name: 'Lokoja',   state: 'kogi', region: Region.NORTH_BRIGHT },
    { name: 'Ankpa',    state: 'kogi', region: Region.NORTH_BRIGHT },
    { name: 'Anyigba',  state: 'kogi', region: Region.NORTH_BRIGHT },
    { name: 'Ajaokuta', state: 'kogi', region: Region.NORTH_BRIGHT },
    { name: 'Ida',      state: 'kogi', region: Region.NORTH_BRIGHT },
    // North Bright — Adamawa
    { name: 'Yola', state: 'adamawa', region: Region.NORTH_BRIGHT },
    { name: 'Mubi', state: 'adamawa', region: Region.NORTH_BRIGHT },
    // North Bright — Benue
    { name: 'Makurdi',  state: 'benue', region: Region.NORTH_BRIGHT },
    { name: 'Gboko',    state: 'benue', region: Region.NORTH_BRIGHT },
    { name: 'Zaki Biam',state: 'benue', region: Region.NORTH_BRIGHT },
    { name: 'Otukpo',   state: 'benue', region: Region.NORTH_BRIGHT },
    // North Bright — Taraba
    { name: 'Jalingo', state: 'taraba', region: Region.NORTH_BRIGHT },

    // SS1 — Abia
    { name: 'Umuahia', state: 'abia', region: Region.SS1 },
    { name: 'Aba',     state: 'abia', region: Region.SS1 },
    // SS1 — Cross River
    { name: 'Calabar', state: 'cross river', region: Region.SS1 },
    { name: 'Ikom',    state: 'cross river', region: Region.SS1 },
    // SS1 — Akwa Ibom
    { name: 'Uyo',  state: 'akwa ibom', region: Region.SS1 },
    { name: 'Eket', state: 'akwa ibom', region: Region.SS1 },

    // SS2 — Imo
    { name: 'Owerri', state: 'imo', region: Region.SS2 },
    { name: 'Orlu',   state: 'imo', region: Region.SS2 },
    // SS2 — Rivers
    { name: 'Port Harcourt', state: 'rivers', region: Region.SS2 },
    { name: 'Bonny',         state: 'rivers', region: Region.SS2 },
    // SS2 — Bayelsa
    { name: 'Yenagoa', state: 'bayelsa', region: Region.SS2 },

    // SS3 — Delta
    { name: 'Asaba', state: 'delta', region: Region.SS3 },
    { name: 'Warri', state: 'delta', region: Region.SS3 },
    // SS3 — Edo
    { name: 'Benin City', state: 'edo', region: Region.SS3 },
    { name: 'Auchi',      state: 'edo', region: Region.SS3 },

    // SE1 — Enugu
    { name: 'Enugu',  state: 'enugu', region: Region.SE1 },
    { name: 'Nsukka', state: 'enugu', region: Region.SE1 },
    // SE1 — Ebonyi
    { name: 'Abakaliki', state: 'ebonyi', region: Region.SE1 },
    // SE1 — Anambra
    { name: 'Onitsha', state: 'anambra', region: Region.SE1 },
    { name: 'Nnewi',   state: 'anambra', region: Region.SE1 },
    { name: 'Awka',    state: 'anambra', region: Region.SE1 },

    // ── Team Radiant ─────────────────────────────────────────────────────────

    // South West — Lagos (ALL under SOUTH_WEST — LAGOS_1/LAGOS_2 deprecated)
    { name: 'Ikeja',           state: 'lagos', region: Region.SOUTH_WEST },
    { name: 'Ikorodu',         state: 'lagos', region: Region.SOUTH_WEST },
    { name: 'Mushin',          state: 'lagos', region: Region.SOUTH_WEST },
    { name: 'Ajah',            state: 'lagos', region: Region.SOUTH_WEST },
    { name: 'Lekki',           state: 'lagos', region: Region.SOUTH_WEST },
    { name: 'Victoria Island', state: 'lagos', region: Region.SOUTH_WEST },
    { name: 'Badagry',         state: 'lagos', region: Region.SOUTH_WEST },
    { name: 'Epe',             state: 'lagos', region: Region.SOUTH_WEST },

    // South West — Oyo
    { name: 'Ibadan',    state: 'oyo', region: Region.SOUTH_WEST },
    { name: 'Ogbomosho', state: 'oyo', region: Region.SOUTH_WEST },
    // South West — Ogun
    { name: 'Abeokuta', state: 'ogun', region: Region.SOUTH_WEST },
    { name: 'Sagamu',   state: 'ogun', region: Region.SOUTH_WEST },
    // South West — Osun
    { name: 'Osogbo',  state: 'osun', region: Region.SOUTH_WEST },
    { name: 'Ile-Ife', state: 'osun', region: Region.SOUTH_WEST },
    // South West — Ondo (matches sample area-head report granularity exactly)
    { name: 'Akure',   state: 'ondo', region: Region.SOUTH_WEST },
    { name: 'Owo',     state: 'ondo', region: Region.SOUTH_WEST },
    { name: 'Arakale', state: 'ondo', region: Region.SOUTH_WEST },
    { name: 'Oore',    state: 'ondo', region: Region.SOUTH_WEST },
    // South West — Ekiti
    { name: 'Ado-Ekiti', state: 'ekiti', region: Region.SOUTH_WEST },

    // North Central — FCT
    { name: 'Abuja Central', state: 'fct', region: Region.NORTH_CENTRAL },
    { name: 'Gwagwalada',    state: 'fct', region: Region.NORTH_CENTRAL },
    // North Central — Nasarawa
    { name: 'Lafia', state: 'nasarawa', region: Region.NORTH_CENTRAL },
    // North Central — Niger
    { name: 'Minna', state: 'niger', region: Region.NORTH_CENTRAL },
    { name: 'Bida',  state: 'niger', region: Region.NORTH_CENTRAL },
    // North Central — Plateau
    { name: 'Jos', state: 'plateau', region: Region.NORTH_CENTRAL },
    // North Central — Kwara
    { name: 'Ilorin', state: 'kwara', region: Region.NORTH_CENTRAL },

    // North West — Kano
    { name: 'Kano', state: 'kano', region: Region.NORTH_WEST },
    // North West — Kaduna
    { name: 'Kaduna', state: 'kaduna', region: Region.NORTH_WEST },
    { name: 'Zaria',  state: 'kaduna', region: Region.NORTH_WEST },
    // North West — Sokoto
    { name: 'Sokoto', state: 'sokoto', region: Region.NORTH_WEST },
    ];

    async function main() {
    console.log('Seeding Locations...\n');
    console.log(`   DB: ${DATABASE_URL.substring(0, 40)}...`);
    console.log(`   ${LOCATIONS.length} locations to seed\n`);

    let created = 0;
    let updated = 0;

    for (const loc of LOCATIONS) {
        const existing = await prisma.location.findUnique({
        where:  { name_state: { name: loc.name, state: loc.state } },
        select: { id: true },
        });

        await prisma.location.upsert({
        where:  { name_state: { name: loc.name, state: loc.state } },
        create: { name: loc.name, state: loc.state, region: loc.region },
        update: { region: loc.region }, // corrects any stale LAGOS_1/LAGOS_2 values
        });

        existing ? updated++ : created++;
    }

    console.log(`Done — ${created} created, ${updated} updated\n`);

    const totals = await prisma.location.groupBy({
        by:     ['region'],
        _count: { id: true },
        orderBy:{ region: 'asc' },
    });
    console.log('   Count per region:');
    for (const row of totals) {
        console.log(`     ${row.region}: ${row._count.id}`);
    }
}

main()
    .catch((err) => {
        console.error('Location seed failed:', err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());