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
import { GoogleMapsService } from '@common/google/google-map.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mock resolveRegion ────────────────────────────────────────────────────────
// resolveRegion is a pure utility function (not injected). We mock it at
// module level so tests control what region comes back without needing real
// state→region mapping logic — that logic has its own tests in region.util.spec.ts.
jest.mock('@common/utils/region.util', () => ({
  resolveRegion:               jest.fn(() => 'SOUTH_WEST'),
  resolveActualRegionForState: jest.fn(() => 'SOUTH_WEST'), // same region as agent default → no rejection
  generateEmployeeRef:         jest.fn(),
}));
import { resolveRegion, resolveActualRegionForState } from '@common/utils/region.util';
const mockResolveRegion              = resolveRegion               as jest.MockedFunction<typeof resolveRegion>;
const mockResolveActualRegionForState = resolveActualRegionForState as jest.MockedFunction<typeof resolveActualRegionForState>;

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  customer: {
    findFirst:  jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
  },
  location: {
    findUnique: jest.fn(),
  },
  outOfRegionRequest: {
    findFirst:  jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
  },
};

const mockMaps = {
  reverseGeocode: jest.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CUSTOMER_STUB = {
  id:              'cust-id',
  businessName:    'Ore Ofe Distributors Ltd',
  address:         '12 Kolade Street, Ilupeju, Lagos',
  mobilePhone:     '+2348099900001',
  whatsApp:        null,
  email:           null,
  cacNumber:       null,
  contactPerson:   'Chukwuemeka Obi',
  contactPhone:    '+2348055500001',
  contactPosition: null,
  region:          Region.SOUTH_WEST,
  state:           'lagos',
  locationId:      null,
  location:        null,
  isActive:        true,
  balanceKobo:     0,
  ownerId:         'agent-id',
  createdAt:       new Date(),
  updatedAt:       new Date(),
};

// What assertExists returns (slim select used internally)
const CUSTOMER_INTERNAL = {
  id:          'cust-id',
  ownerId:     'agent-id',
  region:      Region.SOUTH_WEST,
  isActive:    true,
  mobilePhone: '+2348099900001',
  businessName:'Ore Ofe Distributors Ltd',
};

const OOR_STUB = {
  id:         'oor-id',
  customerId: 'cust-id',
  status:     'PENDING',
  note:       null,
  createdAt:  new Date(),
};

// GPS geocode result — what Google Maps returns for the field agent's coords
const GEO_RESULT = {
  address:  '12 Kolade Street, Ilupeju, Lagos 101233, Nigeria',
  locality: 'Ilupeju',
  state:    'Lagos',
};

// ── GPS-based create DTO (Tiers 1-4)
const GPS_CREATE_DTO = {
  businessName:  'Ore Ofe Distributors Ltd',
  latitude:      6.5244,
  longitude:     3.3792,
  mobilePhone:   '+2348099900001',
  contactPerson: 'Chukwuemeka Obi',
  contactPhone:  '+2348055500001',
};

// ── Manual address create DTO (Admin tiers)
const MANUAL_CREATE_DTO = {
  businessName:  'Ore Ofe Distributors Ltd',
  address:       '12 Kolade Street, Ilupeju, Lagos',
  state:         'Lagos',
  mobilePhone:   '+2348099900001',
  contactPerson: 'Chukwuemeka Obi',
  contactPhone:  '+2348055500001',
};

// ─── Requester factories ───────────────────────────────────────────────────────

function makeFieldAgent(tier = 'TIER2'): JwtPayload {
  return {
    sub:    'agent-id',
    email:  'agent@darvinks.com',
    tier,
    team:   'RADIANT',
    region: Region.SOUTH_WEST as string,
  } as JwtPayload;
}

function makeAdmin(): JwtPayload {
  return {
    sub:    'admin-id',
    email:  'admin@darvinks.com',
    tier:   'TIER5_SYSTEM_ADMIN',
    team:   'RADIANT',
    region: undefined,
  } as JwtPayload;
}

function makeSalesHead(): JwtPayload {
  return {
    sub:    'sh-id',
    email:  'sh@darvinks.com',
    tier:   'TIER5_SALES_HEAD',
    team:   'RADIANT',
    region: Region.SOUTH_WEST as string,
  } as JwtPayload;
}

function makeTier4(): JwtPayload {
  return {
    sub:    'tier4-id',
    email:  'zsm@darvinks.com',
    tier:   'TIER4',
    team:   'RADIANT',
    region: Region.SOUTH_WEST as string,
  } as JwtPayload;
}

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

    // Safe defaults
    mockPrisma.customer.findFirst.mockResolvedValue(null);   // no duplicate phone
    mockPrisma.customer.create.mockResolvedValue(CUSTOMER_STUB);
    mockPrisma.customer.findUnique.mockResolvedValue(CUSTOMER_STUB);
    mockPrisma.customer.findMany.mockResolvedValue([CUSTOMER_STUB]);
    mockPrisma.customer.update.mockResolvedValue(CUSTOMER_STUB);
    mockPrisma.location.findUnique.mockResolvedValue(null);
    mockPrisma.outOfRegionRequest.findFirst.mockResolvedValue(null);
    mockPrisma.outOfRegionRequest.findMany.mockResolvedValue([]);
    mockPrisma.outOfRegionRequest.findUnique.mockResolvedValue(OOR_STUB);
    mockPrisma.outOfRegionRequest.create.mockResolvedValue(OOR_STUB);
    mockPrisma.outOfRegionRequest.update.mockResolvedValue({ ...OOR_STUB, status: 'APPROVED' });

    mockMaps.reverseGeocode.mockResolvedValue(GEO_RESULT);
    mockResolveRegion.mockReturnValue(Region.SOUTH_WEST);
    mockResolveActualRegionForState.mockReturnValue(Region.SOUTH_WEST); // matches agent's region → no rejection
  });

  // ── create() ───────────────────────────────────────────────────────────────

  describe('create()', () => {

    // ── Field tier path (GPS) ────────────────────────────────────────────────

    describe('field tier GPS path (Tier 1–4)', () => {
      it('creates a customer for Tier 2 using GPS coordinates', async () => {
        const result = await service.create(GPS_CREATE_DTO as any, makeFieldAgent('TIER2'));
        expect(result).toEqual(CUSTOMER_STUB);
        expect(mockMaps.reverseGeocode).toHaveBeenCalledWith(6.5244, 3.3792);
        expect(mockPrisma.customer.create).toHaveBeenCalledTimes(1);
      });

      it('creates a customer for Tier 1 using GPS coordinates', async () => {
        await service.create(GPS_CREATE_DTO as any, makeFieldAgent('TIER1'));
        expect(mockMaps.reverseGeocode).toHaveBeenCalledTimes(1);
      });

      it('creates a customer for Tier 3 using GPS coordinates', async () => {
        await service.create(GPS_CREATE_DTO as any, makeFieldAgent('TIER3'));
        expect(mockMaps.reverseGeocode).toHaveBeenCalledTimes(1);
      });

      it('creates a customer for Tier 4 using GPS coordinates', async () => {
        await service.create(GPS_CREATE_DTO as any, makeFieldAgent('TIER4'));
        expect(mockMaps.reverseGeocode).toHaveBeenCalledTimes(1);
      });

      it('uses the geocoded address as the customer address', async () => {
        await service.create(GPS_CREATE_DTO as any, makeFieldAgent());
        const data = mockPrisma.customer.create.mock.calls[0][0].data;
        expect(data.address).toBe(GEO_RESULT.address);
      });

      it('uses the geocoded state (lowercased) to derive region', async () => {
        await service.create(GPS_CREATE_DTO as any, makeFieldAgent());
        // resolveRegion should be called with 'lagos' (lowercased from "Lagos")
        expect(mockResolveRegion).toHaveBeenCalledWith('lagos', expect.any(String));
      });

      it('falls back to dto.state when geocoding returns no state', async () => {
        mockMaps.reverseGeocode.mockResolvedValue({
          address: '6.5244, 3.3792', locality: null, state: null,
        });
        const dto = { ...GPS_CREATE_DTO, state: 'Lagos' };
        await service.create(dto as any, makeFieldAgent());
        expect(mockResolveRegion).toHaveBeenCalledWith('lagos', expect.any(String));
      });

      it('throws BadRequestException when GPS returns no state and dto.state is also missing', async () => {
        mockMaps.reverseGeocode.mockResolvedValue({
          address: '6.5244, 3.3792', locality: null, state: null,
        });
        // no dto.state provided either
        await expect(
          service.create(GPS_CREATE_DTO as any, makeFieldAgent()),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when latitude is missing', async () => {
        const dto = { ...GPS_CREATE_DTO, latitude: undefined };
        await expect(
          service.create(dto as any, makeFieldAgent()),
        ).rejects.toThrow(BadRequestException);
        expect(mockMaps.reverseGeocode).not.toHaveBeenCalled();
      });

      it('throws BadRequestException when longitude is missing', async () => {
        const dto = { ...GPS_CREATE_DTO, longitude: undefined };
        await expect(
          service.create(dto as any, makeFieldAgent()),
        ).rejects.toThrow(BadRequestException);
        expect(mockMaps.reverseGeocode).not.toHaveBeenCalled();
      });

      it('throws ForbiddenException when GPS coordinates are in a different region than the agent', async () => {
        // Agent is SOUTH_WEST but GPS resolves to a NORTH_BRIGHT state
        mockMaps.reverseGeocode.mockResolvedValue({
          address: '5 Main Street, Lokoja, Kogi', locality: 'Lokoja', state: 'Kogi',
        });
        // resolveActualRegionForState('kogi') returns NORTH_BRIGHT ≠ agent's SOUTH_WEST
        mockResolveActualRegionForState.mockReturnValueOnce('NORTH_BRIGHT' as any);

        await expect(
          service.create(GPS_CREATE_DTO as any, makeFieldAgent()),
        ).rejects.toThrow(ForbiddenException);
        expect(mockPrisma.customer.create).not.toHaveBeenCalled();
      });

      it('still creates the customer even when Maps returns coordinate fallback address', async () => {
        // Simulates Maps API outage — reverseGeocode returns coords string, not null
        mockMaps.reverseGeocode.mockResolvedValue({
          address: '6.5244, 3.3792', locality: null, state: 'Lagos',
        });
        await service.create(GPS_CREATE_DTO as any, makeFieldAgent());
        const data = mockPrisma.customer.create.mock.calls[0][0].data;
        expect(data.address).toBe('6.5244, 3.3792');
        expect(mockPrisma.customer.create).toHaveBeenCalledTimes(1);
      });
    });

    // ── Admin tier path (manual address) ─────────────────────────────────────

    describe('admin tier manual address path', () => {
      it('creates a customer for System Admin using manual address', async () => {
        const result = await service.create(MANUAL_CREATE_DTO as any, makeAdmin());
        expect(result).toEqual(CUSTOMER_STUB);
        expect(mockMaps.reverseGeocode).not.toHaveBeenCalled();
      });

      it('creates a customer for Sales Head using manual address', async () => {
        await service.create(MANUAL_CREATE_DTO as any, makeSalesHead());
        expect(mockMaps.reverseGeocode).not.toHaveBeenCalled();
      });

      it('normalises state to lowercase before saving', async () => {
        await service.create(MANUAL_CREATE_DTO as any, makeAdmin()); // dto.state = 'Lagos'
        expect(mockResolveRegion).toHaveBeenCalledWith('lagos', expect.any(String));
      });

      it('throws BadRequestException when address is missing for admin', async () => {
        const dto = { ...MANUAL_CREATE_DTO, address: undefined };
        await expect(
          service.create(dto as any, makeAdmin()),
        ).rejects.toThrow(BadRequestException);
        expect(mockPrisma.customer.create).not.toHaveBeenCalled();
      });

      it('throws BadRequestException when state is missing for admin', async () => {
        const dto = { ...MANUAL_CREATE_DTO, state: undefined };
        await expect(
          service.create(dto as any, makeAdmin()),
        ).rejects.toThrow(BadRequestException);
        expect(mockPrisma.customer.create).not.toHaveBeenCalled();
      });
    });

    // ── Shared validation (both paths) ────────────────────────────────────────

    describe('shared validation', () => {
      it('throws ConflictException when mobilePhone already exists', async () => {
        mockPrisma.customer.findFirst.mockResolvedValue({ id: 'existing-id' });
        await expect(
          service.create(GPS_CREATE_DTO as any, makeFieldAgent()),
        ).rejects.toThrow(ConflictException);
        expect(mockPrisma.customer.create).not.toHaveBeenCalled();
      });

      it('throws ForbiddenException when field agent tries to create in a different region', async () => {
        // resolveActualRegionForState returns NORTH_WEST (different from agent's SOUTH_WEST)
        // This is what the GPS path now checks — not resolveRegion
        mockResolveActualRegionForState.mockReturnValueOnce(Region.NORTH_WEST as any);
        await expect(
          service.create(GPS_CREATE_DTO as any, makeFieldAgent()),
        ).rejects.toThrow(ForbiddenException);
      });

      it('does NOT throw ForbiddenException for admin in a different region', async () => {
        mockResolveRegion.mockReturnValue(Region.NORTH_WEST);
        await expect(
          service.create(MANUAL_CREATE_DTO as any, makeAdmin()),
        ).resolves.not.toThrow();
      });

      it('throws NotFoundException when locationId does not exist', async () => {
        mockPrisma.location.findUnique.mockResolvedValue(null);
        const dto = { ...GPS_CREATE_DTO, locationId: 'bad-loc-id' };
        await expect(
          service.create(dto as any, makeFieldAgent()),
        ).rejects.toThrow(NotFoundException);
        expect(mockPrisma.customer.create).not.toHaveBeenCalled();
      });

      it('throws BadRequestException when location state does not match customer state', async () => {
        mockPrisma.location.findUnique.mockResolvedValue({
          id: 'loc-id', name: 'Arakale', state: 'ondo', // different from 'lagos'
        });
        const dto = { ...GPS_CREATE_DTO, locationId: 'loc-id' };
        await expect(
          service.create(dto as any, makeFieldAgent()),
        ).rejects.toThrow(BadRequestException);
      });

      it('saves locationId when location exists and state matches', async () => {
        mockPrisma.location.findUnique.mockResolvedValue({
          id: 'loc-id', name: 'Ikeja', state: 'lagos', // matches geocoded state
        });
        const dto = { ...GPS_CREATE_DTO, locationId: 'loc-id' };
        await service.create(dto as any, makeFieldAgent());
        const data = mockPrisma.customer.create.mock.calls[0][0].data;
        expect(data.locationId).toBe('loc-id');
      });

      it('saves locationId as null when not provided', async () => {
        await service.create(GPS_CREATE_DTO as any, makeFieldAgent());
        const data = mockPrisma.customer.create.mock.calls[0][0].data;
        expect(data.locationId).toBeNull();
      });

      it('saves the ownerId from the requester sub', async () => {
        await service.create(GPS_CREATE_DTO as any, makeFieldAgent());
        const data = mockPrisma.customer.create.mock.calls[0][0].data;
        expect(data.ownerId).toBe('agent-id');
      });
    });
  });

  // ── findAll() ──────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('returns customers ordered by businessName', async () => {
      await service.findAll({}, makeFieldAgent());
      const call = mockPrisma.customer.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ businessName: 'asc' });
    });

    it('field staff see only their own region', async () => {
      await service.findAll({}, makeFieldAgent());
      const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
      expect(where.region).toBe(Region.SOUTH_WEST);
    });

    it('admin sees all customers — no region filter applied', async () => {
      await service.findAll({}, makeAdmin());
      const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
      expect(where.region).toBeUndefined();
    });

    it('admin can filter by a specific region via query param', async () => {
      await service.findAll({ region: Region.NORTH_WEST }, makeAdmin());
      const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
      expect(where.region).toBe(Region.NORTH_WEST);
    });

    it('applies state filter lowercased when provided', async () => {
      await service.findAll({ state: 'Lagos' }, makeAdmin());
      const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
      expect(where.state).toBe('lagos');
    });

    it('applies isActive filter when provided', async () => {
      await service.findAll({ isActive: false }, makeAdmin());
      const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
      expect(where.isActive).toBe(false);
    });

    it('applies no isActive filter when not provided', async () => {
      await service.findAll({}, makeAdmin());
      const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
      expect(where.isActive).toBeUndefined();
    });
  });

  // ── findById() ─────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns the customer when the requester is the owner', async () => {
      const result = await service.findById('cust-id', makeFieldAgent());
      expect(result).toEqual(CUSTOMER_STUB);
    });

    it('admin can view any customer regardless of region', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER_STUB, region: Region.NORTH_WEST,
      });
      await expect(service.findById('cust-id', makeAdmin())).resolves.not.toThrow();
    });

    it('field agent can view customers in their own region even if not the owner', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER_STUB, ownerId: 'someone-else', region: Region.SOUTH_WEST,
      });
      await expect(service.findById('cust-id', makeFieldAgent())).resolves.not.toThrow();
    });

    it('throws ForbiddenException when field agent views a customer in a different region', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER_STUB, region: Region.NORTH_WEST,
      });
      await expect(
        service.findById('cust-id', makeFieldAgent()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(
        service.findById('bad-id', makeAdmin()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── update() ───────────────────────────────────────────────────────────────

  describe('update()', () => {
    beforeEach(() => {
      // assertExists uses a slim select — mock findUnique to return it
      mockPrisma.customer.findUnique.mockResolvedValue(CUSTOMER_INTERNAL);
      mockPrisma.customer.update.mockResolvedValue(CUSTOMER_STUB);
    });

    it('updates a customer when the requester is the owner', async () => {
      const result = await service.update(
        'cust-id',
        { businessName: 'Ore Ofe Ltd' } as any,
        makeFieldAgent(),
      );
      expect(result).toEqual(CUSTOMER_STUB);
    });

    it('admin can update any customer', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER_INTERNAL, ownerId: 'someone-else',
      });
      await expect(
        service.update('cust-id', { businessName: 'X' } as any, makeAdmin()),
      ).resolves.not.toThrow();
    });

    it('throws ForbiddenException when field agent is not the owner', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER_INTERNAL, ownerId: 'someone-else',
      });
      await expect(
        service.update('cust-id', { businessName: 'X' } as any, makeFieldAgent()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(
        service.update('bad-id', { businessName: 'X' } as any, makeAdmin()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when new phone is already taken by another customer', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'other-cust-id' });
      await expect(
        service.update('cust-id', { mobilePhone: '+2348011111111' } as any, makeFieldAgent()),
      ).rejects.toThrow(ConflictException);
    });

    it('does not check phone uniqueness when phone is unchanged', async () => {
      // Same phone as CUSTOMER_INTERNAL — should skip the uniqueness check
      await service.update(
        'cust-id',
        { mobilePhone: '+2348099900001' } as any, // same as existing
        makeFieldAgent(),
      );
      expect(mockPrisma.customer.findFirst).not.toHaveBeenCalled();
    });

    it('recalculates region when state changes', async () => {
      mockResolveRegion.mockReturnValue(Region.NORTH_WEST);
      await service.update('cust-id', { state: 'kano' } as any, makeAdmin());
      const data = mockPrisma.customer.update.mock.calls[0][0].data;
      expect(data.region).toBe(Region.NORTH_WEST);
      expect(data.state).toBe('kano');
    });

    it('does not include region in update payload when state is not changing', async () => {
      await service.update('cust-id', { businessName: 'New Name' } as any, makeFieldAgent());
      const data = mockPrisma.customer.update.mock.calls[0][0].data;
      expect(data.region).toBeUndefined();
    });
  });

  // ── deactivate() ───────────────────────────────────────────────────────────

  describe('deactivate()', () => {
    it('deactivates an active customer', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(CUSTOMER_INTERNAL);
      mockPrisma.customer.update.mockResolvedValue({ ...CUSTOMER_STUB, isActive: false });

      const result = await service.deactivate('cust-id', makeFieldAgent());
      const data = mockPrisma.customer.update.mock.calls[0][0].data;
      expect(data.isActive).toBe(false);
    });

    it('throws ConflictException when customer is already deactivated', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER_INTERNAL, isActive: false,
      });
      await expect(
        service.deactivate('cust-id', makeFieldAgent()),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when not the owner', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER_INTERNAL, ownerId: 'someone-else',
      });
      await expect(
        service.deactivate('cust-id', makeFieldAgent()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for unknown customer', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(
        service.deactivate('bad-id', makeAdmin()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── reactivate() ───────────────────────────────────────────────────────────

  describe('reactivate()', () => {
    it('reactivates an inactive customer', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...CUSTOMER_INTERNAL, isActive: false,
      });
      mockPrisma.customer.update.mockResolvedValue({ ...CUSTOMER_STUB, isActive: true });

      await service.reactivate('cust-id', makeAdmin());
      const data = mockPrisma.customer.update.mock.calls[0][0].data;
      expect(data.isActive).toBe(true);
    });

    it('throws ConflictException when customer is already active', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(CUSTOMER_INTERNAL); // isActive: true
      await expect(
        service.reactivate('cust-id', makeAdmin()),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for unknown customer', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(
        service.reactivate('bad-id', makeAdmin()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── requestOutOfRegion() ───────────────────────────────────────────────────

  describe('requestOutOfRegion()', () => {
    beforeEach(() => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'cust-id', region: Region.NORTH_WEST, businessName: 'Kano Dist Ltd',
      });
    });

    it('creates an OOR request when customer is in a different region', async () => {
      const result = await service.requestOutOfRegion(
        'cust-id', {}, makeFieldAgent(), // agent is SOUTH_WEST, customer is NORTH_WEST
      );
      expect(result).toEqual(OOR_STUB);
      expect(mockPrisma.outOfRegionRequest.create).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException when customer is already in the agent\'s region', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'cust-id', region: Region.SOUTH_WEST, businessName: 'Lagos Dist',
      });
      await expect(
        service.requestOutOfRegion('cust-id', {}, makeFieldAgent()),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when a pending request already exists', async () => {
      mockPrisma.outOfRegionRequest.findFirst.mockResolvedValue({ id: 'existing-oor' });
      await expect(
        service.requestOutOfRegion('cust-id', {}, makeFieldAgent()),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.outOfRegionRequest.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(
        service.requestOutOfRegion('bad-id', {}, makeFieldAgent()),
      ).rejects.toThrow(NotFoundException);
    });

    it('sets status to PENDING on creation', async () => {
      await service.requestOutOfRegion('cust-id', { note: 'Key distributor' }, makeFieldAgent());
      const data = mockPrisma.outOfRegionRequest.create.mock.calls[0][0].data;
      expect(data.status).toBe('PENDING');
      expect(data.note).toBe('Key distributor');
    });
  });

  // ── approveOutOfRegion() ───────────────────────────────────────────────────

  describe('approveOutOfRegion()', () => {
    it('approves a pending request when called by Sales Head', async () => {
      const result = await service.approveOutOfRegion('oor-id', makeSalesHead());
      expect(result.status).toBe('APPROVED');
    });

    it('approves a pending request when called by System Admin', async () => {
      await expect(
        service.approveOutOfRegion('oor-id', makeAdmin()),
      ).resolves.not.toThrow();
    });

    it('approves a pending request when called by Tier 4 ZSM', async () => {
      await expect(
        service.approveOutOfRegion('oor-id', makeTier4()),
      ).resolves.not.toThrow();
    });

    it('throws ForbiddenException for Tier 2 field agents', async () => {
      await expect(
        service.approveOutOfRegion('oor-id', makeFieldAgent('TIER2')),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.outOfRegionRequest.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for Tier 3', async () => {
      await expect(
        service.approveOutOfRegion('oor-id', makeFieldAgent('TIER3')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when OOR request does not exist', async () => {
      mockPrisma.outOfRegionRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.approveOutOfRegion('bad-id', makeSalesHead()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when request is already approved', async () => {
      mockPrisma.outOfRegionRequest.findUnique.mockResolvedValue({
        id: 'oor-id', status: 'APPROVED',
      });
      await expect(
        service.approveOutOfRegion('oor-id', makeSalesHead()),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.outOfRegionRequest.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when request is already rejected', async () => {
      mockPrisma.outOfRegionRequest.findUnique.mockResolvedValue({
        id: 'oor-id', status: 'REJECTED',
      });
      await expect(
        service.approveOutOfRegion('oor-id', makeSalesHead()),
      ).rejects.toThrow(ConflictException);
    });

    it('sets the approvedBy field to the requester sub', async () => {
      await service.approveOutOfRegion('oor-id', makeSalesHead());
      const data = mockPrisma.outOfRegionRequest.update.mock.calls[0][0].data;
      expect(data.approvedBy).toBe('sh-id');
      expect(data.status).toBe('APPROVED');
    });
  });

  // ── findPendingOutOfRegionRequests() ───────────────────────────────────────

  describe('findPendingOutOfRegionRequests()', () => {
    it('returns pending requests for Sales Head', async () => {
      mockPrisma.outOfRegionRequest.findMany.mockResolvedValue([OOR_STUB]);
      const result = await service.findPendingOutOfRegionRequests(makeSalesHead());
      expect(result).toHaveLength(1);
    });

    it('returns pending requests for Tier 4 ZSM', async () => {
      mockPrisma.outOfRegionRequest.findMany.mockResolvedValue([OOR_STUB]);
      const result = await service.findPendingOutOfRegionRequests(makeTier4());
      expect(result).toHaveLength(1);
    });

    it('queries only PENDING status', async () => {
      mockPrisma.outOfRegionRequest.findMany.mockResolvedValue([]);
      await service.findPendingOutOfRegionRequests(makeSalesHead());
      const where = mockPrisma.outOfRegionRequest.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('PENDING');
    });

    it('orders by createdAt asc — oldest first', async () => {
      mockPrisma.outOfRegionRequest.findMany.mockResolvedValue([]);
      await service.findPendingOutOfRegionRequests(makeSalesHead());
      const orderBy = mockPrisma.outOfRegionRequest.findMany.mock.calls[0][0].orderBy;
      expect(orderBy).toEqual({ createdAt: 'asc' });
    });

    it('caps results at 100', async () => {
      mockPrisma.outOfRegionRequest.findMany.mockResolvedValue([]);
      await service.findPendingOutOfRegionRequests(makeSalesHead());
      const take = mockPrisma.outOfRegionRequest.findMany.mock.calls[0][0].take;
      expect(take).toBe(100);
    });

    it('throws ForbiddenException for Tier 2 field agents', async () => {
      await expect(
        service.findPendingOutOfRegionRequests(makeFieldAgent('TIER2')),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.outOfRegionRequest.findMany).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for Tier 3', async () => {
      await expect(
        service.findPendingOutOfRegionRequests(makeFieldAgent('TIER3')),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── create() — customerType and secondaryCustomerType ─────────────────────

  describe('create() — customer type validation', () => {
    it('creates a PRIMARY customer without secondaryCustomerType', async () => {
      const dto = { ...GPS_CREATE_DTO, customerType: 'PRIMARY' };
      await service.create(dto as any, makeFieldAgent('TIER2'));
      expect(mockPrisma.customer.create).toHaveBeenCalledTimes(1);
      const data = mockPrisma.customer.create.mock.calls[0][0].data;
      expect(data.customerType).toBe('PRIMARY');
      expect(data.secondaryCustomerType).toBeNull();
    });

    it('creates a SECONDARY WHOLESALER customer with secondaryCustomerType', async () => {
      const dto = {
        ...GPS_CREATE_DTO,
        customerType:          'SECONDARY',
        secondaryCustomerType: 'WHOLESALER',
      };
      await service.create(dto as any, makeFieldAgent('TIER2'));
      const data = mockPrisma.customer.create.mock.calls[0][0].data;
      expect(data.customerType).toBe('SECONDARY');
      expect(data.secondaryCustomerType).toBe('WHOLESALER');
    });

    it('creates a SECONDARY RETAILER customer', async () => {
      const dto = {
        ...GPS_CREATE_DTO,
        customerType:          'SECONDARY',
        secondaryCustomerType: 'RETAILER',
      };
      await service.create(dto as any, makeFieldAgent('TIER2'));
      const data = mockPrisma.customer.create.mock.calls[0][0].data;
      expect(data.secondaryCustomerType).toBe('RETAILER');
    });

    it('creates a SECONDARY SUB_DISTRIBUTOR customer', async () => {
      const dto = {
        ...GPS_CREATE_DTO,
        customerType:          'SECONDARY',
        secondaryCustomerType: 'SUB_DISTRIBUTOR',
      };
      await service.create(dto as any, makeFieldAgent('TIER2'));
      const data = mockPrisma.customer.create.mock.calls[0][0].data;
      expect(data.secondaryCustomerType).toBe('SUB_DISTRIBUTOR');
    });

    it('throws BadRequestException when SECONDARY customer has no secondaryCustomerType', async () => {
      const dto = {
        ...GPS_CREATE_DTO,
        customerType:          'SECONDARY',
        secondaryCustomerType: undefined,
      };
      await expect(service.create(dto as any, makeFieldAgent('TIER2')))
        .rejects.toThrow(BadRequestException);
      expect(mockPrisma.customer.create).not.toHaveBeenCalled();
    });

    it('stores secondaryCustomerType as null for PRIMARY customers', async () => {
      const dto = { ...GPS_CREATE_DTO, customerType: 'PRIMARY' };
      await service.create(dto as any, makeFieldAgent('TIER2'));
      const data = mockPrisma.customer.create.mock.calls[0][0].data;
      expect(data.secondaryCustomerType).toBeNull();
    });
  });
});