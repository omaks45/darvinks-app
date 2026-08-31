
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import { ProductService } from '@modules/products/products.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import {
  CreateSecondarySaleInvoiceDto,
  RecordSecondaryPaymentDto,
  SecondarySaleInvoiceQueryDto,
} from './dto/secondary-sale-invoice.dto';

const ALLOWED_TIERS = new Set(['TIER1', 'TIER2', 'TIER3']);

const INVOICE_SELECT = {
  id:          true,
  invoiceRef:  true,
  soldById:    true,
  soldBy:      { select: { fullName: true, employeeRef: true, tier: true } },
  customerId:  true,
  customer:    { select: { businessName: true, address: true, secondaryCustomerType: true } },
  totalKobo:   true,
  paidKobo:    true,
  balanceKobo: true,
  status:      true,
  invoiceUrl:  true,
  note:        true,
  createdAt:   true,
  updatedAt:   true,
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
      id:           true,
      amountKobo:   true,
      paymentMode:  true,
      note:         true,
      createdAt:    true,
      recordedById: true,  // scalar FK — use this instead of nested relation
    },
    orderBy: { createdAt: 'asc' as const },
  },
};

@Injectable()
export class SecondarySaleInvoiceService {
  private readonly logger = new Logger(SecondarySaleInvoiceService.name);

