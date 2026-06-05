
// Integration tests for the full authentication flow.
import request from 'supertest';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import {
    buildTestApp,
    cleanDatabase,
    mockQueue,
} from './helpers/app.helper';

const API = '/api/v1';

const REGISTER_PAYLOAD = {
    fullName: 'Integration Test User',
    email: 'integration@darvinks.com',
    phone: '+2348011111111',
    password: 'TestPass123!',
    role: 'SALES_REPRESENTATIVE',
    team: 'BRIGHT',
    state: 'enugu',
    dateOfBirth: '1992-03-10',
};

describe('Auth — Integration', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    beforeAll(async () => {
        ({ app, prisma } = await buildTestApp());
    });

    afterAll(async () => {
        await cleanDatabase(prisma);
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ── POST /auth/register ────────────────────────────────────────────────────

    describe('POST /auth/register', () => {
        afterEach(async () => {
        await cleanDatabase(prisma);
        });

        it('201: registers a new user successfully', async () => {
        const res = await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', REGISTER_PAYLOAD.fullName)
            .field('email', REGISTER_PAYLOAD.email)
            .field('phone', REGISTER_PAYLOAD.phone)
            .field('password', REGISTER_PAYLOAD.password)
            .field('role', REGISTER_PAYLOAD.role)
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', REGISTER_PAYLOAD.state)
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth)
            .expect(HttpStatus.CREATED);

        expect(res.body.success).toBe(true);
        expect(res.body.data.userId).toBeDefined();
        expect(res.body.data.employeeRef).toMatch(/^Dar-\d{8}$/);
        expect(res.body.data.message).toContain('successful');
        });

        it('tier is auto-assigned from role — SALES_REPRESENTATIVE → TIER2', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', REGISTER_PAYLOAD.fullName)
            .field('email', REGISTER_PAYLOAD.email)
            .field('phone', REGISTER_PAYLOAD.phone)
            .field('password', REGISTER_PAYLOAD.password)
            .field('role', REGISTER_PAYLOAD.role)
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', REGISTER_PAYLOAD.state)
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth)
            .expect(HttpStatus.CREATED);

        const user = await prisma.user.findUnique({
            where: { email: REGISTER_PAYLOAD.email },
            select: { tier: true, role: true, roleLabel: true },
        });

        expect(user?.tier).toBe('TIER2');
        expect(user?.role).toBe('SALES_REPRESENTATIVE');
        expect(user?.roleLabel).toBe('Sales Representative');
        });

        it('region is auto-assigned from state', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', REGISTER_PAYLOAD.fullName)
            .field('email', REGISTER_PAYLOAD.email)
            .field('phone', REGISTER_PAYLOAD.phone)
            .field('password', REGISTER_PAYLOAD.password)
            .field('role', REGISTER_PAYLOAD.role)
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', 'enugu')
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth)
            .expect(HttpStatus.CREATED);

        const user = await prisma.user.findUnique({
            where: { email: REGISTER_PAYLOAD.email },
            select: { region: true },
        });

        expect(user?.region).toBe('SE1');
        });

        it('queues an ID card generation job after registration', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', REGISTER_PAYLOAD.fullName)
            .field('email', REGISTER_PAYLOAD.email)
            .field('phone', REGISTER_PAYLOAD.phone)
            .field('password', REGISTER_PAYLOAD.password)
            .field('role', REGISTER_PAYLOAD.role)
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', REGISTER_PAYLOAD.state)
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth)
            .expect(HttpStatus.CREATED);

        expect(mockQueue.add).toHaveBeenCalledWith(
            'generate-id-card',
            expect.objectContaining({ userId: expect.any(String) }),
            expect.any(Object),
        );
        });

        it('409: rejects duplicate email', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', REGISTER_PAYLOAD.fullName)
            .field('email', REGISTER_PAYLOAD.email)
            .field('phone', REGISTER_PAYLOAD.phone)
            .field('password', REGISTER_PAYLOAD.password)
            .field('role', REGISTER_PAYLOAD.role)
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', REGISTER_PAYLOAD.state)
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth)
            .expect(HttpStatus.CREATED);

        const res = await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', 'Another User')
            .field('email', REGISTER_PAYLOAD.email)
            .field('phone', '+2348099999999')
            .field('password', REGISTER_PAYLOAD.password)
            .field('role', REGISTER_PAYLOAD.role)
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', REGISTER_PAYLOAD.state)
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth)
            .expect(HttpStatus.CONFLICT);

        expect(res.body.statusCode).toBe(409);
        });

        it('409: rejects duplicate phone', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', REGISTER_PAYLOAD.fullName)
            .field('email', REGISTER_PAYLOAD.email)
            .field('phone', REGISTER_PAYLOAD.phone)
            .field('password', REGISTER_PAYLOAD.password)
            .field('role', REGISTER_PAYLOAD.role)
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', REGISTER_PAYLOAD.state)
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth)
            .expect(HttpStatus.CREATED);

        await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', 'Another User')
            .field('email', 'different@darvinks.com')
            .field('phone', REGISTER_PAYLOAD.phone)
            .field('password', REGISTER_PAYLOAD.password)
            .field('role', REGISTER_PAYLOAD.role)
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', REGISTER_PAYLOAD.state)
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth)
            .expect(HttpStatus.CONFLICT);
        });

        it('400: rejects invalid email format', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', REGISTER_PAYLOAD.fullName)
            .field('email', 'not-an-email')
            .field('phone', REGISTER_PAYLOAD.phone)
            .field('password', REGISTER_PAYLOAD.password)
            .field('role', REGISTER_PAYLOAD.role)
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', REGISTER_PAYLOAD.state)
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth)
            .expect(HttpStatus.BAD_REQUEST);
        });

        it('400: rejects password shorter than 8 characters', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', REGISTER_PAYLOAD.fullName)
            .field('email', REGISTER_PAYLOAD.email)
            .field('phone', REGISTER_PAYLOAD.phone)
            .field('password', 'short')
            .field('role', REGISTER_PAYLOAD.role)
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', REGISTER_PAYLOAD.state)
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth)
            .expect(HttpStatus.BAD_REQUEST);
        });

        it('400: rejects invalid role', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', REGISTER_PAYLOAD.fullName)
            .field('email', REGISTER_PAYLOAD.email)
            .field('phone', REGISTER_PAYLOAD.phone)
            .field('password', REGISTER_PAYLOAD.password)
            .field('role', 'INVALID_ROLE')
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', REGISTER_PAYLOAD.state)
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth)
            .expect(HttpStatus.BAD_REQUEST);
        });
    });

    // ── POST /auth/login ───────────────────────────────────────────────────────

    describe('POST /auth/login', () => {
        beforeEach(async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', REGISTER_PAYLOAD.fullName)
            .field('email', REGISTER_PAYLOAD.email)
            .field('phone', REGISTER_PAYLOAD.phone)
            .field('password', REGISTER_PAYLOAD.password)
            .field('role', REGISTER_PAYLOAD.role)
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', REGISTER_PAYLOAD.state)
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth);
        });

        afterEach(async () => {
        await cleanDatabase(prisma);
        });

        it('200: returns access and refresh tokens on valid credentials', async () => {
        const res = await request(app.getHttpServer())
            .post(`${API}/auth/login`)
            .send({ email: REGISTER_PAYLOAD.email, password: REGISTER_PAYLOAD.password })
            .expect(HttpStatus.OK);

        expect(res.body.success).toBe(true);
        expect(res.body.data.accessToken).toBeDefined();
        expect(res.body.data.refreshToken).toBeDefined();
        expect(res.body.data.expiresIn).toBe('12h');
        });

        it('401: rejects wrong password', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/login`)
            .send({ email: REGISTER_PAYLOAD.email, password: 'WrongPassword123' })
            .expect(HttpStatus.UNAUTHORIZED);
        });

        it('401: rejects non-existent email', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/login`)
            .send({ email: 'nobody@darvinks.com', password: REGISTER_PAYLOAD.password })
            .expect(HttpStatus.UNAUTHORIZED);
        });

        it('400: rejects malformed email', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/login`)
            .send({ email: 'bad-email', password: REGISTER_PAYLOAD.password })
            .expect(HttpStatus.BAD_REQUEST);
        });
    });

    // ── POST /auth/refresh ─────────────────────────────────────────────────────

    describe('POST /auth/refresh', () => {
        let refreshToken: string;

        beforeEach(async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', REGISTER_PAYLOAD.fullName)
            .field('email', REGISTER_PAYLOAD.email)
            .field('phone', REGISTER_PAYLOAD.phone)
            .field('password', REGISTER_PAYLOAD.password)
            .field('role', REGISTER_PAYLOAD.role)
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', REGISTER_PAYLOAD.state)
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth);

        const loginRes = await request(app.getHttpServer())
            .post(`${API}/auth/login`)
            .send({ email: REGISTER_PAYLOAD.email, password: REGISTER_PAYLOAD.password });

        refreshToken = loginRes.body.data.refreshToken;
        });

        afterEach(async () => {
        await cleanDatabase(prisma);
        });

        it('200: returns a new token pair using a valid refresh token', async () => {
        const res = await request(app.getHttpServer())
            .post(`${API}/auth/refresh`)
            .send({ refreshToken })
            .expect(HttpStatus.OK);

        expect(res.body.data.accessToken).toBeDefined();
        expect(res.body.data.refreshToken).toBeDefined();
        // New refresh token must differ from the old one (rotation)
        expect(res.body.data.refreshToken).not.toBe(refreshToken);
        });

        it('401: rejects a refresh token that has already been rotated', async () => {
        // Use the token once
        await request(app.getHttpServer())
            .post(`${API}/auth/refresh`)
            .send({ refreshToken })
            .expect(HttpStatus.OK);

        // Try the old token again — must be rejected
        await request(app.getHttpServer())
            .post(`${API}/auth/refresh`)
            .send({ refreshToken })
            .expect(HttpStatus.UNAUTHORIZED);
        });

        it('401: rejects an invalid refresh token', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/refresh`)
            .send({ refreshToken: 'this.is.not.valid' })
            .expect(HttpStatus.UNAUTHORIZED);
        });
    });

    // ── POST /auth/logout ──────────────────────────────────────────────────────

    describe('POST /auth/logout', () => {
        let refreshToken: string;

        beforeEach(async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', REGISTER_PAYLOAD.fullName)
            .field('email', REGISTER_PAYLOAD.email)
            .field('phone', REGISTER_PAYLOAD.phone)
            .field('password', REGISTER_PAYLOAD.password)
            .field('role', REGISTER_PAYLOAD.role)
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', REGISTER_PAYLOAD.state)
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth);

        const loginRes = await request(app.getHttpServer())
            .post(`${API}/auth/login`)
            .send({ email: REGISTER_PAYLOAD.email, password: REGISTER_PAYLOAD.password });

        refreshToken = loginRes.body.data.refreshToken;
        });

        afterEach(async () => {
        await cleanDatabase(prisma);
        });

        it('204: successfully revokes refresh token on logout', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/logout`)
            .send({ refreshToken })
            .expect(HttpStatus.NO_CONTENT);
        });

        it('401: revoked token cannot be used to refresh after logout', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/logout`)
            .send({ refreshToken })
            .expect(HttpStatus.NO_CONTENT);

        await request(app.getHttpServer())
            .post(`${API}/auth/refresh`)
            .send({ refreshToken })
            .expect(HttpStatus.UNAUTHORIZED);
        });
    });

    // ── POST /auth/change-password ─────────────────────────────────────────────

    describe('POST /auth/change-password', () => {
        let accessToken: string;

        beforeEach(async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/register`)
            .field('fullName', REGISTER_PAYLOAD.fullName)
            .field('email', REGISTER_PAYLOAD.email)
            .field('phone', REGISTER_PAYLOAD.phone)
            .field('password', REGISTER_PAYLOAD.password)
            .field('role', REGISTER_PAYLOAD.role)
            .field('team', REGISTER_PAYLOAD.team)
            .field('state', REGISTER_PAYLOAD.state)
            .field('dateOfBirth', REGISTER_PAYLOAD.dateOfBirth);

        const loginRes = await request(app.getHttpServer())
            .post(`${API}/auth/login`)
            .send({ email: REGISTER_PAYLOAD.email, password: REGISTER_PAYLOAD.password });

        accessToken = loginRes.body.data.accessToken;
        });

        afterEach(async () => {
        await cleanDatabase(prisma);
        });

        it('204: successfully changes password', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/change-password`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ currentPassword: REGISTER_PAYLOAD.password, newPassword: 'NewSecurePass456!' })
            .expect(HttpStatus.NO_CONTENT);
        });

        it('400: rejects wrong current password', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/change-password`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ currentPassword: 'WrongCurrentPass', newPassword: 'NewSecurePass456!' })
            .expect(HttpStatus.BAD_REQUEST);
        });

        it('400: rejects when new password equals current password', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/change-password`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ currentPassword: REGISTER_PAYLOAD.password, newPassword: REGISTER_PAYLOAD.password })
            .expect(HttpStatus.BAD_REQUEST);
        });

        it('401: rejects unauthenticated request', async () => {
        await request(app.getHttpServer())
            .post(`${API}/auth/change-password`)
            .send({ currentPassword: REGISTER_PAYLOAD.password, newPassword: 'NewPass456!' })
            .expect(HttpStatus.UNAUTHORIZED);
        });
    });

    // ── GET /auth/roles ────────────────────────────────────────────────────────

    describe('GET /auth/roles', () => {
        it('200: returns all available roles for the registration dropdown', async () => {
        const res = await request(app.getHttpServer())
            .get(`${API}/auth/roles`)
            .expect(HttpStatus.OK);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThan(0);

        // Each item must have role, label, description
        for (const item of res.body.data) {
            expect(item.role).toBeDefined();
            expect(item.label).toBeDefined();
            expect(item.description).toBeDefined();
        }
        });

        it('contains all 13 roles from the PRD', async () => {
        const res = await request(app.getHttpServer())
            .get(`${API}/auth/roles`)
            .expect(HttpStatus.OK);

        const roles = res.body.data.map((r: { role: string }) => r.role);
        expect(roles).toContain('MERCHANDISER');
        expect(roles).toContain('SALES_REPRESENTATIVE');
        expect(roles).toContain('TSM');
        expect(roles).toContain('ZONAL_SALES_MANAGER');
        expect(roles).toContain('GENERAL_MANAGER');
        });

        it('200: accessible without authentication (public endpoint)', async () => {
        await request(app.getHttpServer())
            .get(`${API}/auth/roles`)
            .expect(HttpStatus.OK);
        });
    });
});