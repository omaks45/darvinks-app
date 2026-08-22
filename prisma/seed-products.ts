
// Seeds all Darvinks Healthcare product catalogue with correct pricing.
// Run: npx ts-node prisma/seed-products.ts
// Safe to re-run — uses upsert so existing products are updated not duplicated.

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter } as any);
// ── Price helper ──────────────────────────────────────────────────────────────
// All prices stored in kobo (₦1 = 100 kobo)
const toKobo = (naira: number) => BigInt(Math.round(naira * 100));

// ── Product catalogue ─────────────────────────────────────────────────────────
// Fields: name, category, packQty (units per carton), unitPriceKobo, cartonPriceKobo
//
// Pricing rule:
//   cartonPriceKobo = unit price × packQty  (sell full cartons at carton rate)
//   unitPriceKobo   = price for a single unit / piece
//
// Source: Darvinks Healthcare official price list

const PRODUCTS = [

    // ── VISITA ESSENCE B RANGE ──────────────────────────────────────────────────

    {
        name:            'Visita Essence B Whitening Lotion 250ml',
        category:        'LOTION',
        packQty:         12,
        unitPriceKobo:   toKobo(5250),
        cartonPriceKobo: toKobo(63000),
    },
    {
        name:            'Visita Essence B Whitening Lotion 500ml',
        category:        'LOTION',
        packQty:         12,
        unitPriceKobo:   toKobo(8750),
        cartonPriceKobo: toKobo(105000),
    },
    {
        name:            'Visita Essence B Whitening Lotion 1L',
        category:        'LOTION',
        packQty:         12,
        unitPriceKobo:   toKobo(15833),
        cartonPriceKobo: toKobo(190000),
    },
    {
        name:            'Visita Essence B Whitening Cream 30g',
        category:        'CREAM',
        packQty:         12,
        unitPriceKobo:   toKobo(3750),
        cartonPriceKobo: toKobo(45000),
    },
    {
        name:            'Visita Essence B Whitening Cream 50g',
        category:        'CREAM',
        packQty:         12,
        unitPriceKobo:   toKobo(5417),
        cartonPriceKobo: toKobo(65000),
    },
    {
        name:            'Visita Essence B Whitening Soap 80g',
        category:        'SOAP',
        packQty:         48,
        unitPriceKobo:   toKobo(1500),
        cartonPriceKobo: toKobo(72000),
    },
    {
        name:            'Visita Essence B Whitening Soap 130g',
        category:        'SOAP',
        packQty:         48,
        unitPriceKobo:   toKobo(2000),
        cartonPriceKobo: toKobo(96000),
    },
    {
        name:            'Visita Essence B Body Scrub 500ml',
        category:        'CREAM',
        packQty:         12,
        unitPriceKobo:   toKobo(7500),
        cartonPriceKobo: toKobo(90000),
    },
    {
        name:            'Visita Essence B Face Cream 30g',
        category:        'CREAM',
        packQty:         12,
        unitPriceKobo:   toKobo(4583),
        cartonPriceKobo: toKobo(55000),
    },
    {
        name:            'Visita Essence B Toning Serum 30ml',
        category:        'CREAM',
        packQty:         12,
        unitPriceKobo:   toKobo(6250),
        cartonPriceKobo: toKobo(75000),
    },

    // ── NEOSKIN RANGE ──────────────────────────────────────────────────────────

    {
        name:            'Neoskin Essence B Whitening Lotion 250ml',
        category:        'LOTION',
        packQty:         12,
        unitPriceKobo:   toKobo(5250),
        cartonPriceKobo: toKobo(63000),
    },
    {
        name:            'Neoskin Essence B Whitening Lotion 500ml',
        category:        'LOTION',
        packQty:         12,
        unitPriceKobo:   toKobo(8750),
        cartonPriceKobo: toKobo(105000),
    },
    {
        name:            'Neoskin Essence B Whitening Cream 30g',
        category:        'CREAM',
        packQty:         12,
        unitPriceKobo:   toKobo(3750),
        cartonPriceKobo: toKobo(45000),
    },
    {
        name:            'Neoskin Essence B Whitening Cream 50g',
        category:        'CREAM',
        packQty:         12,
        unitPriceKobo:   toKobo(5417),
        cartonPriceKobo: toKobo(65000),
    },
    {
        name:            'Neoskin Essence B Whitening Soap 80g',
        category:        'SOAP',
        packQty:         48,
        unitPriceKobo:   toKobo(1500),
        cartonPriceKobo: toKobo(72000),
    },
    {
        name:            'Neoskin Essence B Whitening Soap 130g',
        category:        'SOAP',
        packQty:         48,
        unitPriceKobo:   toKobo(2000),
        cartonPriceKobo: toKobo(96000),
    },
    {
        name:            'Neoskin Whitening Body Scrub 500ml',
        category:        'CREAM',
        packQty:         12,
        unitPriceKobo:   toKobo(7500),
        cartonPriceKobo: toKobo(90000),
    },

    // ── VISITA PLUS RANGE ──────────────────────────────────────────────────────

    {
        name:            'Visita Plus Whitening Lotion 250ml',
        category:        'LOTION',
        packQty:         12,
        unitPriceKobo:   toKobo(4583),
        cartonPriceKobo: toKobo(55000),
    },
    {
        name:            'Visita Plus Whitening Lotion 500ml',
        category:        'LOTION',
        packQty:         12,
        unitPriceKobo:   toKobo(7500),
        cartonPriceKobo: toKobo(90000),
    },
    {
        name:            'Visita Plus Whitening Cream 30g',
        category:        'CREAM',
        packQty:         12,
        unitPriceKobo:   toKobo(3333),
        cartonPriceKobo: toKobo(40000),
    },
    {
        name:            'Visita Plus Whitening Cream 50g',
        category:        'CREAM',
        packQty:         12,
        unitPriceKobo:   toKobo(4583),
        cartonPriceKobo: toKobo(55000),
    },
    {
        name:            'Visita Plus Whitening Soap 80g',
        category:        'SOAP',
        packQty:         48,
        unitPriceKobo:   toKobo(1250),
        cartonPriceKobo: toKobo(60000),
    },
    {
        name:            'Visita Plus Whitening Soap 130g',
        category:        'SOAP',
        packQty:         48,
        unitPriceKobo:   toKobo(1667),
        cartonPriceKobo: toKobo(80000),
    },

    // ── MAINTENANCE / SPECIALTY ────────────────────────────────────────────────

    {
        name:            'Visita Maintenance Lotion 250ml',
        category:        'MAINTENANCE',
        packQty:         12,
        unitPriceKobo:   toKobo(3750),
        cartonPriceKobo: toKobo(45000),
    },
    {
        name:            'Visita Maintenance Lotion 500ml',
        category:        'MAINTENANCE',
        packQty:         12,
        unitPriceKobo:   toKobo(6250),
        cartonPriceKobo: toKobo(75000),
    },
    {
        name:            'Neoskin Maintenance Cream 30g',
        category:        'MAINTENANCE',
        packQty:         12,
        unitPriceKobo:   toKobo(2917),
        cartonPriceKobo: toKobo(35000),
    },
    {
        name:            'Neoskin Maintenance Cream 50g',
        category:        'MAINTENANCE',
        packQty:         12,
        unitPriceKobo:   toKobo(4167),
        cartonPriceKobo: toKobo(50000),
    },
    {
        name:            'Visita Sunscreen SPF50 50ml',
        category:        'MAINTENANCE',
        packQty:         12,
        unitPriceKobo:   toKobo(6250),
        cartonPriceKobo: toKobo(75000),
    },
    {
        name:            'Visita Anti-Stretch Mark Cream 200ml',
        category:        'MAINTENANCE',
        packQty:         12,
        unitPriceKobo:   toKobo(5833),
        cartonPriceKobo: toKobo(70000),
    },
];

