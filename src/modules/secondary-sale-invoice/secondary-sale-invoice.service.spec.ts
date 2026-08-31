
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SecondarySaleInvoiceService } from './secondary-sale-invoice.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// Mocks

const mockPrisma = {
  customer: {
    findUnique: jest.fn(),
    update:     jest.fn(),
  },
  product:         { findMany: jest.fn() },
  agentInventory:  { findMany: jest.fn(), update: jest.fn() },
  secondarySaleInvoice: {
    count:      jest.fn(),
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    update:     jest.fn(),
    create:     jest.fn(),
  },
  secondaryPayment: { create: jest.fn() },
  $transaction:     jest.fn(),
};

const mockCloudinary = { uploadBuffer: jest.fn() };

//  Fixtures

const SECONDARY_CUSTOMER = {
  id:                   'sec-cust-id',
  businessName:         'Bright Wholesalers',
  customerType:         'SECONDARY',
  secondaryCustomerType: 'WHOLESALER',
  address:              'Mushin Market, Lagos',
  balanceKobo:          BigInt(0),
};

const PRIMARY_CUSTOMER = {
  id:           'kd-id',
  businessName: 'Ore Ofe Distributors',
  customerType: 'PRIMARY',
};

const PRODUCT_A = {
  id:              'prod-a',
  name:            'Visita Essence B Whitening Lotion (250ml)',
  category:        'LOTION',
  cartonPriceKobo: BigInt(6300000),
};

const PRODUCT_B = {
  id:              'prod-b',
  name:            'Neoskin Essence B Whitening Lotion (250ml)',
  category:        'LOTION',
  cartonPriceKobo: BigInt(6300000),
};

// Agent has 50 of A and 30 of B in hand
const AGENT_INVENTORY = [
  { productId: 'prod-a', quantityCartons: 50 },
  { productId: 'prod-b', quantityCartons: 30 },
];

const INVOICE_STUB = {
  id:          'inv-id',
  invoiceRef:  'SSI-000001',
  soldById:    'agent-id',
  soldBy:      { fullName: 'Kenny Solape', employeeRef: 'Dar-00000007', tier: 'TIER1' },
  customerId:  'sec-cust-id',
  customer:    { businessName: 'Bright Wholesalers', secondaryCustomerType: 'WHOLESALER' },
  totalKobo:   BigInt(126000000),   // 20 cartons × ₦63,000 = ₦1,260,000
  paidKobo:    BigInt(0),
  balanceKobo: BigInt(126000000),
  status:      'UNPAID',
  invoiceUrl:  null,
  note:        null,
  createdAt:   new Date(),
  updatedAt:   new Date(),
  items: [{
    id:              'item-id',
    productId:       'prod-a',
    product:         { name: 'Visita Lotion', category: 'LOTION' },
    quantityCartons: 20,
    unitPriceKobo:   BigInt(6300000),
    lineTotalKobo:   BigInt(126000000),
  }],
  payments: [],
};

const SINGLE_DTO = {
  customerId: 'sec-cust-id',
  items:      [{ productId: 'prod-a', quantityCartons: 20 }],
};

const MULTI_DTO = {
  customerId: 'sec-cust-id',
  items: [
    { productId: 'prod-a', quantityCartons: 20 },
    { productId: 'prod-b', quantityCartons: 10 },
  ],
};

const PAYMENT_DTO = { amountKobo: 50000000, paymentMode: 'TRANSFER' };

