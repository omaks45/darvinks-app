
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
  CreateStockCollectionDto,
  StockCollectionQueryDto,
} from './dto/stock-collection.dto';

// ── Field restrictions ────────────────────────────────────────────────────────
const ALLOWED_TIERS = new Set(['TIER1', 'TIER2', 'TIER3']);

// ── Select shape ──────────────────────────────────────────────────────────────
const COLLECTION_SELECT = {
  id:           true,
  collectionRef: true,
  userId:       true,
  user:         { select: { fullName: true, employeeRef: true, tier: true } },
  sourceId:     true,
  source:       { select: { businessName: true, address: true, region: true } },
  status:       true,
  subtotalKobo: true,
  invoiceUrl:   true,
  submittedAt:  true,
  note:         true,
  createdAt:    true,
  updatedAt:    true,
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
};

@Injectable()
export class StockCollectionService {
  private readonly logger = new Logger(StockCollectionService.name);

  constructor(
    private readonly prisma:      PrismaService,
    private readonly cloudinary:  CloudinaryService,
  ) {}

  // ── Create & submit stock collection ─────────────────────────────────────────

  async create(dto: CreateStockCollectionDto, requester: JwtPayload) {
    if (!ALLOWED_TIERS.has(requester.tier)) {
      throw new ForbiddenException('Only field agents (Tier 1-3) can collect stock');
    }

    // Validate source customer is a PRIMARY customer
    const source = await this.prisma.customer.findUnique({
      where: { id: dto.sourceId },
    });
    if (!source) throw new NotFoundException('Customer not found');
    if (source.customerType !== 'PRIMARY') {
      throw new BadRequestException(
        'Stock can only be collected from PRIMARY customers (Key Distributors)',
      );
    }

    // Fetch all product prices in one query
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products   = await this.prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true, name: true, category: true, cartonPriceKobo: true },
    });

    if (products.length !== productIds.length) {
      const found   = new Set(products.map((p) => p.id));
      const missing = productIds.filter((id) => !found.has(id));
      throw new BadRequestException(
        `Some products not found or inactive: ${missing.join(', ')}`,
      );
    }

    const productMap = new Map(products.map((p) => [p.id, p]));

    // Build line items and calculate subtotal
    let subtotalKobo = BigInt(0);
    const lineItems = dto.items.map((item) => {
      const product      = productMap.get(item.productId)!;
      const unitPrice    = product.cartonPriceKobo;
      const lineTotal    = unitPrice * BigInt(item.quantityCartons);
      subtotalKobo      += lineTotal;
      return {
        productId:       item.productId,
        quantityCartons: item.quantityCartons,
        unitPriceKobo:   unitPrice,
        lineTotalKobo:   lineTotal,
      };
    });

    // Generate collection reference number
    const count = await this.prisma.stockCollection.count();
    const collectionRef = `SC-${String(count + 1).padStart(6, '0')}`;

    // Create collection with items in a transaction
    const collection = await this.prisma.$transaction(async (tx) => {
      // Create the stock collection
      const coll = await tx.stockCollection.create({
        data: {
          collectionRef,
          userId:       requester.sub,
          sourceId:     dto.sourceId,
          subtotalKobo,
          note:         dto.note ?? null,
          status:       'CONFIRMED',
          submittedAt:  new Date(),
          items: {
            create: lineItems,
          },
        },
        select: COLLECTION_SELECT,
      });

      // Update agent inventory — upsert one row per product
      for (const item of dto.items) {
        await tx.agentInventory.upsert({
          where:  { userId_productId: { userId: requester.sub, productId: item.productId } },
          update: { quantityCartons: { increment: item.quantityCartons } },
          create: {
            userId:          requester.sub,
            productId:       item.productId,
            quantityCartons: item.quantityCartons,
          },
        });
      }

      return coll;
    });

    this.logger.log(
      `StockCollection ${collectionRef} created by ${requester.sub} — ` +
      `₦${Number(subtotalKobo) / 100} from KD ${source.businessName}`,
    );

    // Queue PDF invoice generation (fire-and-forget)
    void this.generateInvoicePdf(collection.id, collection);

    return collection;
  }

  // ── My inventory (in-hand stock) ─────────────────────────────────────────────

  async getMyInventory(requester: JwtPayload) {
    const inventory = await this.prisma.agentInventory.findMany({
      where:   { userId: requester.sub },
      select: {
        id:              true,
        productId:       true,
        product:         { select: { name: true, category: true, cartonPriceKobo: true } },
        quantityCartons: true,
        updatedAt:       true,
      },
      orderBy: { product: { name: 'asc' } },
    });

    return inventory.map((inv) => ({
      ...inv,
      valueKobo:   inv.product.cartonPriceKobo * BigInt(inv.quantityCartons),
    }));
  }

  // ── Find all collections ──────────────────────────────────────────────────────

  async findAll(query: StockCollectionQueryDto, requester: JwtPayload) {
    const isAdmin = ['TIER5_SYSTEM_ADMIN', 'TIER5_SALES_HEAD', 'TIER6_GM'].includes(requester.tier);

    return this.prisma.stockCollection.findMany({
      where: {
        ...(isAdmin ? {} : { userId: requester.sub }),
        ...(query.sourceId ? { sourceId: query.sourceId } : {}),
        ...(query.status   ? { status:   query.status as any } : {}),
        ...(query.from || query.to ? {
          createdAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to   ? { lte: new Date(query.to)   } : {}),
          },
        } : {}),
      },
      select:  COLLECTION_SELECT,
      orderBy: { createdAt: 'desc' },
      take:    200,
    });
  }

  // ── Find one ──────────────────────────────────────────────────────────────────

  async findOne(id: string, requester: JwtPayload) {
    const collection = await this.prisma.stockCollection.findUnique({
      where:  { id },
      select: COLLECTION_SELECT,
    });
    if (!collection) throw new NotFoundException('Stock collection not found');

    const isAdmin = ['TIER5_SYSTEM_ADMIN', 'TIER5_SALES_HEAD', 'TIER6_GM'].includes(requester.tier);
    if (!isAdmin && collection.userId !== requester.sub) {
      throw new ForbiddenException('You can only view your own stock collections');
    }

    return collection;
  }

  // ── PDF invoice generation (background) ──────────────────────────────────────

  private async generateInvoicePdf(id: string, collection: any): Promise<void> {
    try {
      // pdfkit is a pure Node.js PDF library — no browser dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const PDFDocument = require('pdfkit') as typeof import('pdfkit');
      const doc     = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));

      await new Promise<void>((resolve, reject) => {
        doc.on('end',   resolve);
        doc.on('error', reject);

        // ── Header bar ──────────────────────────────────────────────────────
        doc.rect(0, 0, doc.page.width, 70).fill('#1F497D');
        doc.fillColor('#FFFFFF')
           .fontSize(18).font('Helvetica-Bold')
           .text('DARVINKS HEALTHCARE LTD', 0, 18, { align: 'center' })
           .fontSize(10).font('Helvetica')
           .text('Stock Collection Invoice', 0, 42, { align: 'center' });

        // ── Invoice details ──────────────────────────────────────────────────
        doc.fillColor('#000000').fontSize(10);
        const details = [
          ['Invoice Ref',  collection.collectionRef],
          ['Date',         new Date().toLocaleDateString('en-NG')],
          ['Collected By', `${collection.user.fullName} (${collection.user.employeeRef})`],
          ['Source (KD)',  collection.source.businessName],
          ['KD Address',   collection.source.address],
        ];
        let y = 85;
        for (const [label, value] of details) {
          doc.font('Helvetica-Bold').text(`${label}:`, 40, y, { continued: true, width: 120 });
          doc.font('Helvetica').text(` ${value}`, { width: 350 });
          y += 18;
        }

        // ── Table header ─────────────────────────────────────────────────────
        y += 6;
        doc.rect(40, y, doc.page.width - 80, 20).fill('#1F497D');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9);
        doc.text('Product',        50,  y + 6, { width: 200 });
        doc.text('Category',       255, y + 6, { width: 70  });
        doc.text('Qty',            330, y + 6, { width: 40  });
        doc.text('Unit Price (₦)', 375, y + 6, { width: 80  });
        doc.text('Total (₦)',      460, y + 6, { width: 80  });

        // ── Table rows ───────────────────────────────────────────────────────
        y += 20;
        doc.fillColor('#000000').font('Helvetica').fontSize(9);
        let alt = false;
        for (const item of collection.items) {
          if (alt) doc.rect(40, y, doc.page.width - 80, 18).fill('#F5F7FA');
          doc.fillColor('#000000');
          doc.text(item.product.name.slice(0, 42), 50,  y + 4, { width: 200 });
          doc.text(item.product.category,          255, y + 4, { width: 70  });
          doc.text(String(item.quantityCartons),   330, y + 4, { width: 40  });
          doc.text(
            ProductService.formatNaira(Number(item.unitPriceKobo)), 375, y + 4, { width: 80 },
          );
          doc.text(
            ProductService.formatNaira(Number(item.lineTotalKobo)), 460, y + 4, { width: 80 },
          );
          y  += 18;
          alt = !alt;
        }

        // ── Divider + Total ──────────────────────────────────────────────────
        y += 6;
        doc.moveTo(40, y).lineTo(doc.page.width - 40, y).stroke('#CCCCCC');
        y += 10;
        doc.font('Helvetica-Bold').fontSize(12)
           .text(
             `TOTAL: ${ProductService.formatNaira(Number(collection.subtotalKobo))}`,
             40, y, { align: 'right', width: doc.page.width - 80 },
           );

        // ── Footer ───────────────────────────────────────────────────────────
        doc.font('Helvetica-Oblique').fontSize(8).fillColor('#888888')
           .text(
             'This is a computer-generated invoice from Darvinks Healthcare Ltd.',
             40, doc.page.height - 50, { align: 'center', width: doc.page.width - 80 },
           );

        doc.end();
      });

      // ── Upload to Cloudinary ─────────────────────────────────────────────
      const pdfBuffer = Buffer.concat(chunks);
      const uploadResult = await this.cloudinary.uploadBuffer(pdfBuffer, 'invoices', {
        publicId:     `${id}-invoice`,
        resourceType: 'raw',
      });

      await this.prisma.stockCollection.update({
        where: { id },
        data:  { invoiceUrl: uploadResult.secure_url },
      });

      this.logger.log(`Invoice PDF generated for StockCollection ${id}: ${uploadResult.secure_url}`);
    } catch (err: any) {
      this.logger.error(`Invoice PDF generation failed for ${id}: ${err.message}`);
    }
  }
}