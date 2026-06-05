// Integration tests for the Users module.
// Covers GET /users/me, GET /users, GET /users/:id, PATCH /users/me

import request from 'supertest';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { buildTestApp, cleanDatabase, makeFakeImageBuffer } from './helpers/app.helper';

const API = '/api/v1';

const USER_PAYLOAD = {
    fullName: 'Users Test Agent',
    email: 'users-test@darvinks.com',
    phone: '+2348022222222',
    password: 'TestPass123!',
    role: 'SALES_REPRESENTATIVE',
    team: 'BRIGHT',
    state: 'lagos',
    dateOfBirth: '1990-01-01',
};

const TIER1_PAYLOAD = {
    fullName: 'Tier One Agent',
    email: 'tier1-user@darvinks.com',
    phone: '+2348033333300',
    password: 'TestPass123!',
    role: 'MERCHANDISER',
    team: 'BRIGHT',
    state: 'enugu',
    dateOfBirth: '1998-05-10',
};

describe('Users — Integration', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let accessToken: string;
    let userId: string;
    let tier1Token: string;
    let tier1UserId: string;

    beforeAll(async () => {
        ({ app, prisma } = await buildTestApp());

        // Register TIER2 user
        const reg = await request(app.getHttpServer())
        .post(`${API}/auth/register`)
        .field('fullName', USER_PAYLOAD.fullName)
        .field('email', USER_PAYLOAD.email)
        .field('phone', USER_PAYLOAD.phone)
        .field('password', USER_PAYLOAD.password)
        .field('role', USER_PAYLOAD.role)
        .field('team', USER_PAYLOAD.team)
        .field('state', USER_PAYLOAD.state)
        .field('dateOfBirth', USER_PAYLOAD.dateOfBirth);

        userId = reg.body.data.userId;

        const login = await request(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: USER_PAYLOAD.email, password: USER_PAYLOAD.password });

        accessToken = login.body.data.accessToken;

        // Register TIER1 user
        const reg1 = await request(app.getHttpServer())
        .post(`${API}/auth/register`)
        .field('fullName', TIER1_PAYLOAD.fullName)
        .field('email', TIER1_PAYLOAD.email)
        .field('phone', TIER1_PAYLOAD.phone)
        .field('password', TIER1_PAYLOAD.password)
        .field('role', TIER1_PAYLOAD.role)
        .field('team', TIER1_PAYLOAD.team)
        .field('state', TIER1_PAYLOAD.state)
        .field('dateOfBirth', TIER1_PAYLOAD.dateOfBirth);

        tier1UserId = reg1.body.data.userId;

        const login1 = await request(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: TIER1_PAYLOAD.email, password: TIER1_PAYLOAD.password });

        tier1Token = login1.body.data.accessToken;
    });

    afterAll(async () => {
        await cleanDatabase(prisma);
        await app.close();
    });

    // ── GET /users/me ──────────────────────────────────────────────────────────

    describe('GET /users/me', () => {
        it('200: returns own profile when authenticated', async () => {
        const res = await request(app.getHttpServer())
            .get(`${API}/users/me`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(HttpStatus.OK);

        expect(res.body.success).toBe(true);
        expect(res.body.data.email).toBe(USER_PAYLOAD.email);
        expect(res.body.data.fullName).toBe(USER_PAYLOAD.fullName);
        expect(res.body.data.role).toBe(USER_PAYLOAD.role);
        expect(res.body.data.tier).toBe('TIER2');
        });

        it('never exposes passwordHash', async () => {
        const res = await request(app.getHttpServer())
            .get(`${API}/users/me`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(HttpStatus.OK);

        expect(res.body.data.passwordHash).toBeUndefined();
        expect(res.body.data.password).toBeUndefined();
        });

        it('returns correct employeeRef in Dar-XXXXXXXX format', async () => {
        const res = await request(app.getHttpServer())
            .get(`${API}/users/me`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(HttpStatus.OK);

        expect(res.body.data.employeeRef).toMatch(/^Dar-\d{8}$/);
        });

        it('returns tier, team, region and roleLabel fields', async () => {
        const res = await request(app.getHttpServer())
            .get(`${API}/users/me`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(HttpStatus.OK);

        expect(res.body.data.tier).toBeDefined();
        expect(res.body.data.team).toBe('BRIGHT');
        expect(res.body.data.region).toBeDefined();
        expect(res.body.data.roleLabel).toBe('Sales Representative');
        });

        it('401: rejects unauthenticated request', async () => {
        await request(app.getHttpServer())
            .get(`${API}/users/me`)
            .expect(HttpStatus.UNAUTHORIZED);
        });

        it('401: rejects invalid Bearer token', async () => {
        await request(app.getHttpServer())
            .get(`${API}/users/me`)
            .set('Authorization', 'Bearer invalid.token.here')
            .expect(HttpStatus.UNAUTHORIZED);
        });
    });

    // ── GET /users/:id ─────────────────────────────────────────────────────────

    describe('GET /users/:id', () => {
        it('200: TIER2 retrieves a user profile by ID', async () => {
        const res = await request(app.getHttpServer())
            .get(`${API}/users/${userId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(HttpStatus.OK);

        expect(res.body.data.id).toBe(userId);
        expect(res.body.data.passwordHash).toBeUndefined();
        });

        it('TIER1 requesting another user ID receives their own profile instead', async () => {
        const res = await request(app.getHttpServer())
            .get(`${API}/users/${userId}`) // requesting TIER2 user's ID
            .set('Authorization', `Bearer ${tier1Token}`)
            .expect(HttpStatus.OK);

        // Should return TIER1's own profile, not the requested ID
        expect(res.body.data.id).toBe(tier1UserId);
        });

        it('TIER1 requesting their own ID returns their profile correctly', async () => {
        const res = await request(app.getHttpServer())
            .get(`${API}/users/${tier1UserId}`)
            .set('Authorization', `Bearer ${tier1Token}`)
            .expect(HttpStatus.OK);

        expect(res.body.data.id).toBe(tier1UserId);
        expect(res.body.data.email).toBe(TIER1_PAYLOAD.email);
        });

        it('401: rejects unauthenticated request', async () => {
        await request(app.getHttpServer())
            .get(`${API}/users/${userId}`)
            .expect(HttpStatus.UNAUTHORIZED);
        });
    });

    // ── GET /users ─────────────────────────────────────────────────────────────

    describe('GET /users', () => {
        it('200: returns a list of users visible to TIER2', async () => {
        const res = await request(app.getHttpServer())
            .get(`${API}/users`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(HttpStatus.OK);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);
        });

        it('TIER2 list contains only same-team users at own tier and below', async () => {
        const res = await request(app.getHttpServer())
            .get(`${API}/users`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(HttpStatus.OK);

        for (const user of res.body.data) {
            expect(user.team).toBe('BRIGHT');
            expect(['TIER1', 'TIER2']).toContain(user.tier);
            expect(user.passwordHash).toBeUndefined();
        }
        });

        it('TIER1 list contains only TIER1 users in the same team', async () => {
        const res = await request(app.getHttpServer())
            .get(`${API}/users`)
            .set('Authorization', `Bearer ${tier1Token}`)
            .expect(HttpStatus.OK);

        for (const user of res.body.data) {
            expect(user.team).toBe('BRIGHT');
            expect(user.tier).toBe('TIER1');
        }
        });

        it('401: rejects unauthenticated request', async () => {
        await request(app.getHttpServer())
            .get(`${API}/users`)
            .expect(HttpStatus.UNAUTHORIZED);
        });
    });

    // ── PATCH /users/me ────────────────────────────────────────────────────────

    describe('PATCH /users/me', () => {
        it('200: updates phone number and returns updated profile', async () => {
        const res = await request(app.getHttpServer())
            .patch(`${API}/users/me`)
            .set('Authorization', `Bearer ${accessToken}`)
            .field('phone', '+2348099887766')
            .expect(HttpStatus.OK);

        expect(res.body.success).toBe(true);
        expect(res.body.data.phone).toBe('+2348099887766');
        });

        it('200: updates profile picture when image is attached', async () => {
        const res = await request(app.getHttpServer())
            .patch(`${API}/users/me`)
            .set('Authorization', `Bearer ${accessToken}`)
            .attach('profilePicture', makeFakeImageBuffer(), {
            filename: 'photo.jpg',
            contentType: 'image/jpeg',
            })
            .expect(HttpStatus.OK);

        // Cloudinary mock returns a fake URL
        expect(res.body.data.profilePictureUrl).toBeDefined();
        });

        it('400: rejects unsupported file type for profile picture', async () => {
        await request(app.getHttpServer())
            .patch(`${API}/users/me`)
            .set('Authorization', `Bearer ${accessToken}`)
            .attach('profilePicture', Buffer.from('fake-pdf'), {
            filename: 'document.pdf',
            contentType: 'application/pdf',
            })
            .expect(HttpStatus.BAD_REQUEST);
        });

        it('401: rejects unauthenticated patch', async () => {
        await request(app.getHttpServer())
            .patch(`${API}/users/me`)
            .field('phone', '+2348099887766')
            .expect(HttpStatus.UNAUTHORIZED);
        });
    });
});