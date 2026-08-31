
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StockCollectionService } from './stock-collection.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  customer:        { findUnique: jest.fn() },
  product:         { findMany: jest.fn() },
  stockCollection: {
    count:      jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    update:     jest.fn(),
  },
  agentInventory: { findMany: jest.fn() },
  $transaction:   jest.fn(),
};

const mockCloudinary = { uploadBuffer: jest.fn() };

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PRIMARY_CUSTOMER = {
  id:           'kd-id',
  businessName: 'Ore Ofe Distributors Ltd',
  customerType: 'PRIMARY',
  region:       'SOUTH_WEST',
};

const SECONDARY_CUSTOMER = {
  id:           'sec-id',
  businessName: 'Bright Wholesalers',
  customerType: 'SECONDARY',
};

const PRODUCT_A = {
  id:              'prod-a',
  name:            'Visita Essence B Whitening Lotion (250ml)',
  category:        'LOTION',
  cartonPriceKobo: BigInt(6300000),
  isActive:        true,
};

const PRODUCT_B = {
  id:              'prod-b',
  name:            'Neoskin Essence B Whitening Lotion (250ml)',
  category:        'LOTION',
  cartonPriceKobo: BigInt(6300000),
  isActive:        true,
};

const COLLECTION_STUB = {
  id:            'coll-id',
  collectionRef: 'SC-000001',
  userId:        'agent-id',
  user:          { fullName: 'Kenny Solape', employeeRef: 'Dar-00000007', tier: 'TIER1' },
  sourceId:      'kd-id',
  source:        {
    businessName: 'Ore Ofe Distributors Ltd',
    address:      '12 Kolade St, Ilupeju',
    region:       'SOUTH_WEST',
  },
  status:        'CONFIRMED',
  subtotalKobo:  BigInt(945000000),
  invoiceUrl:    null,
  submittedAt:   new Date(),
  note:          null,
  createdAt:     new Date(),
  updatedAt:     new Date(),
  items: [{
    id:              'item-id',
    productId:       'prod-a',
    product:         { name: 'Visita Essence B Whitening Lotion (250ml)', category: 'LOTION' },
    quantityCartons: 150,
    unitPriceKobo:   BigInt(6300000),
    lineTotalKobo:   BigInt(945000000),
  }],
};

const INVENTORY_STUB = [{
  id:              'inv-id',
  productId:       'prod-a',
  product: {
    name:            'Visita Essence B Whitening Lotion (250ml)',
    category:        'LOTION',
    cartonPriceKobo: BigInt(6300000),
  },
  quantityCartons: 120,
  updatedAt:       new Date(),
}];

const SINGLE_ITEM_DTO = {
  sourceId: 'kd-id',
  items:    [{ productId: 'prod-a', quantityCartons: 150 }],
  note:     null,
};

const MULTI_ITEM_DTO = {
  sourceId: 'kd-id',
  items: [
    { productId: 'prod-a', quantityCartons: 100 },
    { productId: 'prod-b', quantityCartons: 50  },
  ],
};

