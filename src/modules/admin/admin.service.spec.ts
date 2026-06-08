// src/modules/admin/admin.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AdminService } from './admin.service';
import { MailService } from '@modules/email/email.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { UserRole } from '@common/utils/role.utils';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type { ProvisionUserDto } from '../auths/dto/provision-user.dto';

// ─── Mock factories ───────────────────────────────────────────────────────────

const mockPrisma = {
    user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
    },
    inviteToken: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
    },
    refreshToken: {
        updateMany: jest.fn(),
    },
};

const mockConfig = {
    get: jest.fn((key: string) => {
        const cfg: Record<string, unknown> = { bcryptRounds: 10 };
        return cfg[key];
    }),
};

const mockQueue = { add: jest.fn() };

const mockMail = {
    sendInviteEmail: jest.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// DTOs are cast to ProvisionUserDto via `as unknown as ProvisionUserDto` so
// that the spec can use the full UserRole enum freely without TypeScript
// narrowing the role to the ProvisionableRole union type.
// The service itself enforces the ProvisionableRole restriction at runtime.

const SYSTEM_ADMIN_REQUESTER: JwtPayload = {
    sub: 'admin-uuid',
    email: 'admin@darvinks.com',
    tier: 'TIER5_SYSTEM_ADMIN' as any,
    team: 'BRIGHT' as any,
};

const NON_ADMIN_REQUESTER: JwtPayload = {
    sub: 'user-uuid',
    email: 'user@darvinks.com',
    tier: 'TIER2' as any,
    team: 'BRIGHT' as any,
};

const PROVISION_SALES_HEAD_DTO: ProvisionUserDto = {
    fullName: 'Chukwuemeka Obi',
    email: 'emeka@darvinks.com',
    phone: '+2348055555555',
    role: UserRole.SALES_HEAD as unknown as ProvisionUserDto['role'],
    team: 'BRIGHT' as any,
    dateOfBirth: '1982-03-10',
};

const PROVISION_WAREHOUSE_ADMIN_DTO: ProvisionUserDto = {
    fullName: 'Adaeze Okonkwo',
    email: 'adaeze@darvinks.com',
    phone: '+2348066666666',
    role: UserRole.WAREHOUSE_ADMIN as unknown as ProvisionUserDto['role'],
    warehouseLocation: 'LAGOS_HQ' as any,
};

const PROVISION_GM_DTO: ProvisionUserDto = {
    fullName: 'Dr. Emeka Darvinks',
    email: 'gm@darvinks.com',
    phone: '+2348077777777',
    role: UserRole.GENERAL_MANAGER as unknown as ProvisionUserDto['role'],
};

const PROVISION_SYSTEM_ADMIN_DTO: ProvisionUserDto = {
    fullName: 'Ngozi Admin',
    email: 'ngozi.admin@darvinks.com',
    phone: '+2348088888888',
    role: UserRole.SYSTEM_ADMIN as unknown as ProvisionUserDto['role'],
};

const SAFE_USER = {
    id: 'user-id',
    employeeRef: 'Dar-00000001',
    fullName: 'Kenny Solape',
    email: 'kenny@darvinks.com',
    phone: '+2348012345678',
    role: 'MERCHANDISER',
    roleLabel: 'Merchandiser',
    tier: 'TIER1',
    team: 'BRIGHT',
    region: 'SS1',
    state: 'Cross River',
    warehouseLocation: null,
    accountOrigin: 'SELF_REGISTERED',
    mustChangePassword: false,
    isActive: true,
    profilePictureUrl: null,
    idCardUrl: null,
    fcmToken: null,
    provisionedById: null,
    dateOfBirth: new Date('1995-06-15'),
    annualTargets: {},
    createdAt: new Date(),
    updatedAt: new Date(),
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('AdminService', () => {
    let service: AdminService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
        providers: [
            AdminService,
            { provide: PrismaService,  useValue: mockPrisma },
            { provide: ConfigService,  useValue: mockConfig },
            { provide: MailService,    useValue: mockMail },
            { provide: getQueueToken('notifications'), useValue: mockQueue },
        ],
        }).compile();

        service = module.get<AdminService>(AdminService);
        // resetAllMocks clears both one-time (Once) and persistent mockResolvedValue
        // defaults — prevents mock state from leaking between tests.
        jest.resetAllMocks();
    });

    // ══════════════════════════════════════════════════════════════════════════
    // provisionUser()
    // ══════════════════════════════════════════════════════════════════════════

    describe('provisionUser()', () => {

        // ── Authorization ─────────────────────────────────────────────────────────

        it('throws ForbiddenException when requester is not TIER5_SYSTEM_ADMIN', async () => {
        await expect(
            service.provisionUser(NON_ADMIN_REQUESTER, PROVISION_GM_DTO),
        ).rejects.toThrow(ForbiddenException);

        expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
        });

        // ── Role validation ───────────────────────────────────────────────────────

        it('throws BadRequestException when attempting to provision a field staff role', async () => {
        const dto = {
            ...PROVISION_GM_DTO,
            role: UserRole.MERCHANDISER as unknown as ProvisionUserDto['role'],
        };

        await expect(
            service.provisionUser(SYSTEM_ADMIN_REQUESTER, dto),
        ).rejects.toThrow(BadRequestException);
        });

        it.each([
        UserRole.PROMOTER,
        UserRole.DBSR,
        UserRole.VSR,
        UserRole.SALES_REPRESENTATIVE,
        UserRole.SSR,
        UserRole.ATSM,
        UserRole.TSM,
        UserRole.ZONAL_SALES_MANAGER,
        ])('rejects field staff role: %s', async (role) => {
        const dto = {
            ...PROVISION_GM_DTO,
            role: role as unknown as ProvisionUserDto['role'],
        };
        await expect(
            service.provisionUser(SYSTEM_ADMIN_REQUESTER, dto),
        ).rejects.toThrow(BadRequestException);
        });

        // ── Sales Head validation ─────────────────────────────────────────────────

        it('throws BadRequestException when provisioning Sales Head without team', async () => {
        const dto = { ...PROVISION_SALES_HEAD_DTO, team: undefined };

        await expect(
            service.provisionUser(SYSTEM_ADMIN_REQUESTER, dto),
        ).rejects.toThrow(BadRequestException);
        });

        it('throws ConflictException when a Sales Head already exists for the given team', async () => {
        mockPrisma.user.findFirst.mockResolvedValueOnce({
            id: 'existing-sh',
            fullName: 'Existing SH',
        });

        await expect(
            service.provisionUser(SYSTEM_ADMIN_REQUESTER, PROVISION_SALES_HEAD_DTO),
        ).rejects.toThrow(ConflictException);
        });

        it('allows provisioning a Sales Head when none exists for the team', async () => {
        mockPrisma.user.findFirst
            .mockResolvedValueOnce(null)  // no existing Sales Head
            .mockResolvedValueOnce(null); // no duplicate email/phone
        mockPrisma.user.count.mockResolvedValue(5);
        mockPrisma.user.create.mockResolvedValue({
            id: 'new-sh-id',
            employeeRef: 'Dar-00000006',
        });
        mockQueue.add.mockResolvedValue(undefined);

        const result = await service.provisionUser(
            SYSTEM_ADMIN_REQUESTER,
            PROVISION_SALES_HEAD_DTO,
        );

        expect(result.userId).toBe('new-sh-id');
        expect(result.employeeRef).toBe('Dar-00000006');
        });

        // ── Warehouse Admin validation ────────────────────────────────────────────

        it('throws BadRequestException when provisioning Warehouse Admin without warehouseLocation', async () => {
        const dto = { ...PROVISION_WAREHOUSE_ADMIN_DTO, warehouseLocation: undefined };

        await expect(
            service.provisionUser(SYSTEM_ADMIN_REQUESTER, dto),
        ).rejects.toThrow(BadRequestException);
        });

        it('throws ConflictException when a Warehouse Admin already exists for that location', async () => {
        mockPrisma.user.findFirst
            .mockResolvedValueOnce(null)          // no Sales Head check (different role)
            .mockResolvedValueOnce({              // existing warehouse admin
            id: 'existing-wa',
            fullName: 'Existing Admin',
            });

        await expect(
            service.provisionUser(SYSTEM_ADMIN_REQUESTER, PROVISION_WAREHOUSE_ADMIN_DTO),
        ).rejects.toThrow(ConflictException);
        });

        it('allows provisioning a Warehouse Admin when slot is empty', async () => {
        mockPrisma.user.findFirst
            .mockResolvedValueOnce(null)  // no existing warehouse admin
            .mockResolvedValueOnce(null); // no duplicate email/phone
        mockPrisma.user.count.mockResolvedValue(2);
        mockPrisma.user.create.mockResolvedValue({
            id: 'new-wa-id',
            employeeRef: 'Dar-00000003',
        });
        mockQueue.add.mockResolvedValue(undefined);

        const result = await service.provisionUser(
            SYSTEM_ADMIN_REQUESTER,
            PROVISION_WAREHOUSE_ADMIN_DTO,
        );

        expect(result.userId).toBe('new-wa-id');
        });

        // ── Uniqueness checks ─────────────────────────────────────────────────────

        it('throws ConflictException when email already exists', async () => {
        mockPrisma.user.findFirst.mockResolvedValueOnce({
            email: PROVISION_GM_DTO.email,
            phone: 'different-phone',
        });

        await expect(
            service.provisionUser(SYSTEM_ADMIN_REQUESTER, PROVISION_GM_DTO),
        ).rejects.toThrow(ConflictException);
        });

        it('throws ConflictException when phone already exists', async () => {
        mockPrisma.user.findFirst.mockResolvedValueOnce({
            email: 'different@email.com',
            phone: PROVISION_GM_DTO.phone,
        });

        await expect(
            service.provisionUser(SYSTEM_ADMIN_REQUESTER, PROVISION_GM_DTO),
        ).rejects.toThrow(ConflictException);
        });

        // ── Account creation ──────────────────────────────────────────────────────

        it('creates user with correct role, roleLabel, tier, accountOrigin, mustChangePassword', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(null);
        mockPrisma.user.count.mockResolvedValue(0);
        mockPrisma.user.create.mockResolvedValue({
            id: 'gm-id',
            employeeRef: 'Dar-00000001',
        });
        mockQueue.add.mockResolvedValue(undefined);

        await service.provisionUser(SYSTEM_ADMIN_REQUESTER, PROVISION_GM_DTO);

        const createData = mockPrisma.user.create.mock.calls[0][0].data;
        expect(createData.role).toBe(UserRole.GENERAL_MANAGER);
        expect(createData.roleLabel).toBe('General Manager');
        expect(createData.tier).toBe('TIER6_GM');
        expect(createData.accountOrigin).toBe('PROVISIONED');
        expect(createData.mustChangePassword).toBe(true);
        });

        it('sets team, region, and state to null for GM', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(null);
        mockPrisma.user.count.mockResolvedValue(0);
        mockPrisma.user.create.mockResolvedValue({
            id: 'gm-id',
            employeeRef: 'Dar-00000001',
        });
        mockQueue.add.mockResolvedValue(undefined);

        await service.provisionUser(SYSTEM_ADMIN_REQUESTER, PROVISION_GM_DTO);

        const createData = mockPrisma.user.create.mock.calls[0][0].data;
        expect(createData.team).toBeNull();
        expect(createData.region).toBeNull();
        expect(createData.state).toBeNull();
        });

        it('sets warehouseLocation correctly and team to null for Warehouse Admin', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(null);
        mockPrisma.user.count.mockResolvedValue(0);
        mockPrisma.user.create.mockResolvedValue({
            id: 'wa-id',
            employeeRef: 'Dar-00000001',
        });
        mockQueue.add.mockResolvedValue(undefined);

        await service.provisionUser(SYSTEM_ADMIN_REQUESTER, PROVISION_WAREHOUSE_ADMIN_DTO);

        const createData = mockPrisma.user.create.mock.calls[0][0].data;
        expect(createData.warehouseLocation).toBe('LAGOS_HQ');
        expect(createData.team).toBeNull();
        });

        it('stores a bcrypt hash — never stores the plain temporary password', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(null);
        mockPrisma.user.count.mockResolvedValue(0);
        mockPrisma.user.create.mockResolvedValue({
            id: 'id',
            employeeRef: 'Dar-00000001',
        });
        mockQueue.add.mockResolvedValue(undefined);

        const result = await service.provisionUser(
            SYSTEM_ADMIN_REQUESTER,
            PROVISION_GM_DTO,
        );

        const storedHash = mockPrisma.user.create.mock.calls[0][0].data.passwordHash;
        expect(storedHash).not.toBe(result.temporaryPassword);
        const isValid = await bcrypt.compare(result.temporaryPassword, storedHash);
        expect(isValid).toBe(true);
        });

        it('generates a 12-character temporary password', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(null);
        mockPrisma.user.count.mockResolvedValue(0);
        mockPrisma.user.create.mockResolvedValue({
            id: 'id',
            employeeRef: 'Dar-00000001',
        });
        mockQueue.add.mockResolvedValue(undefined);

        const result = await service.provisionUser(
            SYSTEM_ADMIN_REQUESTER,
            PROVISION_GM_DTO,
        );

        expect(result.temporaryPassword).toHaveLength(12);
        });

        it('generates employee ref in Dar-XXXXXXXX format', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(null);
        mockPrisma.user.count.mockResolvedValue(9);
        mockPrisma.user.create.mockResolvedValue({
            id: 'id',
            employeeRef: 'Dar-00000010',
        });
        mockQueue.add.mockResolvedValue(undefined);

        const result = await service.provisionUser(
            SYSTEM_ADMIN_REQUESTER,
            PROVISION_GM_DTO,
        );

        expect(result.employeeRef).toMatch(/^Dar-\d{8}$/);
        });

        it('sets provisionedById to the requester ID', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(null);
        mockPrisma.user.count.mockResolvedValue(0);
        mockPrisma.user.create.mockResolvedValue({
            id: 'id',
            employeeRef: 'Dar-00000001',
        });
        mockQueue.add.mockResolvedValue(undefined);

        await service.provisionUser(SYSTEM_ADMIN_REQUESTER, PROVISION_GM_DTO);

        const createData = mockPrisma.user.create.mock.calls[0][0].data;
        expect(createData.provisionedById).toBe(SYSTEM_ADMIN_REQUESTER.sub);
        });

        it('queues a provisioning email job with the correct payload', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(null);
        mockPrisma.user.count.mockResolvedValue(0);
        mockPrisma.user.create.mockResolvedValue({
            id: 'new-id',
            employeeRef: 'Dar-00000001',
        });

        await service.provisionUser(SYSTEM_ADMIN_REQUESTER, PROVISION_GM_DTO);

        expect(mockQueue.add).toHaveBeenCalledWith(
            'send-provisioning-email',
            expect.objectContaining({
            userId: 'new-id',
            email: PROVISION_GM_DTO.email,
            fullName: PROVISION_GM_DTO.fullName,
            roleLabel: 'General Manager',
            temporaryPassword: expect.any(String),
            }),
            expect.any(Object),
        );
        });

        it('returns userId, employeeRef, temporaryPassword, and message', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(null);
        mockPrisma.user.count.mockResolvedValue(0);
        mockPrisma.user.create.mockResolvedValue({
            id: 'new-id',
            employeeRef: 'Dar-00000001',
        });
        mockQueue.add.mockResolvedValue(undefined);

        const result = await service.provisionUser(
            SYSTEM_ADMIN_REQUESTER,
            PROVISION_GM_DTO,
        );

        expect(result.userId).toBe('new-id');
        expect(result.employeeRef).toBe('Dar-00000001');
        expect(result.temporaryPassword).toBeDefined();
        expect(result.message).toContain(PROVISION_GM_DTO.fullName);
        expect(result.message).toContain(PROVISION_GM_DTO.email);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // findAllUsers()
    // ══════════════════════════════════════════════════════════════════════════

    describe('findAllUsers()', () => {
        it('returns all users ordered by createdAt descending', async () => {
        const users = [SAFE_USER, { ...SAFE_USER, id: 'user-2' }];
        mockPrisma.user.findMany.mockResolvedValue(users);

        const result = await service.findAllUsers();

        expect(result).toEqual(users);
        expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
        );
        });

        it('returns an empty array when no users exist', async () => {
        mockPrisma.user.findMany.mockResolvedValue([]);
        const result = await service.findAllUsers();
        expect(result).toEqual([]);
        });

        it('never selects passwordHash', async () => {
        mockPrisma.user.findMany.mockResolvedValue([]);
        await service.findAllUsers();

        const selectArg = mockPrisma.user.findMany.mock.calls[0][0].select;
        expect(selectArg.passwordHash).toBeUndefined();
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // findUserById()
    // ══════════════════════════════════════════════════════════════════════════

    describe('findUserById()', () => {
        it('returns the user when found', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(SAFE_USER);

        const result = await service.findUserById('user-id');

        expect(result).toEqual(SAFE_USER);
        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'user-id' } }),
        );
        });

        it('throws NotFoundException when user does not exist', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        await expect(service.findUserById('nonexistent')).rejects.toThrow(
            NotFoundException,
        );
        });

        it('never selects passwordHash', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(SAFE_USER);
        await service.findUserById('user-id');

        const selectArg = mockPrisma.user.findUnique.mock.calls[0][0].select;
        expect(selectArg.passwordHash).toBeUndefined();
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // findProvisionedUsers()
    // ══════════════════════════════════════════════════════════════════════════

    describe('findProvisionedUsers()', () => {
        it('queries only PROVISIONED accounts', async () => {
        mockPrisma.user.findMany.mockResolvedValue([]);

        await service.findProvisionedUsers();

        expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
            where: { accountOrigin: 'PROVISIONED' },
            }),
        );
        });

        it('returns provisioned users ordered by createdAt descending', async () => {
        const provisionedUsers = [
            { ...SAFE_USER, accountOrigin: 'PROVISIONED', role: 'GENERAL_MANAGER' },
        ];
        mockPrisma.user.findMany.mockResolvedValue(provisionedUsers);

        const result = await service.findProvisionedUsers();

        expect(result).toEqual(provisionedUsers);
        expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
        );
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // updateUser()
    // ══════════════════════════════════════════════════════════════════════════

    describe('updateUser()', () => {
        it('updates provided fields and returns the updated user', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-id' });
        const updatedUser = { ...SAFE_USER, fullName: 'Kenny Solape Jr.' };
        mockPrisma.user.update.mockResolvedValue(updatedUser);

        const result = await service.updateUser('user-id', {
            fullName: 'Kenny Solape Jr.',
        });

        expect(result.fullName).toBe('Kenny Solape Jr.');
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
            where: { id: 'user-id' },
            data: expect.objectContaining({ fullName: 'Kenny Solape Jr.' }),
            }),
        );
        });

        it('throws NotFoundException when user does not exist', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        await expect(
            service.updateUser('nonexistent', { fullName: 'Test' }),
        ).rejects.toThrow(NotFoundException);

        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

        it('does not include undefined fields in the update payload', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-id' });
        mockPrisma.user.update.mockResolvedValue(SAFE_USER);

        await service.updateUser('user-id', { fullName: 'New Name' });

        const updateData = mockPrisma.user.update.mock.calls[0][0].data;
        expect(updateData.phone).toBeUndefined();
        expect(updateData.team).toBeUndefined();
        expect(updateData.warehouseLocation).toBeUndefined();
        });

        it('updates annual targets correctly', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-id' });
        mockPrisma.user.update.mockResolvedValue({
            ...SAFE_USER,
            annualTargets: { LOTION: 600 },
        });

        await service.updateUser('user-id', { annualTargets: { LOTION: 600 } });

        const updateData = mockPrisma.user.update.mock.calls[0][0].data;
        expect(updateData.annualTargets).toEqual({ LOTION: 600 });
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // deactivateUser()
    // ══════════════════════════════════════════════════════════════════════════

    describe('deactivateUser()', () => {
        it('deactivates the user and revokes all refresh tokens', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            id: 'user-id',
            isActive: true,
            fullName: 'Kenny Solape',
        });
        mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
        mockPrisma.user.update.mockResolvedValue({ ...SAFE_USER, isActive: false });

        const result = await service.deactivateUser('user-id', SYSTEM_ADMIN_REQUESTER);

        expect(result.isActive).toBe(false);
        expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
            where: { userId: 'user-id', isRevoked: false },
            data: { isRevoked: true },
        });
        });

        it('throws BadRequestException when trying to deactivate own account', async () => {
        await expect(
            service.deactivateUser(SYSTEM_ADMIN_REQUESTER.sub, SYSTEM_ADMIN_REQUESTER),
        ).rejects.toThrow(BadRequestException);

        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
        });

        it('throws NotFoundException when user does not exist', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        await expect(
            service.deactivateUser('nonexistent', SYSTEM_ADMIN_REQUESTER),
        ).rejects.toThrow(NotFoundException);
        });

        it('throws BadRequestException when account is already deactivated', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            id: 'user-id',
            isActive: false,
            fullName: 'Kenny Solape',
        });

        await expect(
            service.deactivateUser('user-id', SYSTEM_ADMIN_REQUESTER),
        ).rejects.toThrow(BadRequestException);

        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

        it('revokes tokens before updating the user record', async () => {
        const callOrder: string[] = [];
        mockPrisma.user.findUnique.mockResolvedValue({
            id: 'user-id',
            isActive: true,
            fullName: 'Kenny',
        });
        mockPrisma.refreshToken.updateMany.mockImplementation(() => {
            callOrder.push('revokeTokens');
            return Promise.resolve({ count: 1 });
        });
        mockPrisma.user.update.mockImplementation(() => {
            callOrder.push('updateUser');
            return Promise.resolve({ ...SAFE_USER, isActive: false });
        });

        await service.deactivateUser('user-id', SYSTEM_ADMIN_REQUESTER);

        expect(callOrder).toEqual(['revokeTokens', 'updateUser']);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // reactivateUser()
    // ══════════════════════════════════════════════════════════════════════════

    describe('reactivateUser()', () => {
        it('reactivates a deactivated user', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            id: 'user-id',
            isActive: false,
            fullName: 'Kenny Solape',
        });
        mockPrisma.user.update.mockResolvedValue({ ...SAFE_USER, isActive: true });

        const result = await service.reactivateUser('user-id');

        expect(result.isActive).toBe(true);
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
            where: { id: 'user-id' },
            data: { isActive: true },
            }),
        );
        });

        it('throws NotFoundException when user does not exist', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        await expect(service.reactivateUser('nonexistent')).rejects.toThrow(
            NotFoundException,
        );
        });

        it('throws BadRequestException when account is already active', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            id: 'user-id',
            isActive: true,
            fullName: 'Kenny Solape',
        });

        await expect(service.reactivateUser('user-id')).rejects.toThrow(
            BadRequestException,
        );

        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // resetUserPassword()
    // ══════════════════════════════════════════════════════════════════════════

    describe('resetUserPassword()', () => {
        it('resets password and revokes all sessions', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            email: 'kenny@darvinks.com',
            fullName: 'Kenny Solape',
        });
        mockPrisma.user.update.mockResolvedValue({});
        mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });
        mockQueue.add.mockResolvedValue(undefined);

        const result = await service.resetUserPassword('user-id');

        expect(result.message).toContain('kenny@darvinks.com');
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
            where: { id: 'user-id' },
            data: expect.objectContaining({ mustChangePassword: true }),
            }),
        );
        expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
            where: { userId: 'user-id', isRevoked: false },
            data: { isRevoked: true },
        });
        });

        it('stores a bcrypt hash of the new temporary password', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            email: 'kenny@darvinks.com',
            fullName: 'Kenny Solape',
        });
        mockPrisma.user.update.mockResolvedValue({});
        mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
        mockQueue.add.mockResolvedValue(undefined);

        await service.resetUserPassword('user-id');

        const updateData = mockPrisma.user.update.mock.calls[0][0].data;
        expect(updateData.passwordHash).toMatch(/^\$2[aby]\$\d+\$/);
        });

        it('queues a password reset email with the correct payload', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            email: 'kenny@darvinks.com',
            fullName: 'Kenny Solape',
        });
        mockPrisma.user.update.mockResolvedValue({});
        mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

        await service.resetUserPassword('user-id');

        expect(mockQueue.add).toHaveBeenCalledWith(
            'send-password-reset-email',
            expect.objectContaining({
            userId: 'user-id',
            email: 'kenny@darvinks.com',
            fullName: 'Kenny Solape',
            temporaryPassword: expect.any(String),
            }),
            expect.any(Object),
        );
        });

        it('throws NotFoundException when user does not exist', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        await expect(service.resetUserPassword('nonexistent')).rejects.toThrow(
            NotFoundException,
        );

        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        expect(mockQueue.add).not.toHaveBeenCalled();
        });

        it('runs password update and token revocation in parallel', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            email: 'kenny@darvinks.com',
            fullName: 'Kenny Solape',
        });

        let updateStarted = false;
        let revokeStarted = false;

        mockPrisma.user.update.mockImplementation(async () => {
            updateStarted = true;
            return {};
        });
        mockPrisma.refreshToken.updateMany.mockImplementation(async () => {
            revokeStarted = true;
            return { count: 1 };
        });
        mockQueue.add.mockResolvedValue(undefined);

        await service.resetUserPassword('user-id');

        expect(updateStarted).toBe(true);
        expect(revokeStarted).toBe(true);
        });
    });
        // ══════════════════════════════════════════════════════════════════════════
        // createInvite()
        // ══════════════════════════════════════════════════════════════════════════

        describe('createInvite()', () => {
            const INVITE_DTO = {
                email: 'adaeze@darvinks.com',
                role: 'SALES_HEAD' as any,
                team: 'BRIGHT' as any,
            };

            it('throws ForbiddenException when requester is not TIER5_SYSTEM_ADMIN', async () => {
                await expect(
                    service.createInvite(NON_ADMIN_REQUESTER, INVITE_DTO),
                ).rejects.toThrow(ForbiddenException);
            });

            it('throws ConflictException when email is already registered', async () => {
                mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

                await expect(
                    service.createInvite(SYSTEM_ADMIN_REQUESTER, INVITE_DTO),
                ).rejects.toThrow(ConflictException);
            });

            it('throws BadRequestException when SALES_HEAD invite is missing team', async () => {
                mockPrisma.user.findUnique.mockResolvedValue(null);

                await expect(
                    service.createInvite(SYSTEM_ADMIN_REQUESTER, {
                        ...INVITE_DTO,
                        team: undefined,
                    }),
                ).rejects.toThrow(BadRequestException);
            });

            it('throws BadRequestException when WAREHOUSE_ADMIN invite is missing warehouseLocation', async () => {
                mockPrisma.user.findUnique.mockResolvedValue(null);

                await expect(
                    service.createInvite(SYSTEM_ADMIN_REQUESTER, {
                        email: 'wa@darvinks.com',
                        role: 'WAREHOUSE_ADMIN' as any,
                    }),
                ).rejects.toThrow(BadRequestException);
            });

            it('creates invite and returns token + expiresAt', async () => {
                mockPrisma.user.findUnique.mockResolvedValue(null);
                mockPrisma.inviteToken.updateMany.mockResolvedValue({ count: 0 });
                mockPrisma.inviteToken.create.mockResolvedValue({ id: 'invite-id' });
                mockMail.sendInviteEmail.mockResolvedValue(undefined);

                const result = await service.createInvite(
                    SYSTEM_ADMIN_REQUESTER,
                    INVITE_DTO,
                );

                expect(result.inviteToken).toBeDefined();
                expect(result.expiresAt).toBeInstanceOf(Date);
                expect(result.message).toContain(INVITE_DTO.email);
            });

            it('invalidates previous unused invites for the same email', async () => {
                mockPrisma.user.findUnique.mockResolvedValue(null);
                mockPrisma.inviteToken.updateMany.mockResolvedValue({ count: 1 });
                mockPrisma.inviteToken.create.mockResolvedValue({ id: 'invite-id' });

                await service.createInvite(SYSTEM_ADMIN_REQUESTER, INVITE_DTO);

                expect(mockPrisma.inviteToken.updateMany).toHaveBeenCalledWith({
                    where: { email: INVITE_DTO.email, isUsed: false },
                    data:  { isUsed: true },
                });
            });

            it('sends invite email fire-and-forget after token creation', async () => {
                mockPrisma.user.findUnique.mockResolvedValue(null);
                mockPrisma.inviteToken.updateMany.mockResolvedValue({ count: 0 });
                mockPrisma.inviteToken.create.mockResolvedValue({ id: 'invite-id' });
                mockMail.sendInviteEmail.mockResolvedValue(undefined);

                await service.createInvite(SYSTEM_ADMIN_REQUESTER, INVITE_DTO);

                // fire-and-forget — give it a tick
                await new Promise(resolve => setImmediate(resolve));

                expect(mockMail.sendInviteEmail).toHaveBeenCalledWith(
                    expect.objectContaining({
                        to:       INVITE_DTO.email,
                        roleLabel: 'Sales Head',
                    }),
                );
            });
        });

        // ══════════════════════════════════════════════════════════════════════════
        // getInvite()
        // ═════════════════════════════════════════════════════════════════════════════════════

        describe('getInvite()', () => {
            const VALID_INVITE = {
                email:             'adaeze@darvinks.com',
                role:              'SALES_HEAD',
                team:              'BRIGHT',
                warehouseLocation: null,
                isUsed:            false,
                expiresAt:         new Date(Date.now() + 24 * 60 * 60 * 1000),
            };

            it('returns invite details for a valid token', async () => {
                mockPrisma.inviteToken.findUnique.mockResolvedValue(VALID_INVITE);

                const result = await service.getInvite('valid-token');

                expect(result.email).toBe('adaeze@darvinks.com');
                expect(result.role).toBe('SALES_HEAD');
                expect(result.roleLabel).toBe('Sales Head');
            });

            it('throws BadRequestException for unknown token', async () => {
                mockPrisma.inviteToken.findUnique.mockResolvedValue(null);

                await expect(service.getInvite('bad-token')).rejects.toThrow(
                    BadRequestException,
                );
            });

            it('throws BadRequestException when invite is already used', async () => {
                mockPrisma.inviteToken.findUnique.mockResolvedValue({
                    ...VALID_INVITE,
                    isUsed: true,
                });

                await expect(service.getInvite('used-token')).rejects.toThrow(
                    BadRequestException,
                );
            });

            it('throws BadRequestException when invite has expired', async () => {
                mockPrisma.inviteToken.findUnique.mockResolvedValue({
                    ...VALID_INVITE,
                    expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
                });

                await expect(service.getInvite('expired-token')).rejects.toThrow(
                    BadRequestException,
                );
            });
        });

});