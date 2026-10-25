
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { GoogleMapsService } from '@common/google/google-map.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type { CreateSecondarySaleDto, SecondarySaleQueryDto } from './dto/seconday-sale.dto';

// Exported pagination type (used by controller return types)

export interface PaginatedResult<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ─── Role constants ───────────────────────────────────────────────────────────

/** Tiers that can submit secondary sales and see only their own records */
const FIELD_TIERS = ['TIER1', 'TIER2', 'TIER3', 'TIER4'] as const;

// ─── Common include shape ─────────────────────────────────────────────────────

const SALE_INCLUDE = {
  user: {
    select: {
      id: true, fullName: true, employeeRef: true,
      role: true, tier: true, team: true, region: true,
    },
  },
  kdAccount: { select: { id: true, businessName: true } },
  items: {
    include: {
      product: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.SecondarySaleInclude;

@Injectable()
export class SecondaySalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly maps:   GoogleMapsService,
  ) {}

  // ─── Create (field agents only) ───────────────────────────────────────────

  /**
   * POST /secondary-sales
   *
   * Only TIER1–TIER4 field agents may submit secondary sales.
   * Validates that:
   *  - The KD customer account exists and is active
   *  - Every productId in items resolves to a known product
   * Deduplicates product IDs so only one DB round-trip is needed.
   */
  async create(dto: CreateSecondarySaleDto, requester: JwtPayload): Promise<any> {
    if (!FIELD_TIERS.includes(requester.tier as any)) {
      throw new ForbiddenException(
        'Only field agents (Tier 1–4) can submit secondary sales',
      );
    }

    // Validate KD customer
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.kdAccountId },
      select: { id: true, isActive: true, businessName: true },
    });

    if (!customer) {
      throw new NotFoundException(
        `KD account '${dto.kdAccountId}' not found`,
      );
    }

    if (!customer.isActive) {
      throw new BadRequestException(
        `KD account '${customer.businessName}' is deactivated and cannot receive secondary sales`,
      );
    }

    // Validate products — single round-trip with deduplicated IDs
    const productIds = [...new Set(dto.items.map((i) => i.productId))];

    const foundProducts = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true },
    });

    const foundIds = new Set(foundProducts.map((p) => p.id));
    const missingIds = productIds.filter((id) => !foundIds.has(id));

    if (missingIds.length > 0) {
      throw new BadRequestException(
        `Unknown product ID(s): ${missingIds.join(', ')}`,
      );
    }

    return this.prisma.secondarySale.create({
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
            quantityCartons: item.quantityCartons  ?? 0,
            quantityRows:    item.quantityRows     ?? 0,
            quantityPieces:  item.quantityPieces   ?? 0,
          })),
        },
      },
      include: SALE_INCLUDE,
    });
  }

  // ─── findAll (own / all depending on tier) ────────────────────────────────

  /**
   * Returns up to 200 secondary sales.
   *
   * Scoping:
   *  - TIER1–TIER4  → own records only; all user/team/tier/region filters are ignored
   *  - Oversight tiers (TIER5_SALES_HEAD, TIER5_SALES_SUPPORT, etc.) → all records
   *
   * Filters available to oversight roles:
   *   userId, kdAccountId, buyerType, from/to (deviceTime),
   *   team, tier, region (filtered via the related user record).
   */
  async findAll(
    query: SecondarySaleQueryDto,
    requester: JwtPayload,
  ): Promise<any[]> {
    const isFieldAgent = FIELD_TIERS.includes(requester.tier as any);
    const resolvedUserId = isFieldAgent
      ? requester.sub
      : (query.userId ?? undefined);

    // Build user-relation filter (oversight only — field agents are already
    // scoped by userId so these filters are irrelevant for them).
    const userFilter = !isFieldAgent && (query.team || query.tier || query.region)
      ? {
          user: {
            ...(query.team   ? { team:   query.team   as any } : {}),
            ...(query.tier   ? { tier:   query.tier   as any } : {}),
            ...(query.region ? { region: query.region as any } : {}),
          },
        }
      : {};

    const where: Prisma.SecondarySaleWhereInput = {
      ...(resolvedUserId    ? { userId:      resolvedUserId    } : {}),
      ...(query.kdAccountId ? { kdAccountId: query.kdAccountId } : {}),
      ...(query.buyerType
        ? { items: { some: { buyerType: query.buyerType } } }
        : {}),
      ...(query.from || query.to
        ? {
            deviceTime: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to   ? { lte: new Date(query.to)   } : {}),
            },
          }
        : {}),
      ...userFilter,
    };

    return this.prisma.secondarySale.findMany({
      where,
      orderBy: { deviceTime: 'desc' },
      take:    200,
      include: SALE_INCLUDE,
    });
  }

  // ─── findById ─────────────────────────────────────────────────────────────

  /**
   * Returns a single secondary sale by ID.
   * Field agents can only fetch their own; oversight roles can fetch any.
   */
  async findById(saleId: string, requester: JwtPayload): Promise<any> {
    const sale = await this.prisma.secondarySale.findUnique({
      where: { id: saleId },
      include: SALE_INCLUDE,
    });

    if (!sale) {
      throw new NotFoundException(`Secondary sale '${saleId}' not found`);
    }

    const isFieldAgent = FIELD_TIERS.includes(requester.tier as any);
    if (isFieldAgent && sale.userId !== requester.sub) {
      throw new ForbiddenException('You can only view your own secondary sales');
    }

    return sale;
  }

  // ─── TIER5_SALES_SUPPORT: All Secondary Sales (platform-wide, paginated) ──

  /**
   * GET /secondary-sales/support/all
   *
   * Paginated platform-wide visibility for TIER5_SALES_SUPPORT.
   * Filters: team, tier, region, userId, from, to (serverTime).
   */
  async findAllForSupport(
    query: {
      team?: string; tier?: string; region?: string; userId?: string;
      from?: string; to?: string; page?: number; limit?: number;
    },
    _requester: JwtPayload,
  ): Promise<PaginatedResult<any>> {
    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip  = (page - 1) * limit;

    const where: Prisma.SecondarySaleWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to
        ? {
            serverTime: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to   ? { lte: new Date(query.to)   } : {}),
            },
          }
        : {}),
      user: {
        ...(query.team   ? { team:   query.team   as any } : {}),
        ...(query.tier   ? { tier:   query.tier   as any } : {}),
        ...(query.region ? { region: query.region as any } : {}),
      },
    };

    const [data, total] = await Promise.all([
      this.prisma.secondarySale.findMany({
        where,
        orderBy: { serverTime: 'desc' },
        skip,
        take: limit,
        include: SALE_INCLUDE,
      }),
      this.prisma.secondarySale.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  // ─── TIER5_SALES_SUPPORT: Sales by User (paginated) ───────────────────────

  /**
   * GET /secondary-sales/support/user/:userId
   *
   * Full secondary sales history for any specific user.
   * TIER5_SALES_SUPPORT only.
   */
  async findByUserForSupport(
    targetUserId: string,
    query: { from?: string; to?: string; page?: number; limit?: number },
    _requester: JwtPayload,
  ): Promise<PaginatedResult<any>> {
    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip  = (page - 1) * limit;

    const where: Prisma.SecondarySaleWhereInput = {
      userId: targetUserId,
      ...(query.from || query.to
        ? {
            serverTime: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to   ? { lte: new Date(query.to)   } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.secondarySale.findMany({
        where,
        orderBy: { serverTime: 'desc' },
        skip,
        take: limit,
        include: SALE_INCLUDE,
      }),
      this.prisma.secondarySale.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }
}