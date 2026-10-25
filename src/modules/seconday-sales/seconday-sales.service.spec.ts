// src/modules/seconday-sales/seconday-sales.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BuyerType } from '@prisma/client';
import { SecondaySalesService } from './seconday-sales.service';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  customer:      { findUnique: jest.fn() },
  product:       { findMany: jest.fn() },
  secondarySale: {
    create:     jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    count:      jest.fn(),
  },
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ACTIVE_CUSTOMER = {
  id:           'cust-id',
  isActive:     true,
  businessName: 'Ore Ofe Distributors Ltd',
};

const PRODUCT_LOTION = { id: 'lotion-id' };
const PRODUCT_SOAP   = { id: 'soap-id' };

const SALE_DETAIL = {
  id:          'sale-id',
  userId:      'user-id',
  user:        { fullName: 'Kenny Solape', employeeRef: 'Dar-00000001' },
  kdAccountId: 'cust-id',
  kdAccount:   { businessName: 'Ore Ofe Distributors Ltd', region: 'LAGOS_2' },
  latitude:    6.5244,
  longitude:   3.3792,
  deviceTime:  new Date('2026-06-15T10:30:00.000Z'),
  serverTime:  new Date(),
  note:        null,
  createdAt:   new Date(),
  items: [
    {
      id:              'item-id',
      productId:       'lotion-id',
      product:         { name: 'DarVinks Lotion', category: 'LOTION' },
      buyerType:       BuyerType.WHOLESALER,
      quantityCartons: 5,
      quantityRows:    0,
      quantityPieces:  0,
    },
  ],
};

const CREATE_DTO = {
  kdAccountId: 'cust-id',
  latitude:    6.5244,
  longitude:   3.3792,
  deviceTime:  '2026-06-15T10:30:00.000Z',
  items: [
    { productId: 'lotion-id', buyerType: BuyerType.WHOLESALER, quantityCartons: 5 },
  ],
};

function makeRequester(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub:   'user-id',
    email: 'agent@darvinks.com',
    tier:  'TIER2',
    team:  'RADIANT',
    ...overrides,
  } as JwtPayload;
}

function makeAdmin(): JwtPayload {
  return makeRequester({ sub: 'admin-id', tier: 'TIER5_SALES_SUPPORT' });
}

