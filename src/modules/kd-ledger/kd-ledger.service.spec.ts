
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { KdLedgerService } from './kd-ledger.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { GoogleVisionService } from '@common/google/google-vision.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  purchaseOrder: { findUnique: jest.fn(), update: jest.fn() },
  kdLedgerEntry: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  kdPayment:     { create: jest.fn() },
  $transaction:  jest.fn(),
};

const mockVision = { extractText: jest.fn() };

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PO_STUB = {
  id:                 'po-id',
  orderRef:           'PO-000001',
  status:             'APPROVED',
  totalKobo:          BigInt(2223000000),
  customerId:         'kd-id',
  createdById:        'agent-id',
  approvalReceiptUrl: null,
  kdLedgerEntry:      null,
};

const LEDGER_STUB = {
  id:              'ledger-id',
  customerId:      'kd-id',
  customer:        { businessName: 'Ore Ofe Distributors', address: '12 Kolade St', region: 'SOUTH_WEST' },
  purchaseOrderId: 'po-id',
  purchaseOrder:   { orderRef: 'PO-000001', totalKobo: BigInt(2223000000), approvedAt: new Date(), createdById: 'agent-id' },
  receiptUrl:      'https://res.cloudinary.com/test/receipt.jpg',
  totalKobo:       BigInt(2223000000),
  paidKobo:        BigInt(0),
  balanceKobo:     BigInt(2223000000),
  status:          'UNPAID',
  ocrExtracted:    false,
  note:            null,
  createdAt:       new Date(),
  updatedAt:       new Date(),
  payments:        [],
};

const PAYMENT_DTO = { amountKobo: 1000000000, paymentMode: 'TRANSFER' };

