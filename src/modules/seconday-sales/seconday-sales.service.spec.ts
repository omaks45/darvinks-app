
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BuyerType } from '@prisma/client';
import { SecondarySaleService } from './seconday-sales.service';
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
  return makeRequester({ sub: 'admin-id', tier: 'TIER5_SYSTEM_ADMIN' });
}

function makeSalesHead(): JwtPayload {
  return makeRequester({ sub: 'sh-id', tier: 'TIER5_SALES_HEAD' });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SecondarySaleService', () => {
  let service: SecondarySaleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecondarySaleService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SecondarySaleService>(SecondarySaleService);
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

    it('throws ForbiddenException for TIER5_SYSTEM_ADMIN', async () => {
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

    it('TIER5_SYSTEM_ADMIN sees all secondary sales', async () => {
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
});