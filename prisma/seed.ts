
// Seeds the first System Admin account.
// Run with: npx ts-node -r tsconfig-paths/register prisma/seed.ts
//
// The seeded admin can then use POST /api/v1/admin/users/provision
// to create all other back-office accounts (Sales Head, Warehouse Admin, GM).

import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

//  Seed configuration
// Change these values before running the seed.
const SEED_ADMIN = {
    fullName:  'chigozie Okeke',
    email:     'jusmaks45@gmail.com',
    phone:     '+2349104095397',
    password:  'Admin@Darvinks2026!',   
    dateOfBirth: '2005-01-01',
};

async function main() {
    console.log(' Seeding System Admin...\n');

    // Check if a System Admin already exists
    const existing = await prisma.user.findFirst({
        where: { role: 'SYSTEM_ADMIN' },
        select: { email: true, employeeRef: true },
    });

    if (existing) {
        console.log(`  System Admin already exists:`);
        console.log(`   Email:       ${existing.email}`);
        console.log(`   EmployeeRef: ${existing.employeeRef}`);
        console.log('\nSeed skipped — delete the existing admin first if you want to re-seed.');
        return;
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(SEED_ADMIN.password, 12);

    // Generate employee ref based on current user count
    const userCount = await prisma.user.count();
    const seq = String(userCount + 1).padStart(8, '0');
    const employeeRef = `Dar-${seq}`;

    // Create the System Admin
    const admin = await prisma.user.create({
        data: {
        employeeRef,
        fullName:          SEED_ADMIN.fullName,
        email:             SEED_ADMIN.email,
        phone:             SEED_ADMIN.phone,
        passwordHash,
        role:              'SYSTEM_ADMIN',
        roleLabel:         'System Administrator',
        tier:              'TIER5_SYSTEM_ADMIN',
        accountOrigin:     'PROVISIONED',
        mustChangePassword: true,
        team:              null,
        region:            null,
        state:             null,
        warehouseLocation: null,
        dateOfBirth:       new Date(SEED_ADMIN.dateOfBirth),
        isActive:          true,
        },
        select: {
        id: true,
        employeeRef: true,
        email: true,
        role: true,
        tier: true,
        },
    });

    console.log(' System Admin created successfully!\n');
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
    console.log('   The admin must change their password on first login.');
    console.log('\n Next steps:');
    console.log('   1. Login with POST /api/v1/auth/login');
    console.log('   2. Change password with POST /api/v1/auth/change-password');
    console.log('   3. Use POST /api/v1/admin/users/provision to create other back-office accounts');
}

main()
    .catch((e) => {
        console.error(' Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });