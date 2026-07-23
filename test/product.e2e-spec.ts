
import request from 'supertest';
import { ProductCategory } from '@prisma/client';
import { buildTestApp, cleanDatabase, makeFakeImageBuffer } from './helpers/app.helper';
import type { INestApplication } from '@nestjs/common';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loginAs(
    app: INestApplication,
    email: string,
    password: string,
    ): Promise<string> {
    const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(201);
    return res.body.data.accessToken;
}

async function registerUser(
    app: INestApplication,
    overrides: Partial<Record<string, unknown>> = {},
    ) {
    const base = {
        fullName:    'Test User',
        email:       `test-${Date.now()}@darvinks.com`,
        phone:       `+234${Math.floor(8000000000 + Math.random() * 999999999)}`,
        password:    'SecurePass123!',
        role:        'SALES_REPRESENTATIVE',
        team:        'BRIGHT',
        state:       'lagos',
        dateOfBirth: '1995-06-15',
    };
    return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .field({ ...base, ...overrides });
}

const CREATE_DTO = {
    name:            'DarVinks Body Lotion 500ml',
    category:        ProductCategory.LOTION,
    packQty:         12,
    unitPriceKobo:   150000,
    cartonPriceKobo: 1700000,
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Products (e2e)', () => {
    let app: INestApplication;
    let prisma: any;
    let adminToken: string;   // TIER5_SYSTEM_ADMIN
    let fieldToken: string;   // TIER2 — read-only

    beforeAll(async () => {
        ({ app, prisma } = await buildTestApp());
        await cleanDatabase(prisma);

        // Seed a System Admin directly
        const bcrypt = await import('bcryptjs');

        await prisma.user.create({
        data: {
            employeeRef:        'Dar-TEST-ADMIN',
            fullName:           'Test Admin',
            email:              'admin@test.com',
            phone:              '+2348000000001',
            passwordHash:       await bcrypt.hash('AdminPass123!', 10),
            role:               'SYSTEM_ADMIN',
            roleLabel:          'System Administrator',
            tier:               'TIER5_SYSTEM_ADMIN',
            accountOrigin:      'PROVISIONED',
            mustChangePassword: false,
            isActive:           true,
        },
        });

        adminToken = await loginAs(app, 'admin@test.com', 'AdminPass123!');

        // Register a field staff user
        const fieldRes = await registerUser(app, {
        email: 'field@test.com',
        phone: '+2348000000002',
        });
        expect(fieldRes.status).toBe(201);
        fieldToken = await loginAs(app, 'field@test.com', 'SecurePass123!');
    });

    afterAll(async () => {
        await cleanDatabase(prisma);
        await app.close();
    });

    // ── POST /products ─────────────────────────────────────────────────────────

    describe('POST /products', () => {
        it('201 — admin creates a product', async () => {
        const res = await request(app.getHttpServer())
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(CREATE_DTO)
            .expect(201);

        expect(res.body.data.name).toBe(CREATE_DTO.name);
        expect(res.body.data.category).toBe(CREATE_DTO.category);
        expect(res.body.data.isActive).toBe(true);
        });

        it('409 — duplicate name+category is rejected', async () => {
        await request(app.getHttpServer())
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(CREATE_DTO)
            .expect(409);
        });

        it('403 — field staff cannot create products', async () => {
        await request(app.getHttpServer())
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${fieldToken}`)
            .send({ ...CREATE_DTO, name: 'Another Product' })
            .expect(403);
        });

        it('401 — unauthenticated request is rejected', async () => {
        await request(app.getHttpServer())
            .post('/api/v1/products')
            .send(CREATE_DTO)
            .expect(401);
        });

        it('400 — missing required fields', async () => {
        await request(app.getHttpServer())
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: 'Incomplete Product' })
            .expect(400);
        });

        it('400 — invalid category enum value', async () => {
        await request(app.getHttpServer())
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...CREATE_DTO, category: 'INVALID_CATEGORY' })
            .expect(400);
        });

        it('400 — unitPriceKobo must be positive', async () => {
        await request(app.getHttpServer())
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ...CREATE_DTO, name: 'Zero Price', unitPriceKobo: 0 })
            .expect(400);
        });
    });

    // ── GET /products ──────────────────────────────────────────────────────────

    describe('GET /products', () => {
        it('200 — returns product list for any authenticated user', async () => {
        const res = await request(app.getHttpServer())
            .get('/api/v1/products')
            .set('Authorization', `Bearer ${fieldToken}`)
            .expect(200);

        expect(Array.isArray(res.body.data)).toBe(true);
        });

        it('200 — filters by category', async () => {
        const res = await request(app.getHttpServer())
            .get('/api/v1/products?category=LOTION')
            .set('Authorization', `Bearer ${fieldToken}`)
            .expect(200);

        res.body.data.forEach((p: any) => {
            expect(p.category).toBe('LOTION');
        });
        });

        it('200 — filters inactive products when isActive=false', async () => {
        const res = await request(app.getHttpServer())
            .get('/api/v1/products?isActive=false')
            .set('Authorization', `Bearer ${fieldToken}`)
            .expect(200);

        res.body.data.forEach((p: any) => {
            expect(p.isActive).toBe(false);
        });
        });

        it('401 — unauthenticated request is rejected', async () => {
        await request(app.getHttpServer())
            .get('/api/v1/products')
            .expect(401);
        });
    });

    // ── GET /products/category/:category ──────────────────────────────────────

    describe('GET /products/category/:category', () => {
        it('200 — returns only active products for that category', async () => {
        const res = await request(app.getHttpServer())
            .get('/api/v1/products/category/LOTION')
            .set('Authorization', `Bearer ${fieldToken}`)
            .expect(200);

        expect(Array.isArray(res.body.data)).toBe(true);
        res.body.data.forEach((p: any) => {
            expect(p.category).toBe('LOTION');
            expect(p.isActive).toBe(true);
        });
        });
    });

    // ── GET /products/:id ──────────────────────────────────────────────────────

    describe('GET /products/:id', () => {
        let productId: string;

        beforeAll(async () => {
        const res = await request(app.getHttpServer())
            .get('/api/v1/products')
            .set('Authorization', `Bearer ${fieldToken}`);
        productId = res.body.data[0]?.id;
        });

        it('200 — returns product by ID', async () => {
        const res = await request(app.getHttpServer())
            .get(`/api/v1/products/${productId}`)
            .set('Authorization', `Bearer ${fieldToken}`)
            .expect(200);

        expect(res.body.data.id).toBe(productId);
        });

        it('404 — unknown ID returns not found', async () => {
        await request(app.getHttpServer())
            .get('/api/v1/products/00000000-0000-0000-0000-000000000000')
            .set('Authorization', `Bearer ${fieldToken}`)
            .expect(404);
        });

        it('400 — non-UUID ID is rejected', async () => {
        await request(app.getHttpServer())
            .get('/api/v1/products/not-a-uuid')
            .set('Authorization', `Bearer ${fieldToken}`)
            .expect(400);
        });
    });

    // ── PATCH /products/:id ────────────────────────────────────────────────────

    describe('PATCH /products/:id', () => {
        let productId: string;

        beforeAll(async () => {
        // Create a separate product to avoid state pollution
        const res = await request(app.getHttpServer())
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
            name:            'DarVinks Soap Update Test',
            category:        ProductCategory.SOAP,
            packQty:         24,
            unitPriceKobo:   80000,
            cartonPriceKobo: 1800000,
            });
        productId = res.body.data.id;
        });

        it('200 — admin updates a product field', async () => {
        const res = await request(app.getHttpServer())
            .patch(`/api/v1/products/${productId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ packQty: 48 })
            .expect(200);

        expect(res.body.data.packQty).toBe(48);
        });

        it('403 — field staff cannot update products', async () => {
        await request(app.getHttpServer())
            .patch(`/api/v1/products/${productId}`)
            .set('Authorization', `Bearer ${fieldToken}`)
            .send({ packQty: 6 })
            .expect(403);
        });

        it('404 — updating non-existent product', async () => {
        await request(app.getHttpServer())
            .patch('/api/v1/products/00000000-0000-0000-0000-000000000000')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ packQty: 10 })
            .expect(404);
        });
    });

    // ── PATCH /products/:id/deactivate ────────────────────────────────────────

    describe('PATCH /products/:id/deactivate + reactivate', () => {
        let productId: string;

        beforeAll(async () => {
        const res = await request(app.getHttpServer())
            .post('/api/v1/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
            name:            'DarVinks Cream Deactivate Test',
            category:        ProductCategory.CREAM,
            packQty:         6,
            unitPriceKobo:   200000,
            cartonPriceKobo: 1100000,
            });
        productId = res.body.data.id;
        });

        it('200 — admin deactivates a product', async () => {
        const res = await request(app.getHttpServer())
            .patch(`/api/v1/products/${productId}/deactivate`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);

        expect(res.body.data.isActive).toBe(false);
        });

        it('409 — deactivating an already inactive product', async () => {
        await request(app.getHttpServer())
            .patch(`/api/v1/products/${productId}/deactivate`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(409);
        });

        it('200 — admin reactivates the product', async () => {
        const res = await request(app.getHttpServer())
            .patch(`/api/v1/products/${productId}/reactivate`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);

        expect(res.body.data.isActive).toBe(true);
        });

        it('409 — reactivating an already active product', async () => {
        await request(app.getHttpServer())
            .patch(`/api/v1/products/${productId}/reactivate`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(409);
        });

        it('403 — field staff cannot deactivate products', async () => {
        await request(app.getHttpServer())
            .patch(`/api/v1/products/${productId}/deactivate`)
            .set('Authorization', `Bearer ${fieldToken}`)
            .expect(403);
        });
    });
});