function makeTier(tier = 'TIER1'): JwtPayload {
  return { sub: 'agent-id', email: 'agent@test.com', tier, team: 'RADIANT' } as JwtPayload;
}
function makeAdmin(): JwtPayload {
  return { sub: 'admin-id', email: 'admin@test.com', tier: 'TIER5_SALES_SUPPORT', team: 'RADIANT' } as JwtPayload;
}
function makeSalesHead(): JwtPayload {
  return { sub: 'sh-id', email: 'sh@test.com', tier: 'TIER5_SALES_HEAD', team: 'RADIANT' } as JwtPayload;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SecondarySaleInvoiceService', () => {
  let service: SecondarySaleInvoiceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecondarySaleInvoiceService,
        { provide: PrismaService,     useValue: mockPrisma },
        { provide: CloudinaryService, useValue: mockCloudinary },
      ],
    }).compile();

    service = module.get<SecondarySaleInvoiceService>(SecondarySaleInvoiceService);
    jest.resetAllMocks();

    mockPrisma.customer.findUnique.mockResolvedValue(SECONDARY_CUSTOMER);
    mockPrisma.product.findMany.mockResolvedValue([PRODUCT_A]);
    mockPrisma.agentInventory.findMany.mockResolvedValue(AGENT_INVENTORY);
    mockPrisma.secondarySaleInvoice.count.mockResolvedValue(0);
    mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue(INVOICE_STUB);
    mockPrisma.secondarySaleInvoice.findMany.mockResolvedValue([INVOICE_STUB]);
    mockPrisma.secondarySaleInvoice.update.mockResolvedValue(INVOICE_STUB);
    mockPrisma.secondaryPayment.create.mockResolvedValue({ id: 'pay-id' });
    mockPrisma.$transaction.mockImplementation((fn: any) =>
      typeof fn === 'function' ? fn(mockPrisma) : Promise.all(fn),
    );
    mockCloudinary.uploadBuffer.mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/test/SSI-000001.pdf',
    });
  });

  // ── create() ───────────────────────────────────────────────────────────────

  describe('create()', () => {

    describe('tier access control', () => {
      it('Tier 1 can log secondary sales', async () => {
        mockPrisma.$transaction.mockResolvedValue(INVOICE_STUB);
        await expect(service.create(SINGLE_DTO as any, makeTier('TIER1'))).resolves.not.toThrow();
      });

      it('Tier 2 can log secondary sales', async () => {
        mockPrisma.$transaction.mockResolvedValue(INVOICE_STUB);
        await expect(service.create(SINGLE_DTO as any, makeTier('TIER2'))).resolves.not.toThrow();
      });

      it('Tier 3 can log secondary sales', async () => {
        mockPrisma.$transaction.mockResolvedValue(INVOICE_STUB);
        await expect(service.create(SINGLE_DTO as any, makeTier('TIER3'))).resolves.not.toThrow();
      });

      it('throws ForbiddenException for Tier 4', async () => {
        await expect(service.create(SINGLE_DTO as any, makeTier('TIER4')))
          .rejects.toThrow(ForbiddenException);
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      });

      it('throws ForbiddenException for Sales Head', async () => {
        await expect(service.create(SINGLE_DTO as any, makeSalesHead()))
          .rejects.toThrow(ForbiddenException);
      });

      it('throws ForbiddenException for System Admin', async () => {
        await expect(service.create(SINGLE_DTO as any, makeAdmin()))
          .rejects.toThrow(ForbiddenException);
      });
    });

    describe('customer validation', () => {
      it('throws NotFoundException when customer does not exist', async () => {
        mockPrisma.customer.findUnique.mockResolvedValue(null);
        await expect(service.create(SINGLE_DTO as any, makeTier()))
          .rejects.toThrow(NotFoundException);
      });

      it('throws BadRequestException when selling to a PRIMARY customer', async () => {
        mockPrisma.customer.findUnique.mockResolvedValue(PRIMARY_CUSTOMER);
        await expect(service.create(SINGLE_DTO as any, makeTier()))
          .rejects.toThrow(BadRequestException);
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      });
    });

    describe('product and inventory validation', () => {
      it('throws BadRequestException when product is not found or inactive', async () => {
        mockPrisma.product.findMany.mockResolvedValue([]);
        await expect(service.create(SINGLE_DTO as any, makeTier()))
          .rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when agent has insufficient in-hand stock', async () => {
        mockPrisma.agentInventory.findMany.mockResolvedValue([
          { productId: 'prod-a', quantityCartons: 5 }, // only 5, trying to sell 20
        ]);
        await expect(service.create(SINGLE_DTO as any, makeTier()))
          .rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when agent has zero stock for the product', async () => {
        mockPrisma.agentInventory.findMany.mockResolvedValue([]); // nothing in hand
        await expect(service.create(SINGLE_DTO as any, makeTier()))
          .rejects.toThrow(BadRequestException);
      });

      it('allows sale when quantityCartons exactly equals in-hand stock', async () => {
        mockPrisma.agentInventory.findMany.mockResolvedValue([
          { productId: 'prod-a', quantityCartons: 20 }, // exactly 20 = selling 20
        ]);
        mockPrisma.$transaction.mockResolvedValue(INVOICE_STUB);
        await expect(service.create(SINGLE_DTO as any, makeTier())).resolves.not.toThrow();
      });
    });

    describe('bulk sales — multiple products per customer', () => {
      it('accepts multiple products for one customer in a single request', async () => {
        mockPrisma.product.findMany.mockResolvedValue([PRODUCT_A, PRODUCT_B]);
        mockPrisma.$transaction.mockResolvedValue(INVOICE_STUB);
        await expect(service.create(MULTI_DTO as any, makeTier())).resolves.not.toThrow();
      });

      it('checks inventory for each product independently', async () => {
        mockPrisma.product.findMany.mockResolvedValue([PRODUCT_A, PRODUCT_B]);
        // B has only 5 in hand but trying to sell 10
        mockPrisma.agentInventory.findMany.mockResolvedValue([
          { productId: 'prod-a', quantityCartons: 50 },
          { productId: 'prod-b', quantityCartons: 5  },
        ]);
        await expect(service.create(MULTI_DTO as any, makeTier()))
          .rejects.toThrow(BadRequestException);
      });

      it('calculates totalKobo as sum across all line items', async () => {
        mockPrisma.product.findMany.mockResolvedValue([PRODUCT_A, PRODUCT_B]);
        mockPrisma.$transaction.mockResolvedValue(INVOICE_STUB);
        // 6300000 × 20 + 6300000 × 10 = 126M + 63M = 189M kobo
        await service.create(MULTI_DTO as any, makeTier());
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      });
    });

    describe('invoice reference', () => {
      it('generates invoiceRef as SSI-000001 when count is 0', async () => {
        mockPrisma.secondarySaleInvoice.count.mockResolvedValue(0);
        mockPrisma.$transaction.mockResolvedValue(INVOICE_STUB);
        await service.create(SINGLE_DTO as any, makeTier());
        expect(mockPrisma.secondarySaleInvoice.count).toHaveBeenCalledTimes(1);
      });

      it('generates incremental reference numbers', async () => {
        mockPrisma.secondarySaleInvoice.count.mockResolvedValue(9);
        mockPrisma.$transaction.mockResolvedValue(INVOICE_STUB);
        await service.create(SINGLE_DTO as any, makeTier());
        // count = 9 → ref = SSI-000010
        expect(mockPrisma.secondarySaleInvoice.count).toHaveBeenCalledTimes(1);
      });
    });

    describe('transaction', () => {
      it('runs inside a transaction', async () => {
        mockPrisma.$transaction.mockResolvedValue(INVOICE_STUB);
        await service.create(SINGLE_DTO as any, makeTier());
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      });

      it('returns the created invoice', async () => {
        mockPrisma.$transaction.mockResolvedValue(INVOICE_STUB);
        const result = await service.create(SINGLE_DTO as any, makeTier());
        expect(result).toEqual(INVOICE_STUB);
      });
    });
  });

  // ── recordPayment() ────────────────────────────────────────────────────────

  describe('recordPayment()', () => {
    const UNPAID_INVOICE = {
      ...INVOICE_STUB,
      totalKobo:   BigInt(126000000),
      paidKobo:    BigInt(0),
      balanceKobo: BigInt(126000000),
      status:      'UNPAID',
    };

    const PARTIAL_INVOICE = {
      ...INVOICE_STUB,
      totalKobo:   BigInt(126000000),
      paidKobo:    BigInt(76000000),
      balanceKobo: BigInt(50000000),
      status:      'PARTIAL',
    };

    it('records a partial payment and returns PARTIAL status', async () => {
      mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue(UNPAID_INVOICE);
      mockPrisma.$transaction.mockResolvedValue([{ id: 'pay-id' }, {}, {}]);
      const result = await service.recordPayment('inv-id', PAYMENT_DTO as any, makeTier()) as any;
      expect(result.invoiceStatus).toBe('PARTIAL');
      expect(result.fullySettled).toBe(false);
      expect(result.paidKobo).toBe(BigInt(50000000));
      expect(result.balanceKobo).toBe(BigInt(76000000));
    });

    it('records a full payment and returns SETTLED status', async () => {
      mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue(PARTIAL_INVOICE);
      mockPrisma.$transaction.mockResolvedValue([{ id: 'pay-id' }, {}, {}]);
      const result = await service.recordPayment(
        'inv-id',
        { amountKobo: 50000000, paymentMode: 'CASH' } as any,
        makeTier(),
      ) as any;
      expect(result.invoiceStatus).toBe('SETTLED');
      expect(result.fullySettled).toBe(true);
      expect(result.balanceKobo).toBe(BigInt(0));
    });

    it('balanceKobo is correctly calculated after partial payment', async () => {
      mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue(UNPAID_INVOICE);
      mockPrisma.$transaction.mockResolvedValue([{ id: 'pay-id' }, {}, {}]);
      const result = await service.recordPayment(
        'inv-id',
        { amountKobo: 50000000, paymentMode: 'TRANSFER' } as any,
        makeTier(),
      ) as any;
      // 126M - 50M = 76M remaining
      expect(result.balanceKobo).toBe(BigInt(76000000));
    });

    describe('access control', () => {
      it('the agent who made the sale can record payment', async () => {
        mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue(UNPAID_INVOICE);
        mockPrisma.$transaction.mockResolvedValue([{ id: 'pay-id' }, {}, {}]);
        await expect(service.recordPayment('inv-id', PAYMENT_DTO as any, makeTier()))
          .resolves.not.toThrow();
      });

      it('Sales Head can record payment on any invoice', async () => {
        mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue({
          ...UNPAID_INVOICE, soldById: 'other-agent',
        });
        mockPrisma.$transaction.mockResolvedValue([{ id: 'pay-id' }, {}, {}]);
        await expect(service.recordPayment('inv-id', PAYMENT_DTO as any, makeSalesHead()))
          .resolves.not.toThrow();
      });

      it('System Admin can record payment on any invoice', async () => {
        mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue({
          ...UNPAID_INVOICE, soldById: 'other-agent',
        });
        mockPrisma.$transaction.mockResolvedValue([{ id: 'pay-id' }, {}, {}]);
        await expect(service.recordPayment('inv-id', PAYMENT_DTO as any, makeAdmin()))
          .resolves.not.toThrow();
      });

      it('throws ForbiddenException when agent records payment on another agent\'s invoice', async () => {
        mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue({
          ...UNPAID_INVOICE, soldById: 'other-agent',
        });
        await expect(service.recordPayment('inv-id', PAYMENT_DTO as any, makeTier()))
          .rejects.toThrow(ForbiddenException);
      });
    });

    describe('business rules', () => {
      it('throws BadRequestException when invoice is already SETTLED', async () => {
        mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue({
          ...INVOICE_STUB,
          status:      'SETTLED',
          balanceKobo: BigInt(0),
        });
        await expect(service.recordPayment('inv-id', PAYMENT_DTO as any, makeTier()))
          .rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when payment exceeds outstanding balance', async () => {
        mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue({
          ...INVOICE_STUB,
          totalKobo:   BigInt(126000000),
          paidKobo:    BigInt(120000000),
          balanceKobo: BigInt(6000000), // only 6M remaining
          status:      'PARTIAL',
        });
        // Trying to pay 50M when only 6M remains
        await expect(
          service.recordPayment(
            'inv-id',
            { amountKobo: 50000000, paymentMode: 'TRANSFER' } as any,
            makeTier(),
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws NotFoundException when invoice does not exist', async () => {
        mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue(null);
        await expect(service.recordPayment('bad-id', PAYMENT_DTO as any, makeTier()))
          .rejects.toThrow(NotFoundException);
      });
    });
  });

  // ── findAll() ──────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('field staff see only their own invoices', async () => {
      await service.findAll({}, makeTier());
      const where = mockPrisma.secondarySaleInvoice.findMany.mock.calls[0][0].where;
      expect(where.soldById).toBe('agent-id');
    });

    it('Sales Head sees all invoices — no soldById filter', async () => {
      await service.findAll({}, makeSalesHead());
      const where = mockPrisma.secondarySaleInvoice.findMany.mock.calls[0][0].where;
      expect(where.soldById).toBeUndefined();
    });

    it('System Admin sees all invoices', async () => {
      await service.findAll({}, makeAdmin());
      const where = mockPrisma.secondarySaleInvoice.findMany.mock.calls[0][0].where;
      expect(where.soldById).toBeUndefined();
    });

    it('applies customerId filter when provided', async () => {
      await service.findAll({ customerId: 'sec-cust-id' }, makeSalesHead());
      const where = mockPrisma.secondarySaleInvoice.findMany.mock.calls[0][0].where;
      expect(where.customerId).toBe('sec-cust-id');
    });

    it('applies status filter when provided', async () => {
      await service.findAll({ status: 'UNPAID' }, makeSalesHead());
      const where = mockPrisma.secondarySaleInvoice.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('UNPAID');
    });

    it('applies from date filter when provided', async () => {
      await service.findAll({ from: '2026-08-01' }, makeSalesHead());
      const where = mockPrisma.secondarySaleInvoice.findMany.mock.calls[0][0].where;
      expect(where.createdAt?.gte).toBeInstanceOf(Date);
    });

    it('applies to date filter when provided', async () => {
      await service.findAll({ to: '2026-08-31' }, makeSalesHead());
      const where = mockPrisma.secondarySaleInvoice.findMany.mock.calls[0][0].where;
      expect(where.createdAt?.lte).toBeInstanceOf(Date);
    });

    it('orders by createdAt descending', async () => {
      await service.findAll({}, makeSalesHead());
      expect(mockPrisma.secondarySaleInvoice.findMany.mock.calls[0][0].orderBy)
        .toEqual({ createdAt: 'desc' });
    });

    it('caps results at 200', async () => {
      await service.findAll({}, makeSalesHead());
      expect(mockPrisma.secondarySaleInvoice.findMany.mock.calls[0][0].take).toBe(200);
    });
  });

  // ── findOne() ──────────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('returns the invoice when requester is the seller', async () => {
      const result = await service.findOne('inv-id', makeTier());
      expect(result).toEqual(INVOICE_STUB);
    });

    it('Admin can view any invoice', async () => {
      mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue({
        ...INVOICE_STUB, soldById: 'someone-else',
      });
      await expect(service.findOne('inv-id', makeAdmin())).resolves.not.toThrow();
    });

    it('Sales Head can view any invoice', async () => {
      mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue({
        ...INVOICE_STUB, soldById: 'someone-else',
      });
      await expect(service.findOne('inv-id', makeSalesHead())).resolves.not.toThrow();
    });

    it('throws ForbiddenException when field agent views another agent\'s invoice', async () => {
      mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue({
        ...INVOICE_STUB, soldById: 'other-agent',
      });
      await expect(service.findOne('inv-id', makeTier()))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.secondarySaleInvoice.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad-id', makeAdmin()))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── getOutstanding() ───────────────────────────────────────────────────────

  describe('getOutstanding()', () => {
    it('returns only UNPAID and PARTIAL invoices for the agent', async () => {
      await service.getOutstanding(makeTier());
      const where = mockPrisma.secondarySaleInvoice.findMany.mock.calls[0][0].where;
      expect(where.soldById).toBe('agent-id');
      expect(where.status.in).toEqual(expect.arrayContaining(['UNPAID', 'PARTIAL']));
      expect(where.status.in).not.toContain('SETTLED');
    });

    it('orders results oldest-first — most urgent at the top', async () => {
      await service.getOutstanding(makeTier());
      expect(mockPrisma.secondarySaleInvoice.findMany.mock.calls[0][0].orderBy)
        .toEqual({ createdAt: 'asc' });
    });

    it('returns empty array when agent has no outstanding invoices', async () => {
      mockPrisma.secondarySaleInvoice.findMany.mockResolvedValue([]);
      const result = await service.getOutstanding(makeTier());
      expect(result).toHaveLength(0);
    });

    it('does not include SETTLED invoices', async () => {
      await service.getOutstanding(makeTier());
      const where = mockPrisma.secondarySaleInvoice.findMany.mock.calls[0][0].where;
      // The status.in array should not contain SETTLED
      expect(where.status.in).not.toContain('SETTLED');
    });
  });
});