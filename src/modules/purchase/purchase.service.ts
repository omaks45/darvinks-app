
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PurchaseOrderStatus, WarehouseLocation } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { ProductService } from '@modules/products/products.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type {
  CreatePurchaseOrderDto,
  RecordPaymentDto,
  UploadDocumentDto,
  QualifyInvoiceDto,
  PurchaseOrderQueryDto,
} from './dto/purchase.dto';

//  Role constants
const FIELD_TIERS   = ['TIER1', 'TIER2', 'TIER3', 'TIER4'];
const APPROVER_TIERS = ['TIER5_SYSTEM_ADMIN', 'TIER5_SALES_HEAD', 'TIER6_GM'];
const ADMIN_TIERS   = ['TIER5_SYSTEM_ADMIN', 'TIER5_SALES_HEAD', 'TIER6_GM', 'WAREHOUSE_ADMIN'];

// ── Status transition map — only allowed next states per current state ─────────
const ALLOWED_TRANSITIONS: Partial<Record<PurchaseOrderStatus, PurchaseOrderStatus[]>> = {
  PENDING_APPROVAL: ['APPROVED', 'CANCELLED'],
  APPROVED:         ['PAYMENT_RECEIVED', 'CANCELLED'],
  PAYMENT_RECEIVED: ['DO_UPLOADED', 'CANCELLED'],
  DO_UPLOADED:      ['DELIVERED', 'CANCELLED'],
  DELIVERED:        ['FULLY_PAID', 'DEFAULTED'],
};

// ── Select shapes ──────────────────────────────────────────────────────────────
const PO_LIST_SELECT = {
  id:                true,
  orderRef:          true,
  customerId:        true,
  customer:          { select: { businessName: true, region: true } },
  warehouseLocation: true,
  status:            true,
  qualification:     true,
  subtotalKobo:      true,
  creditAppliedKobo: true,
  totalKobo:         true,
  paidKobo:          true,
  paymentDeadline:   true,
  createdById:       true,
  createdAt:         true,
  updatedAt:         true,
} as const;

const PO_DETAIL_SELECT = {
  ...PO_LIST_SELECT,
  cashDiscountKobo: true,
  incentiveKobo:    true,
  kdInvoiceUrl:     true,
  chequeUrl:        true,
  formalInvoiceUrl: true,
  deliveryOrderUrl: true,
  invoiceMismatch:  true,
  approvedById:     true,
  approvedAt:       true,
  deliveredById:    true,
  deliveredAt:      true,
  fullyPaidAt:      true,
  note:             true,
  items: {
    select: {
      id:              true,
      productId:       true,
      product:         { select: { name: true, category: true } },
      quantityCartons: true,
      unitPriceKobo:   true,
      lineTotalKobo:   true,
    },
  },
  payments: {
    select: {
      id:          true,
      amountKobo:  true,
      paymentMode: true,
      proofUrl:    true,
      note:        true,
      createdAt:   true,
    },
  },
} as const;

@Injectable()
export class PurchaseOrderService {
  private readonly logger = new Logger(PurchaseOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productService: ProductService,
  ) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(dto: CreatePurchaseOrderDto, requester: JwtPayload) {
    // Validate customer exists and is active
    const customer = await this.prisma.customer.findUnique({
      where:  { id: dto.customerId },
      select: { id: true, isActive: true, businessName: true },
    });
    if (!customer)        throw new NotFoundException(`Customer ${dto.customerId} not found`);
    if (!customer.isActive) throw new BadRequestException(`Customer "${customer.businessName}" is deactivated`);

    // Fetch all products in one query — O(1) DB round trips regardless of item count
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products   = await this.prisma.product.findMany({
      where:  { id: { in: productIds }, isActive: true },
      select: { id: true, name: true, unitPriceKobo: true, cartonPriceKobo: true, packQty: true },
    });

    if (products.length !== productIds.length) {
      const found     = new Set(products.map((p) => p.id));
      const missing   = productIds.filter((id) => !found.has(id));
      throw new BadRequestException(
        `Products not found or inactive: ${missing.join(', ')}`,
      );
    }

    // Index products by id for O(1) lookup
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Build line items and calculate totals
    const itemsData = dto.items.map((item) => {
      const product      = productMap.get(item.productId)!;
      const unitPrice    = ProductService.effectivePrice(product, item.quantityCartons);
      const lineTotal    = item.quantityCartons >= product.packQty
        ? product.cartonPriceKobo
        : product.unitPriceKobo * item.quantityCartons;

      return {
        productId:       item.productId,
        quantityCartons: item.quantityCartons,
        unitPriceKobo:   unitPrice,
        lineTotalKobo:   lineTotal,
      };
    });

    const subtotalKobo      = itemsData.reduce((sum, i) => sum + i.lineTotalKobo, 0);
    const creditAppliedKobo = Math.min(dto.creditAppliedKobo ?? 0, subtotalKobo);
    const totalKobo         = subtotalKobo - creditAppliedKobo;

    // Generate unique order reference
    const count    = await this.prisma.purchaseOrder.count();
    const orderRef = `PO-${String(count + 1).padStart(6, '0')}`;

    const po = await this.prisma.purchaseOrder.create({
      data: {
        orderRef,
        customerId:        dto.customerId,
        warehouseLocation: dto.warehouseLocation,
        subtotalKobo,
        creditAppliedKobo,
        totalKobo,
        note:              dto.note ?? null,
        createdById:       requester.sub,
        items:             { create: itemsData },
      },
      select: PO_DETAIL_SELECT,
    });

    this.logger.log(`PO created: ${orderRef} (₦${totalKobo / 100}) by ${requester.sub}`);
    return po;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findAll(query: PurchaseOrderQueryDto, requester: JwtPayload) {
    const isAdmin = ADMIN_TIERS.includes(requester.tier as string);

    return this.prisma.purchaseOrder.findMany({
      where: {
        ...(isAdmin ? {} : { createdById: requester.sub }),
        ...(query.status           ? { status:            query.status }           : {}),
        ...(query.warehouseLocation? { warehouseLocation: query.warehouseLocation } : {}),
        ...(query.customerId       ? { customerId:        query.customerId }        : {}),
      },
      select:  PO_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, requester: JwtPayload) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where:  { id },
      select: PO_DETAIL_SELECT,
    });
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);

    // Field staff can only see their own POs
    if (
      FIELD_TIERS.includes(requester.tier as string) &&
      po.createdById !== requester.sub
    ) {
      throw new ForbiddenException('You can only view your own purchase orders');
    }

    return po;
  }

  // ── Status transitions ─────────────────────────────────────────────────────

  async approve(id: string, requester: JwtPayload) {
    if (!APPROVER_TIERS.includes(requester.tier as string)) {
      throw new ForbiddenException('Only Sales Head, System Admin or GM can approve orders');
    }

    const po = await this.assertExists(id);
    this.assertTransition(po.status, 'APPROVED');

    return this.prisma.purchaseOrder.update({
      where:  { id },
      data:   { status: 'APPROVED', approvedById: requester.sub, approvedAt: new Date() },
      select: PO_LIST_SELECT,
    });
  }

  async markDelivered(id: string, requester: JwtPayload) {
    if (!ADMIN_TIERS.includes(requester.tier as string)) {
      throw new ForbiddenException('Only admin roles can mark orders as delivered');
    }

    const po = await this.assertExists(id);
    this.assertTransition(po.status, 'DELIVERED');

    // Set 30-day payment deadline from delivery date
    const paymentDeadline = new Date();
    paymentDeadline.setDate(paymentDeadline.getDate() + 30);

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status:          'DELIVERED',
        deliveredById:   requester.sub,
        deliveredAt:     new Date(),
        paymentDeadline,
      },
      select: PO_LIST_SELECT,
    });
  }

  async cancel(id: string, requester: JwtPayload) {
    const po = await this.assertExists(id);

    // Only creator or admin can cancel
    if (
      po.createdById !== requester.sub &&
      !ADMIN_TIERS.includes(requester.tier as string)
    ) {
      throw new ForbiddenException('Only the order creator or an admin can cancel this order');
    }

    this.assertTransition(po.status, 'CANCELLED');

    return this.prisma.purchaseOrder.update({
      where:  { id },
      data:   { status: 'CANCELLED' },
      select: PO_LIST_SELECT,
    });
  }

  // ── Payments ───────────────────────────────────────────────────────────────

  async recordPayment(id: string, dto: RecordPaymentDto, requester: JwtPayload) {
    const po = await this.assertExists(id);

    if (!['APPROVED', 'PAYMENT_RECEIVED', 'DO_UPLOADED', 'DELIVERED'].includes(po.status)) {
      throw new BadRequestException(
        `Cannot record payment on a ${po.status.toLowerCase()} order`,
      );
    }

    const newPaidKobo = po.paidKobo + dto.amountKobo;
    if (newPaidKobo > po.totalKobo) {
      throw new BadRequestException(
        `Payment of ${ProductService.formatNaira(dto.amountKobo)} would exceed ` +
        `the outstanding balance of ${ProductService.formatNaira(po.totalKobo - po.paidKobo)}`,
      );
    }

    const isFullyPaid = newPaidKobo >= po.totalKobo;

    const [payment] = await this.prisma.$transaction([
      this.prisma.paymentRecord.create({
        data: {
          purchaseOrderId: id,
          amountKobo:      dto.amountKobo,
          paymentMode:     dto.paymentMode,
          proofUrl:        dto.proofUrl ?? null,
          note:            dto.note     ?? null,
        },
        select: { id: true, amountKobo: true, paymentMode: true, createdAt: true },
      }),
      this.prisma.purchaseOrder.update({
        where: { id },
        data: {
          paidKobo:   newPaidKobo,
          status:     po.status === 'APPROVED' ? 'PAYMENT_RECEIVED' : po.status,
          ...(isFullyPaid ? { status: 'FULLY_PAID', fullyPaidAt: new Date() } : {}),
          // Update customer balance (debit — positive means they owe money)
          customer:   { update: { balanceKobo: { decrement: dto.amountKobo } } },
        },
      }),
    ]);

    this.logger.log(
      `Payment recorded: ${ProductService.formatNaira(dto.amountKobo)} on PO ${po.orderRef}` +
      `${isFullyPaid ? ' — FULLY PAID' : ''}`,
    );
    return payment;
  }

  // ── Document upload ────────────────────────────────────────────────────────

  async uploadDocument(id: string, dto: UploadDocumentDto, requester: JwtPayload) {
    await this.assertExists(id);

    // Update status to DO_UPLOADED when delivery order is uploaded
    const statusUpdate = dto.documentType === 'deliveryOrderUrl'
      ? { status: 'DO_UPLOADED' as PurchaseOrderStatus }
      : {};

    return this.prisma.purchaseOrder.update({
      where:  { id },
      data:   { [dto.documentType]: dto.url, ...statusUpdate },
      select: PO_LIST_SELECT,
    });
  }

  // ── Invoice qualification ──────────────────────────────────────────────────

  async qualifyInvoice(id: string, dto: QualifyInvoiceDto, requester: JwtPayload) {
    if (!APPROVER_TIERS.includes(requester.tier as string)) {
      throw new ForbiddenException('Only Sales Head or above can qualify invoices');
    }

    await this.assertExists(id);

    return this.prisma.purchaseOrder.update({
      where: { id },
      data:  {
        qualification:  dto.qualification,
        invoiceMismatch: (dto.invoiceMismatch ?? null) as any,
      },
      select: PO_LIST_SELECT,
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async assertExists(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where:  { id },
      select: {
        id:         true,
        orderRef:   true,
        status:     true,
        totalKobo:  true,
        paidKobo:   true,
        createdById: true,
      },
    });
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    return po;
  }

  private assertTransition(
    current: PurchaseOrderStatus,
    next: PurchaseOrderStatus,
  ): void {
    const allowed = ALLOWED_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Cannot transition from ${current} to ${next}. ` +
        `Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }
  }
}