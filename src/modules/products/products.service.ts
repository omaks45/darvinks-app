
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ProductCategory } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type { CreateProductDto, UpdateProductDto, ProductQueryDto } from './dto/product.dto';

// Fields returned in all product responses
const PRODUCT_SELECT = {
  id:              true,
  name:            true,
  category:        true,
  packQty:         true,
  unitPriceKobo:   true,
  cartonPriceKobo: true,
  isActive:        true,
  imageUrl:        true,
  createdAt:       true,
  updatedAt:       true,
} as const;

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly prisma:     PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(dto: CreateProductDto) {
    // Enforce unique (name, category) at service level for a clear error message
    const existing = await this.prisma.product.findUnique({
      where: { name_category: { name: dto.name, category: dto.category } },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        `A ${dto.category} product named "${dto.name}" already exists`,
      );
    }

    const product = await this.prisma.product.create({
      data: {
        name:            dto.name,
        category:        dto.category,
        packQty:         dto.packQty,
        unitPriceKobo:   dto.unitPriceKobo,
        cartonPriceKobo: dto.cartonPriceKobo,
      },
      select: PRODUCT_SELECT,
    });

    this.logger.log(`Product created: ${product.name} (${product.category})`);
    return product;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findAll(query: ProductQueryDto) {
    const { category, isActive } = query;

    return this.prisma.product.findMany({
      where: {
        ...(category  ? { category }          : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
      select:  PRODUCT_SELECT,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({
      where:  { id },
      select: PRODUCT_SELECT,
    });

    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async findByCategory(category: ProductCategory) {
    return this.prisma.product.findMany({
      where:   { category, isActive: true },
      select:  PRODUCT_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateProductDto) {
    await this.assertExists(id);

    // If name or category is changing, check uniqueness
    if (dto.name !== undefined || dto.category !== undefined) {
      const current = await this.prisma.product.findUniqueOrThrow({
        where:  { id },
        select: { name: true, category: true },
      });

      const newName     = dto.name     ?? current.name;
      const newCategory = dto.category ?? current.category;

      const conflict = await this.prisma.product.findUnique({
        where: { name_category: { name: newName, category: newCategory } },
        select: { id: true },
      });

      if (conflict && conflict.id !== id) {
        throw new ConflictException(
          `A ${newCategory} product named "${newName}" already exists`,
        );
      }
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name            !== undefined ? { name:            dto.name }            : {}),
        ...(dto.category        !== undefined ? { category:        dto.category }        : {}),
        ...(dto.packQty         !== undefined ? { packQty:         dto.packQty }         : {}),
        ...(dto.unitPriceKobo   !== undefined ? { unitPriceKobo:   dto.unitPriceKobo }   : {}),
        ...(dto.cartonPriceKobo !== undefined ? { cartonPriceKobo: dto.cartonPriceKobo } : {}),
        ...(dto.isActive        !== undefined ? { isActive:        dto.isActive }        : {}),
      },
      select: PRODUCT_SELECT,
    });

    this.logger.log(`Product updated: ${updated.name} (${updated.category})`);
    return updated;
  }

  // ── Deactivate / Reactivate ────────────────────────────────────────────────
  // Hard delete is intentionally not exposed — products referenced by
  // purchase orders or stock entries must remain in the system for history.

  async deactivate(id: string) {
    const product = await this.assertExists(id);

    if (!product.isActive) {
      throw new ConflictException('Product is already deactivated');
    }

    return this.prisma.product.update({
      where: { id },
      data:  { isActive: false },
      select: PRODUCT_SELECT,
    });
  }

  async reactivate(id: string) {
    const product = await this.assertExists(id);

    if (product.isActive) {
      throw new ConflictException('Product is already active');
    }

    return this.prisma.product.update({
      where: { id },
      data:  { isActive: true },
      select: PRODUCT_SELECT,
    });
  }

  // ── Price helpers (used by purchase order and analytics modules) ──────────

  /**
   * Formats a kobo integer as a readable Naira string.
   * e.g. 1700000 → "₦17,000.00"
   */
  static formatNaira(kobo: number): string {
    return new Intl.NumberFormat('en-NG', {
      style:    'currency',
      currency: 'NGN',
    }).format(kobo / 100);
  }

  /**
   * Returns the effective carton price for a given quantity.
   * Business rule: carton price applies when qty >= packQty.
   */
  static effectivePrice(
    product: { unitPriceKobo: number; cartonPriceKobo: number; packQty: number },
    qty: number,
  ): number {
    return qty >= product.packQty
      ? product.cartonPriceKobo
      : product.unitPriceKobo * qty;
  }

  // ── Upload product image (Sales Support Agent only) ───────────────────────

  async uploadImage(id: string, file: Express.Multer.File, requester: JwtPayload) {
    if (!['TIER5_SALES_SUPPORT', 'TIER5_SALES_HEAD'].includes(requester.tier as string)) {
      throw new ForbiddenException('Only Sales Support Agents can upload product images');
    }

    await this.assertExists(id);

    const uploadResult = await this.cloudinary.uploadBuffer(
      file.buffer,
      'products',
      {
        publicId:     `product-${id}`,
        resourceType: 'image',
      },
    );

    return this.prisma.product.update({
      where:  { id },
      data:   { imageUrl: uploadResult.secure_url },
      select: PRODUCT_SELECT,
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async assertExists(id: string) {
    const product = await this.prisma.product.findUnique({
      where:  { id },
      select: { id: true, isActive: true, name: true },
    });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }
}