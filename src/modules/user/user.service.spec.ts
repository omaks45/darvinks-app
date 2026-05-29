import type { File as MulterFile } from 'multer';
// src/modules/users/users.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UserTier, Team } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import type { JwtPayload } from '@modules/auth/strategies/jwt.strategy';

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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<{ id: string; tier: UserTier; team: Team }> = {}) {
  return {
    id: 'user-id',
    employeeRef: 'DRV-BRT-0001',
    fullName: 'Test User',
    email: 'test@darvinks.com',
    phone: '+2348012345678',
    tier: UserTier.TIER2,
    team: Team.BRIGHT,
    region: 'SE1',
    state: 'enugu',
    dateOfBirth: new Date('1995-01-01'),
    profilePictureUrl: null,
    idCardUrl: null,
    annualTargets: {},
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRequester(tier: UserTier, team: Team = Team.BRIGHT): JwtPayload {
  return { sub: 'requester-id', email: 'req@darvinks.com', tier, team };
}

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CloudinaryService, useValue: mockCloudinary },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
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

      await expect(service.findById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── findVisible ────────────────────────────────────────────────────────────

  describe('findVisible()', () => {
    it('TIER5_SYSTEM_ADMIN can see all users (no team filter)', async () => {
      const users = [makeUser(), makeUser({ team: Team.RADIANT })];
      mockPrisma.user.findMany.mockResolvedValue(users);

      await service.findVisible(makeRequester(UserTier.TIER5_SYSTEM_ADMIN));

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ where: expect.objectContaining({ team: expect.anything() }) }),
      );
    });

    it('TIER5_SALES_HEAD can see all users', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.findVisible(makeRequester(UserTier.TIER5_SALES_HEAD));
      // Should NOT have team filter
      const call = mockPrisma.user.findMany.mock.calls[0][0];
      expect(call.where).toBeUndefined();
    });

    it('TIER6_GM can see all users', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.findVisible(makeRequester(UserTier.TIER6_GM));
      const call = mockPrisma.user.findMany.mock.calls[0][0];
      expect(call.where).toBeUndefined();
    });

    it('TIER4 (ZSM) filters by team and lower tiers', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.findVisible(makeRequester(UserTier.TIER4, Team.BRIGHT));

      const call = mockPrisma.user.findMany.mock.calls[0][0];
      expect(call.where.team).toBe(Team.BRIGHT);
      expect(call.where.tier.in).toContain(UserTier.TIER1);
      expect(call.where.tier.in).toContain(UserTier.TIER2);
      expect(call.where.tier.in).toContain(UserTier.TIER3);
      expect(call.where.tier.in).toContain(UserTier.TIER4);
    });

    it('TIER2 (SR) can only see TIER1 and own tier in same team', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.findVisible(makeRequester(UserTier.TIER2, Team.BRIGHT));

      const call = mockPrisma.user.findMany.mock.calls[0][0];
      expect(call.where.team).toBe(Team.BRIGHT);
      expect(call.where.tier.in).toContain(UserTier.TIER1);
      expect(call.where.tier.in).toContain(UserTier.TIER2);
      expect(call.where.tier.in).not.toContain(UserTier.TIER3);
      expect(call.where.tier.in).not.toContain(UserTier.TIER4);
    });

    it('TIER1 can only see their own tier in the same team', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.findVisible(makeRequester(UserTier.TIER1, Team.RADIANT));

      const call = mockPrisma.user.findMany.mock.calls[0][0];
      expect(call.where.team).toBe(Team.RADIANT);
      // TIER1 has no lower tiers, so only sees TIER1
      expect(call.where.tier.in).toEqual([UserTier.TIER1]);
    });

    it('does not leak users from opposite team for non-admin tiers', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.findVisible(makeRequester(UserTier.TIER3, Team.BRIGHT));

      const call = mockPrisma.user.findMany.mock.calls[0][0];
      expect(call.where.team).toBe(Team.BRIGHT);
      // Must not have Team.RADIANT in the query
      expect(call.where.team).not.toBe(Team.RADIANT);
    });
  });

  // ── saveIdCardUrl ──────────────────────────────────────────────────────────

  describe('saveIdCardUrl()', () => {
    it('updates user record with the provided ID card URL', async () => {
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

    it('uploads new profile picture and persists URL', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser());
      mockCloudinary.uploadBuffer.mockResolvedValue({
        secure_url: 'https://cloudinary.com/new-photo.jpg',
      });
      mockPrisma.user.update.mockResolvedValue(makeUser());

      const mockFile = {
        buffer: Buffer.from('img'),
        mimetype: 'image/jpeg',
      } as MulterFile;

      await service.updateProfile('user-id', {}, mockFile);

      expect(mockCloudinary.uploadBuffer).toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            profilePictureUrl: 'https://cloudinary.com/new-photo.jpg',
          }),
        }),
      );
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.updateProfile('bad-id', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});