
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { WarehouseLocation } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type {
  StockInboundDto,
  StockAdjustmentDto,
  StockQueryDto,
  MovementQueryDto,
} from './dto/warehouse.dto';

// Only Warehouse Admin and System Admin manage stock
const WAREHOUSE_TIERS = ['WAREHOUSE_ADMIN', 'TIER5_SYSTEM_ADMIN'];

const STOCK_ENTRY_SELECT = {
  id:                true,
  warehouseLocation: true,
  productId:         true,
  product: {
    select: {
      name:            true,
      category:        true,
      unitPriceKobo:   true,
      cartonPriceKobo: true,
    },
  },
  quantityCartons:   true,
  lowStockThreshold: true,
  updatedAt:         true,
} as const;

const MOVEMENT_SELECT = {
  id:                true,
  warehouseLocation: true,
  productId:         true,
  product:           { select: { name: true, category: true } },
  type:              true,
  quantityCartons:   true,
  batchReference:    true,
  reasonNote:        true,
  purchaseOrderId:   true,
  recordedById:      true,
  recordedBy:        { select: { fullName: true, employeeRef: true } },
  adjustedById:      true,
  createdAt:         true,
} as const;

@Injectable()
export class WarehouseService {
  private readonly logger = new Logger(WarehouseService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Stock levels ───────────────────────────────────────────────────────────

  async getStockLevels(query: StockQueryDto) {
    const { warehouseLocation, lowStockOnly } = query;

    const entries = await this.prisma.stockEntry.findMany({
      where: {
        ...(warehouseLocation ? { warehouseLocation } : {}),
        // lowStockOnly: quantityCartons <= lowStockThreshold
        // Prisma doesn't support column comparisons directly — filter post-query
      },
      select:  STOCK_ENTRY_SELECT,
      orderBy: [{ warehouseLocation: 'asc' }, { product: { name: 'asc' } }],
    });

    if (lowStockOnly) {
      return entries.filter((e) => e.quantityCartons <= e.lowStockThreshold);
    }
    return entries;
  }

  async getStockForProduct(
    productId: string,
    warehouseLocation: WarehouseLocation,
  ) {
    const entry = await this.prisma.stockEntry.findUnique({
      where:  { warehouseLocation_productId: { warehouseLocation, productId } },
      select: STOCK_ENTRY_SELECT,
    });
    if (!entry) throw new NotFoundException(
      `No stock entry for product ${productId} at ${warehouseLocation}`,
    );
    return entry;
  }

  // ── Inbound stock ──────────────────────────────────────────────────────────

  async recordInbound(dto: StockInboundDto, requester: JwtPayload) {
    this.assertWarehouseTier(requester);
    this.assertWarehouseScope(requester, dto.warehouseLocation);

    // Verify product exists and is active
    const product = await this.prisma.product.findUnique({
      where:  { id: dto.productId },
      select: { id: true, isActive: true, name: true },
    });
    if (!product)        throw new NotFoundException(`Product ${dto.productId} not found`);
    if (!product.isActive) throw new BadRequestException(`Product "${product.name}" is inactive`);

    const [entry] = await this.prisma.$transaction([
      // Upsert stock entry — create if first time, increment if exists
      this.prisma.stockEntry.upsert({
        where: {
          warehouseLocation_productId: {
            warehouseLocation: dto.warehouseLocation,
            productId:         dto.productId,
          },
        },
        create: {
          warehouseLocation: dto.warehouseLocation,
          productId:         dto.productId,
          quantityCartons:   dto.quantityCartons,
        },
        update: {
          quantityCartons: { increment: dto.quantityCartons },
        },
        select: STOCK_ENTRY_SELECT,
      }),
      // Record the movement for audit trail
      this.prisma.stockMovement.create({
        data: {
          warehouseLocation: dto.warehouseLocation,
          productId:         dto.productId,
          type:              'INBOUND',
          quantityCartons:   dto.quantityCartons,
          batchReference:    dto.batchReference ?? null,
          reasonNote:        dto.reasonNote     ?? null,
          recordedById:      requester.sub,
        },
      }),
    ]);

    this.logger.log(
      `Inbound: ${dto.quantityCartons} cartons of ${dto.productId} ` +
      `at ${dto.warehouseLocation} by ${requester.sub}`,
    );
    return entry;
  }

  // ── Stock adjustment ───────────────────────────────────────────────────────

  async adjustStock(dto: StockAdjustmentDto, requester: JwtPayload) {
    this.assertWarehouseTier(requester);
    this.assertWarehouseScope(requester, dto.warehouseLocation);

    // Fetch current stock
    const entry = await this.prisma.stockEntry.findUnique({
      where: {
        warehouseLocation_productId: {
          warehouseLocation: dto.warehouseLocation,
          productId:         dto.productId,
        },
      },
      select: { quantityCartons: true },
    });

    if (!entry) {
      throw new NotFoundException(
        `No stock entry for product ${dto.productId} at ${dto.warehouseLocation}`,
      );
    }

    const newQty = entry.quantityCartons + dto.quantityCartons;
    if (newQty < 0) {
      throw new BadRequestException(
        `Adjustment would result in negative stock ` +
        `(current: ${entry.quantityCartons}, adjustment: ${dto.quantityCartons})`,
      );
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.stockEntry.update({
        where: {
          warehouseLocation_productId: {
            warehouseLocation: dto.warehouseLocation,
            productId:         dto.productId,
          },
        },
        data:   { quantityCartons: newQty },
        select: STOCK_ENTRY_SELECT,
      }),
      this.prisma.stockMovement.create({
        data: {
          warehouseLocation: dto.warehouseLocation,
          productId:         dto.productId,
          type:              'ADJUSTMENT',
          quantityCartons:   dto.quantityCartons,
          reasonNote:        dto.reasonNote,
          recordedById:      requester.sub,
          adjustedById:      requester.sub,
        },
      }),
    ]);

    this.logger.log(
      `Adjustment: ${dto.quantityCartons} cartons of ${dto.productId} ` +
      `at ${dto.warehouseLocation} by ${requester.sub}. New qty: ${newQty}`,
    );
    return updated;
  }

  // ── Movement history ───────────────────────────────────────────────────────

  async getMovements(query: MovementQueryDto) {
    return this.prisma.stockMovement.findMany({
      where: {
        ...(query.warehouseLocation ? { warehouseLocation: query.warehouseLocation } : {}),
        ...(query.type              ? { type:              query.type }              : {}),
        ...(query.productId         ? { productId:         query.productId }         : {}),
      },
      select:  MOVEMENT_SELECT,
      orderBy: { createdAt: 'desc' },
      take:    200, // guard against returning unbounded result sets
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private assertWarehouseTier(requester: JwtPayload): void {
    if (!WAREHOUSE_TIERS.includes(requester.tier as string)) {
      throw new ForbiddenException(
        'Only Warehouse Admin and System Admin can record stock movements',
      );
    }
  }

  private assertWarehouseScope(
    requester: JwtPayload,
    location: WarehouseLocation,
  ): void {
    // System Admin has access to all warehouses
    if (requester.tier === 'TIER5_SYSTEM_ADMIN') return;

    // Warehouse Admin is scoped to one location — check via the user's
    // warehouseLocation claim which we add to the JWT payload in Phase 1
    // For now we trust the DB check in the controller guard layer
  }
}