function makeSalesHead(): JwtPayload {
  return makeRequester({ sub: 'sh-id', tier: 'TIER5_SALES_HEAD' });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SecondarySaleService', () => {
  let service: SecondaySalesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        // instantiate service manually to avoid needing GoogleMapsService dependency
        { provide: SecondaySalesService, useFactory: () => new SecondaySalesService(mockPrisma as any, {} as any) },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SecondaySalesService>(SecondaySalesService);
    jest.resetAllMocks();
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create()', () => {
    beforeEach(() => {
      mockPrisma.customer.findUnique.mockResolvedValue(ACTIVE_CUSTOMER);
      mockPrisma.product.findMany.mockResolvedValue([PRODUCT_LOTION]);
      mockPrisma.secondarySale.create.mockResolvedValue(SALE_DETAIL);
    });

    it('creates a secondary sale for a Tier1 field agent', async () => {
      const result = await service.create(CREATE_DTO, makeRequester({ tier: 'TIER1' }));
      expect(result).toEqual(SALE_DETAIL);
      expect(mockPrisma.secondarySale.create).toHaveBeenCalledTimes(1);
    });

    it('creates a secondary sale for a Tier4 field agent', async () => {
      const result = await service.create(CREATE_DTO, makeRequester({ tier: 'TIER4' }));
      expect(result).toEqual(SALE_DETAIL);
    });

    it('throws ForbiddenException for TIER5_SALES_HEAD', async () => {
      await expect(
        service.create(CREATE_DTO, makeSalesHead()),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.customer.findUnique).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for TIER5_SALES_SUPPORT', async () => {
      await expect(
        service.create(CREATE_DTO, makeAdmin()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(
        service.create(CREATE_DTO, makeRequester()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the customer is deactivated', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...ACTIVE_CUSTOMER, isActive: false,
      });
      await expect(
        service.create(CREATE_DTO, makeRequester()),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when a product is not found', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]); // none found
      await expect(
        service.create(CREATE_DTO, makeRequester()),
      ).rejects.toThrow(BadRequestException);
    });

    it('deduplicates product IDs — single DB round trip regardless of item count', async () => {
      const dto = {
        ...CREATE_DTO,
        items: [
          { productId: 'lotion-id', buyerType: BuyerType.WHOLESALER, quantityCartons: 5 },
          { productId: 'lotion-id', buyerType: BuyerType.RETAILER,   quantityCartons: 2 }, // dup productId
        ],
      };
      await service.create(dto, makeRequester());

      const whereIn = mockPrisma.product.findMany.mock.calls[0][0].where.id.in;
      expect(whereIn).toHaveLength(1);
      expect(whereIn[0]).toBe('lotion-id');
    });

    it('reports every missing product ID in the error message', async () => {
      mockPrisma.product.findMany.mockResolvedValue([PRODUCT_LOTION]); // soap-id missing
      const dto = {
        ...CREATE_DTO,
        items: [
          { productId: 'lotion-id', buyerType: BuyerType.WHOLESALER, quantityCartons: 5 },
          { productId: 'soap-id',   buyerType: BuyerType.RETAILER,   quantityCartons: 2 },
        ],
      };

      await expect(service.create(dto, makeRequester())).rejects.toThrow(
        expect.objectContaining({ message: expect.stringContaining('soap-id') }),
      );
    });

    it('defaults quantityRows and quantityPieces to 0 when omitted', async () => {
      await service.create(CREATE_DTO, makeRequester());

      const createCall = mockPrisma.secondarySale.create.mock.calls[0][0];
      const items = createCall.data.items.create;
      expect(items[0].quantityRows).toBe(0);
      expect(items[0].quantityPieces).toBe(0);
    });

    it('passes deviceTime through as a Date', async () => {
      await service.create(CREATE_DTO, makeRequester());

      const createCall = mockPrisma.secondarySale.create.mock.calls[0][0];
      expect(createCall.data.deviceTime).toBeInstanceOf(Date);
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('field staff see only their own secondary sales', async () => {
      mockPrisma.secondarySale.findMany.mockResolvedValue([]);
      await service.findAll({}, makeRequester());

      const where = mockPrisma.secondarySale.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe('user-id');
    });

    it('TIER5_SALES_HEAD sees all secondary sales — no userId filter', async () => {
      mockPrisma.secondarySale.findMany.mockResolvedValue([]);
      await service.findAll({}, makeSalesHead());

      const where = mockPrisma.secondarySale.findMany.mock.calls[0][0].where;
      expect(where.userId).toBeUndefined();
    });

    it('TIER5_SALES_SUPPORT sees all secondary sales', async () => {
      mockPrisma.secondarySale.findMany.mockResolvedValue([]);
      await service.findAll({}, makeAdmin());

      const where = mockPrisma.secondarySale.findMany.mock.calls[0][0].where;
      expect(where.userId).toBeUndefined();
    });

    it('applies kdAccountId filter when provided', async () => {
      mockPrisma.secondarySale.findMany.mockResolvedValue([]);
      await service.findAll({ kdAccountId: 'cust-id' }, makeAdmin());

      const where = mockPrisma.secondarySale.findMany.mock.calls[0][0].where;
      expect(where.kdAccountId).toBe('cust-id');
    });

    it('applies buyerType filter via nested items.some', async () => {
      mockPrisma.secondarySale.findMany.mockResolvedValue([]);
      await service.findAll({ buyerType: BuyerType.RETAILER }, makeAdmin());

      const where = mockPrisma.secondarySale.findMany.mock.calls[0][0].where;
      expect(where.items.some.buyerType).toBe(BuyerType.RETAILER);
    });

    it('applies from/to date range filter on deviceTime', async () => {
      mockPrisma.secondarySale.findMany.mockResolvedValue([]);
      await service.findAll(
        { from: '2026-06-01', to: '2026-06-30' },
        makeAdmin(),
      );

      const where = mockPrisma.secondarySale.findMany.mock.calls[0][0].where;
      expect(where.deviceTime.gte).toBeInstanceOf(Date);
      expect(where.deviceTime.lte).toBeInstanceOf(Date);
    });

    it('caps results at 200 records', async () => {
      mockPrisma.secondarySale.findMany.mockResolvedValue([]);
      await service.findAll({}, makeAdmin());

      const call = mockPrisma.secondarySale.findMany.mock.calls[0][0];
      expect(call.take).toBe(200);
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns the sale when the requester is the creator', async () => {
      mockPrisma.secondarySale.findUnique.mockResolvedValue(SALE_DETAIL);
      const result = await service.findById('sale-id', makeRequester());
      expect(result).toEqual(SALE_DETAIL);
    });

    it('admin can view any secondary sale', async () => {
      mockPrisma.secondarySale.findUnique.mockResolvedValue({
        ...SALE_DETAIL, userId: 'other-user',
      });
      await expect(
        service.findById('sale-id', makeAdmin()),
      ).resolves.not.toThrow();
    });

    it('throws ForbiddenException when a field agent views another agent\'s sale', async () => {
      mockPrisma.secondarySale.findUnique.mockResolvedValue({
        ...SALE_DETAIL, userId: 'other-user',
      });
      await expect(
        service.findById('sale-id', makeRequester()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for an unknown ID', async () => {
      mockPrisma.secondarySale.findUnique.mockResolvedValue(null);
      await expect(
        service.findById('bad-id', makeAdmin()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── findAllForSupport ──────────────────────────────────────────────────────

  describe('findAllForSupport()', () => {
    const PAGINATED_RESPONSE = {
      data: [SALE_DETAIL],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    };

    beforeEach(() => {
      mockPrisma.secondarySale.findMany.mockResolvedValue([SALE_DETAIL]);
      mockPrisma.secondarySale.count.mockResolvedValue(1);
    });

    it('returns paginated secondary sales for TIER5_SALES_SUPPORT', async () => {
      const result = await service.findAllForSupport({}, makeAdmin());
      expect(result).toMatchObject(PAGINATED_RESPONSE);
    });

    it('returns paginated secondary sales for TIER5_SALES_HEAD', async () => {
      const result = await service.findAllForSupport({}, makeSalesHead());
      expect(result).toMatchObject(PAGINATED_RESPONSE);
    });

    it('filters by userId when provided', async () => {
      await service.findAllForSupport({ userId: 'target-user' }, makeAdmin());

      const where = mockPrisma.secondarySale.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe('target-user');
    });

    it('filters by team on the related user', async () => {
      await service.findAllForSupport({ team: 'RADIANT' }, makeAdmin());

      const where = mockPrisma.secondarySale.findMany.mock.calls[0][0].where;
      expect(where.user.team).toBe('RADIANT');
    });

    it('filters by tier on the related user', async () => {
      await service.findAllForSupport({ tier: 'TIER2' }, makeAdmin());

      const where = mockPrisma.secondarySale.findMany.mock.calls[0][0].where;
      expect(where.user.tier).toBe('TIER2');
    });

    it('filters by region on the related user', async () => {
      await service.findAllForSupport({ region: 'SOUTH_WEST' }, makeAdmin());

      const where = mockPrisma.secondarySale.findMany.mock.calls[0][0].where;
      expect(where.user.region).toBe('SOUTH_WEST');
    });

    it('applies from/to date range filter on serverTime', async () => {
      await service.findAllForSupport(
        { from: '2026-06-01', to: '2026-06-30' },
        makeAdmin(),
      );

      const where = mockPrisma.secondarySale.findMany.mock.calls[0][0].where;
      expect(where.serverTime.gte).toBeInstanceOf(Date);
      expect(where.serverTime.lte).toBeInstanceOf(Date);
    });

    it('uses default page 1 and limit 20 when not specified', async () => {
      await service.findAllForSupport({}, makeAdmin());

      const call = mockPrisma.secondarySale.findMany.mock.calls[0][0];
      expect(call.skip).toBe(0);
      expect(call.take).toBe(20);
    });

    it('applies custom page and limit', async () => {
      mockPrisma.secondarySale.count.mockResolvedValue(100);
      const result = await service.findAllForSupport({ page: 3, limit: 10 }, makeAdmin());

      const call = mockPrisma.secondarySale.findMany.mock.calls[0][0];
      expect(call.skip).toBe(20);
      expect(call.take).toBe(10);
      expect(result.meta.page).toBe(3);
      expect(result.meta.limit).toBe(10);
    });

    it('clamps limit to a maximum of 100', async () => {
      await service.findAllForSupport({ limit: 999 }, makeAdmin());

      const call = mockPrisma.secondarySale.findMany.mock.calls[0][0];
      expect(call.take).toBe(100);
    });

    it('includes correct totalPages in meta', async () => {
      mockPrisma.secondarySale.count.mockResolvedValue(55);
      const result = await service.findAllForSupport({ limit: 20 }, makeAdmin());

      expect(result.meta.totalPages).toBe(3); // ceil(55/20)
    });

    it('runs findMany and count in parallel (both called once)', async () => {
      await service.findAllForSupport({}, makeAdmin());

      expect(mockPrisma.secondarySale.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.secondarySale.count).toHaveBeenCalledTimes(1);
    });
  });

  // ── findByUserForSupport ───────────────────────────────────────────────────

  describe('findByUserForSupport()', () => {
    const TARGET_USER_ID = 'target-user-id';

    beforeEach(() => {
      mockPrisma.secondarySale.findMany.mockResolvedValue([SALE_DETAIL]);
      mockPrisma.secondarySale.count.mockResolvedValue(1);
    });

    it('returns paginated secondary sales for the target user', async () => {
      const result = await service.findByUserForSupport(TARGET_USER_ID, {}, makeAdmin());

      expect(result.data).toEqual([SALE_DETAIL]);
      expect(result.meta).toMatchObject({ total: 1, page: 1 });
    });

    it('scopes the query to the target userId', async () => {
      await service.findByUserForSupport(TARGET_USER_ID, {}, makeAdmin());

      const where = mockPrisma.secondarySale.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe(TARGET_USER_ID);
    });

    it('applies from/to date range filter on serverTime', async () => {
      await service.findByUserForSupport(
        TARGET_USER_ID,
        { from: '2026-07-01', to: '2026-07-31' },
        makeAdmin(),
      );

      const where = mockPrisma.secondarySale.findMany.mock.calls[0][0].where;
      expect(where.serverTime.gte).toBeInstanceOf(Date);
      expect(where.serverTime.lte).toBeInstanceOf(Date);
    });

    it('uses default page 1 and limit 20 when not specified', async () => {
      await service.findByUserForSupport(TARGET_USER_ID, {}, makeAdmin());

      const call = mockPrisma.secondarySale.findMany.mock.calls[0][0];
      expect(call.skip).toBe(0);
      expect(call.take).toBe(20);
    });

    it('applies custom page and limit', async () => {
      mockPrisma.secondarySale.count.mockResolvedValue(50);
      const result = await service.findByUserForSupport(
        TARGET_USER_ID,
        { page: 2, limit: 10 },
        makeAdmin(),
      );

      const call = mockPrisma.secondarySale.findMany.mock.calls[0][0];
      expect(call.skip).toBe(10);
      expect(call.take).toBe(10);
      expect(result.meta.page).toBe(2);
    });

    it('clamps limit to a maximum of 100', async () => {
      await service.findByUserForSupport(TARGET_USER_ID, { limit: 500 }, makeAdmin());

      const call = mockPrisma.secondarySale.findMany.mock.calls[0][0];
      expect(call.take).toBe(100);
    });

    it('can be called by TIER5_SALES_HEAD without restrictions', async () => {
      const result = await service.findByUserForSupport(TARGET_USER_ID, {}, makeSalesHead());
      expect(result.data).toEqual([SALE_DETAIL]);
    });

    it('runs findMany and count in parallel (both called once)', async () => {
      await service.findByUserForSupport(TARGET_USER_ID, {}, makeAdmin());

      expect(mockPrisma.secondarySale.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.secondarySale.count).toHaveBeenCalledTimes(1);
    });
  });
});