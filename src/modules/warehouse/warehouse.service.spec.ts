// src/modules/warehouse/warehouse.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { WarehouseLocation, StockMovementType } from '@prisma/client';
import { WarehouseService } from './warehouse.service';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  product:       { findUnique: jest.fn() },
  stockEntry:    { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  stockMovement: { findMany: jest.fn(), create: jest.fn() },
  $transaction:  jest.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STOCK_ENTRY = {
  id:                'entry-id',
  warehouseLocation: WarehouseLocation.LAGOS_HQ,
  productId:         'prod-id',
  product:           { name: 'DarVinks Lotion', category: 'LOTION', unitPriceKobo: 150000, cartonPriceKobo: 1700000 },
  quantityCartons:   50,
  lowStockThreshold: 10,
  updatedAt:         new Date(),
};

const ACTIVE_PRODUCT = { id: 'prod-id', isActive: true, name: 'DarVinks Lotion' };

function makeWarehouseAdmin(
  overrides: Partial<JwtPayload> = {},
): JwtPayload {
  return {
    sub:   'admin-id',
    email: 'wh@darvinks.com',
    tier:  'WAREHOUSE_ADMIN',
    team:  'BRIGHT',
    ...overrides,
  } as JwtPayload;
}

function makeFieldStaff(): JwtPayload {
  return {
    sub:   'field-id',
    email: 'field@darvinks.com',
    tier:  'TIER2',
    team:  'BRIGHT',
  } as JwtPayload;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WarehouseService', () => {
  let service: WarehouseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarehouseService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WarehouseService>(WarehouseService);
    jest.resetAllMocks();

    // Default $transaction executes all ops and returns their results
    mockPrisma.$transaction.mockImplementation(
      (ops: Promise<unknown>[]) => Promise.all(ops),
    );
  });

  // ── getStockLevels ─────────────────────────────────────────────────────────

  describe('getStockLevels()', () => {
    it('returns all stock entries when no filters applied', async () => {
      mockPrisma.stockEntry.findMany.mockResolvedValue([STOCK_ENTRY]);

      const result = await service.getStockLevels({});
      expect(result).toEqual([STOCK_ENTRY]);
    });

    it('filters by warehouseLocation', async () => {
      mockPrisma.stockEntry.findMany.mockResolvedValue([STOCK_ENTRY]);

      await service.getStockLevels({ warehouseLocation: WarehouseLocation.LAGOS_HQ });

      const where = mockPrisma.stockEntry.findMany.mock.calls[0][0].where;
      expect(where.warehouseLocation).toBe(WarehouseLocation.LAGOS_HQ);
    });

    it('filters to low stock entries when lowStockOnly=true', async () => {
      const entries = [
        { ...STOCK_ENTRY, quantityCartons: 5,  lowStockThreshold: 10 }, // low
        { ...STOCK_ENTRY, quantityCartons: 50, lowStockThreshold: 10 }, // ok
      ];
      mockPrisma.stockEntry.findMany.mockResolvedValue(entries);

      const result = await service.getStockLevels({ lowStockOnly: true });
      expect(result).toHaveLength(1);
      expect(result[0].quantityCartons).toBe(5);
    });

    it('includes entries at exactly the threshold as low stock', async () => {
      const entries = [
        { ...STOCK_ENTRY, quantityCartons: 10, lowStockThreshold: 10 }, // exactly threshold
      ];
      mockPrisma.stockEntry.findMany.mockResolvedValue(entries);

      const result = await service.getStockLevels({ lowStockOnly: true });
      expect(result).toHaveLength(1);
    });
  });

  // ── getStockForProduct ─────────────────────────────────────────────────────

  describe('getStockForProduct()', () => {
    it('returns stock entry when found', async () => {
      mockPrisma.stockEntry.findUnique.mockResolvedValue(STOCK_ENTRY);

      const result = await service.getStockForProduct(
        'prod-id', WarehouseLocation.LAGOS_HQ,
      );
      expect(result).toEqual(STOCK_ENTRY);
    });

    it('throws NotFoundException when entry does not exist', async () => {
      mockPrisma.stockEntry.findUnique.mockResolvedValue(null);

      await expect(
        service.getStockForProduct('prod-id', WarehouseLocation.LAGOS_HQ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── recordInbound ──────────────────────────────────────────────────────────

  describe('recordInbound()', () => {
    const INBOUND_DTO = {
      productId:         'prod-id',
      warehouseLocation: WarehouseLocation.LAGOS_HQ,
      quantityCartons:   20,
      batchReference:    'BATCH-001',
    };

    it('creates inbound movement and upserts stock entry', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(ACTIVE_PRODUCT);
      mockPrisma.$transaction.mockResolvedValue([STOCK_ENTRY, {}]);

      const result = await service.recordInbound(INBOUND_DTO, makeWarehouseAdmin());
      expect(result).toEqual(STOCK_ENTRY);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('throws ForbiddenException for field staff', async () => {
      await expect(
        service.recordInbound(INBOUND_DTO, makeFieldStaff()),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.product.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when product does not exist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.recordInbound(INBOUND_DTO, makeWarehouseAdmin()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when product is inactive', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...ACTIVE_PRODUCT,
        isActive: false,
      });

      await expect(
        service.recordInbound(INBOUND_DTO, makeWarehouseAdmin()),
      ).rejects.toThrow(BadRequestException);
    });

    it('runs upsert and movement create in a single transaction', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(ACTIVE_PRODUCT);
      mockPrisma.$transaction.mockResolvedValue([STOCK_ENTRY, {}]);

      await service.recordInbound(INBOUND_DTO, makeWarehouseAdmin());

      // Transaction called with an array of two promises
      const txArgs = mockPrisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(txArgs)).toBe(true);
      expect(txArgs).toHaveLength(2);
    });

    it('System Admin can also record inbound', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(ACTIVE_PRODUCT);
      mockPrisma.$transaction.mockResolvedValue([STOCK_ENTRY, {}]);
      const sysAdmin = makeWarehouseAdmin({ tier: 'TIER5_SYSTEM_ADMIN' });

      await expect(
        service.recordInbound(INBOUND_DTO, sysAdmin),
      ).resolves.not.toThrow();
    });
  });

  // ── adjustStock ────────────────────────────────────────────────────────────

  describe('adjustStock()', () => {
    const ADJUST_DTO = {
      productId:         'prod-id',
      warehouseLocation: WarehouseLocation.LAGOS_HQ,
      quantityCartons:   -5,
      reasonNote:        'Damaged stock write-off',
    };

    it('applies negative adjustment and records movement', async () => {
      mockPrisma.stockEntry.findUnique.mockResolvedValue(STOCK_ENTRY); // qty: 50
      mockPrisma.$transaction.mockResolvedValue([
        { ...STOCK_ENTRY, quantityCartons: 45 },
        {},
      ]);

      const result = await service.adjustStock(ADJUST_DTO, makeWarehouseAdmin());
      expect(result.quantityCartons).toBe(45);
    });

    it('applies positive adjustment', async () => {
      mockPrisma.stockEntry.findUnique.mockResolvedValue(STOCK_ENTRY);
      mockPrisma.$transaction.mockResolvedValue([
        { ...STOCK_ENTRY, quantityCartons: 60 },
        {},
      ]);

      const result = await service.adjustStock(
        { ...ADJUST_DTO, quantityCartons: 10 },
        makeWarehouseAdmin(),
      );
      expect(result.quantityCartons).toBe(60);
    });

    it('throws BadRequestException when adjustment results in negative stock', async () => {
      mockPrisma.stockEntry.findUnique.mockResolvedValue({
        ...STOCK_ENTRY,
        quantityCartons: 3,
      });

      await expect(
        service.adjustStock(
          { ...ADJUST_DTO, quantityCartons: -10 }, // 3 - 10 = -7
          makeWarehouseAdmin(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no stock entry exists', async () => {
      mockPrisma.stockEntry.findUnique.mockResolvedValue(null);

      await expect(
        service.adjustStock(ADJUST_DTO, makeWarehouseAdmin()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for field staff', async () => {
      await expect(
        service.adjustStock(ADJUST_DTO, makeFieldStaff()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('runs update and movement create in a single transaction', async () => {
      mockPrisma.stockEntry.findUnique.mockResolvedValue(STOCK_ENTRY);
      mockPrisma.$transaction.mockResolvedValue([STOCK_ENTRY, {}]);

      await service.adjustStock(ADJUST_DTO, makeWarehouseAdmin());

      const txArgs = mockPrisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(txArgs)).toBe(true);
      expect(txArgs).toHaveLength(2);
    });
  });

  // ── getMovements ───────────────────────────────────────────────────────────

  describe('getMovements()', () => {
    it('returns movements ordered by createdAt descending', async () => {
      mockPrisma.stockMovement.findMany.mockResolvedValue([]);

      await service.getMovements({});

      expect(mockPrisma.stockMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('limits results to 200 records', async () => {
      mockPrisma.stockMovement.findMany.mockResolvedValue([]);

      await service.getMovements({});

      expect(mockPrisma.stockMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('filters by warehouseLocation', async () => {
      mockPrisma.stockMovement.findMany.mockResolvedValue([]);

      await service.getMovements({ warehouseLocation: WarehouseLocation.KANO });

      const where = mockPrisma.stockMovement.findMany.mock.calls[0][0].where;
      expect(where.warehouseLocation).toBe(WarehouseLocation.KANO);
    });

    it('filters by movement type', async () => {
      mockPrisma.stockMovement.findMany.mockResolvedValue([]);

      await service.getMovements({ type: StockMovementType.INBOUND });

      const where = mockPrisma.stockMovement.findMany.mock.calls[0][0].where;
      expect(where.type).toBe(StockMovementType.INBOUND);
    });

    it('filters by productId', async () => {
      mockPrisma.stockMovement.findMany.mockResolvedValue([]);

      await service.getMovements({ productId: 'prod-id' });

      const where = mockPrisma.stockMovement.findMany.mock.calls[0][0].where;
      expect(where.productId).toBe('prod-id');
    });
  });
});