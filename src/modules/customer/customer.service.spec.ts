// src/modules/customers/customer.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Region } from '@prisma/client';
import { CustomerService } from './customer.service';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  customer: {
    findFirst:  jest.fn(),
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
  },
  outOfRegionRequest: {
    findFirst:  jest.fn(),
    findUnique: jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
  },
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CUSTOMER = {
  id:              'cust-id',
  businessName:    'Ore Ofe Distributors Ltd',
  address:         '12 Kolade Street, Ilupeju, Lagos',
  mobilePhone:     '+2348012345678',
  whatsApp:        null,
  email:           null,
  cacNumber:       null,
  contactPerson:   'Chukwuemeka Obi',
  contactPhone:    '+2348055555555',
  contactPosition: null,
  region:          Region.LAGOS_2, // RADIANT team + lagos → LAGOS_2
  state:           'lagos',
  isActive:        true,
  balanceKobo:     0,
  ownerId:         'user-id',
  createdAt:       new Date(),
  updatedAt:       new Date(),
};

const CREATE_DTO = {
  businessName:  'Ore Ofe Distributors Ltd',
  address:       '12 Kolade Street, Ilupeju, Lagos',
  mobilePhone:   '+2348012345678',
  contactPerson: 'Chukwuemeka Obi',
  contactPhone:  '+2348055555555',
  state:         'lagos',
};