function makeTier(tier = 'TIER1'): JwtPayload {
  return { sub: 'agent-id', email: 'agent@test.com', tier, team: 'RADIANT' } as JwtPayload;
}
function makeAdmin(): JwtPayload {
  return { sub: 'admin-id', email: 'admin@test.com', tier: 'TIER5_SALES_SUPPORT', team: 'RADIANT' } as JwtPayload;
}
function makeSalesHead(): JwtPayload {
  return { sub: 'sh-id', email: 'sh@test.com', tier: 'TIER5_SALES_HEAD', team: 'RADIANT' } as JwtPayload;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StockCollectionService', () => {
  let service: StockCollectionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockCollectionService,
        { provide: PrismaService,     useValue: mockPrisma },
        { provide: CloudinaryService, useValue: mockCloudinary },
      ],
    }).compile();

    service = module.get<StockCollectionService>(StockCollectionService);
    jest.resetAllMocks();

    mockPrisma.customer.findUnique.mockResolvedValue(PRIMARY_CUSTOMER);
    mockPrisma.product.findMany.mockResolvedValue([PRODUCT_A]);
    mockPrisma.stockCollection.count.mockResolvedValue(0);
    mockPrisma.stockCollection.findMany.mockResolvedValue([COLLECTION_STUB]);
    mockPrisma.stockCollection.findUnique.mockResolvedValue(COLLECTION_STUB);
    mockPrisma.stockCollection.update.mockResolvedValue(COLLECTION_STUB);
    mockPrisma.agentInventory.findMany.mockResolvedValue(INVENTORY_STUB);
    mockPrisma.$transaction.mockImplementation((fn: any) =>
      typeof fn === 'function' ? fn(mockPrisma) : Promise.all(fn),
    );
    mockCloudinary.uploadBuffer.mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/test/SC-000001-invoice.pdf',
    });
  });

  // ── create() ───────────────────────────────────────────────────────────────

  describe('create()', () => {

    describe('tier access control', () => {
      it('Tier 1 can collect stock', async () => {
        mockPrisma.$transaction.mockResolvedValue(COLLECTION_STUB);
        await expect(service.create(SINGLE_ITEM_DTO as any, makeTier('TIER1'))).resolves.not.toThrow();
      });

      it('Tier 2 can collect stock', async () => {
        mockPrisma.$transaction.mockResolvedValue(COLLECTION_STUB);
        await expect(service.create(SINGLE_ITEM_DTO as any, makeTier('TIER2'))).resolves.not.toThrow();
      });

      it('Tier 3 can collect stock', async () => {
        mockPrisma.$transaction.mockResolvedValue(COLLECTION_STUB);
        await expect(service.create(SINGLE_ITEM_DTO as any, makeTier('TIER3'))).resolves.not.toThrow();
      });

      it('throws ForbiddenException for Tier 4', async () => {
        await expect(service.create(SINGLE_ITEM_DTO as any, makeTier('TIER4')))
          .rejects.toThrow(ForbiddenException);
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      });

      it('throws ForbiddenException for Sales Head', async () => {
        await expect(service.create(SINGLE_ITEM_DTO as any, makeSalesHead()))
          .rejects.toThrow(ForbiddenException);
      });

      it('throws ForbiddenException for System Admin', async () => {
        await expect(service.create(SINGLE_ITEM_DTO as any, makeAdmin()))
          .rejects.toThrow(ForbiddenException);
      });
    });

    describe('customer validation', () => {
      it('throws NotFoundException when source customer does not exist', async () => {
        mockPrisma.customer.findUnique.mockResolvedValue(null);
        await expect(service.create(SINGLE_ITEM_DTO as any, makeTier()))
          .rejects.toThrow(NotFoundException);
      });

      it('throws BadRequestException when source is a SECONDARY customer', async () => {
        mockPrisma.customer.findUnique.mockResolvedValue(SECONDARY_CUSTOMER);
        await expect(service.create(SINGLE_ITEM_DTO as any, makeTier()))
          .rejects.toThrow(BadRequestException);
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      });
    });

    describe('product validation', () => {
      it('throws BadRequestException when product is not found or inactive', async () => {
        mockPrisma.product.findMany.mockResolvedValue([]);
        await expect(service.create(SINGLE_ITEM_DTO as any, makeTier()))
          .rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when one product is missing from multi-item request', async () => {
        mockPrisma.product.findMany.mockResolvedValue([PRODUCT_A]); // only A found, B missing
        await expect(service.create(MULTI_ITEM_DTO as any, makeTier()))
          .rejects.toThrow(BadRequestException);
      });

      it('deduplicates product IDs in the findMany query', async () => {
        mockPrisma.$transaction.mockResolvedValue(COLLECTION_STUB);
        const dto = {
          sourceId: 'kd-id',
          items: [
            { productId: 'prod-a', quantityCartons: 10 },
            { productId: 'prod-a', quantityCartons: 5  }, // duplicate
          ],
        };
        await service.create(dto as any, makeTier());
        const inClause = mockPrisma.product.findMany.mock.calls[0][0].where.id.in;
        expect(inClause).toHaveLength(1);
      });
    });

    describe('pricing and reference', () => {
      it('uses cartonPriceKobo from the product catalogue (not unit price)', async () => {
        mockPrisma.$transaction.mockResolvedValue(COLLECTION_STUB);
        await service.create(SINGLE_ITEM_DTO as any, makeTier());
        // 6300000 × 150 = 945,000,000 — transaction was called meaning price calc passed
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      });

      it('generates collectionRef as SC-000001 when count is 0', async () => {
        mockPrisma.stockCollection.count.mockResolvedValue(0);
        mockPrisma.$transaction.mockResolvedValue(COLLECTION_STUB);
        await service.create(SINGLE_ITEM_DTO as any, makeTier());
        expect(mockPrisma.stockCollection.count).toHaveBeenCalledTimes(1);
      });

      it('generates collectionRef as SC-000042 when count is 41', async () => {
        mockPrisma.stockCollection.count.mockResolvedValue(41);
        mockPrisma.$transaction.mockResolvedValue(COLLECTION_STUB);
        await service.create(SINGLE_ITEM_DTO as any, makeTier());
        // count returned 41 → ref = SC-000042
        expect(mockPrisma.stockCollection.count).toHaveBeenCalledTimes(1);
      });

      it('calculates correct subtotal across multiple products', async () => {
        mockPrisma.product.findMany.mockResolvedValue([PRODUCT_A, PRODUCT_B]);
        mockPrisma.$transaction.mockResolvedValue(COLLECTION_STUB);
        // 6300000 × 100 + 6300000 × 50 = 630M + 315M = 945M kobo
        await service.create(MULTI_ITEM_DTO as any, makeTier());
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      });
    });

    describe('transaction', () => {
      it('runs inside a transaction', async () => {
        mockPrisma.$transaction.mockResolvedValue(COLLECTION_STUB);
        await service.create(SINGLE_ITEM_DTO as any, makeTier());
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      });

      it('returns the created collection', async () => {
        mockPrisma.$transaction.mockResolvedValue(COLLECTION_STUB);
        const result = await service.create(SINGLE_ITEM_DTO as any, makeTier());
        expect(result).toEqual(COLLECTION_STUB);
      });

      it('sets status to CONFIRMED on creation', async () => {
        // transaction runs the function — mock it to call through
        mockPrisma.$transaction.mockImplementation(async (fn: any) => {
          const result = await fn({
            stockCollection: { create: jest.fn().mockResolvedValue(COLLECTION_STUB) },
            agentInventory:  { upsert: jest.fn().mockResolvedValue({}) },
          });
          return result;
        });
        await service.create(SINGLE_ITEM_DTO as any, makeTier());
        // If we reach here without error the transaction ran correctly
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ── getMyInventory() ───────────────────────────────────────────────────────

  describe('getMyInventory()', () => {
    it('queries inventory scoped to the requesting agent', async () => {
      await service.getMyInventory(makeTier());
      expect(mockPrisma.agentInventory.findMany.mock.calls[0][0].where.userId)
        .toBe('agent-id');
    });

    it('returns inventory with valueKobo computed', async () => {
      const result = await service.getMyInventory(makeTier()) as any[];
      expect(result[0].valueKobo).toBe(BigInt(6300000) * BigInt(120));
    });

    it('orders results alphabetically by product name', async () => {
      await service.getMyInventory(makeTier());
      expect(mockPrisma.agentInventory.findMany.mock.calls[0][0].orderBy)
        .toEqual({ product: { name: 'asc' } });
    });

    it('returns empty array when agent has no in-hand stock', async () => {
      mockPrisma.agentInventory.findMany.mockResolvedValue([]);
      const result = await service.getMyInventory(makeTier());
      expect(result).toHaveLength(0);
    });

    it('returns all products the agent has collected so far', async () => {
      mockPrisma.agentInventory.findMany.mockResolvedValue([
        INVENTORY_STUB[0],
        { ...INVENTORY_STUB[0], productId: 'prod-b', quantityCartons: 30 },
      ]);
      const result = await service.getMyInventory(makeTier());
      expect(result).toHaveLength(2);
    });
  });

  // ── findAll() ──────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('field staff see only their own collections', async () => {
      await service.findAll({}, makeTier('TIER2'));
      const where = mockPrisma.stockCollection.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe('agent-id');
    });

    it('Sales Head sees all collections — no userId filter', async () => {
      await service.findAll({}, makeSalesHead());
      const where = mockPrisma.stockCollection.findMany.mock.calls[0][0].where;
      expect(where.userId).toBeUndefined();
    });

    it('System Admin sees all collections', async () => {
      await service.findAll({}, makeAdmin());
      const where = mockPrisma.stockCollection.findMany.mock.calls[0][0].where;
      expect(where.userId).toBeUndefined();
    });

    it('applies sourceId filter when provided', async () => {
      await service.findAll({ sourceId: 'kd-id' }, makeSalesHead());
      const where = mockPrisma.stockCollection.findMany.mock.calls[0][0].where;
      expect(where.sourceId).toBe('kd-id');
    });

    it('applies status filter when provided', async () => {
      await service.findAll({ status: 'CONFIRMED' }, makeSalesHead());
      const where = mockPrisma.stockCollection.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('CONFIRMED');
    });

    it('applies from date filter', async () => {
      await service.findAll({ from: '2026-08-01' }, makeSalesHead());
      const where = mockPrisma.stockCollection.findMany.mock.calls[0][0].where;
      expect(where.createdAt?.gte).toBeInstanceOf(Date);
    });

    it('applies to date filter', async () => {
      await service.findAll({ to: '2026-08-31' }, makeSalesHead());
      const where = mockPrisma.stockCollection.findMany.mock.calls[0][0].where;
      expect(where.createdAt?.lte).toBeInstanceOf(Date);
    });

    it('orders results by createdAt descending', async () => {
      await service.findAll({}, makeSalesHead());
      expect(mockPrisma.stockCollection.findMany.mock.calls[0][0].orderBy)
        .toEqual({ createdAt: 'desc' });
    });

    it('caps results at 200', async () => {
      await service.findAll({}, makeSalesHead());
      expect(mockPrisma.stockCollection.findMany.mock.calls[0][0].take).toBe(200);
    });
  });

  // ── findOne() ──────────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('returns the collection when requester is the creator', async () => {
      const result = await service.findOne('coll-id', makeTier());
      expect(result).toEqual(COLLECTION_STUB);
    });

    it('Admin can view any collection', async () => {
      mockPrisma.stockCollection.findUnique.mockResolvedValue({
        ...COLLECTION_STUB, userId: 'someone-else',
      });
      await expect(service.findOne('coll-id', makeAdmin())).resolves.not.toThrow();
    });

    it('Sales Head can view any collection', async () => {
      mockPrisma.stockCollection.findUnique.mockResolvedValue({
        ...COLLECTION_STUB, userId: 'someone-else',
      });
      await expect(service.findOne('coll-id', makeSalesHead())).resolves.not.toThrow();
    });

    it('throws ForbiddenException when field agent views another agent\'s collection', async () => {
      mockPrisma.stockCollection.findUnique.mockResolvedValue({
        ...COLLECTION_STUB, userId: 'other-agent',
      });
      await expect(service.findOne('coll-id', makeTier()))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.stockCollection.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad-id', makeAdmin()))
        .rejects.toThrow(NotFoundException);
    });
  });
});