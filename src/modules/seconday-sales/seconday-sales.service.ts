
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type {
  CreateSecondarySaleDto,
  SecondarySaleQueryDto,
} from './dto/seconday-sale.dto';

// Field tiers only — confirmed: any of Tier 1-4 may log a secondary sale,
// not just Tier 1.
const FIELD_TIERS = ['TIER1', 'TIER2', 'TIER3', 'TIER4'];
const ADMIN_TIERS  = ['TIER5_SYSTEM_ADMIN', 'TIER5_SALES_HEAD', 'TIER6_GM'];

const SALE_SELECT = {
  id:         true,
  userId:     true,
  user:       { select: { fullName: true, employeeRef: true } },
  kdAccountId: true,
  kdAccount:  { select: { businessName: true, region: true } },
  latitude:   true,
  longitude:  true,
  deviceTime: true,
  serverTime: true,
  note:       true,
  createdAt:  true,
  items: {
    select: {
      id:              true,
      productId:       true,
      product:         { select: { name: true, category: true } },
      buyerType:       true,
      quantityCartons: true,
      quantityRows:    true,
      quantityPieces:  true,
    },
  },
} as const;

@Injectable()
export class SecondarySaleService {
  private readonly logger = new Logger(SecondarySaleService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(dto: CreateSecondarySaleDto, requester: JwtPayload) {
    if (!FIELD_TIERS.includes(requester.tier as string)) {
      throw new ForbiddenException(
        'Only field staff (Tier 1-4) can log secondary sales',
      );
    }

    // Validate kdAccountId against a real, active Customer — this was
    // previously a loose string for offline flexibility, but that let
    // typos and stale IDs silently corrupt achievement-vs-target rollups,
    // so it's now checked the same way PurchaseOrderService validates
    // customerId on PO creation.
    const customer = await this.prisma.customer.findUnique({
      where:  { id: dto.kdAccountId },
      select: { id: true, isActive: true, businessName: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${dto.kdAccountId} not found`);
    }
    if (!customer.isActive) {
      throw new BadRequestException(
        `Customer "${customer.businessName}" is deactivated`,
      );
    }

    // Validate all referenced products exist — same dedup + single-query
    // pattern as PurchaseOrderService.create() for O(1) DB round trips
    // regardless of item count.
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where:  { id: { in: productIds } },
      select: { id: true },
    });
    if (products.length !== productIds.length) {
      const found   = new Set(products.map((p) => p.id));
      const missing = productIds.filter((id) => !found.has(id));
      throw new BadRequestException(`Products not found: ${missing.join(', ')}`);
    }

    const sale = await this.prisma.secondarySale.create({
      data: {
        userId:      requester.sub,
        kdAccountId: dto.kdAccountId,
        latitude:    dto.latitude,
        longitude:   dto.longitude,
        deviceTime:  new Date(dto.deviceTime),
        note:        dto.note ?? null,
        items: {
          create: dto.items.map((item) => ({
            productId:       item.productId,
            buyerType:       item.buyerType,
            quantityCartons: item.quantityCartons ?? 0,
            quantityRows:    item.quantityRows    ?? 0,
            quantityPieces:  item.quantityPieces  ?? 0,
          })),
        },
      },
      select: SALE_SELECT,
    });

    this.logger.log(
      `Secondary sale logged at customer ${dto.kdAccountId} by ${requester.sub}`,
    );
    return sale;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findAll(query: SecondarySaleQueryDto, requester: JwtPayload) {
    const isAdmin = ADMIN_TIERS.includes(requester.tier as string);
    const dateFilter = this.buildDateFilter(query.from, query.to);

    return this.prisma.secondarySale.findMany({
      where: {
        ...(isAdmin ? {} : { userId: requester.sub }),
        ...(query.kdAccountId ? { kdAccountId: query.kdAccountId } : {}),
        ...(dateFilter ? { deviceTime: dateFilter } : {}),
        ...(query.buyerType
          ? { items: { some: { buyerType: query.buyerType } } }
          : {}),
      },
      select:  SALE_SELECT,
      orderBy: { deviceTime: 'desc' },
      take:    200,
    });
  }

  async findById(id: string, requester: JwtPayload) {
    const sale = await this.prisma.secondarySale.findUnique({
      where:  { id },
      select: SALE_SELECT,
    });
    if (!sale) throw new NotFoundException(`Secondary sale ${id} not found`);

    if (
      !ADMIN_TIERS.includes(requester.tier as string) &&
      sale.userId !== requester.sub
    ) {
      throw new ForbiddenException('You can only view your own secondary sales');
    }

    return sale;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildDateFilter(
    from?: string,
    to?: string,
  ): { gte?: Date; lte?: Date } | null {
    if (!from && !to) return null;
    return {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to) }   : {}),
    };
  }
}