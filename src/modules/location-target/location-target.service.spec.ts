
import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TargetCategory } from '@prisma/client';
import { LocationTargetService } from './location-target.service';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  location:       { findUnique: jest.fn() },
  locationTarget: {
    upsert:     jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    delete:     jest.fn(),
  },
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TARGET_STUB = {
  id:          'target-id',
  locationId:  'loc-id',
  location:    { name: 'Arakale', state: 'ondo', region: 'SOUTH_WEST' },
  category:    TargetCategory.LOTION,
  periodMonth: '2026-07',
  targetValue: 5000,
  createdById: 'admin-id',
  createdBy:   { fullName: 'Admin User', employeeRef: 'Dar-00000001' },
  createdAt:   new Date(),
  updatedAt:   new Date(),
};

const SET_DTO = {
  locationId:  'loc-id',
  category:    TargetCategory.LOTION,
  periodMonth: '2026-07',
  targetValue: 5000,
};

function makeAdmin(): JwtPayload {
  return { sub: 'admin-id', email: 'admin@darvinks.com',
    tier: 'TIER5_SYSTEM_ADMIN', team: 'RADIANT' } as JwtPayload;
}
function makeSalesHead(): JwtPayload {
  return { sub: 'sh-id', email: 'sh@darvinks.com',
    tier: 'TIER5_SALES_HEAD', team: 'RADIANT' } as JwtPayload;
}
function makeFieldAgent(): JwtPayload {
  return { sub: 'agent-id', email: 'agent@darvinks.com',
    tier: 'TIER2', team: 'RADIANT' } as JwtPayload;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LocationTargetService', () => {
  let service: LocationTargetService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationTargetService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LocationTargetService>(LocationTargetService);
    jest.resetAllMocks();
  });

  // ── set (upsert) ───────────────────────────────────────────────────────────

  describe('set()', () => {
    beforeEach(() => {
      mockPrisma.location.findUnique.mockResolvedValue({ id: 'loc-id' });
      mockPrisma.locationTarget.upsert.mockResolvedValue(TARGET_STUB);
    });

    it('creates a new target for Admin', async () => {
      const result = await service.set(SET_DTO, makeAdmin());
      expect(result).toEqual(TARGET_STUB);
      expect(mockPrisma.locationTarget.upsert).toHaveBeenCalledTimes(1);
    });

    it('updates an existing target for Sales Head (upsert behaviour)', async () => {
      const updated = { ...TARGET_STUB, targetValue: 8000 };
      mockPrisma.locationTarget.upsert.mockResolvedValue(updated);

      const result = await service.set({ ...SET_DTO, targetValue: 8000 }, makeSalesHead());
      expect(result.targetValue).toBe(8000);
    });

    it('passes the correct upsert where clause using the unique constraint', async () => {
      await service.set(SET_DTO, makeAdmin());
      const call = mockPrisma.locationTarget.upsert.mock.calls[0][0];
      expect(call.where.locationId_category_periodMonth).toEqual({
        locationId:  'loc-id',
        category:    TargetCategory.LOTION,
        periodMonth: '2026-07',
      });
    });

    it('sets createdById from the requester on create', async () => {
      await service.set(SET_DTO, makeAdmin());
      const call = mockPrisma.locationTarget.upsert.mock.calls[0][0];
      expect(call.create.createdById).toBe('admin-id');
    });

    it('only updates targetValue on an existing row — never overwrites createdById', async () => {
      await service.set(SET_DTO, makeAdmin());
      const call = mockPrisma.locationTarget.upsert.mock.calls[0][0];
      expect(Object.keys(call.update)).toEqual(['targetValue']);
    });

    it('throws ForbiddenException for field staff', async () => {
      await expect(service.set(SET_DTO, makeFieldAgent()))
        .rejects.toThrow(ForbiddenException);
      expect(mockPrisma.location.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the location does not exist', async () => {
      mockPrisma.location.findUnique.mockResolvedValue(null);
      await expect(service.set(SET_DTO, makeAdmin()))
        .rejects.toThrow(NotFoundException);
      expect(mockPrisma.locationTarget.upsert).not.toHaveBeenCalled();
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('returns all targets when no filters are provided', async () => {
      mockPrisma.locationTarget.findMany.mockResolvedValue([TARGET_STUB]);
      const result = await service.findAll({});
      expect(result).toHaveLength(1);
    });

    it('applies locationId filter when provided', async () => {
      mockPrisma.locationTarget.findMany.mockResolvedValue([]);
      await service.findAll({ locationId: 'loc-id' });
      const where = mockPrisma.locationTarget.findMany.mock.calls[0][0].where;
      expect(where.locationId).toBe('loc-id');
    });

    it('applies category filter when provided', async () => {
      mockPrisma.locationTarget.findMany.mockResolvedValue([]);
      await service.findAll({ category: TargetCategory.SOAP });
      const where = mockPrisma.locationTarget.findMany.mock.calls[0][0].where;
      expect(where.category).toBe(TargetCategory.SOAP);
    });

    it('applies periodMonth filter when provided', async () => {
      mockPrisma.locationTarget.findMany.mockResolvedValue([]);
      await service.findAll({ periodMonth: '2026-07' });
      const where = mockPrisma.locationTarget.findMany.mock.calls[0][0].where;
      expect(where.periodMonth).toBe('2026-07');
    });

    it('orders by periodMonth desc then location name asc', async () => {
      mockPrisma.locationTarget.findMany.mockResolvedValue([]);
      await service.findAll({});
      const orderBy = mockPrisma.locationTarget.findMany.mock.calls[0][0].orderBy;
      expect(orderBy).toEqual([
        { periodMonth: 'desc' },
        { location: { name: 'asc' } },
      ]);
    });

    it('combines multiple filters when all are provided', async () => {
      mockPrisma.locationTarget.findMany.mockResolvedValue([]);
      await service.findAll({
        locationId: 'loc-id',
        category:   TargetCategory.CREAM,
        periodMonth: '2026-07',
      });
      const where = mockPrisma.locationTarget.findMany.mock.calls[0][0].where;
      expect(where.locationId).toBe('loc-id');
      expect(where.category).toBe(TargetCategory.CREAM);
      expect(where.periodMonth).toBe('2026-07');
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns the target when found', async () => {
      mockPrisma.locationTarget.findUnique.mockResolvedValue(TARGET_STUB);
      const result = await service.findById('target-id');
      expect(result).toEqual(TARGET_STUB);
    });

    it('throws NotFoundException for an unknown id', async () => {
      mockPrisma.locationTarget.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── remove ─────────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('deletes the target for Admin', async () => {
      mockPrisma.locationTarget.findUnique.mockResolvedValue({ id: 'target-id' });

      const result = await service.remove('target-id', makeAdmin());
      expect(result.message).toBe('Location target deleted');
      expect(mockPrisma.locationTarget.delete).toHaveBeenCalledWith({
        where: { id: 'target-id' },
      });
    });

    it('deletes the target for Sales Head', async () => {
      mockPrisma.locationTarget.findUnique.mockResolvedValue({ id: 'target-id' });
      await service.remove('target-id', makeSalesHead());
      expect(mockPrisma.locationTarget.delete).toHaveBeenCalledTimes(1);
    });

    it('throws ForbiddenException for field staff', async () => {
      await expect(service.remove('target-id', makeFieldAgent()))
        .rejects.toThrow(ForbiddenException);
      expect(mockPrisma.locationTarget.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when target does not exist', async () => {
      mockPrisma.locationTarget.findUnique.mockResolvedValue(null);
      await expect(service.remove('bad-id', makeAdmin()))
        .rejects.toThrow(NotFoundException);
      expect(mockPrisma.locationTarget.delete).not.toHaveBeenCalled();
    });
  });
});