
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ProductCategory } from '@prisma/client';
import { ProductService } from './products.service';
import { PrismaService } from '@common/prisma/prisma.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  product: {
    findUnique:        jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findMany:          jest.fn(),
    create:            jest.fn(),
    update:            jest.fn(),
  },
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PRODUCT = {
  id:              'prod-id',
  name:            'DarVinks Body Lotion 500ml',
  category:        ProductCategory.LOTION,
  packQty:         12,
  unitPriceKobo:   150000,
  cartonPriceKobo: 1700000,
  isActive:        true,
  createdAt:       new Date(),
  updatedAt:       new Date(),
};

const CREATE_DTO = {
  name:            'DarVinks Body Lotion 500ml',
  category:        ProductCategory.LOTION,
  packQty:         12,
  unitPriceKobo:   150000,
  cartonPriceKobo: 1700000,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProductService', () => {
  let service: ProductService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ProductService>(ProductService);
    jest.resetAllMocks();
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates and returns the product on success', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      mockPrisma.product.create.mockResolvedValue(PRODUCT);

      const result = await service.create(CREATE_DTO);

      expect(result).toEqual(PRODUCT);
      expect(mockPrisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name:    CREATE_DTO.name,
            category: CREATE_DTO.category,
          }),
        }),
      );
    });

    it('throws ConflictException when name+category already exists', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'existing-id' });

      await expect(service.create(CREATE_DTO)).rejects.toThrow(ConflictException);
      expect(mockPrisma.product.create).not.toHaveBeenCalled();
    });

    it('checks uniqueness with the name_category composite key', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      mockPrisma.product.create.mockResolvedValue(PRODUCT);

      await service.create(CREATE_DTO);

      expect(mockPrisma.product.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name_category: { name: CREATE_DTO.name, category: CREATE_DTO.category } },
        }),
      );
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('returns all products when no filters provided', async () => {
      mockPrisma.product.findMany.mockResolvedValue([PRODUCT]);

      const result = await service.findAll({});

      expect(result).toEqual([PRODUCT]);
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('applies category filter when provided', async () => {
      mockPrisma.product.findMany.mockResolvedValue([PRODUCT]);

      await service.findAll({ category: ProductCategory.LOTION });

      const call = mockPrisma.product.findMany.mock.calls[0][0];
      expect(call.where.category).toBe(ProductCategory.LOTION);
    });

    it('applies isActive filter when provided', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);

      await service.findAll({ isActive: false });

      const call = mockPrisma.product.findMany.mock.calls[0][0];
      expect(call.where.isActive).toBe(false);
    });

    it('orders results by category then name', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);

      await service.findAll({});

      const call = mockPrisma.product.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual([{ category: 'asc' }, { name: 'asc' }]);
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns product when found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(PRODUCT);

      const result = await service.findById('prod-id');
      expect(result).toEqual(PRODUCT);
    });

    it('throws NotFoundException when product does not exist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(service.findById('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── findByCategory ─────────────────────────────────────────────────────────

  describe('findByCategory()', () => {
    it('filters by category and isActive=true only', async () => {
      mockPrisma.product.findMany.mockResolvedValue([PRODUCT]);

      await service.findByCategory(ProductCategory.LOTION);

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { category: ProductCategory.LOTION, isActive: true },
        }),
      );
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('updates only provided fields', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(PRODUCT);
      mockPrisma.product.update.mockResolvedValue({ ...PRODUCT, packQty: 24 });

      const result = await service.update('prod-id', { packQty: 24 });

      expect(result.packQty).toBe(24);
      const updateData = mockPrisma.product.update.mock.calls[0][0].data;
      expect(updateData.packQty).toBe(24);
      expect(updateData.name).toBeUndefined();
      expect(updateData.category).toBeUndefined();
    });

    it('throws NotFoundException when product does not exist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.update('bad-id', { packQty: 24 }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.product.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when updating name+category to an existing combination', async () => {
      // assertExists → findUnique
      mockPrisma.product.findUnique
        .mockResolvedValueOnce(PRODUCT)             // assertExists
        .mockResolvedValueOnce({ id: 'other-id' }); // conflict check finds different product
      // fetch current (name/category) → findUniqueOrThrow
      mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce(PRODUCT);

      await expect(
        service.update('prod-id', { name: 'Existing Lotion' }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows updating name+category to the same product (no false conflict)', async () => {
      // assertExists → findUnique; conflict check → findUnique (same ID = no conflict)
      mockPrisma.product.findUnique
        .mockResolvedValueOnce(PRODUCT)           // assertExists
        .mockResolvedValueOnce({ id: 'prod-id' }); // conflict check — same ID, no conflict
      // fetch current → findUniqueOrThrow
      mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce(PRODUCT);
      mockPrisma.product.update.mockResolvedValue(PRODUCT);

      await expect(
        service.update('prod-id', { name: PRODUCT.name }),
      ).resolves.not.toThrow();
    });
  });

  // ── deactivate ─────────────────────────────────────────────────────────────

  describe('deactivate()', () => {
    it('sets isActive to false', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(PRODUCT);
      mockPrisma.product.update.mockResolvedValue({ ...PRODUCT, isActive: false });

      const result = await service.deactivate('prod-id');

      expect(result.isActive).toBe(false);
      expect(mockPrisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
    });

    it('throws ConflictException when already deactivated', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ ...PRODUCT, isActive: false });

      await expect(service.deactivate('prod-id')).rejects.toThrow(ConflictException);
      expect(mockPrisma.product.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when product does not exist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.deactivate('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── reactivate ─────────────────────────────────────────────────────────────

  describe('reactivate()', () => {
    it('sets isActive to true', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ ...PRODUCT, isActive: false });
      mockPrisma.product.update.mockResolvedValue(PRODUCT);

      const result = await service.reactivate('prod-id');
      expect(result.isActive).toBe(true);
    });

    it('throws ConflictException when already active', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(PRODUCT); // isActive: true

      await expect(service.reactivate('prod-id')).rejects.toThrow(ConflictException);
      expect(mockPrisma.product.update).not.toHaveBeenCalled();
    });
  });

  // ── static helpers ─────────────────────────────────────────────────────────

  describe('formatNaira()', () => {
    it('converts kobo to Naira string correctly', () => {
      expect(ProductService.formatNaira(1700000)).toContain('17,000');
      expect(ProductService.formatNaira(150000)).toContain('1,500');
    });
  });

  describe('effectivePrice()', () => {
    const product = { unitPriceKobo: 150000, cartonPriceKobo: 1700000, packQty: 12 };

    it('returns carton price when qty >= packQty', () => {
      expect(ProductService.effectivePrice(product, 12)).toBe(1700000);
      expect(ProductService.effectivePrice(product, 24)).toBe(1700000);
    });

    it('returns unit price × qty when qty < packQty', () => {
      expect(ProductService.effectivePrice(product, 5)).toBe(750000);
      expect(ProductService.effectivePrice(product, 1)).toBe(150000);
    });
  });
});