function makeRequester(
  overrides: Partial<JwtPayload> = {},
): JwtPayload {
  return {
    sub:    'user-id',
    email:  'agent@darvinks.com',
    tier:   'TIER2',
    team:   'RADIANT',
    region: Region.LAGOS_2, // RADIANT team + lagos → LAGOS_2
    ...overrides,
  } as JwtPayload;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CustomerService', () => {
  let service: CustomerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
    jest.resetAllMocks();
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates and returns customer when requester is in the same region', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.create.mockResolvedValue(CUSTOMER);

      const result = await service.create(CREATE_DTO, makeRequester());

      expect(result).toEqual(CUSTOMER);
      expect(mockPrisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            businessName: CREATE_DTO.businessName,
            ownerId:      'user-id',
          }),
        }),
      );
    });

    it('auto-derives region from state', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.create.mockResolvedValue(CUSTOMER);

      // makeRequester defaults to team:RADIANT — resolveRegion('lagos','RADIANT') = LAGOS_2
      await service.create({ ...CREATE_DTO, state: 'lagos' }, makeRequester());

      const data = mockPrisma.customer.create.mock.calls[0][0].data;
      expect(data.region).toBe(Region.LAGOS_2);
    });

    it('throws ConflictException when phone already registered', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.create(CREATE_DTO, makeRequester())).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.customer.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when field staff creates outside their region', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      // Enugu customer (SE1) but requester is RADIANT Lagos (LAGOS_2) — different regions
      const requester = makeRequester({ tier: 'TIER2', region: Region.LAGOS_2, team: 'RADIANT' });

      await expect(
        service.create({ ...CREATE_DTO, state: 'enugu' }, requester),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin can create customers in any region', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.create.mockResolvedValue(CUSTOMER);
      const admin = makeRequester({ tier: 'TIER5_SYSTEM_ADMIN', region: undefined as any });

      await expect(service.create(CREATE_DTO, admin)).resolves.not.toThrow();
    });

    it('normalises state to lowercase', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.create.mockResolvedValue(CUSTOMER);

      await service.create({ ...CREATE_DTO, state: 'LAGOS' }, makeRequester());

      const data = mockPrisma.customer.create.mock.calls[0][0].data;
      expect(data.state).toBe('lagos');
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('field staff see only their region', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([CUSTOMER]);
      const requester = makeRequester({ tier: 'TIER2', region: Region.LAGOS_2 });

      await service.findAll({}, requester);

      const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
      expect(where.region).toBe(Region.LAGOS_2);
    });

    it('admin sees all regions (no region filter applied)', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      const admin = makeRequester({ tier: 'TIER5_SYSTEM_ADMIN' });

      await service.findAll({}, admin);

      const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
      expect(where.region).toBeUndefined();
    });

    it('admin can filter by region explicitly', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      const admin = makeRequester({ tier: 'TIER5_SALES_HEAD' });

      await service.findAll({ region: Region.SE1 }, admin);

      const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
      expect(where.region).toBe(Region.SE1);
    });

    it('applies isActive filter when provided', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      await service.findAll({ isActive: false }, makeRequester({ tier: 'TIER5_SYSTEM_ADMIN' }));

      const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
      expect(where.isActive).toBe(false);
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns customer when found and requester has access', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(CUSTOMER);

      const result = await service.findById('cust-id', makeRequester());
      expect(result).toEqual(CUSTOMER);
    });

    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(
        service.findById('bad-id', makeRequester()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when field staff accesses customer in another region', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER,
        region: Region.NORTH_BRIGHT,
      });
      const requester = makeRequester({ tier: 'TIER2', region: Region.LAGOS_2 });

      await expect(
        service.findById('cust-id', requester),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin can access customer in any region', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER,
        region: Region.NORTH_BRIGHT,
      });
      const admin = makeRequester({ tier: 'TIER5_SYSTEM_ADMIN' });

      await expect(service.findById('cust-id', admin)).resolves.not.toThrow();
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('owner can update their own customer', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(CUSTOMER);
      mockPrisma.customer.update.mockResolvedValue({
        ...CUSTOMER,
        businessName: 'Updated Name',
      });

      const result = await service.update(
        'cust-id',
        { businessName: 'Updated Name' },
        makeRequester({ sub: 'user-id' }),
      );
      expect(result.businessName).toBe('Updated Name');
    });

    it('throws ForbiddenException when non-owner tries to update', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(CUSTOMER); // ownerId: 'user-id'

      await expect(
        service.update(
          'cust-id',
          { businessName: 'Hack' },
          makeRequester({ sub: 'other-user-id' }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when updating to a duplicate phone', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(CUSTOMER);
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'other-cust' });

      await expect(
        service.update('cust-id', { mobilePhone: '+2348099999999' }, makeRequester()),
      ).rejects.toThrow(ConflictException);
    });

    it('recalculates region when state changes', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER,
        ownerId: 'user-id',
      });
      mockPrisma.customer.update.mockResolvedValue({
        ...CUSTOMER,
        state: 'enugu',
        region: Region.SE1,
      });

      // enugu → SE1 only on BRIGHT team; use BRIGHT admin to avoid region restriction
      const brightAdmin = makeRequester({ tier: 'TIER5_SYSTEM_ADMIN', team: 'BRIGHT' as any });
      await service.update('cust-id', { state: 'enugu' }, brightAdmin);

      const data = mockPrisma.customer.update.mock.calls[0][0].data;
      expect(data.state).toBe('enugu');
      expect(data.region).toBe(Region.SE1);
    });
  });

  // ── deactivate / reactivate ────────────────────────────────────────────────

  describe('deactivate()', () => {
    it('owner can deactivate their customer', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(CUSTOMER);
      mockPrisma.customer.update.mockResolvedValue({ ...CUSTOMER, isActive: false });

      const result = await service.deactivate('cust-id', makeRequester());
      expect(result.isActive).toBe(false);
    });

    it('throws ConflictException when already deactivated', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER, isActive: false });

      await expect(
        service.deactivate('cust-id', makeRequester()),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('reactivate()', () => {
    it('admin can reactivate a deactivated customer', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER,
        isActive:  false,
        ownerId:   'admin-id',
      });
      mockPrisma.customer.update.mockResolvedValue(CUSTOMER);
      const admin = makeRequester({ sub: 'admin-id', tier: 'TIER5_SYSTEM_ADMIN' });

      const result = await service.reactivate('cust-id', admin);
      expect(result.isActive).toBe(true);
    });

    it('throws ConflictException when already active', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(CUSTOMER); // isActive: true

      await expect(
        service.reactivate('cust-id', makeRequester()),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── out-of-region requests ─────────────────────────────────────────────────

  describe('requestOutOfRegion()', () => {
    it('creates request when customer is in a different region', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER,
        region: Region.NORTH_BRIGHT,
      });
      mockPrisma.outOfRegionRequest.findFirst.mockResolvedValue(null);
      mockPrisma.outOfRegionRequest.create.mockResolvedValue({
        id:         'oor-id',
        customerId: 'cust-id',
        status:     'PENDING',
        note:       null,
        createdAt:  new Date(),
      });

      const result = await service.requestOutOfRegion(
        'cust-id',
        { note: 'Key account' },
        makeRequester({ region: Region.LAGOS_2 }),
      );
      expect(result.status).toBe('PENDING');
    });

    it('throws BadRequestException when customer is already in requester region', async () => {
      // CUSTOMER.region is LAGOS_2 — requester must match to trigger same-region check
      mockPrisma.customer.findUnique.mockResolvedValue(CUSTOMER);
      const requester = makeRequester({ region: Region.LAGOS_2 });

      await expect(
        service.requestOutOfRegion('cust-id', {}, requester),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when pending request already exists', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER,
        region: Region.NORTH_BRIGHT,
      });
      mockPrisma.outOfRegionRequest.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.requestOutOfRegion('cust-id', {}, makeRequester()),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('approveOutOfRegion()', () => {
    it('admin can approve a pending request', async () => {
      mockPrisma.outOfRegionRequest.findUnique.mockResolvedValue({
        id: 'oor-id', status: 'PENDING',
      });
      mockPrisma.outOfRegionRequest.update.mockResolvedValue({
        id: 'oor-id', status: 'APPROVED',
      });
      const admin = makeRequester({ tier: 'TIER5_SALES_HEAD' });

      const result = await service.approveOutOfRegion('oor-id', admin);
      expect(result.status).toBe('APPROVED');
    });

    it('throws ConflictException when request is not pending', async () => {
      mockPrisma.outOfRegionRequest.findUnique.mockResolvedValue({
        id: 'oor-id', status: 'APPROVED',
      });
      const admin = makeRequester({ tier: 'TIER5_SALES_HEAD' });

      await expect(
        service.approveOutOfRegion('oor-id', admin),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException for field staff trying to approve', async () => {
      await expect(
        service.approveOutOfRegion('oor-id', makeRequester({ tier: 'TIER2' })),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});