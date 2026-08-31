// src/modules/customers/customer.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CustomerService } from './customer.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { GoogleMapsService } from '@common/google/google-map.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  customer:           { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  location:           { findUnique: jest.fn() },
  outOfRegionRequest: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
};

const mockMaps = {
  reverseGeocode: jest.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CUSTOMER_STUB = {
  id:                    'cust-id',
  businessName:          'Ore Ofe Distributors Ltd',
  address:               '12 Kolade Street, Ilupeju, Lagos',
  mobilePhone:           '+2348099900001',
  region:                'SOUTH_WEST',
  state:                 'lagos',
  customerType:          'PRIMARY',
  secondaryCustomerType: null,
  isActive:              true,
  ownerId:               'agent-id',
  balanceKobo:           BigInt(0),
  createdAt:             new Date(),
  updatedAt:             new Date(),
};

const SECONDARY_STUB = {
  ...CUSTOMER_STUB,
  id:                    'sec-id',
  businessName:          'Bright Wholesalers',
  customerType:          'SECONDARY',
  secondaryCustomerType: 'WHOLESALER',
};

// Field agent base
function makeAgent(tier = 'TIER2', region = 'SOUTH_WEST', sub = 'agent-id'): JwtPayload {
  return { sub, email: 'agent@test.com', tier, team: 'RADIANT', region } as JwtPayload;
}
function makeSalesSupport(): JwtPayload {
  return { sub: 'ss-id', email: 'ss@test.com', tier: 'TIER5_SALES_SUPPORT', team: 'RADIANT', region: undefined } as any;
}
function makeSalesHead(): JwtPayload {
  return { sub: 'sh-id', email: 'sh@test.com', tier: 'TIER5_SALES_HEAD', team: 'RADIANT', region: undefined } as any;
}
function makeFieldSupport(): JwtPayload {
  return { sub: 'fs-id', email: 'fs@test.com', tier: 'TIER5_FIELD_SUPPORT', team: 'RADIANT', region: undefined } as any;
}

const FIELD_CREATE_DTO = {
  businessName:          'New KD',
  mobilePhone:           '+2348011100001',
  contactPerson:         'Chukwuemeka',
  contactPhone:          '+2348011100002',
  customerType:          'PRIMARY',
  latitude:              6.5244,
  longitude:             3.3792,
};

const ADMIN_CREATE_DTO = {
  businessName:          'Admin KD',
  mobilePhone:           '+2348011100003',
  contactPerson:         'Admin Person',
  contactPhone:          '+2348011100004',
  customerType:          'PRIMARY',
  address:               '1 Admin Street, Lagos',
  state:                 'lagos',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CustomerService', () => {
  let service: CustomerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: PrismaService,     useValue: mockPrisma },
        { provide: GoogleMapsService, useValue: mockMaps },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
    jest.resetAllMocks();

    // Default happy-path mocks
    mockPrisma.customer.findFirst.mockResolvedValue(null);    // no duplicate phone
    mockPrisma.customer.findUnique.mockResolvedValue(CUSTOMER_STUB);
    mockPrisma.customer.findMany.mockResolvedValue([CUSTOMER_STUB]);
    mockPrisma.customer.create.mockResolvedValue(CUSTOMER_STUB);
    mockPrisma.customer.update.mockResolvedValue(CUSTOMER_STUB);
    mockPrisma.customer.count.mockResolvedValue(5);
    mockPrisma.location.findUnique.mockResolvedValue(null);
    mockPrisma.outOfRegionRequest.findFirst.mockResolvedValue(null);
    mockPrisma.outOfRegionRequest.create.mockResolvedValue({ id: 'req-id' });
    mockPrisma.outOfRegionRequest.findMany.mockResolvedValue([]);
    mockMaps.reverseGeocode.mockResolvedValue({ address: '12 Kolade St, Lagos', state: 'lagos' });
  });

  // ── create() ───────────────────────────────────────────────────────────────

  describe('create()', () => {

    describe('field agent (Tier 1–4)', () => {
      it('creates customer using GPS — resolves address from coordinates', async () => {
        await service.create(FIELD_CREATE_DTO as any, makeAgent('TIER2', 'SOUTH_WEST'));
        expect(mockMaps.reverseGeocode).toHaveBeenCalledWith(
          FIELD_CREATE_DTO.latitude,
          FIELD_CREATE_DTO.longitude,
        );
        expect(mockPrisma.customer.create).toHaveBeenCalledTimes(1);
      });

      it('throws BadRequestException when GPS coordinates are missing', async () => {
        const dto = { ...FIELD_CREATE_DTO, latitude: undefined, longitude: undefined };
        await expect(service.create(dto as any, makeAgent()))
          .rejects.toThrow(BadRequestException);
        expect(mockPrisma.customer.create).not.toHaveBeenCalled();
      });

      it('throws ForbiddenException when GPS places agent outside their region', async () => {
        // GPS resolves to abuja → NORTH_BRIGHT, but agent is SOUTH_WEST
        mockMaps.reverseGeocode.mockResolvedValue({ address: '1 Central Business District, Abuja', state: 'abuja' });
        await expect(service.create(FIELD_CREATE_DTO as any, makeAgent('TIER2', 'SOUTH_WEST')))
          .rejects.toThrow(ForbiddenException);
      });

      it('sets ownerId to the requesting agent', async () => {
        await service.create(FIELD_CREATE_DTO as any, makeAgent('TIER2', 'SOUTH_WEST'));
        const data = mockPrisma.customer.create.mock.calls[0][0].data;
        expect(data.ownerId).toBe('agent-id');
      });

      it('throws BadRequestException when SECONDARY created without secondaryCustomerType', async () => {
        const dto = { ...FIELD_CREATE_DTO, customerType: 'SECONDARY', secondaryCustomerType: undefined };
        await expect(service.create(dto as any, makeAgent()))
          .rejects.toThrow(BadRequestException);
      });

      it('creates SECONDARY customer when secondaryCustomerType is provided', async () => {
        mockPrisma.customer.create.mockResolvedValue(SECONDARY_STUB);
        const dto = { ...FIELD_CREATE_DTO, customerType: 'SECONDARY', secondaryCustomerType: 'WHOLESALER' };
        const result = await service.create(dto as any, makeAgent()) as any;
        expect(result.customerType).toBe('SECONDARY');
      });
    });

    describe('admin tier', () => {
      it('creates customer using manual address — no GPS needed', async () => {
        await service.create(ADMIN_CREATE_DTO as any, makeSalesSupport());
        expect(mockMaps.reverseGeocode).not.toHaveBeenCalled();
        expect(mockPrisma.customer.create).toHaveBeenCalledTimes(1);
      });

      it('throws BadRequestException when admin omits address', async () => {
        const dto = { ...ADMIN_CREATE_DTO, address: undefined };
        await expect(service.create(dto as any, makeSalesSupport()))
          .rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when admin omits state', async () => {
        const dto = { ...ADMIN_CREATE_DTO, state: undefined };
        await expect(service.create(dto as any, makeSalesSupport()))
          .rejects.toThrow(BadRequestException);
      });
    });

    describe('duplicate phone check', () => {
      it('throws ConflictException when phone already exists', async () => {
        mockPrisma.customer.findFirst.mockResolvedValue({ id: 'existing' });
        await expect(service.create(ADMIN_CREATE_DTO as any, makeSalesSupport()))
          .rejects.toThrow(ConflictException);
        expect(mockPrisma.customer.create).not.toHaveBeenCalled();
      });
    });

    describe('location validation', () => {
      it('throws NotFoundException when locationId does not exist', async () => {
        mockPrisma.location.findUnique.mockResolvedValue(null);
        const dto = { ...ADMIN_CREATE_DTO, locationId: 'bad-loc-id' };
        await expect(service.create(dto as any, makeSalesSupport()))
          .rejects.toThrow(NotFoundException);
      });

      it('throws BadRequestException when location is in a different state', async () => {
        mockPrisma.location.findUnique.mockResolvedValue({ id: 'loc-id', state: 'ogun', name: 'Sagamu' });
        const dto = { ...ADMIN_CREATE_DTO, locationId: 'loc-id', state: 'lagos' };
        await expect(service.create(dto as any, makeSalesSupport()))
          .rejects.toThrow(BadRequestException);
      });

      it('allows locationId when location is in the same state', async () => {
        mockPrisma.location.findUnique.mockResolvedValue({ id: 'loc-id', state: 'lagos', name: 'Ilupeju' });
        const dto = { ...ADMIN_CREATE_DTO, locationId: 'loc-id', state: 'lagos' };
        await expect(service.create(dto as any, makeSalesSupport())).resolves.not.toThrow();
      });
    });
  });

  // ── findAll() ──────────────────────────────────────────────────────────────

  describe('findAll()', () => {

    describe('ownership scoping — THE CORE RULE', () => {
      it('Tier 1 sees only customers they created (ownerId = their sub)', async () => {
        await service.findAll({} as any, makeAgent('TIER1', 'SOUTH_WEST', 'agent-id'));
        const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(where.ownerId).toBe('agent-id');
      });

      it('Tier 2 sees only their own customers', async () => {
        await service.findAll({} as any, makeAgent('TIER2', 'SOUTH_WEST', 'agent-id'));
        const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(where.ownerId).toBe('agent-id');
      });

      it('Tier 3 sees only their own customers', async () => {
        await service.findAll({} as any, makeAgent('TIER3', 'SOUTH_WEST', 'tier3-id'));
        const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(where.ownerId).toBe('tier3-id');
      });

      it('Tier 4 sees only their own customers', async () => {
        await service.findAll({} as any, makeAgent('TIER4', 'SOUTH_WEST', 'tier4-id'));
        const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(where.ownerId).toBe('tier4-id');
      });

      it('two Tier 2 agents get different results — no cross-visibility', async () => {
        // Agent A
        await service.findAll({} as any, makeAgent('TIER2', 'SOUTH_WEST', 'agent-a'));
        const whereA = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(whereA.ownerId).toBe('agent-a');

        // Agent B
        await service.findAll({} as any, makeAgent('TIER2', 'SOUTH_WEST', 'agent-b'));
        const whereB = mockPrisma.customer.findMany.mock.calls[1][0].where;
        expect(whereB.ownerId).toBe('agent-b');

        // They are different — B cannot see A's customers
        expect(whereA.ownerId).not.toBe(whereB.ownerId);
      });
    });

    describe('admin tiers — see all customers', () => {
      it('Sales Support Agent sees all customers with no ownerId filter', async () => {
        await service.findAll({} as any, makeSalesSupport());
        const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(where.ownerId).toBeUndefined();
      });

      it('Sales Head sees all customers', async () => {
        await service.findAll({} as any, makeSalesHead());
        const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(where.ownerId).toBeUndefined();
      });

      it('Field Support Agent sees all customers — no ownerId filter', async () => {
        await service.findAll({} as any, makeFieldSupport());
        const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(where.ownerId).toBeUndefined();
      });

      it('admin can filter by region', async () => {
        await service.findAll({ region: 'SOUTH_WEST' } as any, makeSalesSupport());
        const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(where.region).toBe('SOUTH_WEST');
      });
    });

    describe('filters', () => {
      it('applies customerType filter for PRIMARY', async () => {
        await service.findAll({ customerType: 'PRIMARY' } as any, makeSalesSupport());
        const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(where.customerType).toBe('PRIMARY');
      });

      it('applies customerType filter for SECONDARY', async () => {
        await service.findAll({ customerType: 'SECONDARY' } as any, makeSalesSupport());
        const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(where.customerType).toBe('SECONDARY');
      });

      it('applies secondaryCustomerType filter', async () => {
        await service.findAll({ secondaryCustomerType: 'WHOLESALER' } as any, makeSalesSupport());
        const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(where.secondaryCustomerType).toBe('WHOLESALER');
      });

      it('applies isActive filter', async () => {
        await service.findAll({ isActive: false } as any, makeSalesSupport());
        const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(where.isActive).toBe(false);
      });

      it('applies state filter (lowercased)', async () => {
        await service.findAll({ state: 'Lagos' } as any, makeSalesSupport());
        const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(where.state).toBe('lagos');
      });

      it('field agent does NOT get region filter — only ownerId', async () => {
        await service.findAll({ region: 'SOUTH_WEST' } as any, makeAgent('TIER2', 'SOUTH_WEST'));
        const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
        expect(where.ownerId).toBe('agent-id');
        // region filter is only applied for admins
        expect(where.region).toBeUndefined();
      });
    });
  });

  // ── findById() ─────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns customer when requester is the owner', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER_STUB, ownerId: 'agent-id' });
      await expect(service.findById('cust-id', makeAgent())).resolves.not.toThrow();
    });

    it('throws ForbiddenException when non-owner field agent tries to access', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER_STUB, ownerId: 'someone-else' });
      await expect(service.findById('cust-id', makeAgent('TIER2', 'SOUTH_WEST', 'not-the-owner')))
        .rejects.toThrow(ForbiddenException);
    });

    it('admin can access any customer regardless of owner', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER_STUB, ownerId: 'someone-else' });
      await expect(service.findById('cust-id', makeSalesSupport())).resolves.not.toThrow();
    });

    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id', makeAgent()))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── update() ───────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('owner can update their own customer', async () => {
      await expect(service.update('cust-id', { businessName: 'New Name' } as any, makeAgent()))
        .resolves.not.toThrow();
    });

    it('throws ForbiddenException when non-owner tries to update', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER_STUB, ownerId: 'other-agent' });
      await expect(service.update('cust-id', { businessName: 'X' } as any, makeAgent()))
        .rejects.toThrow(ForbiddenException);
    });

    it('admin can update any customer', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER_STUB, ownerId: 'someone-else' });
      await expect(service.update('cust-id', { businessName: 'X' } as any, makeSalesSupport()))
        .resolves.not.toThrow();
    });

    it('throws ConflictException when new phone already belongs to another customer', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'other-cust' });
      await expect(service.update('cust-id', { mobilePhone: '+2348099900002' } as any, makeAgent()))
        .rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException for unknown customer', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.update('bad-id', {} as any, makeAgent()))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── deactivate() ───────────────────────────────────────────────────────────

  describe('deactivate()', () => {
    it('owner can deactivate', async () => {
      await service.deactivate('cust-id', makeAgent());
      const data = mockPrisma.customer.update.mock.calls[0][0].data;
      expect(data.isActive).toBe(false);
    });

    it('throws when customer is already inactive', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER_STUB, isActive: false });
      await expect(service.deactivate('cust-id', makeAgent())).rejects.toThrow();
    });

    it('throws ForbiddenException when non-owner tries to deactivate', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER_STUB, ownerId: 'other' });
      await expect(service.deactivate('cust-id', makeAgent()))
        .rejects.toThrow(ForbiddenException);
    });
  });

  // ── reactivate() ───────────────────────────────────────────────────────────

  describe('reactivate()', () => {
    it('owner can reactivate', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER_STUB, isActive: false });
      await service.reactivate('cust-id', makeAgent());
      const data = mockPrisma.customer.update.mock.calls[0][0].data;
      expect(data.isActive).toBe(true);
    });

    it('throws when customer is already active', async () => {
      await expect(service.reactivate('cust-id', makeAgent())).rejects.toThrow();
    });
  });

  // ── requestOutOfRegion() ───────────────────────────────────────────────────

  describe('requestOutOfRegion()', () => {
    beforeEach(() => {
      // Customer is in NORTH_BRIGHT — agent is in SOUTH_WEST → out of region ✓
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER_STUB,
        region: 'NORTH_BRIGHT',
      });
    });

    it('creates an OOR request when customer is outside agent region', async () => {
      await expect(service.requestOutOfRegion('cust-id', {} as any, makeAgent('TIER2', 'SOUTH_WEST')))
        .resolves.not.toThrow();
      expect(mockPrisma.outOfRegionRequest.create).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException when customer is already in the agent region', async () => {
      // Same region as agent — no request needed
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER_STUB,
        region: 'SOUTH_WEST',
      });
      await expect(service.requestOutOfRegion('cust-id', {} as any, makeAgent('TIER2', 'SOUTH_WEST')))
        .rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when a pending OOR request already exists', async () => {
      mockPrisma.outOfRegionRequest.findFirst.mockResolvedValue({ id: 'existing-req' });
      await expect(service.requestOutOfRegion('cust-id', {} as any, makeAgent('TIER2', 'SOUTH_WEST')))
        .rejects.toThrow(ConflictException);
    });
  });

  // ── approveOutOfRegion() ───────────────────────────────────────────────────

  describe('approveOutOfRegion()', () => {
    beforeEach(() => {
      mockPrisma.outOfRegionRequest.findUnique.mockResolvedValue({
        id:         'req-id',
        status:     'PENDING',
        customerId: 'cust-id',
      });
      mockPrisma.outOfRegionRequest.update.mockResolvedValue({ id: 'req-id', status: 'APPROVED' });
    });

    it('Sales Head can approve OOR request', async () => {
      await expect(service.approveOutOfRegion('req-id', makeSalesHead())).resolves.not.toThrow();
    });

    it('Tier 4 can approve OOR request', async () => {
      await expect(service.approveOutOfRegion('req-id', makeAgent('TIER4'))).resolves.not.toThrow();
    });

    it('throws ForbiddenException for Tier 2', async () => {
      await expect(service.approveOutOfRegion('req-id', makeAgent('TIER2')))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for unknown request', async () => {
      mockPrisma.outOfRegionRequest.findUnique.mockResolvedValue(null);
      await expect(service.approveOutOfRegion('bad-id', makeSalesHead()))
        .rejects.toThrow(NotFoundException);
    });
  });
});