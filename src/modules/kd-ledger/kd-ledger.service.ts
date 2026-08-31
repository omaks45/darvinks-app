
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { GoogleVisionService } from '@common/google/google-vision.service';
import { ProductService } from '@modules/products/products.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { RecordKdPaymentDto, UpdateLedgerTotalDto } from './dto/kd-ledger.dto';

const LEDGER_SELECT = {
  id:              true,
  customerId:      true,
  customer:        { select: { businessName: true, address: true, region: true } },
  purchaseOrderId: true,
  purchaseOrder:   { select: { orderRef: true, totalKobo: true, approvedAt: true } },
  receiptUrl:      true,
  totalKobo:       true,
  paidKobo:        true,
  balanceKobo:     true,
  status:          true,
  ocrExtracted:    true,
  note:            true,
  createdAt:       true,
  updatedAt:       true,
  payments: {
    select: {
      id:          true,
      amountKobo:  true,
      paymentMode: true,
      note:        true,
      createdAt:   true,
      recordedBy:  { select: { fullName: true, employeeRef: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
};

const FIELD_TIERS   = new Set(['TIER2', 'TIER3', 'TIER4']);
const APPROVER_TIERS = new Set(['TIER5_SALES_HEAD', 'TIER5_SALES_SUPPORT']);

@Injectable()
export class KdLedgerService {
  private readonly logger = new Logger(KdLedgerService.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly vision:  GoogleVisionService,
  ) {}

  // ── Get or create ledger for a PO (called when agent views PO) ───────────────

  async getByPurchaseOrder(purchaseOrderId: string, requester: JwtPayload) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where:  { id: purchaseOrderId },
      select: {
        id:                true,
        orderRef:          true,
        status:            true,
        totalKobo:         true,
        customerId:        true,
        createdById:       true,
        approvalReceiptUrl: true,
        kdLedgerEntry:     { select: LEDGER_SELECT },
      },
    });

    if (!po) throw new NotFoundException('Purchase order not found');

    // Access control — only the PO creator or admins
    const isAdmin = APPROVER_TIERS.has(requester.tier) || requester.tier === 'TIER6_GM';
    if (!isAdmin && po.createdById !== requester.sub) {
      throw new ForbiddenException('You can only view ledger entries for your own purchase orders');
    }

    if (!po.kdLedgerEntry) {
      return { purchaseOrder: po, ledgerEntry: null };
    }

    return { purchaseOrder: po, ledgerEntry: po.kdLedgerEntry };
  }

  // ── Upload approval receipt (Sales Head / Admin only) ─────────────────────────
  // Called separately from PO approval — agent uploads receipt AFTER seeing PO approved

  async uploadReceipt(
    purchaseOrderId: string,
    file:            Express.Multer.File,
    requester:       JwtPayload,
  ) {
    // Any field agent (Tier 2-4) who owns the PO can upload the receipt
    const isAdmin = APPROVER_TIERS.has(requester.tier);
    const po = await this.prisma.purchaseOrder.findUnique({
      where:  { id: purchaseOrderId },
      select: { id: true, status: true, customerId: true,
                totalKobo: true, orderRef: true, createdById: true },
    });

    if (!po) throw new NotFoundException('Purchase order not found');
    if (!isAdmin && po.createdById !== requester.sub) {
      throw new ForbiddenException('You can only upload receipts for your own purchase orders');
    }
    if (!['APPROVED', 'PAYMENT_RECEIVED', 'DO_UPLOADED', 'DELIVERED', 'FULLY_PAID'].includes(po.status)) {
      throw new BadRequestException('Receipt can only be uploaded after the PO has been approved');
    }

    // Upload receipt image to Cloudinary
    const { CloudinaryService } = await import('@modules/cloudinary/cloudinary.service');
    // Use injected cloudinary via dynamic import pattern
    const uploadModule = await import('@modules/cloudinary/cloudinary.service');
    // We'll use prisma directly since cloudinary is not injected here
    // For the actual implementation, add CloudinaryService to constructor

    // Store receipt URL on PO
    const receiptUrl = `pending-upload-${Date.now()}`; // placeholder — real upload in controller

    // Create or update ledger entry
    const existing = await this.prisma.kdLedgerEntry.findUnique({
      where: { purchaseOrderId },
    });

    let ledgerEntry;
    if (existing) {
      ledgerEntry = await this.prisma.kdLedgerEntry.update({
        where: { purchaseOrderId },
        data:  { receiptUrl, ocrExtracted: false },
        select: LEDGER_SELECT,
      });
    } else {
      ledgerEntry = await this.prisma.kdLedgerEntry.create({
        data: {
          customerId:      po.customerId,
          purchaseOrderId: po.id,
          receiptUrl,
          totalKobo:       po.totalKobo, // default to PO total — OCR may override
          balanceKobo:     po.totalKobo,
          paidKobo:        BigInt(0),
          status:          'UNPAID',
        },
        select: LEDGER_SELECT,
      });
    }

    // Queue OCR extraction (fire-and-forget)
    void this.extractReceiptViaOcr(ledgerEntry.id, receiptUrl);

    return ledgerEntry;
  }

  // ── Manual upload receipt with Cloudinary (controller calls this) ─────────────

  async createOrUpdateWithReceipt(
    purchaseOrderId: string,
    receiptUrl:      string,
    requester:       JwtPayload,
  ) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where:  { id: purchaseOrderId },
      select: { id: true, status: true, customerId: true,
                totalKobo: true, orderRef: true, createdById: true },
    });

    if (!po) throw new NotFoundException('Purchase order not found');

    const isAdmin = APPROVER_TIERS.has(requester.tier);
    if (!isAdmin && po.createdById !== requester.sub) {
      throw new ForbiddenException('You can only upload receipts for your own purchase orders');
    }

    if (!['APPROVED', 'PAYMENT_RECEIVED', 'DO_UPLOADED', 'DELIVERED', 'FULLY_PAID'].includes(po.status)) {
      throw new BadRequestException('PO must be approved before uploading a receipt');
    }

    // Update PO with receipt URL
    await this.prisma.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data:  { approvalReceiptUrl: receiptUrl },
    });

    // Upsert ledger entry
    const existing = await this.prisma.kdLedgerEntry.findUnique({
      where: { purchaseOrderId },
    });

    let ledgerEntry;
    if (existing) {
      ledgerEntry = await this.prisma.kdLedgerEntry.update({
        where:  { purchaseOrderId },
        data:   { receiptUrl, ocrExtracted: false },
        select: LEDGER_SELECT,
      });
    } else {
      ledgerEntry = await this.prisma.kdLedgerEntry.create({
        data: {
          customerId:      po.customerId,
          purchaseOrderId: po.id,
          receiptUrl,
          totalKobo:       po.totalKobo,
          balanceKobo:     po.totalKobo,
          paidKobo:        BigInt(0),
          status:          'UNPAID',
        },
        select: LEDGER_SELECT,
      });
    }

    this.logger.log(`Receipt uploaded for PO ${po.orderRef}: ${receiptUrl}`);

    // Fire OCR extraction in background
    void this.extractReceiptViaOcr(ledgerEntry.id, receiptUrl);

    return ledgerEntry;
  }

  // ── OCR extraction from receipt 

  private async extractReceiptViaOcr(ledgerEntryId: string, receiptUrl: string): Promise<void> {
    try {
      this.logger.log(`Running OCR on receipt for ledger entry ${ledgerEntryId}`);

      const extracted = await this.vision.extractInvoiceText(receiptUrl);
      if (!extracted?.rawText) {
        this.logger.warn(`OCR returned no text for ledger ${ledgerEntryId}`);
        return;
      }
      const text = extracted.rawText;
      const totalMatch = text.match(
        /(?:total|amount|sum|grand total)[:\s]*[₦N]?\s*([\d,]+(?:\.\d{2})?)/i,
      ) ?? text.match(/[₦N]\s*([\d,]+(?:\.\d{2})?)/);

      if (totalMatch) {
        const totalNaira = parseFloat(totalMatch[1].replace(/,/g, ''));
        const totalKobo  = BigInt(Math.round(totalNaira * 100));

        await this.prisma.kdLedgerEntry.update({
          where: { id: ledgerEntryId },
          data:  {
            totalKobo,
            balanceKobo:  totalKobo,
            ocrExtracted: true,
          },
        });

        this.logger.log(
          `OCR extracted ₦${totalNaira.toLocaleString()} for ledger ${ledgerEntryId}`,
        );
      } else {
        this.logger.warn(`Could not extract total amount from receipt for ledger ${ledgerEntryId}`);
      }
    } catch (err: any) {
      this.logger.error(`OCR extraction failed for ledger ${ledgerEntryId}: ${err.message}`);
    }
  }

  // ── Manually update total (if OCR fails) ──────────────────────────────────────

  async updateTotal(id: string, dto: UpdateLedgerTotalDto, requester: JwtPayload) {
    const entry = await this.prisma.kdLedgerEntry.findUnique({
      where:  { id },
      select: { id: true, paidKobo: true, purchaseOrder: { select: { createdById: true } } },
    });
    if (!entry) throw new NotFoundException('Ledger entry not found');

    const isAdmin = APPROVER_TIERS.has(requester.tier);
    if (!isAdmin && entry.purchaseOrder.createdById !== requester.sub) {
      throw new ForbiddenException('You can only update ledger entries for your own purchase orders');
    }

    const totalKobo  = BigInt(dto.totalKobo);
    const balanceKobo = totalKobo - entry.paidKobo;

    return this.prisma.kdLedgerEntry.update({
      where:  { id },
      data:   {
        totalKobo,
        balanceKobo,
        ocrExtracted: false,
        note:         dto.note ?? null,
        status:       balanceKobo <= BigInt(0) ? 'SETTLED'
                    : entry.paidKobo > BigInt(0) ? 'PARTIAL' : 'UNPAID',
      },
      select: LEDGER_SELECT,
    });
  }

  // ── Record KD payment ─────────────────────────────────────────────────────────

  async recordPayment(id: string, dto: RecordKdPaymentDto, requester: JwtPayload) {
    if (!FIELD_TIERS.has(requester.tier) && !APPROVER_TIERS.has(requester.tier)) {
      throw new ForbiddenException('Tier 2-4 and admins can record KD payments');
    }

    const entry = await this.prisma.kdLedgerEntry.findUnique({
      where:  { id },
      select: {
        id: true, totalKobo: true, paidKobo: true, balanceKobo: true,
        status: true, customerId: true,
        purchaseOrder: { select: { createdById: true } },
      },
    });
    if (!entry) throw new NotFoundException('Ledger entry not found');

    if (entry.status === 'SETTLED') {
      throw new BadRequestException('This ledger entry is already fully settled');
    }

    const isAdmin      = APPROVER_TIERS.has(requester.tier);
    const isOwner      = entry.purchaseOrder.createdById === requester.sub;
    if (!isAdmin && !isOwner) {
      throw new ForbiddenException('You can only record payments for your own customer ledgers');
    }

    const paymentKobo  = BigInt(dto.amountKobo);
    if (paymentKobo > entry.balanceKobo) {
      throw new BadRequestException(
        `Payment of ${ProductService.formatNaira(Number(paymentKobo))} exceeds ` +
        `outstanding balance of ${ProductService.formatNaira(Number(entry.balanceKobo))}`,
      );
    }

    const newPaidKobo    = entry.paidKobo + paymentKobo;
    const newBalanceKobo = entry.totalKobo - newPaidKobo;
    const newStatus      = newBalanceKobo === BigInt(0) ? 'SETTLED'
      : newPaidKobo > BigInt(0) ? 'PARTIAL' : 'UNPAID';

    const [payment] = await this.prisma.$transaction([
      this.prisma.kdPayment.create({
        data: {
          ledgerEntryId: id,
          recordedById:  requester.sub,
          amountKobo:    paymentKobo,
          paymentMode:   dto.paymentMode,
          note:          dto.note ?? null,
        },
      }),
      this.prisma.kdLedgerEntry.update({
        where: { id },
        data:  { paidKobo: newPaidKobo, balanceKobo: newBalanceKobo, status: newStatus },
      }),
    ]);

    this.logger.log(
      `KD payment of ₦${Number(paymentKobo) / 100} recorded for ledger ${id} — ${newStatus}`,
    );

    return {
      payment,
      ledgerStatus:  newStatus,
      paidKobo:      newPaidKobo,
      balanceKobo:   newBalanceKobo,
      fullySettled:  newStatus === 'SETTLED',
    };
  }

  // ── Find all ledger entries ───────────────────────────────────────────────────

  async findAll(customerId: string | undefined, requester: JwtPayload) {
    const isAdmin = APPROVER_TIERS.has(requester.tier) || requester.tier === 'TIER6_GM';

    return this.prisma.kdLedgerEntry.findMany({
      where: {
        ...(customerId ? { customerId } : {}),
        ...(isAdmin ? {} : {
          purchaseOrder: { createdById: requester.sub },
        }),
      },
      select:  LEDGER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }
}