// ── Seed function ─────────────────────────────────────────────────────────────

async function seedProducts() {
    console.log(`\nSeeding ${PRODUCTS.length} products...\n`);

    let created = 0;
    let updated = 0;

    for (const product of PRODUCTS) {
        const result = await prisma.product.upsert({
        where:  { name_category: { name: product.name, category: product.category as any } },
        update: {
            packQty:         product.packQty,
            unitPriceKobo:   product.unitPriceKobo,
            cartonPriceKobo: product.cartonPriceKobo,
            isActive:        true,
        },
        create: {
            name:            product.name,
            category:        product.category as any,
            packQty:         product.packQty,
            unitPriceKobo:   product.unitPriceKobo,
            cartonPriceKobo: product.cartonPriceKobo,
            isActive:        true,
        },
        });

        const isNew = result.createdAt.getTime() === result.updatedAt.getTime();
        if (isNew) {
        created++;
        console.log(`  Created: ${product.name}`);
        } else {
        updated++;
        console.log(`  Updated: ${product.name}`);
        }
    }

    console.log(`\n────────────────────────────────`);
    console.log(`  Created: ${created} products`);
    console.log(`  Updated: ${updated} products`);
    console.log(`  Total:   ${PRODUCTS.length} products`);
    console.log(`────────────────────────────────\n`);
    console.log('Product seeding complete.');
    console.log('   Warehouse Admin can now record inbound stock for these products.');
    console.log('   Sales Support Agent can upload product images via PATCH /products/:id/image\n');
}

seedProducts()
    .catch((e) => {
        console.error('Seeding failed:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());