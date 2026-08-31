// src/modules/locations/location.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Region } from '@prisma/client';
import { LocationService } from './location.service';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  location: {
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    delete:     jest.fn(),
  },
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LOCATION_STUB = {
  id:        'loc-id',
  name:      'Arakale',
  state:     'ondo',
  region:    Region.SOUTH_WEST,
  createdAt: new Date(),
  _count:    { customers: 0 },
};

const CREATE_DTO = {
  name:   'Arakale',
  state:  'Ondo',       // intentionally mixed-case — service should normalise
  region: Region.SOUTH_WEST,
};

function makeAdmin(): JwtPayload {
  return { sub: 'admin-id', email: 'admin@darvinks.com',
    tier: 'TIER5_SALES_SUPPORT', team: 'RADIANT' } as JwtPayload;
}
function makeSalesHead(): JwtPayload {
  return { sub: 'sh-id', email: 'sh@darvinks.com',
    tier: 'TIER5_SALES_HEAD', team: 'RADIANT' } as JwtPayload;
}
function makeFieldAgent(): JwtPayload {
  return { sub: 'agent-id', email: 'agent@darvinks.com',
    tier: 'TIER2', team: 'RADIANT', region: 'SOUTH_WEST' } as JwtPayload;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LocationService', () => {
  let service: LocationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LocationService>(LocationService);
    jest.resetAllMocks();
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create()', () => {
    beforeEach(() => {
      mockPrisma.location.findUnique.mockResolvedValue(null); // no duplicate
      mockPrisma.location.create.mockResolvedValue(LOCATION_STUB);
    });

    it('creates a location for System Admin', async () => {
      const result = await service.create(CREATE_DTO, makeAdmin());
      expect(result).toEqual(LOCATION_STUB);
      expect(mockPrisma.location.create).toHaveBeenCalledTimes(1);
    });

    it('creates a location for Sales Head', async () => {
      const result = await service.create(CREATE_DTO, makeSalesHead());
      expect(result).toEqual(LOCATION_STUB);
    });

    it('normalises state to lowercase before saving', async () => {
      await service.create(CREATE_DTO, makeAdmin()); // DTO has "Ondo"
      const data = mockPrisma.location.create.mock.calls[0][0].data;
      expect(data.state).toBe('ondo');
    });

    it('checks uniqueness with the normalised lowercase state', async () => {
      await service.create(CREATE_DTO, makeAdmin());
      const where = mockPrisma.location.findUnique.mock.calls[0][0].where;
      expect(where.name_state.state).toBe('ondo');
    });

    it('throws ForbiddenException for field staff', async () => {
      await expect(service.create(CREATE_DTO, makeFieldAgent()))
        .rejects.toThrow(ForbiddenException);
      expect(mockPrisma.location.findUnique).not.toHaveBeenCalled();
    });

    it('throws ConflictException when location already exists in that state', async () => {
      mockPrisma.location.findUnique.mockResolvedValue({ id: 'existing-id' });
      await expect(service.create(CREATE_DTO, makeAdmin()))
        .rejects.toThrow(ConflictException);
      expect(mockPrisma.location.create).not.toHaveBeenCalled();
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('returns all locations when no filters are provided', async () => {
      mockPrisma.location.findMany.mockResolvedValue([LOCATION_STUB]);
      const result = await service.findAll({});
      expect(result).toHaveLength(1);
    });

    it('applies region filter when provided', async () => {
      mockPrisma.location.findMany.mockResolvedValue([]);
      await service.findAll({ region: Region.SOUTH_WEST });
      const where = mockPrisma.location.findMany.mock.calls[0][0].where;
      expect(where.region).toBe(Region.SOUTH_WEST);
    });

    it('normalises state filter to lowercase', async () => {
      mockPrisma.location.findMany.mockResolvedValue([]);
      await service.findAll({ state: 'Ondo' });
      const where = mockPrisma.location.findMany.mock.calls[0][0].where;
      expect(where.state).toBe('ondo');
    });

    it('applies no where clause when both filters are omitted', async () => {
      mockPrisma.location.findMany.mockResolvedValue([]);
      await service.findAll({});
      const where = mockPrisma.location.findMany.mock.calls[0][0].where;
      expect(where).toEqual({});
    });

    it('orders by region → state → name', async () => {
      mockPrisma.location.findMany.mockResolvedValue([]);
      await service.findAll({});
      const orderBy = mockPrisma.location.findMany.mock.calls[0][0].orderBy;
      expect(orderBy).toEqual([
        { region: 'asc' },
        { state: 'asc' },
        { name: 'asc' },
      ]);
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns the location with its active customers', async () => {
      const withCustomers = { ...LOCATION_STUB, customers: [{ id: 'c-1', businessName: 'Ore Ofe' }] };
      mockPrisma.location.findUnique.mockResolvedValue(withCustomers);
      const result = await service.findById('loc-id');
      expect(result.customers).toHaveLength(1);
    });

    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.location.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update()', () => {
    beforeEach(() => {
      // assertExists call + update call both use findUnique
      mockPrisma.location.findUnique.mockResolvedValue({ id: 'loc-id' });
      mockPrisma.location.update.mockResolvedValue({ ...LOCATION_STUB, name: 'Arakale Market' });
    });

    it('updates a location for Admin', async () => {
      const result = await service.update('loc-id', { name: 'Arakale Market' }, makeAdmin());
      expect(result.name).toBe('Arakale Market');
    });

    it('throws ForbiddenException for field staff', async () => {
      await expect(service.update('loc-id', { name: 'X' }, makeFieldAgent()))
        .rejects.toThrow(ForbiddenException);
      expect(mockPrisma.location.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when location does not exist', async () => {
      mockPrisma.location.findUnique.mockResolvedValue(null);
      await expect(service.update('bad-id', { name: 'X' }, makeAdmin()))
        .rejects.toThrow(NotFoundException);
      expect(mockPrisma.location.update).not.toHaveBeenCalled();
    });

    it('only includes provided fields in the update payload', async () => {
      await service.update('loc-id', { name: 'New Name' }, makeAdmin());
      const data = mockPrisma.location.update.mock.calls[0][0].data;
      expect(data.name).toBe('New Name');
      expect(data.region).toBeUndefined();
    });
  });

  // ── remove ─────────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('deletes a location with no linked customers or targets', async () => {
      mockPrisma.location.findUnique.mockResolvedValue({
        id: 'loc-id',
        _count: { customers: 0, targets: 0 },
      });

      const result = await service.remove('loc-id', makeAdmin());
      expect(result.message).toBe('Location deleted successfully');
      expect(mockPrisma.location.delete).toHaveBeenCalledWith({ where: { id: 'loc-id' } });
    });

    it('throws ConflictException when customers are still linked', async () => {
      mockPrisma.location.findUnique.mockResolvedValue({
        id: 'loc-id',
        _count: { customers: 3, targets: 0 },
      });
      await expect(service.remove('loc-id', makeAdmin()))
        .rejects.toThrow(ConflictException);
      expect(mockPrisma.location.delete).not.toHaveBeenCalled();
    });

    it('throws ConflictException when targets exist', async () => {
      mockPrisma.location.findUnique.mockResolvedValue({
        id: 'loc-id',
        _count: { customers: 0, targets: 2 },
      });
      await expect(service.remove('loc-id', makeAdmin()))
        .rejects.toThrow(ConflictException);
      expect(mockPrisma.location.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when location does not exist', async () => {
      mockPrisma.location.findUnique.mockResolvedValue(null);
      await expect(service.remove('bad-id', makeAdmin()))
        .rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for field staff', async () => {
      await expect(service.remove('loc-id', makeFieldAgent()))
        .rejects.toThrow(ForbiddenException);
      expect(mockPrisma.location.findUnique).not.toHaveBeenCalled();
    });
  });
});