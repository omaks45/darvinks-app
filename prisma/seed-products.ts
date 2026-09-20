// prisma/seed-products.ts
// Official Darvinks Healthcare product catalogue — September 2026 price list.
//
// unitLabel semantics (what the mobile UI shows next to unitPriceKobo):
//   CREAM        → "box"
//   SOAP         → "roll"
//   LOTION       → "roll"  (except Cup Cream 250ml → "pc")
//   MAINTENANCE  → "roll" | "litre" | "bottle"  (per product, see comments)
//
// DESTRUCTIVE: deletes ALL existing products (and FK-dependent rows) before
// inserting the canonical list.
//
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

// ── Official September 2026 price list ────────────────────────────────────────

const PRODUCTS = [

    // ─── CREAM — unitLabel: "box" ────────────────────────────────────────────────

    {
        name:            'Acneway Cream 30g',
        category:        'CREAM',
        packQty:         30,
        unitPriceKobo:   toKobo(7_100),
        cartonPriceKobo: toKobo(213_000),
        unitLabel:       'box',
    },
    {
        name:            'Neoskin Cream 30g',
        category:        'CREAM',
        packQty:         30,
        unitPriceKobo:   toKobo(7_200),
        cartonPriceKobo: toKobo(216_000),
        unitLabel:       'box',
    },
    {
        name:            'Skin Gold Cream 30g',
        category:        'CREAM',
        packQty:         30,
        unitPriceKobo:   toKobo(5_800),
        cartonPriceKobo: toKobo(174_000),
        unitLabel:       'box',
    },
    {
        name:            'Visita Plus Cream 30g',
        category:        'CREAM',
        packQty:         30,
        unitPriceKobo:   toKobo(7_400),
        cartonPriceKobo: toKobo(222_000),
        unitLabel:       'box',
    },
    {
        name:            'Visita Plus Cream 15g',
        category:        'CREAM',
        packQty:         36,
        unitPriceKobo:   toKobo(1_200),
        cartonPriceKobo: toKobo(43_200),
        unitLabel:       'box',
    },
    {
        name:            'Visita Plus Cream 50g',
        category:        'CREAM',
        packQty:         20,
        unitPriceKobo:   toKobo(6_000),
        cartonPriceKobo: toKobo(170_000),
        unitLabel:       'box',
    },
    {
        name:            'Visiderm Cream 50g',
        category:        'CREAM',
        packQty:         20,
        unitPriceKobo:   toKobo(6_000),
        cartonPriceKobo: toKobo(120_000),
        unitLabel:       'box',
    },
    {
        name:            'Visiderm Cream 30g',
        category:        'CREAM',
        packQty:         30,
        unitPriceKobo:   toKobo(7_100),
        cartonPriceKobo: toKobo(213_000),
        unitLabel:       'box',
    },
    {
        name:            'Neovate Cream 30g',
        category:        'CREAM',
        packQty:         30,
        unitPriceKobo:   toKobo(7_100),
        cartonPriceKobo: toKobo(198_000),
        unitLabel:       'box',
    },
    {
        name:            'Visiderm Plus Gel 30g',
        category:        'CREAM',
        packQty:         30,
        unitPriceKobo:   toKobo(7_100),
        cartonPriceKobo: toKobo(240_000),
        unitLabel:       'box',
    },
    {
        name:            'Skineo Cream 15g',
        category:        'CREAM',
        packQty:         240,           // 24 boxes × 10 units per box
        unitPriceKobo:   toKobo(7_000),
        cartonPriceKobo: toKobo(168_000),
        unitLabel:       'box',
    },

    // ─── SOAP — unitLabel: "roll" ────────────────────────────────────────────────

    {
        name:            'Visita Soap 70g',
        category:        'SOAP',
        packQty:         72,            // 12 rolls × 6 bars
        unitPriceKobo:   toKobo(4_000),
        cartonPriceKobo: toKobo(24_000),
        unitLabel:       'roll',
    },
    {
        name:            'Visita Soap 150g',
        category:        'SOAP',
        packQty:         48,            // 12 rolls × 4 bars
        unitPriceKobo:   toKobo(2_750),
        cartonPriceKobo: toKobo(33_000),
        unitLabel:       'roll',
    },
    {
        name:            'Neoskin Essence Soap 150g',
        category:        'SOAP',
        packQty:         48,
        unitPriceKobo:   toKobo(2_750),
        cartonPriceKobo: toKobo(33_000),
        unitLabel:       'roll',
    },
    {
        name:            'Visita Essence Soap 200g',
        category:        'SOAP',
        packQty:         48,            // 12 rolls × 4 bars
        unitPriceKobo:   toKobo(3_335),
        cartonPriceKobo: toKobo(40_000),
        unitLabel:       'roll',
    },
    {
        name:            'Visita Essence Carrot Soap 200g',
        category:        'SOAP',
        packQty:         48,            // 8 rolls × 6 bars
        unitPriceKobo:   toKobo(5_500),
        cartonPriceKobo: toKobo(44_000),
        unitLabel:       'roll',
    },
    {
        name:            'Visita Essence Papaya Soap 200g',
        category:        'SOAP',
        packQty:         48,
        unitPriceKobo:   toKobo(5_500),
        cartonPriceKobo: toKobo(44_000),
        unitLabel:       'roll',
    },

    // ─── LOTION — unitLabel: "roll" (except Cup Cream → "pc") ────────────────────

    {
        name:            'Visita Essence B Complexion Lotion 250ml',
        category:        'LOTION',
        packQty:         36,            // 6 rolls × 6 bottles
        unitPriceKobo:   toKobo(10_500),
        cartonPriceKobo: toKobo(63_000),
        unitLabel:       'roll',
    },
    {
        name:            'Visita Essence B Complexion Lotion 500ml',
        category:        'LOTION',
        packQty:         24,            // 4 rolls × 6 bottles
        unitPriceKobo:   toKobo(15_625),
        cartonPriceKobo: toKobo(62_500),
        unitLabel:       'roll',
    },
    {
        name:            'Visita Essence B Whitening Lotion 250ml',
        category:        'LOTION',
        packQty:         36,
        unitPriceKobo:   toKobo(10_500),
        cartonPriceKobo: toKobo(63_000),
        unitLabel:       'roll',
    },
    {
        name:            'Visita Essence B Whitening Lotion 500ml',
        category:        'LOTION',
        packQty:         24,
        unitPriceKobo:   toKobo(15_625),
        cartonPriceKobo: toKobo(62_500),
        unitLabel:       'roll',
    },
    {
        name:            'Neoskin Essence B Whitening Lotion 250ml',
        category:        'LOTION',
        packQty:         36,
        unitPriceKobo:   toKobo(10_500),
        cartonPriceKobo: toKobo(63_000),
        unitLabel:       'roll',
    },
    {
        name:            'Neoskin Essence B Whitening Lotion 500ml',
        category:        'LOTION',
        packQty:         24,
        unitPriceKobo:   toKobo(15_625),
        cartonPriceKobo: toKobo(62_500),
        unitLabel:       'roll',
    },
    {
        name:            'Neoskin Essence B Complexion Lotion 250ml',
        category:        'LOTION',
        packQty:         36,
        unitPriceKobo:   toKobo(10_500),
        cartonPriceKobo: toKobo(63_000),
        unitLabel:       'roll',
    },
    {
        name:            'Neoskin Essence B Complexion Lotion 500ml',
        category:        'LOTION',
        packQty:         24,
        unitPriceKobo:   toKobo(15_625),
        cartonPriceKobo: toKobo(62_500),
        unitLabel:       'roll',
    },
    {
        // Exception: sold per piece, not per roll
        name:            'Visita Essence B Whitening Cup Cream 250ml',
        category:        'LOTION',
        packQty:         72,            // 72 pcs per carton
        unitPriceKobo:   toKobo(1_320),
        cartonPriceKobo: toKobo(95_000),
        unitLabel:       'pc',          // ← only LOTION product sold per piece
    },
    {
        name:            'Visita Pawpo Whitening Lotion 325ml',
        category:        'LOTION',
        packQty:         24,
        unitPriceKobo:   toKobo(13_750),
        cartonPriceKobo: toKobo(55_000),
        unitLabel:       'roll',
    },
    {
        name:            'Visita Pawpo Whitening Lotion 250ml',
        category:        'LOTION',
        packQty:         36,            // 6 rolls × 6 bottles
        unitPriceKobo:   toKobo(10_500),
        cartonPriceKobo: toKobo(63_000),
        unitLabel:       'roll',
    },

    // ─── MAINTENANCE — mixed unitLabels ──────────────────────────────────────────

    {
        name:            'Visita BSC Cream 30ml',
        category:        'MAINTENANCE',
        packQty:         108,           // 9 rolls × 12 units
        unitPriceKobo:   toKobo(6_000),
        cartonPriceKobo: toKobo(72_000),
        unitLabel:       'roll',
    },
    {
        name:            'Neoskin BSC Cream 30ml',
        category:        'MAINTENANCE',
        packQty:         108,
        unitPriceKobo:   toKobo(6_000),
        cartonPriceKobo: toKobo(72_000),
        unitLabel:       'roll',
    },
    {
        name:            'Visita Carrot Shower Gel 1L',
        category:        'MAINTENANCE',
        packQty:         12,            // 12 × 1L
        unitPriceKobo:   toKobo(5_834),
        cartonPriceKobo: toKobo(70_000),
        unitLabel:       'litre',
    },
    {
        name:            'Visita Whitening Serum Oil 70ml',
        category:        'MAINTENANCE',
        packQty:         72,            // 72 bottles
        unitPriceKobo:   toKobo(600),
        cartonPriceKobo: toKobo(43_200),
        unitLabel:       'bottle',
    },
    {
        name:            'Neoskin Whitening Serum Oil 70ml',
        category:        'MAINTENANCE',
        packQty:         72,
        unitPriceKobo:   toKobo(600),
        cartonPriceKobo: toKobo(43_200),
        unitLabel:       'bottle',
    },
];

