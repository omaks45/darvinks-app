import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

// ─── Load DATABASE_URL from .env ──────────────────────────────────────────────
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
        // Strip surrounding quotes if present
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

    // Set env var BEFORE PrismaClient is instantiated
    const DATABASE_URL = loadDatabaseUrl();
    process.env.DATABASE_URL = DATABASE_URL;

    // ─── Prisma client ────────────────────────────────────────────────────────────
    // Prisma v7 with @prisma/adapter-pg requires the adapter to be passed explicitly.
    // The `as any` cast is intentional: the generated client types may not expose
    // the `adapter` option depending on the preview feature flags in schema.prisma.
    const adapter = new PrismaPg({ connectionString: DATABASE_URL });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = new (PrismaClient as any)({ adapter });

    // ─── Seed configuration ───────────────────────────────────────────────────────
    const SEED_ADMIN = {
    fullName:    'Chigozie Okeke',
    email:       'jusmaks45@gmail.com',
    phone:       '+2349104095397',
    password:    'Admin@Darvinks2026!',
    dateOfBirth: '2005-01-01',
    };
    // ─────────────────────────────────────────────────────────────────────────────

    async function main(): Promise<void> {
    console.log(' Seeding System Admin...\n');
    console.log(`   Using DB: ${DATABASE_URL.substring(0, 40)}...`);

    // Check if a system admin already exists
    const existing = await prisma.user.findFirst({
        where:  { role: 'SYSTEM_ADMIN' },
        select: { email: true, employeeRef: true },
    });

    if (existing) {
        console.log('  System Admin already exists:');
        console.log(`   Email:       ${existing.email}`);
        console.log(`   EmployeeRef: ${existing.employeeRef}`);
        console.log('\nSeed skipped — delete the existing admin first to re-seed.');
        return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(SEED_ADMIN.password, 12);

    // Generate employee reference
    const userCount   = await prisma.user.count();
    const seq         = String(userCount + 1).padStart(8, '0');
    const employeeRef = `Dar-${seq}`;

    // Create the system admin user
    const admin = await prisma.user.create({
        data: {
        employeeRef,
        fullName:           SEED_ADMIN.fullName,
        email:              SEED_ADMIN.email,
        phone:              SEED_ADMIN.phone,
        passwordHash,
        role:               'SYSTEM_ADMIN',
        roleLabel:          'System Administrator',
        tier:               'TIER5_SALES_SUPPORT',
        accountOrigin:      'PROVISIONED',
        mustChangePassword: true,
        team:               null,
        region:             null,
        state:              null,
        warehouseLocation:  null,
        dateOfBirth:        new Date(SEED_ADMIN.dateOfBirth),
        isActive:           true,
        },
        select: {
        id:          true,
        employeeRef: true,
        email:       true,
        role:        true,
        tier:        true,
        },
    });

    console.log('\n System Admin created successfully!');
    console.log('─────────────────────────────────────────');
    console.log(`  ID:          ${admin.id}`);
    console.log(`  EmployeeRef: ${admin.employeeRef}`);
    console.log(`  Email:       ${admin.email}`);
    console.log(`  Role:        ${admin.role}`);
    console.log(`  Tier:        ${admin.tier}`);
    console.log('─────────────────────────────────────────');
    console.log('\n Login credentials:');
    console.log(`  Email:    ${SEED_ADMIN.email}`);
    console.log(`  Password: ${SEED_ADMIN.password}`);
    console.log('\n  mustChangePassword = true');
    console.log('  Change password on first login via POST /api/v1/auth/change-password');
    console.log('\n Next steps:');
    console.log('  1. POST /api/v1/auth/login');
    console.log('  2. POST /api/v1/auth/change-password');
    console.log('  3. POST /api/v1/admin/users/provision  ← create other back-office accounts');
}

main()
    .catch((e: Error) => {
        console.error(' Seed failed:', e.message ?? e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });