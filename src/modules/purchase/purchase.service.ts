// src/modules/purchase-orders/purchase-order.service.ts
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
import { GoogleVisionService } from '@common/google/google-vision.service';
import { PushNotificationService } from '@modules/notifications/push-notification.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type {
  CreatePurchaseOrderDto,
  RecordPaymentDto,
  UploadDocumentDto,
  QualifyInvoiceDto,
  PurchaseOrderQueryDto,
} from './dto/purchase.dto';
import { CloudinaryFolder, CloudinaryService } from '@modules/cloudinary/cloudinary.service';

// ── Role constants ─────────────────────────────────────────────────────────────
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
    private readonly prisma:          PrismaService,
    private readonly productService:  ProductService,
    private readonly vision:          GoogleVisionService,
    private readonly cloudinary:      CloudinaryService,
    private readonly push:            PushNotificationService,
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
      // PO items are always ordered in cartons — carton price always applies.
      // unitPriceKobo is stored for reference (price per individual unit inside
      // a carton) but lineTotalKobo is always cartonPriceKobo × quantityCartons.
      // The packQty field describes how many units are inside one carton — it is
      // not a threshold for switching between pricing tiers in purchase orders.
      const unitPrice    = product.cartonPriceKobo;
      const lineTotal    = product.cartonPriceKobo * BigInt(item.quantityCartons);

      return {
        productId:       item.productId,
        quantityCartons: item.quantityCartons,
        unitPriceKobo:   unitPrice,
        lineTotalKobo:   lineTotal,
      };
    });

    const subtotalKobo      = itemsData.reduce((sum, i) => sum + i.lineTotalKobo, BigInt(0));
    const creditAppliedKobo = dto.creditAppliedKobo
      ? (BigInt(dto.creditAppliedKobo) < subtotalKobo ? BigInt(dto.creditAppliedKobo) : subtotalKobo)
      : BigInt(0);
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

    this.logger.log(`PO created: ${orderRef} (₦${totalKobo / 100n}) by ${requester.sub}`);
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

  async approve(
    id:        string,
    requester: JwtPayload,
    receiptFile?: Express.Multer.File,
  ) {
    if (!APPROVER_TIERS.includes(requester.tier as string)) {
      throw new ForbiddenException('Only Sales Head, System Admin or GM can approve orders');
    }

    const po = await this.prisma.purchaseOrder.findUnique({
      where:  { id },
      select: {
        id:            true,
        orderRef:      true,
        status:        true,
        totalKobo:     true,
        paidKobo:      true,
        createdById:   true,
        customerId:    true,
        qualification: true,
        kdInvoiceUrl:  true,
      },
    });
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);

    // KD invoice must be uploaded before approval
    if (!po.kdInvoiceUrl) {
      throw new BadRequestException(
        'KD invoice must be uploaded before this order can be approved. ' +
        'The field agent should upload the customer invoice via PATCH /purchase-orders/:id/documents',
      );
    }

    // Invoice must be qualified (matched) before approval
    if (po.qualification !== 'QUALIFIED') {
      throw new BadRequestException(
        `Invoice qualification is "${po.qualification}". ` +
        'The invoice must be reviewed and marked QUALIFIED before approval.',
      );
    }

    this.assertTransition(po.status, 'APPROVED');

    // ── Upload receipt if provided ───────────────────────────────────────────
    let receiptUrl: string | null = null;
    if (receiptFile?.buffer) {
      const resourceType = receiptFile.mimetype === 'application/pdf' ? 'raw' : 'image';
      const upload = await this.cloudinary.uploadBuffer(
        receiptFile.buffer,
        'receipts',
        {
          publicId:     `po-${id}-approval-receipt`,
          resourceType: resourceType as any,
        },
      );
      receiptUrl = upload.secure_url;
      this.logger.log(`Approval receipt uploaded for PO ${po.orderRef}: ${receiptUrl}`);
    }

    // ── Approve the PO ───────────────────────────────────────────────────────
    const approved = await this.prisma.purchaseOrder.update({
      where:  { id },
      data:   {
        status:             'APPROVED',
        approvedById:       requester.sub,
        approvedAt:         new Date(),
        ...(receiptUrl ? { approvalReceiptUrl: receiptUrl } : {}),
      },
      select: PO_LIST_SELECT,
    });

    // ── Auto-create KD ledger entry if receipt was attached ──────────────────
    if (receiptUrl) {
      void this.createKdLedgerEntry(id, po.customerId, po.totalKobo, receiptUrl);
    }

    // ── Push notification to the PO creator ─────────────────────────────────
    void this.notifyPoCreator(po.createdById, po.orderRef, id, receiptUrl);

    return approved;
  }

  // ── Internal: create KD ledger entry after approval ──────────────────────────

  private async createKdLedgerEntry(
    purchaseOrderId: string,
    customerId:      string,
    totalKobo:       bigint,
    receiptUrl:      string,
  ): Promise<void> {
    try {
      const existing = await this.prisma.kdLedgerEntry.findUnique({
        where: { purchaseOrderId },
      });
      if (existing) return; // already exists — don't duplicate

      await this.prisma.kdLedgerEntry.create({
        data: {
          customerId,
          purchaseOrderId,
          receiptUrl,
          totalKobo,
          balanceKobo: totalKobo,
          paidKobo:    BigInt(0),
          status:      'UNPAID',
        },
      });

      this.logger.log(`KD ledger entry auto-created for PO ${purchaseOrderId}`);
    } catch (err: any) {
      this.logger.error(`Failed to auto-create KD ledger for PO ${purchaseOrderId}: ${err.message}`);
    }
  }

  // ── Internal: send push notification to PO creator ───────────────────────────

  private async notifyPoCreator(
    createdById:    string,
    orderRef:       string,
    purchaseOrderId: string,
    receiptUrl:     string | null,
  ): Promise<void> {
    try {
      await this.push.notifyPoApproved({
        createdById,
        orderRef,
        purchaseOrderId,
        hasReceipt: receiptUrl !== null,
      });
    } catch (err: any) {
      this.logger.warn(`Push notification failed for ${orderRef}: ${err.message}`);
    }
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

    // Run atomically — mark PO delivered AND increase KD debt in one transaction.
    // The KD's debt starts the moment they receive the goods.
    // Collections recorded later will reduce this balance.
    const [updated] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.update({
        where: { id },
        data: {
          status:          'DELIVERED',
          deliveredById:   requester.sub,
          deliveredAt:     new Date(),
          paymentDeadline,
        },
        select: PO_LIST_SELECT,
      }),
      this.prisma.customer.update({
        where: { id: po.customerId },
        data:  { balanceKobo: { increment: po.totalKobo } },
      }),
    ]);

    this.logger.log(
      `PO ${po.orderRef} marked delivered — ` +
      `KD balance increased by ₦${Number(po.totalKobo) / 100}`,
    );

    return updated;
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

    // If goods were already delivered, reverse the KD debt that was added at delivery
    const wasDelivered = ['DELIVERED', 'FULLY_PAID'].includes(po.status);

    if (wasDelivered) {
      const [updated] = await this.prisma.$transaction([
        this.prisma.purchaseOrder.update({
          where:  { id },
          data:   { status: 'CANCELLED' },
          select: PO_LIST_SELECT,
        }),
        this.prisma.customer.update({
          where: { id: po.customerId },
          data:  { balanceKobo: { decrement: po.totalKobo } },
        }),
      ]);
      return updated;
    }

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

    const newPaidKobo = po.paidKobo + BigInt(dto.amountKobo);
    if (newPaidKobo > po.totalKobo) {
      throw new BadRequestException(
        `Payment of ${ProductService.formatNaira(Number(dto.amountKobo))} would exceed ` +
        `the outstanding balance of ${ProductService.formatNaira(Number(po.totalKobo - po.paidKobo))}`,
      );
    }

    const isFullyPaid = newPaidKobo >= po.totalKobo;

    const [payment] = await this.prisma.$transaction([
      this.prisma.paymentRecord.create({
        data: {
          purchaseOrderId: id,
          amountKobo:      BigInt(dto.amountKobo),
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
          customer:   { update: { balanceKobo: { decrement: BigInt(dto.amountKobo) } } },
        },
      }),
    ]);

    this.logger.log(
      `Payment recorded: ${ProductService.formatNaira(Number(dto.amountKobo))} on PO ${po.orderRef}` +
      `${isFullyPaid ? ' — FULLY PAID' : ''}`,
    );
    return payment;
  }

  // ── Document upload ────────────────────────────────────────────────────────
  // Maps each document type to its Cloudinary folder
  private readonly DOCUMENT_FOLDER_MAP: Record<
    'kdInvoiceUrl' | 'chequeUrl' | 'formalInvoiceUrl' | 'deliveryOrderUrl',
    { folder: CloudinaryFolder; label: string }
  > = {
    kdInvoiceUrl:     { folder: 'invoices', label: 'KD invoice' },
    chequeUrl:        { folder: 'cheques',  label: 'cheque image' },
    formalInvoiceUrl: { folder: 'invoices', label: 'formal invoice' },
    deliveryOrderUrl: { folder: 'invoices', label: 'delivery order' },
  };

  async uploadDocument(
    id:        string,
    dto:       UploadDocumentDto,
    file:      Express.Multer.File,
    requester: JwtPayload,
  ) {
    await this.assertExists(id);

    // 1. Upload the file to Cloudinary
    const { folder, label } = this.DOCUMENT_FOLDER_MAP[dto.documentType];
    const uploadResult = await this.cloudinary.uploadBuffer(
      file.buffer,
      folder,
      {
        publicId:     `${id}-${dto.documentType}-${Date.now()}`,
        resourceType: file.mimetype === 'application/pdf' ? 'raw' : 'image',
      },
    );
    const fileUrl = uploadResult.secure_url;
    this.logger.log(`${label} uploaded for PO ${id}: ${fileUrl}`);

    // 2. Store the URL and update status if needed
    const statusUpdate = dto.documentType === 'deliveryOrderUrl'
      ? { status: 'DO_UPLOADED' as PurchaseOrderStatus }
      : {};

    const updated = await this.prisma.purchaseOrder.update({
      where:  { id },
      data:   { [dto.documentType]: fileUrl, ...statusUpdate },
      select: {
        ...PO_LIST_SELECT,
        kdInvoiceUrl: true,
        items: {
          select: {
            productId:       true,
            quantityCartons: true,
            unitPriceKobo:   true,
            lineTotalKobo:   true,
            product:         { select: { name: true } },
          },
        },
      },
    });

    // 3. Auto-run OCR when KD invoice is uploaded (fire-and-forget)
    if (dto.documentType === 'kdInvoiceUrl') {
      void this.runInvoiceComparison(id, fileUrl, updated.items);
    }

    return updated;
  }

  /**
   * Calls Google Vision OCR to extract and compare the KD invoice against
   * PO line items. Runs fire-and-forget — result updates qualification field.
   * Sales Head can override the system result if needed.
   */
  private async runInvoiceComparison(
    poId:         string,
    invoiceUrl:   string,
    items:        Array<{
      productId:       string;
      quantityCartons: number;
      unitPriceKobo:   bigint;
      lineTotalKobo:   bigint;
      product:         { name: string };
    }>,
  ): Promise<void> {
    try {
      this.logger.log(`Running OCR comparison for PO ${poId}...`);

      const poItems = items.map((i) => ({
        productName:     i.product.name,
        quantityCartons: i.quantityCartons,
        unitPriceKobo:   Number(i.unitPriceKobo),
        lineTotalKobo:   Number(i.lineTotalKobo),
      }));

      const result = await this.vision.compareInvoiceToPO(invoiceUrl, poItems);

      await this.prisma.purchaseOrder.update({
        where: { id: poId },
        data: {
          qualification:  result.qualified ? 'QUALIFIED' : 'NOT_QUALIFIED',
          invoiceMismatch: result.qualified
            ? null
            : {
                summary:    result.summary,
                confidence: result.confidence,
                mismatches: result.mismatches,
              } as any,
        },
      });

      this.logger.log(
        `OCR result for PO ${poId}: ${result.qualified ? 'QUALIFIED ✓' : 'NOT_QUALIFIED ✗'} — ${result.summary}`,
      );
    } catch (err) {
      // OCR failure should not block the upload — log and leave qualification as PENDING
      this.logger.error(
        `OCR comparison failed for PO ${poId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
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
        id:          true,
        orderRef:    true,
        status:      true,
        totalKobo:   true,
        paidKobo:    true,
        createdById: true,
        customerId:  true,
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