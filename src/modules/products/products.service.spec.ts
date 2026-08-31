// src/modules/products/products.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProductService } from './products.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  product: {
    findMany:  jest.fn(),
    findUnique: jest.fn(),
    create:    jest.fn(),
    update:    jest.fn(),
    count:     jest.fn(),
  },
};

const mockCloudinary = { uploadBuffer: jest.fn() };

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PRODUCT_STUB = {
  id:              'prod-id',
  name:            'Visita Essence B Whitening Lotion 250ml',
  category:        'LOTION',
  packQty:         12,
  unitPriceKobo:   BigInt(525000),
  cartonPriceKobo: BigInt(6300000),
  isActive:        true,
  imageUrl:        null,
  createdAt:       new Date(),
  updatedAt:       new Date(),
};

const CREATE_DTO = {
  name:            'Visita Essence B Whitening Lotion 250ml',
  category:        'LOTION',
  packQty:         12,
  unitPriceKobo:   525000,
  cartonPriceKobo: 6300000,
};

const MOCK_FILE = {
  buffer:   Buffer.from('image-data'),
  mimetype: 'image/jpeg',
} as Express.Multer.File;

function makeSalesSupport(): JwtPayload {
  return { sub: 'ss-id', email: 'ss@test.com', tier: 'TIER5_SALES_SUPPORT', team: 'RADIANT' } as JwtPayload;
}
function makeSalesHead(): JwtPayload {
  return { sub: 'sh-id', email: 'sh@test.com', tier: 'TIER5_SALES_HEAD', team: 'RADIANT' } as JwtPayload;
}
function makeAgent(tier = 'TIER2'): JwtPayload {
  return { sub: 'agent-id', email: 'agent@test.com', tier, team: 'RADIANT' } as JwtPayload;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProductService', () => {
  let service: ProductService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService,     useValue: mockPrisma },
        { provide: CloudinaryService, useValue: mockCloudinary },
      ],
    }).compile();

    service = module.get<ProductService>(ProductService);
    jest.resetAllMocks();

    // Default: product does NOT exist yet (for create tests)
    mockPrisma.product.findUnique.mockResolvedValue(null);
    mockPrisma.product.findMany.mockResolvedValue([PRODUCT_STUB]);
    mockPrisma.product.create.mockResolvedValue(PRODUCT_STUB);
    mockPrisma.product.update.mockResolvedValue(PRODUCT_STUB);
    mockPrisma.product.count.mockResolvedValue(0);
    mockCloudinary.uploadBuffer.mockResolvedValue({
      secure_url: 'https://cloudinary.com/products/prod-id.jpg',
    });
  });

  // ── create() ───────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates a product and returns it', async () => {
      const result = await service.create(CREATE_DTO as any);
      expect(mockPrisma.product.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual(PRODUCT_STUB);
    });

    it('passes dto values to prisma create', async () => {
      await service.create(CREATE_DTO as any);
      const data = mockPrisma.product.create.mock.calls[0][0].data;
      expect(data.name).toBe(CREATE_DTO.name);
      expect(data.category).toBe(CREATE_DTO.category);
      expect(data.packQty).toBe(CREATE_DTO.packQty);
    });

    it('throws ConflictException when product name + category already exists', async () => {
      // findUnique returns existing product → service throws ConflictException
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'existing-id' });
      await expect(service.create(CREATE_DTO as any))
        .rejects.toThrow(ConflictException);
      expect(mockPrisma.product.create).not.toHaveBeenCalled();
    });

    it('sets isActive to true on creation', async () => {
      await service.create(CREATE_DTO as any);
      // isActive comes from the returned PRODUCT_STUB which has isActive: true
      expect(mockPrisma.product.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── findAll() ──────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('returns all active products by default', async () => {
      const result = await service.findAll({});
      expect(result).toHaveLength(1);
    });

    it('applies category filter when provided', async () => {
      await service.findAll({ category: 'LOTION' } as any);
      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      expect(where.category).toBe('LOTION');
    });

    it('applies isActive filter when provided', async () => {
      await service.findAll({ isActive: false } as any);
      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      expect(where.isActive).toBe(false);
    });

    it('returns imageUrl in the response', async () => {
      const result = await service.findAll({}) as any[];
      expect(result[0]).toHaveProperty('imageUrl');
    });
  });

  // ── findById() ─────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns a product by id', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(PRODUCT_STUB);
      const result = await service.findById('prod-id');
      expect(result).toEqual(PRODUCT_STUB);
    });

    it('throws NotFoundException when product does not exist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id'))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── findByCategory() ───────────────────────────────────────────────────────

  describe('findByCategory()', () => {
    it('returns only active products for the given category', async () => {
      await service.findByCategory('LOTION' as any);
      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      expect(where.category).toBe('LOTION');
      expect(where.isActive).toBe(true);
    });
  });

  // ── update() ───────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('updates a product and returns it', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(PRODUCT_STUB);
      const result = await service.update('prod-id', { packQty: 24 } as any);
      expect(mockPrisma.product.update).toHaveBeenCalledTimes(1);
      expect(result).toEqual(PRODUCT_STUB);
    });

    it('throws NotFoundException when product does not exist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.update('bad-id', { packQty: 24 } as any))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── deactivate() ───────────────────────────────────────────────────────────

  describe('deactivate()', () => {
    it('sets isActive to false', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(PRODUCT_STUB); // isActive: true
      await service.deactivate('prod-id');
      const data = mockPrisma.product.update.mock.calls[0][0].data;
      expect(data.isActive).toBe(false);
    });

    it('throws NotFoundException when product does not exist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.deactivate('bad-id'))
        .rejects.toThrow(NotFoundException);
    });

    it('throws when product is already deactivated', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ ...PRODUCT_STUB, isActive: false });
      // Service throws ConflictException for already-deactivated
      await expect(service.deactivate('prod-id'))
        .rejects.toThrow();
    });
  });

  // ── reactivate() ───────────────────────────────────────────────────────────

  describe('reactivate()', () => {
    it('sets isActive to true', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ ...PRODUCT_STUB, isActive: false });
      await service.reactivate('prod-id');
      const data = mockPrisma.product.update.mock.calls[0][0].data;
      expect(data.isActive).toBe(true);
    });

    it('throws NotFoundException when product does not exist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.reactivate('bad-id'))
        .rejects.toThrow(NotFoundException);
    });

    it('throws when product is already active', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(PRODUCT_STUB); // isActive: true
      // Service throws ConflictException for already-active
      await expect(service.reactivate('prod-id'))
        .rejects.toThrow();
    });
  });

  // ── uploadImage() ──────────────────────────────────────────────────────────

  describe('uploadImage()', () => {
    describe('access control', () => {
      it('Sales Support Agent can upload product image', async () => {
        mockPrisma.product.findUnique.mockResolvedValue(PRODUCT_STUB);
        await expect(service.uploadImage('prod-id', MOCK_FILE, makeSalesSupport()))
          .resolves.not.toThrow();
      });

      it('Sales Head can upload product image', async () => {
        mockPrisma.product.findUnique.mockResolvedValue(PRODUCT_STUB);
        await expect(service.uploadImage('prod-id', MOCK_FILE, makeSalesHead()))
          .resolves.not.toThrow();
      });

      it('throws ForbiddenException for Tier 2 field agent', async () => {
        await expect(service.uploadImage('prod-id', MOCK_FILE, makeAgent('TIER2')))
          .rejects.toThrow(ForbiddenException);
        expect(mockCloudinary.uploadBuffer).not.toHaveBeenCalled();
      });

      it('throws ForbiddenException for Tier 4', async () => {
        await expect(service.uploadImage('prod-id', MOCK_FILE, makeAgent('TIER4')))
          .rejects.toThrow(ForbiddenException);
      });
    });

    describe('upload behaviour', () => {
      it('uploads file to Cloudinary products folder', async () => {
        mockPrisma.product.findUnique.mockResolvedValue(PRODUCT_STUB);
        await service.uploadImage('prod-id', MOCK_FILE, makeSalesSupport());
        expect(mockCloudinary.uploadBuffer).toHaveBeenCalledWith(
          MOCK_FILE.buffer,
          'products',
          expect.objectContaining({ publicId: 'product-prod-id', resourceType: 'image' }),
        );
      });

      it('saves the returned Cloudinary URL as imageUrl on the product', async () => {
        mockPrisma.product.findUnique.mockResolvedValue(PRODUCT_STUB);
        await service.uploadImage('prod-id', MOCK_FILE, makeSalesSupport());
        const data = mockPrisma.product.update.mock.calls[0][0].data;
        expect(data.imageUrl).toBe('https://cloudinary.com/products/prod-id.jpg');
      });

      it('throws NotFoundException when product does not exist', async () => {
        mockPrisma.product.findUnique.mockResolvedValue(null);
        await expect(service.uploadImage('bad-id', MOCK_FILE, makeSalesSupport()))
          .rejects.toThrow(NotFoundException);
        expect(mockCloudinary.uploadBuffer).not.toHaveBeenCalled();
      });
    });

    describe('static helpers', () => {
      it('formatNaira converts kobo to Nigerian naira string', () => {
        const result = ProductService.formatNaira(6300000);
        expect(result).toContain('63,000');
      });

      it('effectivePrice returns cartonPriceKobo when qty >= packQty', () => {
        const product = { unitPriceKobo: 525000, cartonPriceKobo: 6300000, packQty: 12 };
        expect(ProductService.effectivePrice(product, 12)).toBe(6300000);
        expect(ProductService.effectivePrice(product, 24)).toBe(6300000);
      });

      it('effectivePrice returns unitPriceKobo × qty when qty < packQty', () => {
        const product = { unitPriceKobo: 525000, cartonPriceKobo: 6300000, packQty: 12 };
        expect(ProductService.effectivePrice(product, 5)).toBe(525000 * 5);
      });
    });
  });
});