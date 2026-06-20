// src/modules/collections/collection.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMode } from '@prisma/client';
import { CollectionService } from './collections.service';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  customer:   { findUnique: jest.fn(), update: jest.fn() },
  collection: {
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    create:     jest.fn(),
    aggregate:  jest.fn(),
    count:      jest.fn(),
  },
  $transaction: jest.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ACTIVE_CUSTOMER = {
  id:          'cust-id',
  isActive:    true,
  businessName: 'Ore Ofe Ltd',
  balanceKobo: 5000000,
};

const COLLECTION = {
  id:            'coll-id',
  customerId:    'cust-id',
  customer:      { businessName: 'Ore Ofe Ltd', region: 'LAGOS_1' },
  recordedById:  'user-id',
  recordedBy:    { fullName: 'Test Agent', employeeRef: 'Dar-00000001' },
  amountKobo:    500000,
  paymentMode:   PaymentMode.TRANSFER,
  receiptUrl:    'https://cloudinary.com/receipt.jpg',
  depositorName: 'Emeka Obi',
  location:      'Access Bank, Ilupeju',
  collectedAt:   new Date(),
  note:          null,
  createdAt:     new Date(),
  updatedAt:     new Date(),
};

const CREATE_DTO = {
  customerId:    'cust-id',
  amountKobo:    500000,
  paymentMode:   PaymentMode.TRANSFER,
  receiptUrl:    'https://cloudinary.com/receipt.jpg',
  depositorName: 'Emeka Obi',
  location:      'Access Bank, Ilupeju',
  collectedAt:   '2026-06-01T10:30:00.000Z',
};

function makeRequester(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub:   'user-id',
    email: 'agent@darvinks.com',
    tier:  'TIER2',
    team:  'BRIGHT',
    ...overrides,
  } as JwtPayload;
}

