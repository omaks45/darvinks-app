// src/modules/collections/collection.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { ProductService } from '@modules/products/products.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type { CreateCollectionDto, CollectionQueryDto } from './dto/collection.dto';

const ADMIN_TIERS = ['TIER5_SYSTEM_ADMIN', 'TIER5_SALES_HEAD', 'TIER6_GM', 'WAREHOUSE_ADMIN'];

const COLLECTION_SELECT = {
  id:           true,
  customerId:   true,
  customer:     { select: { businessName: true, region: true } },
  recordedById: true,
  recordedBy:   { select: { fullName: true, employeeRef: true } },
  amountKobo:   true,
  paymentMode:  true,
  receiptUrl:   true,
  depositorName: true,
  location:     true,
  collectedAt:  true,
  note:         true,
  createdAt:    true,
  updatedAt:    true,
} as const;

@Injectable()
export class CollectionService {
  private readonly logger = new Logger(CollectionService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(dto: CreateCollectionDto, requester: JwtPayload) {
    // Validate customer
    const customer = await this.prisma.customer.findUnique({
      where:  { id: dto.customerId },
      select: { id: true, isActive: true, businessName: true, balanceKobo: true },
    });
    if (!customer)           throw new NotFoundException(`Customer ${dto.customerId} not found`);
    if (!customer.isActive)  throw new BadRequestException(`Customer "${customer.businessName}" is deactivated`);

    // Record collection and update customer balance atomically
    const [collection] = await this.prisma.$transaction([
      this.prisma.collection.create({
        data: {
          customerId:    dto.customerId,
          recordedById:  requester.sub,
          amountKobo:    BigInt(dto.amountKobo),
          paymentMode:   dto.paymentMode,
          receiptUrl:    dto.receiptUrl,
          depositorName: dto.depositorName,
          location:      dto.location,
          collectedAt:   new Date(dto.collectedAt),
          note:          dto.note ?? null,
        },
        select: COLLECTION_SELECT,
      }),
      // Decrement customer outstanding balance
      this.prisma.customer.update({
        where: { id: dto.customerId },
        data:  { balanceKobo: { decrement: BigInt(dto.amountKobo) } },
      }),
    ]);

    this.logger.log(
      `Collection recorded: ${ProductService.formatNaira(Number(dto.amountKobo))} ` +
      `from customer ${dto.customerId} by ${requester.sub}`,
    );
    return collection;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findAll(query: CollectionQueryDto, requester: JwtPayload) {
    const isAdmin = ADMIN_TIERS.includes(requester.tier as string);

    // Date range filter
    const dateFilter = this.buildDateFilter(query.from, query.to);

    return this.prisma.collection.findMany({
      where: {
        // Field staff see only their own collections
        ...(isAdmin ? {} : { recordedById: requester.sub }),
        ...(query.customerId  ? { customerId:  query.customerId }  : {}),
        ...(query.paymentMode ? { paymentMode: query.paymentMode } : {}),
        ...(dateFilter        ? { collectedAt: dateFilter }        : {}),
      },
      select:  COLLECTION_SELECT,
      orderBy: { collectedAt: 'desc' },
    });
  }

  async findById(id: string, requester: JwtPayload) {
    const collection = await this.prisma.collection.findUnique({
      where:  { id },
      select: COLLECTION_SELECT,
    });
    if (!collection) throw new NotFoundException(`Collection ${id} not found`);

    // Field staff can only see their own collections
    if (
      !ADMIN_TIERS.includes(requester.tier as string) &&
      collection.recordedById !== requester.sub
    ) {
      throw new ForbiddenException('You can only view your own collections');
    }

    return collection;
  }

  async getSummaryForCustomer(customerId: string, requester: JwtPayload) {
    // Verify customer exists
    const customer = await this.prisma.customer.findUnique({
      where:  { id: customerId },
      select: { id: true, businessName: true, balanceKobo: true },
    });
    if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);

    const [totalResult, countResult] = await Promise.all([
      this.prisma.collection.aggregate({
        where: { customerId },
        _sum:  { amountKobo: true },
      }),
      this.prisma.collection.count({ where: { customerId } }),
    ]);

    return {
      customerId,
      businessName:      customer.businessName,
      balanceKobo:       customer.balanceKobo,
      balanceFormatted:  ProductService.formatNaira(Number(customer.balanceKobo)),
      totalCollectedKobo: totalResult._sum.amountKobo ?? BigInt(0),
      totalCollectedFormatted: ProductService.formatNaira(
        Number(totalResult._sum.amountKobo ?? BigInt(0)),
      ),
      collectionCount: countResult,
    };
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