function makeAgent(tier = 'TIER2'): JwtPayload {
  return { sub: 'agent-id', email: 'agent@darvinks.com', tier, team: 'RADIANT' } as JwtPayload;
}
function makeSalesHead(): JwtPayload {
  return { sub: 'sh-id', email: 'sh@darvinks.com', tier: 'TIER5_SALES_HEAD', team: 'RADIANT' } as JwtPayload;
}
function makeAdmin(): JwtPayload {
  return { sub: 'admin-id', email: 'admin@darvinks.com', tier: 'TIER5_SALES_SUPPORT', team: 'RADIANT' } as JwtPayload;
}
function makeGM(): JwtPayload {
  return { sub: 'gm-id', email: 'gm@darvinks.com', tier: 'TIER6_GM', team: 'RADIANT' } as JwtPayload;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('KdLedgerService', () => {
  let service: KdLedgerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KdLedgerService,
        { provide: PrismaService,       useValue: mockPrisma },
        { provide: GoogleVisionService, useValue: mockVision },
      ],
    }).compile();

    service = module.get<KdLedgerService>(KdLedgerService);
    jest.resetAllMocks();

    mockPrisma.purchaseOrder.findUnique.mockResolvedValue(PO_STUB);
    mockPrisma.purchaseOrder.update.mockResolvedValue(PO_STUB);
    mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue(LEDGER_STUB);
    mockPrisma.kdLedgerEntry.findMany.mockResolvedValue([LEDGER_STUB]);
    mockPrisma.kdLedgerEntry.create.mockResolvedValue(LEDGER_STUB);
    mockPrisma.kdLedgerEntry.update.mockResolvedValue(LEDGER_STUB);
    mockPrisma.kdPayment.create.mockResolvedValue({ id: 'pay-id', amountKobo: BigInt(1000000000) });
    mockPrisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));
    mockVision.extractText.mockResolvedValue({ text: 'TOTAL: 22,230,000' });
  });

  // ── getByPurchaseOrder() ───────────────────────────────────────────────────

  describe('getByPurchaseOrder()', () => {
    it('returns PO and ledger entry for the PO creator', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, kdLedgerEntry: LEDGER_STUB,
      });
      const result = await service.getByPurchaseOrder('po-id', makeAgent()) as any;
      expect(result.purchaseOrder).toBeDefined();
      expect(result.ledgerEntry).toEqual(LEDGER_STUB);
    });

    it('returns null ledgerEntry when no receipt has been uploaded yet', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, kdLedgerEntry: null,
      });
      const result = await service.getByPurchaseOrder('po-id', makeAgent()) as any;
      expect(result.ledgerEntry).toBeNull();
    });

    it('Sales Head can view any PO ledger', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, createdById: 'other-agent', kdLedgerEntry: LEDGER_STUB,
      });
      await expect(service.getByPurchaseOrder('po-id', makeSalesHead())).resolves.not.toThrow();
    });

    it('GM can view any PO ledger', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, createdById: 'other-agent', kdLedgerEntry: LEDGER_STUB,
      });
      await expect(service.getByPurchaseOrder('po-id', makeGM())).resolves.not.toThrow();
    });

    it('throws ForbiddenException when Tier 2 agent views another agent\'s PO ledger', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, createdById: 'other-agent', kdLedgerEntry: null,
      });
      await expect(service.getByPurchaseOrder('po-id', makeAgent()))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when PO does not exist', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);
      await expect(service.getByPurchaseOrder('bad-id', makeAdmin()))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── createOrUpdateWithReceipt() ───────────────────────────────────────────

  describe('createOrUpdateWithReceipt()', () => {
    it('creates a new ledger entry when one does not exist', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue(null); // no existing entry
      await service.createOrUpdateWithReceipt('po-id', 'https://receipt-url.jpg', makeAgent());
      expect(mockPrisma.kdLedgerEntry.create).toHaveBeenCalledTimes(1);
    });

    it('updates the existing ledger entry when one already exists', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue(LEDGER_STUB);
      await service.createOrUpdateWithReceipt('po-id', 'https://new-receipt.jpg', makeAgent());
      expect(mockPrisma.kdLedgerEntry.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.kdLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('stores the receipt URL on the PO record', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue(null);
      await service.createOrUpdateWithReceipt('po-id', 'https://receipt.jpg', makeAgent());
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-id' },
        data:  { approvalReceiptUrl: 'https://receipt.jpg' },
      });
    });

    it('throws ForbiddenException when agent uploads receipt for another agent\'s PO', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, createdById: 'other-agent',
      });
      await expect(
        service.createOrUpdateWithReceipt('po-id', 'https://receipt.jpg', makeAgent()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when PO is still PENDING_APPROVAL', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...PO_STUB, status: 'PENDING_APPROVAL',
      });
      await expect(
        service.createOrUpdateWithReceipt('po-id', 'https://receipt.jpg', makeAgent()),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when PO does not exist', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);
      await expect(
        service.createOrUpdateWithReceipt('bad-id', 'https://receipt.jpg', makeAgent()),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows upload from APPROVED, DELIVERED, and FULLY_PAID statuses', async () => {
      for (const status of ['APPROVED', 'DELIVERED', 'FULLY_PAID']) {
        jest.clearAllMocks();
        mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ ...PO_STUB, status });
        mockPrisma.purchaseOrder.update.mockResolvedValue({});
        mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue(null);
        mockPrisma.kdLedgerEntry.create.mockResolvedValue(LEDGER_STUB);
        mockVision.extractText.mockResolvedValue({ text: 'TOTAL: 22,230,000' });
        await expect(
          service.createOrUpdateWithReceipt('po-id', 'https://receipt.jpg', makeAgent()),
        ).resolves.not.toThrow();
      }
    });
  });

  // ── updateTotal() ──────────────────────────────────────────────────────────

  describe('updateTotal()', () => {
    it('updates totalKobo and recalculates balanceKobo', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue({
        ...LEDGER_STUB,
        paidKobo:        BigInt(500000000),
        purchaseOrder:   { createdById: 'agent-id' },
      });
      await service.updateTotal('ledger-id', { totalKobo: 2000000000 } as any, makeAgent());
      const data = mockPrisma.kdLedgerEntry.update.mock.calls[0][0].data;
      expect(data.totalKobo).toBe(BigInt(2000000000));
      expect(data.balanceKobo).toBe(BigInt(1500000000)); // 2000M - 500M paid
    });

    it('sets status to SETTLED when balanceKobo becomes zero', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue({
        ...LEDGER_STUB,
        paidKobo:      BigInt(2223000000), // already paid everything
        purchaseOrder: { createdById: 'agent-id' },
      });
      await service.updateTotal('ledger-id', { totalKobo: 2223000000 } as any, makeAgent());
      const data = mockPrisma.kdLedgerEntry.update.mock.calls[0][0].data;
      expect(data.status).toBe('SETTLED');
    });

    it('sets status to PARTIAL when some payment was already made', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue({
        ...LEDGER_STUB,
        paidKobo:      BigInt(500000000),
        purchaseOrder: { createdById: 'agent-id' },
      });
      await service.updateTotal('ledger-id', { totalKobo: 2000000000 } as any, makeAgent());
      const data = mockPrisma.kdLedgerEntry.update.mock.calls[0][0].data;
      expect(data.status).toBe('PARTIAL');
    });

    it('sets status to UNPAID when no payment yet', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue({
        ...LEDGER_STUB,
        paidKobo:      BigInt(0),
        purchaseOrder: { createdById: 'agent-id' },
      });
      await service.updateTotal('ledger-id', { totalKobo: 2000000000 } as any, makeAgent());
      const data = mockPrisma.kdLedgerEntry.update.mock.calls[0][0].data;
      expect(data.status).toBe('UNPAID');
    });

    it('marks ocrExtracted as false on manual update', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue({
        ...LEDGER_STUB, paidKobo: BigInt(0), purchaseOrder: { createdById: 'agent-id' },
      });
      await service.updateTotal('ledger-id', { totalKobo: 2000000000 } as any, makeAgent());
      const data = mockPrisma.kdLedgerEntry.update.mock.calls[0][0].data;
      expect(data.ocrExtracted).toBe(false);
    });

    it('throws ForbiddenException when agent updates another agent\'s ledger', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue({
        ...LEDGER_STUB,
        paidKobo:      BigInt(0),
        purchaseOrder: { createdById: 'other-agent' },
      });
      await expect(service.updateTotal('ledger-id', { totalKobo: 2000000000 } as any, makeAgent()))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when ledger entry does not exist', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue(null);
      await expect(service.updateTotal('bad-id', { totalKobo: 2000000000 } as any, makeAgent()))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── recordPayment() ────────────────────────────────────────────────────────

  describe('recordPayment()', () => {
    const PAYABLE_LEDGER = {
      ...LEDGER_STUB,
      totalKobo:   BigInt(2223000000),
      paidKobo:    BigInt(0),
      balanceKobo: BigInt(2223000000),
      status:      'UNPAID',
      purchaseOrder: { createdById: 'agent-id' },
    };

    beforeEach(() => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue(PAYABLE_LEDGER);
    });

    it('records a partial payment and returns PARTIAL status', async () => {
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'pay-id', amountKobo: BigInt(1000000000) },
        {},
      ]);
      const result = await service.recordPayment('ledger-id', PAYMENT_DTO as any, makeAgent()) as any;
      expect(result.ledgerStatus).toBe('PARTIAL');
      expect(result.paidKobo).toBe(BigInt(1000000000));
      expect(result.balanceKobo).toBe(BigInt(1223000000));
      expect(result.fullySettled).toBe(false);
    });

    it('records a full payment and returns SETTLED status', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue({
        ...PAYABLE_LEDGER,
        paidKobo:    BigInt(1223000000),
        balanceKobo: BigInt(1000000000),
        status:      'PARTIAL',
      });
      mockPrisma.$transaction.mockResolvedValue([{ id: 'pay-id' }, {}]);
      const result = await service.recordPayment(
        'ledger-id',
        { amountKobo: 1000000000, paymentMode: 'TRANSFER' } as any,
        makeAgent(),
      ) as any;
      expect(result.ledgerStatus).toBe('SETTLED');
      expect(result.balanceKobo).toBe(BigInt(0));
      expect(result.fullySettled).toBe(true);
    });

    it('Tier 2 agent (PO creator) can record payment', async () => {
      mockPrisma.$transaction.mockResolvedValue([{ id: 'pay-id' }, {}]);
      await expect(
        service.recordPayment('ledger-id', PAYMENT_DTO as any, makeAgent('TIER2')),
      ).resolves.not.toThrow();
    });

    it('Tier 3 can record payment', async () => {
      mockPrisma.$transaction.mockResolvedValue([{ id: 'pay-id' }, {}]);
      await expect(
        service.recordPayment('ledger-id', PAYMENT_DTO as any, makeAgent('TIER3')),
      ).resolves.not.toThrow();
    });

    it('Tier 4 can record payment', async () => {
      mockPrisma.$transaction.mockResolvedValue([{ id: 'pay-id' }, {}]);
      await expect(
        service.recordPayment('ledger-id', PAYMENT_DTO as any, makeAgent('TIER4')),
      ).resolves.not.toThrow();
    });

    it('throws ForbiddenException for Tier 1', async () => {
      await expect(
        service.recordPayment('ledger-id', PAYMENT_DTO as any, makeAgent('TIER1')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin can record payment on any ledger entry', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue({
        ...PAYABLE_LEDGER, purchaseOrder: { createdById: 'other-agent' },
      });
      mockPrisma.$transaction.mockResolvedValue([{ id: 'pay-id' }, {}]);
      await expect(
        service.recordPayment('ledger-id', PAYMENT_DTO as any, makeAdmin()),
      ).resolves.not.toThrow();
    });

    it('throws ForbiddenException when Tier 2 agent records payment on another agent\'s ledger', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue({
        ...PAYABLE_LEDGER, purchaseOrder: { createdById: 'other-agent' },
      });
      await expect(
        service.recordPayment('ledger-id', PAYMENT_DTO as any, makeAgent('TIER2')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when ledger is already SETTLED', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue({
        ...PAYABLE_LEDGER, status: 'SETTLED', balanceKobo: BigInt(0),
        purchaseOrder: { createdById: 'agent-id' },
      });
      await expect(service.recordPayment('ledger-id', PAYMENT_DTO as any, makeAgent()))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when payment exceeds outstanding balance', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue({
        ...PAYABLE_LEDGER,
        balanceKobo:   BigInt(500000000), // only 500M kobo remaining
        purchaseOrder: { createdById: 'agent-id' },
      });
      // Trying to pay 1000M when only 500M remains
      await expect(
        service.recordPayment('ledger-id', { amountKobo: 1000000000, paymentMode: 'CASH' } as any, makeAgent()),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when ledger entry does not exist', async () => {
      mockPrisma.kdLedgerEntry.findUnique.mockResolvedValue(null);
      await expect(service.recordPayment('bad-id', PAYMENT_DTO as any, makeAgent()))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── findAll() ──────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('Tier 2 agent sees only their own PO ledger entries', async () => {
      await service.findAll(undefined, makeAgent('TIER2'));
      const where = mockPrisma.kdLedgerEntry.findMany.mock.calls[0][0].where;
      expect(where.purchaseOrder).toEqual({ createdById: 'agent-id' });
    });

    it('Sales Head sees all ledger entries', async () => {
      await service.findAll(undefined, makeSalesHead());
      const where = mockPrisma.kdLedgerEntry.findMany.mock.calls[0][0].where;
      expect(where.purchaseOrder).toBeUndefined();
    });

    it('Admin sees all ledger entries', async () => {
      await service.findAll(undefined, makeAdmin());
      const where = mockPrisma.kdLedgerEntry.findMany.mock.calls[0][0].where;
      expect(where.purchaseOrder).toBeUndefined();
    });

    it('GM sees all ledger entries', async () => {
      await service.findAll(undefined, makeGM());
      const where = mockPrisma.kdLedgerEntry.findMany.mock.calls[0][0].where;
      expect(where.purchaseOrder).toBeUndefined();
    });

    it('applies customerId filter when provided', async () => {
      await service.findAll('kd-id', makeSalesHead());
      const where = mockPrisma.kdLedgerEntry.findMany.mock.calls[0][0].where;
      expect(where.customerId).toBe('kd-id');
    });

    it('does not apply customerId filter when not provided', async () => {
      await service.findAll(undefined, makeSalesHead());
      const where = mockPrisma.kdLedgerEntry.findMany.mock.calls[0][0].where;
      expect(where.customerId).toBeUndefined();
    });

    it('orders by createdAt descending', async () => {
      await service.findAll(undefined, makeSalesHead());
      const orderBy = mockPrisma.kdLedgerEntry.findMany.mock.calls[0][0].orderBy;
      expect(orderBy).toEqual({ createdAt: 'desc' });
    });
  });
});