function makeAdmin(): JwtPayload {
  return makeRequester({ sub: 'admin-id', tier: 'TIER5_SYSTEM_ADMIN' });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CollectionService', () => {
  let service: CollectionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CollectionService>(CollectionService);
    jest.resetAllMocks();

    mockPrisma.$transaction.mockImplementation(
      (ops: Promise<unknown>[]) => Promise.all(ops),
    );
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates collection and returns it', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(ACTIVE_CUSTOMER);
      mockPrisma.$transaction.mockResolvedValue([COLLECTION, {}]);

      const result = await service.create(CREATE_DTO, makeRequester());
      expect(result).toEqual(COLLECTION);
    });

    it('runs collection create and balance decrement in one transaction', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(ACTIVE_CUSTOMER);
      mockPrisma.$transaction.mockResolvedValue([COLLECTION, {}]);

      await service.create(CREATE_DTO, makeRequester());

      const txArgs = mockPrisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(txArgs)).toBe(true);
      expect(txArgs).toHaveLength(2);
    });

    it('sets recordedById to the requester sub', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(ACTIVE_CUSTOMER);
      mockPrisma.collection.create.mockResolvedValue(COLLECTION);
      mockPrisma.customer.update.mockResolvedValue({});
      // Use real transaction for this test
      mockPrisma.$transaction.mockImplementation(
        (ops: Promise<unknown>[]) => Promise.all(ops),
      );

      await service.create(CREATE_DTO, makeRequester());

      const createData = mockPrisma.collection.create.mock.calls[0][0].data;
      expect(createData.recordedById).toBe('user-id');
    });

    it('converts collectedAt string to Date', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(ACTIVE_CUSTOMER);
      mockPrisma.collection.create.mockResolvedValue(COLLECTION);
      mockPrisma.customer.update.mockResolvedValue({});
      mockPrisma.$transaction.mockImplementation(
        (ops: Promise<unknown>[]) => Promise.all(ops),
      );

      await service.create(CREATE_DTO, makeRequester());

      const createData = mockPrisma.collection.create.mock.calls[0][0].data;
      expect(createData.collectedAt).toBeInstanceOf(Date);
    });

    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.create(CREATE_DTO, makeRequester())).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when customer is deactivated', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        ...ACTIVE_CUSTOMER, isActive: false,
      });
      await expect(service.create(CREATE_DTO, makeRequester())).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('field staff see only their own collections', async () => {
      mockPrisma.collection.findMany.mockResolvedValue([]);
      await service.findAll({}, makeRequester());

      const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
      expect(where.recordedById).toBe('user-id');
    });

    it('admin sees all collections', async () => {
      mockPrisma.collection.findMany.mockResolvedValue([]);
      await service.findAll({}, makeAdmin());

      const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
      expect(where.recordedById).toBeUndefined();
    });

    it('applies customerId filter', async () => {
      mockPrisma.collection.findMany.mockResolvedValue([]);
      await service.findAll({ customerId: 'cust-id' }, makeAdmin());

      const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
      expect(where.customerId).toBe('cust-id');
    });

    it('applies date range filter when from and to are provided', async () => {
      mockPrisma.collection.findMany.mockResolvedValue([]);
      await service.findAll(
        { from: '2026-06-01', to: '2026-06-30' },
        makeAdmin(),
      );

      const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
      expect(where.collectedAt.gte).toBeInstanceOf(Date);
      expect(where.collectedAt.lte).toBeInstanceOf(Date);
    });

    it('applies no date filter when neither from nor to provided', async () => {
      mockPrisma.collection.findMany.mockResolvedValue([]);
      await service.findAll({}, makeAdmin());

      const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
      expect(where.collectedAt).toBeUndefined();
    });

    it('orders by collectedAt descending', async () => {
      mockPrisma.collection.findMany.mockResolvedValue([]);
      await service.findAll({}, makeAdmin());

      const orderBy = mockPrisma.collection.findMany.mock.calls[0][0].orderBy;
      expect(orderBy).toEqual({ collectedAt: 'desc' });
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns collection when requester is the recorder', async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(COLLECTION);
      const result = await service.findById('coll-id', makeRequester());
      expect(result).toEqual(COLLECTION);
    });

    it('admin can view any collection', async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...COLLECTION, recordedById: 'other-user',
      });
      await expect(service.findById('coll-id', makeAdmin())).resolves.not.toThrow();
    });

    it('throws ForbiddenException when field staff views another user collection', async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...COLLECTION, recordedById: 'other-user',
      });
      await expect(
        service.findById('coll-id', makeRequester()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for unknown ID', async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id', makeAdmin())).rejects.toThrow(NotFoundException);
    });
  });

  // ── getSummaryForCustomer ──────────────────────────────────────────────────

  describe('getSummaryForCustomer()', () => {
    it('returns summary with formatted naira values', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(ACTIVE_CUSTOMER);
      mockPrisma.collection.aggregate.mockResolvedValue({ _sum: { amountKobo: 2000000 } });
      mockPrisma.collection.count.mockResolvedValue(4);

      const result = await service.getSummaryForCustomer('cust-id', makeAdmin());

      expect(result.customerId).toBe('cust-id');
      expect(result.collectionCount).toBe(4);
      expect(result.totalCollectedKobo).toBe(2000000);
      expect(result.balanceFormatted).toContain('50,000');
      expect(result.totalCollectedFormatted).toContain('20,000');
    });

    it('handles zero collections gracefully', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(ACTIVE_CUSTOMER);
      mockPrisma.collection.aggregate.mockResolvedValue({ _sum: { amountKobo: null } });
      mockPrisma.collection.count.mockResolvedValue(0);

      const result = await service.getSummaryForCustomer('cust-id', makeAdmin());
      expect(result.totalCollectedKobo).toBe(0);
    });

    it('runs aggregate and count in parallel', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(ACTIVE_CUSTOMER);
      mockPrisma.collection.aggregate.mockResolvedValue({ _sum: { amountKobo: 0 } });
      mockPrisma.collection.count.mockResolvedValue(0);

      await service.getSummaryForCustomer('cust-id', makeAdmin());

      // Both called once — parallel execution
      expect(mockPrisma.collection.aggregate).toHaveBeenCalledTimes(1);
      expect(mockPrisma.collection.count).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(
        service.getSummaryForCustomer('bad-id', makeAdmin()),
      ).rejects.toThrow(NotFoundException);
    });
  });
});