// ── Seed ─────────────────────────────────────────────────────────────────────

async function seedProducts() {
    console.log('\n  Clearing dependent tables before deleting products...');

    // Delete in reverse FK order
    const { count: saleItems }    = await (prisma as any).secondarySaleItem.deleteMany().catch(() => ({ count: 0 }));
    const { count: invItems }     = await (prisma as any).secondarySaleInvoiceItem.deleteMany().catch(() => ({ count: 0 }));
    const { count: poItems }      = await (prisma as any).purchaseOrderItem.deleteMany().catch(() => ({ count: 0 }));
    const { count: collItems }    = await (prisma as any).stockCollectionItem.deleteMany().catch(() => ({ count: 0 }));
    const { count: agentInv }     = await (prisma as any).agentInventory.deleteMany().catch(() => ({ count: 0 }));
    const { count: stockMoves }   = await (prisma as any).stockMovement.deleteMany().catch(() => ({ count: 0 }));
    const { count: stockEntries } = await (prisma as any).stockEntry.deleteMany().catch(() => ({ count: 0 }));

    console.log(
        `   Cleared: ${saleItems} sale items, ${invItems} invoice items, ` +
        `${poItems} PO items, ${collItems} collection items, ` +
        `${agentInv} agent inventory, ${stockMoves} stock movements, ` +
        `${stockEntries} stock entries.\n`,
    );

    console.log('⚠️  Deleting all existing products...');
    const { count: deleted } = await prisma.product.deleteMany();
    console.log(`   Deleted ${deleted} product(s).\n`);

    console.log(`Seeding ${PRODUCTS.length} products...\n`);

    for (const p of PRODUCTS) {
        await prisma.product.create({
        data: {
            name:            p.name,
            category:        p.category as any,
            packQty:         p.packQty,
            unitPriceKobo:   p.unitPriceKobo,
            cartonPriceKobo: p.cartonPriceKobo,
            unitLabel:       p.unitLabel,
            isActive:        true,
        },
        });

        const unitPrice   = (Number(p.unitPriceKobo)   / 100).toLocaleString();
        const cartonPrice = (Number(p.cartonPriceKobo)  / 100).toLocaleString();
        console.log(`  ✓  ${p.name.padEnd(48)} ₦${unitPrice}/${p.unitLabel}  |  ₦${cartonPrice}/ctn`);
    }

    console.log('\n────────────────────────────────────────────────────────');
    console.log(`  Inserted: ${PRODUCTS.length}`);
    console.log('────────────────────────────────────────────────────────\n');
    console.log('Product seeding complete — September 2026 price list is now live.\n');
}

seedProducts()
    .catch(e => { console.error('Seeding failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());