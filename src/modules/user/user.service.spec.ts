// src/modules/users/users.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserTier, Team } from '@prisma/client';
import { getQueueToken } from '@nestjs/bull';
import { UsersService } from './user.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

const mockCloudinary = {
  uploadBuffer: jest.fn(),
};

const mockQueue = {
  add: jest.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<{ id: string; tier: UserTier; team: Team }> = {}) {
  return {
    id: 'user-id',
    employeeRef: 'Dar-00000001',
    fullName: 'Test User',
    email: 'test@darvinks.com',
    phone: '+2348012345678',
    role: 'MERCHANDISER',
    roleLabel: 'Merchandiser',
    tier: UserTier.TIER2,
    team: Team.BRIGHT,
    region: 'SE1',
    state: 'enugu',
    dateOfBirth: new Date('1995-01-01'),
    profilePictureUrl: null,
    idCardUrl: null,
    annualTargets: {},
    isActive: true,
    accountOrigin: 'SELF_REGISTERED',
    warehouseLocation: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRequester(
  tier: UserTier,
  team: Team = Team.BRIGHT,
): JwtPayload {
  return { sub: 'requester-id', email: 'req@darvinks.com', tier, team };
}

function makePhoto(): Express.Multer.File {
  return {
    buffer: Buffer.from('fake-image'),
    mimetype: 'image/jpeg',
    originalname: 'photo.jpg',
    size: 1024,
  } as Express.Multer.File;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CloudinaryService, useValue: mockCloudinary },
        { provide: getQueueToken('notifications'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);

    jest.resetAllMocks();

    // Default: Cloudinary upload succeeds
    mockCloudinary.uploadBuffer.mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/darvinks/photo.jpg',
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns user when found', async () => {
      const user = makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const result = await service.findById('user-id');
      expect(result).toEqual(user);
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('never exposes passwordHash', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser());
      await service.findById('user-id');

      const selectArg = mockPrisma.user.findUnique.mock.calls[0][0].select;
      expect(selectArg.passwordHash).toBeUndefined();
    });
  });

  // ── findProfile ────────────────────────────────────────────────────────────

  describe('findProfile()', () => {
    it('delegates to findById with the requesterId', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser());
      await service.findProfile('user-id');

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-id' } }),
      );
    });
  });

  // ── findVisible ────────────────────────────────────────────────────────────

  describe('findVisible()', () => {
    it('TIER5_SYSTEM_ADMIN sees all users with no team filter', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.findVisible(makeRequester(UserTier.TIER5_SYSTEM_ADMIN));

      const call = mockPrisma.user.findMany.mock.calls[0][0];
      expect(call.where).toBeUndefined();
    });

    it('TIER5_SALES_HEAD sees all users', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.findVisible(makeRequester(UserTier.TIER5_SALES_HEAD));

      const call = mockPrisma.user.findMany.mock.calls[0][0];
      expect(call.where).toBeUndefined();
    });

    it('TIER6_GM sees all users', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.findVisible(makeRequester(UserTier.TIER6_GM));

      const call = mockPrisma.user.findMany.mock.calls[0][0];
      expect(call.where).toBeUndefined();
    });

    it('TIER4 filters by team and includes lower tiers', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.findVisible(makeRequester(UserTier.TIER4, Team.BRIGHT));

      const call = mockPrisma.user.findMany.mock.calls[0][0];
      expect(call.where.team).toBe(Team.BRIGHT);
      expect(call.where.tier.in).toContain(UserTier.TIER1);
      expect(call.where.tier.in).toContain(UserTier.TIER2);
      expect(call.where.tier.in).toContain(UserTier.TIER3);
      expect(call.where.tier.in).toContain(UserTier.TIER4);
      expect(call.where.tier.in).not.toContain(UserTier.TIER5_SYSTEM_ADMIN);
    });

    it('TIER2 can only see TIER1 and TIER2 in the same team', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.findVisible(makeRequester(UserTier.TIER2, Team.BRIGHT));

      const call = mockPrisma.user.findMany.mock.calls[0][0];
      expect(call.where.team).toBe(Team.BRIGHT);
      expect(call.where.tier.in).toContain(UserTier.TIER1);
      expect(call.where.tier.in).toContain(UserTier.TIER2);
      expect(call.where.tier.in).not.toContain(UserTier.TIER3);
    });

    it('TIER1 can only see TIER1 in the same team', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.findVisible(makeRequester(UserTier.TIER1, Team.RADIANT));

      const call = mockPrisma.user.findMany.mock.calls[0][0];
      expect(call.where.team).toBe(Team.RADIANT);
      expect(call.where.tier.in).toEqual([UserTier.TIER1]);
    });

    it('does not leak users from the opposite team for non-admin tiers', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.findVisible(makeRequester(UserTier.TIER3, Team.BRIGHT));

      const call = mockPrisma.user.findMany.mock.calls[0][0];
      expect(call.where.team).toBe(Team.BRIGHT);
      expect(call.where.team).not.toBe(Team.RADIANT);
    });
  });

  // ── saveIdCardUrl ──────────────────────────────────────────────────────────

  describe('saveIdCardUrl()', () => {
    it('updates user record with the ID card URL', async () => {
      mockPrisma.user.update.mockResolvedValue({});

      await service.saveIdCardUrl('user-id', 'https://cloudinary.com/card.pdf');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        data: { idCardUrl: 'https://cloudinary.com/card.pdf' },
      });
    });
  });

  // ── updateProfile ──────────────────────────────────────────────────────────

  describe('updateProfile()', () => {
    it('updates phone when provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser());
      mockPrisma.user.update.mockResolvedValue(makeUser());

      await service.updateProfile('user-id', { phone: '+2349012345678' });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phone: '+2349012345678' }),
        }),
      );
    });

    it('uploads profile picture and persists URL', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser());
      mockPrisma.user.update.mockResolvedValue(makeUser());

      await service.updateProfile('user-id', {}, makePhoto());

      expect(mockCloudinary.uploadBuffer).toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            profilePictureUrl: 'https://res.cloudinary.com/darvinks/photo.jpg',
          }),
        }),
      );
    });

    it('queues ID card regeneration when profile picture is uploaded', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser());
      mockPrisma.user.update.mockResolvedValue(makeUser());

      await service.updateProfile('user-id', {}, makePhoto());

      expect(mockQueue.add).toHaveBeenCalledWith(
        'generate-id-card',
        expect.objectContaining({ userId: 'user-id' }),
        expect.any(Object),
      );
    });

    it('does NOT queue ID card regeneration when no photo is provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser());
      mockPrisma.user.update.mockResolvedValue(makeUser());

      await service.updateProfile('user-id', { phone: '+2348011111111' });

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('includes correct roleLabel in the ID card regeneration job', async () => {
      const user = makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue(user);

      await service.updateProfile('user-id', {}, makePhoto());

      expect(mockQueue.add).toHaveBeenCalledWith(
        'generate-id-card',
        expect.objectContaining({ roleLabel: 'Merchandiser' }),
        expect.any(Object),
      );
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.updateProfile('bad-id', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does not call Cloudinary when no picture is provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser());
      mockPrisma.user.update.mockResolvedValue(makeUser());

      await service.updateProfile('user-id', { phone: '+2348011111111' });

      expect(mockCloudinary.uploadBuffer).not.toHaveBeenCalled();
    });

    it('returns the updated user profile', async () => {
      const updated = { ...makeUser(), phone: '+2349012345678' };
      mockPrisma.user.findUnique.mockResolvedValue(makeUser());
      mockPrisma.user.update.mockResolvedValue(updated);

      const result = await service.updateProfile('user-id', { phone: '+2349012345678' });

      expect(result.phone).toBe('+2349012345678');
    });
  });

  // ── addDirectReport ────────────────────────────────────────────────────────

  describe('addDirectReport()', () => {
    const SALES_HEAD = {
      sub: 'sh-id', tier: 'TIER5_SALES_HEAD', team: 'RADIANT',
      email: 'sh@darvinks.com',
    } as any;

    const TIER4_RADIANT = {
      id: 'tier4-id', fullName: 'Kenny ZSM', tier: 'TIER4',
      team: 'RADIANT', isActive: true, reportsToId: null,
    };

    const TIER4_BRIGHT = {
      id: 'tier4-bright-id', fullName: 'Emeka ZSM', tier: 'TIER4',
      team: 'BRIGHT', isActive: true, reportsToId: null,
    };

    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(TIER4_RADIANT);
      mockPrisma.user.update.mockResolvedValue({ ...TIER4_RADIANT, reportsToId: 'sh-id' });
    });

    it('links a same-team Tier 4 to a Sales Head', async () => {
      const result = await service.addDirectReport('tier4-id', SALES_HEAD);
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
      const data = mockPrisma.user.update.mock.calls[0][0].data;
      expect(data.reportsToId).toBe('sh-id');
    });

    it('throws BadRequestException when the target is on a different team', async () => {
      // BRIGHT Tier 4 cannot report to RADIANT Sales Head
      mockPrisma.user.findUnique.mockResolvedValue(TIER4_BRIGHT);
      await expect(
        service.addDirectReport('tier4-bright-id', SALES_HEAD),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when target tier does not match expected', async () => {
      // Sales Head expects TIER4, not TIER3
      mockPrisma.user.findUnique.mockResolvedValue({
        ...TIER4_RADIANT, tier: 'TIER3',
      });
      await expect(
        service.addDirectReport('tier4-id', SALES_HEAD),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when target is already linked to another manager', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...TIER4_RADIANT, reportsToId: 'other-manager-id',
      });
      await expect(
        service.addDirectReport('tier4-id', SALES_HEAD),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when target already reports to the requester', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...TIER4_RADIANT, reportsToId: 'sh-id',
      });
      await expect(
        service.addDirectReport('tier4-id', SALES_HEAD),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when target is deactivated', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...TIER4_RADIANT, isActive: false,
      });
      await expect(
        service.addDirectReport('tier4-id', SALES_HEAD),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when target user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.addDirectReport('bad-id', SALES_HEAD),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a TIER1 tries to add a direct report', async () => {
      const tier1 = { ...SALES_HEAD, tier: 'TIER1' };
      await expect(
        service.addDirectReport('any-id', tier1),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});