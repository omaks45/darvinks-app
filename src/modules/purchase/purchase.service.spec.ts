
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMode, WarehouseLocation } from '@prisma/client';
import { PurchaseOrderService } from './purchase.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { ProductService } from '@modules/products/products.service';
import { GoogleVisionService } from '@common/google/google-vision.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  customer:      { findUnique: jest.fn() },
  product:       { findMany: jest.fn() },
  purchaseOrder: {
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    count:      jest.fn(),
  },
  paymentRecord: { create: jest.fn() },
  $transaction:  jest.fn(),
};

const mockProductService = {
  formatNaira: jest.fn((kobo: number) => `₦${(kobo / 100).toLocaleString()}`),
};

const mockVision = {
  compareInvoiceToPO: jest.fn(),
};

const mockCloudinary = {
  uploadBuffer: jest.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PRODUCT = {
  id:              'prod-id',
  name:            'Visita Essence B Whitening Lotion (250ml)',
  unitPriceKobo:   BigInt(175000),
  cartonPriceKobo: BigInt(6300000),
  packQty:         36,
};

const CUSTOMER = {
  id:           'cust-id',
  isActive:     true,
  businessName: 'Ore Ofe Distributors Ltd',
};

// 12 cartons × ₦63,000 = ₦756,000 = 75,600,000 kobo
const PO_STUB = {
  id:                'po-id',
  orderRef:          'PO-000001',
  customerId:        'cust-id',
  customer:          { businessName: 'Ore Ofe Distributors Ltd', region: 'SOUTH_WEST' },
  warehouseLocation: WarehouseLocation.LAGOS_HQ,
  status:            'PENDING_APPROVAL',
  qualification:     'PENDING',
  subtotalKobo:      BigInt(75600000),
  creditAppliedKobo: BigInt(0),
  totalKobo:         BigInt(75600000),
  paidKobo:          BigInt(0),
  paymentDeadline:   null,
  createdById:       'agent-id',
  createdAt:         new Date(),
  updatedAt:         new Date(),
};

const PO_DETAIL = {
  ...PO_STUB,
  cashDiscountKobo: BigInt(0),
  incentiveKobo:    BigInt(0),
  kdInvoiceUrl:     null,
  chequeUrl:        null,
  formalInvoiceUrl: null,
  deliveryOrderUrl: null,
  invoiceMismatch:  null,
  approvedById:     null,
  approvedAt:       null,
  deliveredById:    null,
  deliveredAt:      null,
  fullyPaidAt:      null,
  note:             null,
  items: [{
    id:              'item-id',
    productId:       'prod-id',
    product:         { name: 'Visita Essence B Whitening Lotion (250ml)', category: 'LOTION' },
    quantityCartons: 12,
    unitPriceKobo:   BigInt(6300000),
    lineTotalKobo:   BigInt(75600000),
  }],
  payments: [],
};

const MOCK_FILE: Express.Multer.File = {
  fieldname:    'file',
  originalname: 'invoice.jpg',
  encoding:     '7bit',
  mimetype:     'image/jpeg',
  buffer:       Buffer.from('fake-image'),
  size:         1024,
  stream:       null as any,
  destination:  '',
  filename:     '',
  path:         '',
};

const MOCK_PDF_FILE: Express.Multer.File = {
  ...MOCK_FILE,
  originalname: 'invoice.pdf',
  mimetype:     'application/pdf',
};

const CREATE_DTO = {
  customerId:        'cust-id',
  warehouseLocation: WarehouseLocation.LAGOS_HQ,
  items:             [{ productId: 'prod-id', quantityCartons: 12 }],
};

function makeRequester(tier = 'TIER2'): JwtPayload {
  return { sub: 'agent-id', email: 'agent@darvinks.com',
    tier, team: 'RADIANT', region: 'SOUTH_WEST' } as JwtPayload;
}
function makeSalesHead(): JwtPayload {
  return { sub: 'sh-id', email: 'sh@darvinks.com',
    tier: 'TIER5_SALES_HEAD', team: 'RADIANT' } as JwtPayload;
}
function makeAdmin(): JwtPayload {
  return { sub: 'admin-id', email: 'admin@darvinks.com',
    tier: 'TIER5_SYSTEM_ADMIN', team: 'RADIANT' } as JwtPayload;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PurchaseOrderService', () => {
  let service: PurchaseOrderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrderService,
        { provide: PrismaService,       useValue: mockPrisma },
        { provide: ProductService,      useValue: mockProductService },
        { provide: GoogleVisionService, useValue: mockVision },
        { provide: CloudinaryService,   useValue: mockCloudinary },
      ],
    }).compile();

    service = module.get<PurchaseOrderService>(PurchaseOrderService);
    jest.resetAllMocks();

    // Safe defaults
    mockPrisma.customer.findUnique.mockResolvedValue(CUSTOMER);
    mockPrisma.product.findMany.mockResolvedValue([PRODUCT]);
    mockPrisma.purchaseOrder.count.mockResolvedValue(0);
    mockPrisma.purchaseOrder.create.mockResolvedValue(PO_DETAIL);
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue(PO_STUB);
    mockPrisma.purchaseOrder.findMany.mockResolvedValue([PO_STUB]);
    mockPrisma.purchaseOrder.update.mockResolvedValue(PO_DETAIL);
    mockPrisma.$transaction.mockImplementation(
      (ops: any[]) => Promise.all(ops),
    );
    mockProductService.formatNaira.mockImplementation(
      (kobo: number) => `₦${(kobo / 100).toLocaleString()}`,
    );
    mockCloudinary.uploadBuffer.mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/test/invoice.jpg',
    });
    mockVision.compareInvoiceToPO.mockResolvedValue({
      qualified: true, summary: 'Match', confidence: 0.95, mismatches: [],
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates a purchase order and returns it', async () => {
      const result = await service.create(CREATE_DTO as any, makeRequester());
      expect(result).toEqual(PO_DETAIL);
      expect(mockPrisma.purchaseOrder.create).toHaveBeenCalledTimes(1);
    });

    it('always uses carton price for PO items regardless of qty vs packQty', async () => {
      await service.create(CREATE_DTO as any, makeRequester());
      const item = mockPrisma.purchaseOrder.create.mock.calls[0][0].data.items.create[0];
      expect(item.unitPriceKobo).toBe(PRODUCT.cartonPriceKobo);
      expect(item.lineTotalKobo).toBe(PRODUCT.cartonPriceKobo * BigInt(12));
    });

    it('uses carton price even when quantity is less than packQty', async () => {
      const dto = { ...CREATE_DTO, items: [{ productId: 'prod-id', quantityCartons: 5 }] };
      await service.create(dto as any, makeRequester());
      const item = mockPrisma.purchaseOrder.create.mock.calls[0][0].data.items.create[0];
      expect(item.unitPriceKobo).toBe(PRODUCT.cartonPriceKobo);
      expect(item.lineTotalKobo).toBe(PRODUCT.cartonPriceKobo * BigInt(5));
    });

    it('calculates subtotal as sum of all line totals', async () => {
      const dto = {
        ...CREATE_DTO,
        items: [
          { productId: 'prod-id', quantityCartons: 12 },
          { productId: 'prod-id', quantityCartons: 12 },
        ],
      };
      await service.create(dto as any, makeRequester());
      const data = mockPrisma.purchaseOrder.create.mock.calls[0][0].data;
      expect(data.subtotalKobo).toBe(BigInt(151200000));
    });

    it('applies credit correctly when creditAppliedKobo is provided', async () => {
      const dto = { ...CREATE_DTO, creditAppliedKobo: 1000000 };
      await service.create(dto as any, makeRequester());
      const data = mockPrisma.purchaseOrder.create.mock.calls[0][0].data;
      expect(data.creditAppliedKobo).toBe(BigInt(1000000));
      expect(data.totalKobo).toBe(BigInt(74600000));
    });

    it('caps credit at subtotal — credit cannot exceed the order value', async () => {
      const dto = { ...CREATE_DTO, creditAppliedKobo: 999999999 };
      await service.create(dto as any, makeRequester());
      const data = mockPrisma.purchaseOrder.create.mock.calls[0][0].data;
      expect(data.creditAppliedKobo).toBe(data.subtotalKobo);
      expect(data.totalKobo).toBe(BigInt(0));
    });

    it('generates order ref as PO-000001 when count is 0', async () => {
      mockPrisma.purchaseOrder.count.mockResolvedValue(0);
      await service.create(CREATE_DTO as any, makeRequester());
      expect(mockPrisma.purchaseOrder.create.mock.calls[0][0].data.orderRef).toBe('PO-000001');
    });

    it('generates correct sequential order ref', async () => {
      mockPrisma.purchaseOrder.count.mockResolvedValue(41);
      await service.create(CREATE_DTO as any, makeRequester());
      expect(mockPrisma.purchaseOrder.create.mock.calls[0][0].data.orderRef).toBe('PO-000042');
    });

    it('deduplicates product IDs in a single findMany query', async () => {
      const dto = {
        ...CREATE_DTO,
        items: [
          { productId: 'prod-id', quantityCartons: 10 },
          { productId: 'prod-id', quantityCartons: 5 },
        ],
      };
      await service.create(dto as any, makeRequester());
      expect(mockPrisma.product.findMany.mock.calls[0][0].where.id.in).toHaveLength(1);
    });

    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.create(CREATE_DTO as any, makeRequester()))
        .rejects.toThrow(NotFoundException);
      expect(mockPrisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when customer is deactivated', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER, isActive: false });
      await expect(service.create(CREATE_DTO as any, makeRequester()))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when a product is not found or inactive', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);
      await expect(service.create(CREATE_DTO as any, makeRequester()))
        .rejects.toThrow(BadRequestException);
    });

    it('handles large kobo values without overflow — invoice test: ₦22,230,000', async () => {
      const products = [
        { id: 'p1', name: 'Visita Whitip',     unitPriceKobo: BigInt(175000),  cartonPriceKobo: BigInt(6300000),  packQty: 36 },
        { id: 'p2', name: 'Neoskin Lotion',    unitPriceKobo: BigInt(175000),  cartonPriceKobo: BigInt(6300000),  packQty: 36 },
        { id: 'p3', name: 'Visita Plus Cream', unitPriceKobo: BigInt(740000),  cartonPriceKobo: BigInt(22200000), packQty: 30 },
      ];
      mockPrisma.product.findMany.mockResolvedValue(products);

      const dto = {
        customerId: 'cust-id',
        warehouseLocation: WarehouseLocation.LAGOS_HQ,
        items: [
          { productId: 'p1', quantityCartons: 150 },
          { productId: 'p2', quantityCartons: 100 },
          { productId: 'p3', quantityCartons: 15  },
          { productId: 'p2', quantityCartons: 50  },
        ],
      };

      await service.create(dto as any, makeRequester());
      const data = mockPrisma.purchaseOrder.create.mock.calls[0][0].data;
      const expected = BigInt(945000000) + BigInt(630000000) + BigInt(333000000) + BigInt(315000000);
      expect(data.subtotalKobo).toBe(expected); // 2,223,000,000 kobo = ₦22,230,000
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('field staff see only their own POs', async () => {
      await service.findAll({}, makeRequester());
      expect(mockPrisma.purchaseOrder.findMany.mock.calls[0][0].where.createdById)
        .toBe('agent-id');
    });

    it('admin sees all POs — no createdById filter', async () => {
      await service.findAll({}, makeAdmin());
      expect(mockPrisma.purchaseOrder.findMany.mock.calls[0][0].where.createdById)
        .toBeUndefined();
    });

    it('applies status filter when provided', async () => {
      await service.findAll({ status: 'PENDING_APPROVAL' as any }, makeAdmin());
      expect(mockPrisma.purchaseOrder.findMany.mock.calls[0][0].where.status)
        .toBe('PENDING_APPROVAL');
    });

    it('applies warehouseLocation filter when provided', async () => {
      await service.findAll({ warehouseLocation: WarehouseLocation.ONITSHA }, makeAdmin());
      expect(mockPrisma.purchaseOrder.findMany.mock.calls[0][0].where.warehouseLocation)
        .toBe(WarehouseLocation.ONITSHA);
    });

    it('orders results by createdAt descending', async () => {
      await service.findAll({}, makeAdmin());
      expect(mockPrisma.purchaseOrder.findMany.mock.calls[0][0].orderBy)
        .toEqual({ createdAt: 'desc' });
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns the PO when the requester is the creator', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(PO_DETAIL);
      const result = await service.findById('po-id', makeRequester());
      expect(result).toEqual(PO_DETAIL);
    });

    it('admin can view any PO', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_DETAIL, createdById: 'someone-else',
      });
      await expect(service.findById('po-id', makeAdmin())).resolves.not.toThrow();
    });

    it('throws ForbiddenException when field agent views another agent\'s PO', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_DETAIL, createdById: 'different-agent',
      });
      await expect(service.findById('po-id', makeRequester()))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id', makeAdmin()))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── approve ────────────────────────────────────────────────────────────────

  describe('approve()', () => {
    const APPROVABLE_PO = {
      ...PO_STUB,
      status:        'PENDING_APPROVAL',
      kdInvoiceUrl:  'https://res.cloudinary.com/test/invoice.jpg',
      qualification: 'QUALIFIED',
    };

    beforeEach(() => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(APPROVABLE_PO);
      mockPrisma.purchaseOrder.update.mockResolvedValue({ ...APPROVABLE_PO, status: 'APPROVED' });
    });

    it('approves a qualified PO for Sales Head', async () => {
      await service.approve('po-id', makeSalesHead());
      const data = mockPrisma.purchaseOrder.update.mock.calls[0][0].data;
      expect(data.status).toBe('APPROVED');
      expect(data.approvedById).toBe('sh-id');
    });

    it('throws ForbiddenException for field agents', async () => {
      await expect(service.approve('po-id', makeRequester()))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when KD invoice is not yet uploaded', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...APPROVABLE_PO, kdInvoiceUrl: null,
      });
      await expect(service.approve('po-id', makeSalesHead()))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when invoice qualification is PENDING', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...APPROVABLE_PO, qualification: 'PENDING',
      });
      await expect(service.approve('po-id', makeSalesHead()))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when invoice qualification is NOT_QUALIFIED', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...APPROVABLE_PO, qualification: 'NOT_QUALIFIED',
      });
      await expect(service.approve('po-id', makeSalesHead()))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid state transition', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...APPROVABLE_PO, status: 'CANCELLED',
      });
      await expect(service.approve('po-id', makeSalesHead()))
        .rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when PO does not exist', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);
      await expect(service.approve('po-id', makeSalesHead()))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── markDelivered ──────────────────────────────────────────────────────────

  describe('markDelivered()', () => {
    beforeEach(() => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...PO_STUB, status: 'DO_UPLOADED' });
      mockPrisma.purchaseOrder.update.mockResolvedValue({ ...PO_STUB, status: 'DELIVERED' });
    });

    it('marks a DO_UPLOADED PO as DELIVERED for admin', async () => {
      await service.markDelivered('po-id', makeAdmin());
      const data = mockPrisma.purchaseOrder.update.mock.calls[0][0].data;
      expect(data.status).toBe('DELIVERED');
      expect(data.deliveredById).toBe('admin-id');
      expect(data.paymentDeadline).toBeInstanceOf(Date);
    });

    it('sets a 30-day payment deadline from today', async () => {
      const before = new Date();
      await service.markDelivered('po-id', makeAdmin());
      const deadline = mockPrisma.purchaseOrder.update.mock.calls[0][0].data.paymentDeadline;
      const diffDays = Math.round((deadline.getTime() - before.getTime()) / 86400000);
      expect(diffDays).toBe(30);
    });

    it('throws ForbiddenException for field agents', async () => {
      await expect(service.markDelivered('po-id', makeRequester()))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for invalid state transition', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...PO_STUB, status: 'PENDING_APPROVAL' });
      await expect(service.markDelivered('po-id', makeAdmin()))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ── cancel ─────────────────────────────────────────────────────────────────

  describe('cancel()', () => {
    beforeEach(() => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, status: 'PENDING_APPROVAL', createdById: 'agent-id',
      });
      mockPrisma.purchaseOrder.update.mockResolvedValue({ ...PO_STUB, status: 'CANCELLED' });
    });

    it('allows the creator to cancel their own PO', async () => {
      await service.cancel('po-id', makeRequester());
      expect(mockPrisma.purchaseOrder.update.mock.calls[0][0].data.status).toBe('CANCELLED');
    });

    it('allows admin to cancel any PO', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, status: 'PENDING_APPROVAL', createdById: 'someone-else',
      });
      await expect(service.cancel('po-id', makeAdmin())).resolves.not.toThrow();
    });

    it('throws ForbiddenException when field agent cancels another agent\'s PO', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, status: 'PENDING_APPROVAL', createdById: 'other-agent',
      });
      await expect(service.cancel('po-id', makeRequester()))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for invalid state transition', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, status: 'FULLY_PAID', createdById: 'agent-id',
      });
      await expect(service.cancel('po-id', makeRequester()))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ── recordPayment ──────────────────────────────────────────────────────────

  describe('recordPayment()', () => {
    const PAYMENT_DTO = { amountKobo: 10000000, paymentMode: PaymentMode.TRANSFER };

    it('records partial payment', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, status: 'APPROVED',
        totalKobo: BigInt(75600000), paidKobo: BigInt(0),
      });
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'pay-id', amountKobo: BigInt(10000000) }, {},
      ]);

      const result = await service.recordPayment('po-id', PAYMENT_DTO as any, makeRequester());
      expect(result.amountKobo).toBe(BigInt(10000000));
    });

    it('throws BadRequestException when payment exceeds outstanding balance', async () => {
      // outstanding: 75,600,000 - 75,500,000 = 100,000; paying 200,000 exceeds it
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, status: 'APPROVED',
        totalKobo: BigInt(75600000), paidKobo: BigInt(75500000),
      });
      await expect(
        service.recordPayment(
          'po-id',
          { amountKobo: 200000, paymentMode: PaymentMode.CASH },
          makeRequester(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on PENDING_APPROVAL order', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...PO_STUB, status: 'PENDING_APPROVAL' });
      await expect(service.recordPayment('po-id', PAYMENT_DTO as any, makeRequester()))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on CANCELLED order', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...PO_STUB, status: 'CANCELLED' });
      await expect(service.recordPayment('po-id', PAYMENT_DTO as any, makeRequester()))
        .rejects.toThrow(BadRequestException);
    });

    it('marks order FULLY_PAID when payment completes the total', async () => {
      // outstanding: 75,600,000 - 65,600,000 = 10,000,000; payment = 10,000,000
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, status: 'DELIVERED',
        totalKobo: BigInt(75600000), paidKobo: BigInt(65600000),
        orderRef: 'PO-000001',
      });
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'pay-id', amountKobo: BigInt(10000000) }, {},
      ]);

      await service.recordPayment('po-id', PAYMENT_DTO as any, makeRequester());
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when PO does not exist', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);
      await expect(service.recordPayment('po-id', PAYMENT_DTO as any, makeRequester()))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── uploadDocument ─────────────────────────────────────────────────────────

  describe('uploadDocument()', () => {
    beforeEach(() => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(PO_STUB);
      mockPrisma.purchaseOrder.update.mockResolvedValue({
        ...PO_DETAIL, kdInvoiceUrl: 'https://res.cloudinary.com/test/invoice.jpg',
      });
    });

    it('uploads the file to Cloudinary before saving to DB', async () => {
      const dto = { documentType: 'kdInvoiceUrl' };
      await service.uploadDocument('po-id', dto as any, MOCK_FILE, makeRequester());

      expect(mockCloudinary.uploadBuffer).toHaveBeenCalledTimes(1);
      const [buffer, folder] = mockCloudinary.uploadBuffer.mock.calls[0];
      expect(buffer).toEqual(MOCK_FILE.buffer);
      expect(folder).toBe('invoices');
    });

    it('stores the Cloudinary URL returned from the upload', async () => {
      mockCloudinary.uploadBuffer.mockResolvedValue({
        secure_url: 'https://res.cloudinary.com/test/invoices/invoice-123.jpg',
      });
      const dto = { documentType: 'kdInvoiceUrl' };
      await service.uploadDocument('po-id', dto as any, MOCK_FILE, makeRequester());

      const data = mockPrisma.purchaseOrder.update.mock.calls[0][0].data;
      expect(data.kdInvoiceUrl).toBe('https://res.cloudinary.com/test/invoices/invoice-123.jpg');
    });

    it('uploads PDF files with raw resourceType', async () => {
      const dto = { documentType: 'kdInvoiceUrl' };
      await service.uploadDocument('po-id', dto as any, MOCK_PDF_FILE, makeRequester());

      const [, , options] = mockCloudinary.uploadBuffer.mock.calls[0];
      expect(options.resourceType).toBe('raw');
    });

    it('uploads image files with image resourceType', async () => {
      const dto = { documentType: 'kdInvoiceUrl' };
      await service.uploadDocument('po-id', dto as any, MOCK_FILE, makeRequester()); // JPEG

      const [, , options] = mockCloudinary.uploadBuffer.mock.calls[0];
      expect(options.resourceType).toBe('image');
    });

    it('sends cheque images to the cheques folder', async () => {
      const dto = { documentType: 'chequeUrl' };
      await service.uploadDocument('po-id', dto as any, MOCK_FILE, makeRequester());

      const [, folder] = mockCloudinary.uploadBuffer.mock.calls[0];
      expect(folder).toBe('cheques');
    });

    it('triggers OCR comparison when document type is kdInvoiceUrl', async () => {
      const dto = { documentType: 'kdInvoiceUrl' };
      await service.uploadDocument('po-id', dto as any, MOCK_FILE, makeRequester());

      await new Promise(resolve => setImmediate(resolve));
      expect(mockVision.compareInvoiceToPO).toHaveBeenCalledTimes(1);
    });

    it('does NOT trigger OCR for other document types', async () => {
      const dto = { documentType: 'deliveryOrderUrl' };
      mockPrisma.purchaseOrder.update.mockResolvedValue({
        ...PO_DETAIL, status: 'DO_UPLOADED',
      });
      await service.uploadDocument('po-id', dto as any, MOCK_FILE, makeAdmin());

      await new Promise(resolve => setImmediate(resolve));
      expect(mockVision.compareInvoiceToPO).not.toHaveBeenCalled();
    });

    it('sets status to DO_UPLOADED when deliveryOrderUrl is uploaded', async () => {
      mockPrisma.purchaseOrder.update.mockResolvedValue({ ...PO_DETAIL, status: 'DO_UPLOADED' });
      const dto = { documentType: 'deliveryOrderUrl' };
      await service.uploadDocument('po-id', dto as any, MOCK_FILE, makeAdmin());

      const data = mockPrisma.purchaseOrder.update.mock.calls[0][0].data;
      expect(data.status).toBe('DO_UPLOADED');
    });

    it('does not change status for non-delivery-order uploads', async () => {
      const dto = { documentType: 'kdInvoiceUrl' };
      await service.uploadDocument('po-id', dto as any, MOCK_FILE, makeRequester());

      const data = mockPrisma.purchaseOrder.update.mock.calls[0][0].data;
      expect(data.status).toBeUndefined();
    });

    it('continues gracefully if OCR throws an error', async () => {
      mockVision.compareInvoiceToPO.mockRejectedValue(new Error('Vision API down'));
      const dto = { documentType: 'kdInvoiceUrl' };
      await expect(
        service.uploadDocument('po-id', dto as any, MOCK_FILE, makeRequester()),
      ).resolves.not.toThrow();
    });

    it('throws NotFoundException when PO does not exist', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);
      const dto = { documentType: 'kdInvoiceUrl' };
      await expect(
        service.uploadDocument('po-id', dto as any, MOCK_FILE, makeRequester()),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not call DB update if Cloudinary upload fails', async () => {
      mockCloudinary.uploadBuffer.mockRejectedValue(new Error('Cloudinary error'));
      const dto = { documentType: 'kdInvoiceUrl' };
      await expect(
        service.uploadDocument('po-id', dto as any, MOCK_FILE, makeRequester()),
      ).rejects.toThrow();
      expect(mockPrisma.purchaseOrder.update).not.toHaveBeenCalled();
    });
  });

  // ── qualifyInvoice ─────────────────────────────────────────────────────────

  describe('qualifyInvoice()', () => {
    beforeEach(() => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(PO_STUB);
      mockPrisma.purchaseOrder.update.mockResolvedValue({
        ...PO_STUB, qualification: 'QUALIFIED',
      });
    });

    it('qualifies a PO invoice for Sales Head', async () => {
      await service.qualifyInvoice('po-id', { qualification: 'QUALIFIED' } as any, makeSalesHead());
      expect(mockPrisma.purchaseOrder.update.mock.calls[0][0].data.qualification).toBe('QUALIFIED');
    });

    it('can mark invoice as NOT_QUALIFIED with mismatch details', async () => {
      const dto = {
        qualification: 'NOT_QUALIFIED',
        invoiceMismatch: { summary: 'Quantity mismatch', confidence: 0.9, mismatches: [] },
      };
      await service.qualifyInvoice('po-id', dto as any, makeSalesHead());
      expect(mockPrisma.purchaseOrder.update.mock.calls[0][0].data.qualification).toBe('NOT_QUALIFIED');
    });

    it('throws ForbiddenException for field agents', async () => {
      await expect(
        service.qualifyInvoice('po-id', { qualification: 'QUALIFIED' } as any, makeRequester()),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.purchaseOrder.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when PO does not exist', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);
      await expect(
        service.qualifyInvoice('po-id', { qualification: 'QUALIFIED' } as any, makeSalesHead()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── state machine — invalid transitions ────────────────────────────────────

  describe('state machine — invalid transitions are blocked', () => {
    it('cannot approve a CANCELLED order', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, status: 'CANCELLED',
        kdInvoiceUrl: 'https://cloudinary.com/invoice.jpg', qualification: 'QUALIFIED',
      });
      await expect(service.approve('po-id', makeSalesHead())).rejects.toThrow(BadRequestException);
    });

    it('cannot approve a FULLY_PAID order', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, status: 'FULLY_PAID',
        kdInvoiceUrl: 'https://cloudinary.com/invoice.jpg', qualification: 'QUALIFIED',
      });
      await expect(service.approve('po-id', makeSalesHead())).rejects.toThrow(BadRequestException);
    });

    it('cannot skip from PENDING_APPROVAL to DELIVERED', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...PO_STUB, status: 'PENDING_APPROVAL' });
      await expect(service.markDelivered('po-id', makeAdmin())).rejects.toThrow(BadRequestException);
    });

    it('cannot cancel a FULLY_PAID order', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, status: 'FULLY_PAID', createdById: 'agent-id',
      });
      await expect(service.cancel('po-id', makeRequester())).rejects.toThrow(BadRequestException);
    });

    it('cannot cancel a DELIVERED order', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, status: 'DELIVERED', createdById: 'agent-id',
      });
      await expect(service.cancel('po-id', makeRequester())).rejects.toThrow(BadRequestException);
    });

    it('cannot mark APPROVED as delivered without DO_UPLOADED step', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...PO_STUB, status: 'APPROVED' });
      await expect(service.markDelivered('po-id', makeAdmin())).rejects.toThrow(BadRequestException);
    });

    it('PENDING_APPROVAL → APPROVED is a valid transition', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, status: 'PENDING_APPROVAL',
        kdInvoiceUrl: 'https://cloudinary.com/invoice.jpg', qualification: 'QUALIFIED',
      });
      mockPrisma.purchaseOrder.update.mockResolvedValue({ ...PO_STUB, status: 'APPROVED' });
      await expect(service.approve('po-id', makeSalesHead())).resolves.not.toThrow();
    });

    it('DO_UPLOADED → DELIVERED is a valid transition', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...PO_STUB, status: 'DO_UPLOADED' });
      mockPrisma.purchaseOrder.update.mockResolvedValue({ ...PO_STUB, status: 'DELIVERED' });
      await expect(service.markDelivered('po-id', makeAdmin())).resolves.not.toThrow();
    });

    it('PENDING_APPROVAL → CANCELLED is a valid transition', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, status: 'PENDING_APPROVAL', createdById: 'agent-id',
      });
      mockPrisma.purchaseOrder.update.mockResolvedValue({ ...PO_STUB, status: 'CANCELLED' });
      await expect(service.cancel('po-id', makeRequester())).resolves.not.toThrow();
    });
  });
});