  constructor(
    private readonly prisma:     PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ── Create sale invoice ───────────────────────────────────────────────────────

  async create(dto: CreateSecondarySaleInvoiceDto, requester: JwtPayload) {
    if (!ALLOWED_TIERS.has(requester.tier)) {
      throw new ForbiddenException('Only field agents (Tier 1-3) can log secondary sales');
    }

    // Validate secondary customer
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.customerType !== 'SECONDARY') {
      throw new BadRequestException(
        'Sales can only be made to SECONDARY customers (sub-distributors, wholesalers, retailers)',
      );
    }

    // Check agent has enough inventory for each product
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const [products, inventory] = await Promise.all([
      this.prisma.product.findMany({
        where:  { id: { in: productIds }, isActive: true },
        select: { id: true, name: true, category: true, cartonPriceKobo: true },
      }),
      this.prisma.agentInventory.findMany({
        where:  { userId: requester.sub, productId: { in: productIds } },
        select: { productId: true, quantityCartons: true },
      }),
    ]);

    if (products.length !== productIds.length) {
      throw new BadRequestException('Some products not found or inactive');
    }

    const productMap   = new Map(products.map((p) => [p.id, p]));
    const inventoryMap = new Map(inventory.map((i) => [i.productId, i.quantityCartons]));

    // Validate stock availability and build line items
    let totalKobo = BigInt(0);
    const lineItems = dto.items.map((item) => {
      const product   = productMap.get(item.productId)!;
      const inHand    = inventoryMap.get(item.productId) ?? 0;

      if (item.quantityCartons > inHand) {
        throw new BadRequestException(
          `Insufficient stock for ${product.name}. ` +
          `You have ${inHand} carton(s) in hand but tried to sell ${item.quantityCartons}.`,
        );
      }

      const unitPrice  = product.cartonPriceKobo;
      const lineTotal  = unitPrice * BigInt(item.quantityCartons);
      totalKobo       += lineTotal;

      return {
        productId:       item.productId,
        quantityCartons: item.quantityCartons,
        unitPriceKobo:   unitPrice,
        lineTotalKobo:   lineTotal,
      };
    });

    // Generate invoice reference
    const count      = await this.prisma.secondarySaleInvoice.count();
    const invoiceRef = `SSI-${String(count + 1).padStart(6, '0')}`;

    // Create invoice and deduct inventory atomically
    const invoice = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.secondarySaleInvoice.create({
        data: {
          invoiceRef,
          soldById:    requester.sub,
          customerId:  dto.customerId,
          totalKobo,
          paidKobo:    BigInt(0),
          balanceKobo: totalKobo,
          status:      'UNPAID',
          note:        dto.note ?? null,
          items: { create: lineItems },
        },
        select: INVOICE_SELECT,
      });

      // Deduct from agent inventory
      for (const item of dto.items) {
        await tx.agentInventory.update({
          where: { userId_productId: { userId: requester.sub, productId: item.productId } },
          data:  { quantityCartons: { decrement: item.quantityCartons } },
        });
      }

      // Update customer balance (total owed across all invoices)
      await tx.customer.update({
        where: { id: dto.customerId },
        data:  { balanceKobo: { increment: totalKobo } },
      });

      return inv;
    });

    this.logger.log(
      `Sale invoice ${invoiceRef} created — ₦${Number(totalKobo) / 100} ` +
      `to ${customer.businessName} by ${requester.sub}`,
    );

    // Generate PDF invoice (fire-and-forget)
    void this.generateInvoicePdf(invoice.id, invoice, customer);

    return invoice;
  }

  // ── Record payment ────────────────────────────────────────────────────────────

  async recordPayment(
    invoiceId: string,
    dto:       RecordSecondaryPaymentDto,
    requester: JwtPayload,
  ) {
    const invoice = await this.prisma.secondarySaleInvoice.findUnique({
      where:  { id: invoiceId },
      select: { id: true, soldById: true, customerId: true, totalKobo: true,
                paidKobo: true, balanceKobo: true, status: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    // Only the agent who made the sale or admins can record payments
    const isAdmin = ['TIER5_SALES_SUPPORT', 'TIER5_SALES_HEAD'].includes(requester.tier);
    if (!isAdmin && invoice.soldById !== requester.sub) {
      throw new ForbiddenException('You can only record payments for your own invoices');
    }

    if (invoice.status === 'SETTLED') {
      throw new BadRequestException('This invoice is already fully settled');
    }

    const paymentKobo = BigInt(dto.amountKobo);
    if (paymentKobo > invoice.balanceKobo) {
      throw new BadRequestException(
        `Payment of ${ProductService.formatNaira(Number(paymentKobo))} exceeds ` +
        `outstanding balance of ${ProductService.formatNaira(Number(invoice.balanceKobo))}`,
      );
    }

    const newPaidKobo    = invoice.paidKobo + paymentKobo;
    const newBalanceKobo = invoice.totalKobo - newPaidKobo;
    const newStatus      = newBalanceKobo === BigInt(0) ? 'SETTLED'
      : newPaidKobo > BigInt(0) ? 'PARTIAL' : 'UNPAID';

    const [payment] = await this.prisma.$transaction([
      this.prisma.secondaryPayment.create({
        data: {
          invoiceId,
          recordedById: requester.sub,
          amountKobo:   paymentKobo,
          paymentMode:  dto.paymentMode,
          note:         dto.note ?? null,
        } as any,
      }),
      this.prisma.secondarySaleInvoice.update({
        where: { id: invoiceId },
        data:  { paidKobo: newPaidKobo, balanceKobo: newBalanceKobo, status: newStatus },
      }),
      // Update customer's running balance
      this.prisma.customer.update({
        where: { id: invoice.customerId },
        data:  { balanceKobo: { decrement: paymentKobo } },
      }),
    ]);

    this.logger.log(
      `Payment of ₦${Number(paymentKobo) / 100} recorded for invoice ${invoiceId} — ` +
      `status now ${newStatus}`,
    );

    return {
      payment,
      invoiceStatus:   newStatus,
      paidKobo:        newPaidKobo,
      balanceKobo:     newBalanceKobo,
      fullySettled:    newStatus === 'SETTLED',
    };
  }

  // ── Find all invoices ─────────────────────────────────────────────────────────

  async findAll(query: SecondarySaleInvoiceQueryDto, requester: JwtPayload) {
    const isAdmin = ['TIER5_SALES_SUPPORT', 'TIER5_SALES_HEAD', 'TIER6_GM'].includes(requester.tier);

    return this.prisma.secondarySaleInvoice.findMany({
      where: {
        ...(isAdmin ? {} : { soldById: requester.sub }),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.status     ? { status:     query.status as any } : {}),
        ...(query.from || query.to ? {
          createdAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to   ? { lte: new Date(query.to)   } : {}),
          },
        } : {}),
      },
      select:  INVOICE_SELECT,
      orderBy: { createdAt: 'desc' },
      take:    200,
    });
  }

  // ── Find one ──────────────────────────────────────────────────────────────────

  async findOne(id: string, requester: JwtPayload) {
    const invoice = await this.prisma.secondarySaleInvoice.findUnique({
      where:  { id },
      select: INVOICE_SELECT,
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const isAdmin = ['TIER5_SALES_SUPPORT', 'TIER5_SALES_HEAD', 'TIER6_GM'].includes(requester.tier);
    if (!isAdmin && invoice.soldById !== requester.sub) {
      throw new ForbiddenException('You can only view your own invoices');
    }

    return invoice;
  }

  // ── Outstanding invoices (Make Payment page) ──────────────────────────────────

  async getOutstanding(requester: JwtPayload) {
    return this.prisma.secondarySaleInvoice.findMany({
      where: {
        soldById: requester.sub,
        status:   { in: ['UNPAID', 'PARTIAL'] },
      },
      select:  INVOICE_SELECT,
      orderBy: { createdAt: 'asc' }, // oldest first — most urgent
    });
  }

  // ── PDF invoice generation ────────────────────────────────────────────────────

  private async generateInvoicePdf(id: string, invoice: any, customer: any): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const PDFDocument = require('pdfkit') as typeof import('pdfkit');
      const doc    = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));

      await new Promise<void>((resolve, reject) => {
        doc.on('end',   resolve);
        doc.on('error', reject);

        // Header
        doc.rect(0, 0, doc.page.width, 70).fill('#1F497D');
        doc.fillColor('#FFFFFF')
           .fontSize(18).font('Helvetica-Bold')
           .text('DARVINKS HEALTHCARE LTD', 0, 18, { align: 'center' })
           .fontSize(10).font('Helvetica')
           .text('Sales Invoice', 0, 42, { align: 'center' });

        // Invoice details
        doc.fillColor('#000000').fontSize(10);
        const details = [
          ['Invoice Ref',   invoice.invoiceRef],
          ['Date',          new Date().toLocaleDateString('en-NG')],
          ['Sold By',       `${invoice.soldBy.fullName} (${invoice.soldBy.employeeRef})`],
          ['Customer',      customer.businessName],
          ['Address',       customer.address],
          ['Customer Type', customer.secondaryCustomerType ?? 'SECONDARY'],
        ];
        let y = 85;
        for (const [label, value] of details) {
          doc.font('Helvetica-Bold').text(`${label}:`, 40, y, { continued: true, width: 120 });
          doc.font('Helvetica').text(` ${value}`, { width: 350 });
          y += 18;
        }

        // Table header
        y += 6;
        doc.rect(40, y, doc.page.width - 80, 20).fill('#1F497D');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9);
        doc.text('Product',        50,  y + 6, { width: 200 });
        doc.text('Qty (Ctn)',      260, y + 6, { width: 60  });
        doc.text('Unit Price (₦)', 325, y + 6, { width: 90  });
        doc.text('Total (₦)',      420, y + 6, { width: 90  });

        // Table rows
        y += 20;
        doc.fillColor('#000000').font('Helvetica').fontSize(9);
        let alt = false;
        for (const item of invoice.items) {
          if (alt) doc.rect(40, y, doc.page.width - 80, 18).fill('#F5F7FA');
          doc.fillColor('#000000');
          doc.text(item.product.name.slice(0, 42), 50,  y + 4, { width: 200 });
          doc.text(String(item.quantityCartons),   260, y + 4, { width: 60  });
          doc.text(
            ProductService.formatNaira(Number(item.unitPriceKobo)), 325, y + 4, { width: 90 },
          );
          doc.text(
            ProductService.formatNaira(Number(item.lineTotalKobo)), 420, y + 4, { width: 90 },
          );
          y  += 18;
          alt = !alt;
        }

        // Total
        y += 6;
        doc.moveTo(40, y).lineTo(doc.page.width - 40, y).stroke('#CCCCCC');
        y += 10;
        doc.font('Helvetica-Bold').fontSize(12)
            .text(
              `TOTAL AMOUNT DUE: ${ProductService.formatNaira(Number(invoice.totalKobo))}`,
              40, y, { align: 'right', width: doc.page.width - 80 },
            );
          y += 18;
          doc.font('Helvetica-Oblique').fontSize(9).fillColor('#B40000')
            .text('Payment due immediately. Outstanding balance attracts follow-up.', 40, y);

          // Footer
          doc.font('Helvetica-Oblique').fontSize(8).fillColor('#888888')
            .text(
              'This is a computer-generated invoice from Darvinks Healthcare Ltd.',
              40, doc.page.height - 50, { align: 'center', width: doc.page.width - 80 },
            );

        doc.end();
      });

      const pdfBuffer = Buffer.concat(chunks);
      const uploadResult = await this.cloudinary.uploadBuffer(pdfBuffer, 'invoices', {
        publicId:     `${id}-sale-invoice`,
        resourceType: 'raw',
      });

      await this.prisma.secondarySaleInvoice.update({
        where: { id },
        data:  { invoiceUrl: uploadResult.secure_url },
      });

      this.logger.log(`Sale invoice PDF generated for ${id}: ${uploadResult.secure_url}`);
    } catch (err: any) {
      this.logger.error(`Sale invoice PDF generation failed for ${id}: ${err.message}`);
    }
  }
}