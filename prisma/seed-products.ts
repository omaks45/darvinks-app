// prisma/seed-products.ts
// Official Darvinks Healthcare product catalogue — August 2026 price list.
// Safe to re-run: uses upsert so existing records are updated not duplicated.
// Run: npx ts-node -r tsconfig-paths/register prisma/seed-products.ts

import { PrismaClient } from '@prisma/client';
import { PrismaPg }     from '@prisma/adapter-pg';
import { Pool }         from 'pg';
import * as dotenv      from 'dotenv';

dotenv.config();

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter } as any);

// All prices are in kobo (₦1 = 100 kobo)
const toKobo = (naira: number) => BigInt(Math.round(naira * 100));

// ── Official price list ────────────────────────────────────────────────────────
//
// packQty     = units per carton (the quantity you get per carton purchase)
// unitPrice   = box/roll/bottle/unit price (in naira)
// cartonPrice = full carton price (in naira)
//
// For SOAP: "12 rolls × 4" means 48 units per carton (12 rolls, 4 bars per roll)
// For LOTION: "6 rolls × 6" means 36 units per carton (6 rolls, 6 bottles per roll)

const PRODUCTS = [

    // ─── CREAM ─────────────────────────────────────────────────────────────────

    {
        name:            'Acneway Cream 30g',
        category:        'CREAM',
        packQty:         30,        // 30 boxes per carton
        unitPriceKobo:   toKobo(7100),
        cartonPriceKobo: toKobo(213000),
    },
    {
        name:            'Neoskin Cream 30g',
        category:        'CREAM',
        packQty:         30,
        unitPriceKobo:   toKobo(7200),
        cartonPriceKobo: toKobo(216000),
    },
    {
        name:            'Skin Gold Cream 30g',
        category:        'CREAM',
        packQty:         30,
        unitPriceKobo:   toKobo(5800),
        cartonPriceKobo: toKobo(174000),
    },
    {
        name:            'Visita Plus Cream 30g',
        category:        'CREAM',
        packQty:         30,
        unitPriceKobo:   toKobo(7400),
        cartonPriceKobo: toKobo(222000),
    },
    {
        name:            'Visita Plus Cream 15g',
        category:        'CREAM',
        packQty:         36,
        unitPriceKobo:   toKobo(1200),
        cartonPriceKobo: toKobo(43200),
    },
    {
        name:            'Visita Plus Cream 50g',
        category:        'CREAM',
        packQty:         20,
        unitPriceKobo:   toKobo(6000),
        cartonPriceKobo: toKobo(170000),
    },
    {
        name:            'Visiderm Cream 50g',
        category:        'CREAM',
        packQty:         20,
        unitPriceKobo:   toKobo(6000),
        cartonPriceKobo: toKobo(120000),
    },
    {
        name:            'Visiderm Cream 30g',
        category:        'CREAM',
        packQty:         30,
        unitPriceKobo:   toKobo(7100),
        cartonPriceKobo: toKobo(213000),
    },
    {
        name:            'Neovate Cream 30g',
        category:        'CREAM',
        packQty:         30,
        unitPriceKobo:   toKobo(7100),
        cartonPriceKobo: toKobo(198000),
    },
    {
        name:            'Visiderm Plus Gel 30g',
        category:        'CREAM',
        packQty:         30,
        unitPriceKobo:   toKobo(7100),
        cartonPriceKobo: toKobo(240000),
    },
    {
        name:            'Skineo Cream 15g',
        category:        'CREAM',
        packQty:         240,       // 24 boxes × 10 units = 240 units per carton
        unitPriceKobo:   toKobo(7000),
        cartonPriceKobo: toKobo(168000),
    },

    // ─── SOAP ──────────────────────────────────────────────────────────────────

    {
        name:            'Visita Soap 70g',
        category:        'SOAP',
        packQty:         72,        // 12 rolls × 6 bars = 72 bars per carton
        unitPriceKobo:   toKobo(4000),   // per roll (6 bars)
        cartonPriceKobo: toKobo(24000),
    },
    {
        name:            'Visita Soap 150g',
        category:        'SOAP',
        packQty:         48,        // 12 rolls × 4 bars = 48 bars per carton
        unitPriceKobo:   toKobo(2750),   // per roll (4 bars)
        cartonPriceKobo: toKobo(33000),
    },
    {
        name:            'Neoskin Essence Soap 150g',
        category:        'SOAP',
        packQty:         48,
        unitPriceKobo:   toKobo(2750),
        cartonPriceKobo: toKobo(33000),
    },
    {
        name:            'Visita Essence Soap 200g',
        category:        'SOAP',
        packQty:         48,        // 12 rolls × 4 bars
        unitPriceKobo:   toKobo(3335),
        cartonPriceKobo: toKobo(40000),
    },
    {
        name:            'Visita Essence Carrot Soap 200g',
        category:        'SOAP',
        packQty:         48,        // 8 rolls × 6 bars = 48 bars per carton
        unitPriceKobo:   toKobo(5500),   // per roll (6 bars)
        cartonPriceKobo: toKobo(44000),
    },
    {
        name:            'Visita Essence Papaya Soap 200g',
        category:        'SOAP',
        packQty:         48,        // 8 rolls × 6 bars
        unitPriceKobo:   toKobo(5500),
        cartonPriceKobo: toKobo(44000),
    },

    // ─── LOTION ────────────────────────────────────────────────────────────────

    {
        name:            'Visita Essence B Complexion Lotion 250ml',
        category:        'LOTION',
        packQty:         36,        // 6 rolls × 6 bottles = 36 per carton
        unitPriceKobo:   toKobo(10500),  // per roll (6 bottles)
        cartonPriceKobo: toKobo(63000),
    },
    {
        name:            'Visita Essence B Complexion Lotion 500ml',
        category:        'LOTION',
        packQty:         24,        // 4 rolls × 6 bottles = 24 per carton
        unitPriceKobo:   toKobo(15625),
        cartonPriceKobo: toKobo(62500),
    },
    {
        name:            'Visita Essence B Whitening Lotion 250ml',
        category:        'LOTION',
        packQty:         36,
        unitPriceKobo:   toKobo(10500),
        cartonPriceKobo: toKobo(63000),
    },
    {
        name:            'Visita Essence B Whitening Lotion 500ml',
        category:        'LOTION',
        packQty:         24,
        unitPriceKobo:   toKobo(15625),
        cartonPriceKobo: toKobo(62500),
    },
    {
        name:            'Neoskin Essence B Whitening Lotion 250ml',
        category:        'LOTION',
        packQty:         36,
        unitPriceKobo:   toKobo(10500),
        cartonPriceKobo: toKobo(63000),
    },
    {
        name:            'Neoskin Essence B Whitening Lotion 500ml',
        category:        'LOTION',
        packQty:         24,
        unitPriceKobo:   toKobo(15625),
        cartonPriceKobo: toKobo(62500),
    },
    {
        name:            'Neoskin Essence B Complexion Lotion 250ml',
        category:        'LOTION',
        packQty:         36,
        unitPriceKobo:   toKobo(10500),
        cartonPriceKobo: toKobo(63000),
    },
    {
        name:            'Neoskin Essence B Complexion Lotion 500ml',
        category:        'LOTION',
        packQty:         24,
        unitPriceKobo:   toKobo(15625),
        cartonPriceKobo: toKobo(62500),
    },
    {
        name:            'Visita Essence B Whitening Cup Cream 250ml',
        category:        'LOTION',
        packQty:         72,        // 72 pcs per carton
        unitPriceKobo:   toKobo(1320),
        cartonPriceKobo: toKobo(95000),
    },
    {
        name:            'Visita Pawpo Whitening Lotion 325ml',
        category:        'LOTION',
        packQty:         24,        // 24 pcs per carton
        unitPriceKobo:   toKobo(2295),
        cartonPriceKobo: toKobo(55000),
    },
    {
        name:            'Visita Pawpo Whitening Lotion 250ml',
        category:        'LOTION',
        packQty:         36,        // 6 rolls × 6 bottles
        unitPriceKobo:   toKobo(10500),
        cartonPriceKobo: toKobo(63000),
    },

    // ─── MAINTENANCE ───────────────────────────────────────────────────────────

    {
        name:            'Visita BSC Cream 30ml',
        category:        'MAINTENANCE',
        packQty:         108,       // 9 rolls × 12 units = 108 per carton
        unitPriceKobo:   toKobo(6000),   // per roll (12 units)
        cartonPriceKobo: toKobo(72000),
    },
    {
        name:            'Neoskin BSC Cream 30ml',
        category:        'MAINTENANCE',
        packQty:         108,
        unitPriceKobo:   toKobo(6000),
        cartonPriceKobo: toKobo(72000),
    },
    {
        name:            'Visita Carrot Shower Gel 1L',
        category:        'MAINTENANCE',
        packQty:         12,        // 12 × 1L per carton
        unitPriceKobo:   toKobo(5834),
        cartonPriceKobo: toKobo(70000),
    },
    {
        name:            'Visita Whitening Serum Oil 70ml',
        category:        'MAINTENANCE',
        packQty:         72,        // 72 bottles per carton
        unitPriceKobo:   toKobo(600),
        cartonPriceKobo: toKobo(43200),
    },
    {
        name:            'Neoskin Whitening Serum Oil 70ml',
        category:        'MAINTENANCE',
        packQty:         72,
        unitPriceKobo:   toKobo(600),
        cartonPriceKobo: toKobo(43200),
    },
    ];

    // ── Seed ──────────────────────────────────────────────────────────────────────

    async function seedProducts() {
    console.log(`\nSeeding ${PRODUCTS.length} products with official August 2026 prices...\n`);

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
        if (isNew) { created++; console.log(`  Created: ${product.name}`); }
        else        { updated++; console.log(`  Updated: ${product.name}  →  ₦${(Number(product.cartonPriceKobo) / 100).toLocaleString()}/ctn`); }
    }

    console.log(`\n────────────────────────────────────────`);
    console.log(`  Created: ${created}  |  Updated: ${updated}  |  Total: ${PRODUCTS.length}`);
    console.log(`────────────────────────────────────────\n`);
    console.log('Product seeding complete — all prices are now accurate per the August 2026 price list.\n');
}

seedProducts()
    .catch(e => { console.error('Seeding failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());