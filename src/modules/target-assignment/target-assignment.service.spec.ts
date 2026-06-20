
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProductCategory, TargetPeriod, UserTier } from '@prisma/client';
import { TargetAssignmentService } from './target-assignment.service';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  targetAssignment:  {
    create:      jest.fn(),
    findUnique:  jest.fn(),
    findMany:    jest.fn(),
    update:      jest.fn(),
    updateMany:  jest.fn(),
  },
  user:              { findUnique: jest.fn() },
  product:           { findMany: jest.fn() },
  secondarySaleItem: { groupBy: jest.fn() },
  purchaseOrderItem: { groupBy: jest.fn() },
  $transaction:      jest.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SALES_HEAD_ID = 'sh-id';
const TIER4_USER = {
  id: 'tier4-id', fullName: 'Adaeze Tier4', tier: UserTier.TIER4,
  isActive: true, reportsToId: SALES_HEAD_ID,
};
const TIER3_USER_A = {
  id: 'tier3-a-id', fullName: 'Chuka Tier3A', tier: UserTier.TIER3,
  isActive: true, reportsToId: 'tier4-id',
};
const TIER3_USER_B = {
  id: 'tier3-b-id', fullName: 'Bola Tier3B', tier: UserTier.TIER3,
  isActive: true, reportsToId: 'tier4-id',
};

const ROOT_ASSIGNMENT = {
  id: 'root-assignment-id',
  assignedToId: 'tier4-id',
  targetCartons: 1000,
  category: ProductCategory.LOTION,
  period: TargetPeriod.MONTHLY,
  year: 2026,
  quarter: null,
  month: 6,
  week: null,
};

const ASSIGNMENT_DETAIL = {
  id: 'assignment-id',
  assignedById: SALES_HEAD_ID,
  assignedBy: { fullName: 'Sales Head', employeeRef: 'Dar-00000001', tier: UserTier.TIER5_SALES_HEAD },
  assignedToId: 'tier4-id',
  assignedTo: { fullName: 'Adaeze Tier4', employeeRef: 'Dar-00000002', tier: UserTier.TIER4 },
  category: ProductCategory.LOTION,
  period: TargetPeriod.MONTHLY,
  year: 2026,
  quarter: null,
  month: 6,
  week: null,
  targetCartons: 1000,
  parentAssignmentId: null,
  isStale: false,
  note: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeRequester(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: 'tier4-id',
    email: 'agent@darvinks.com',
    tier: UserTier.TIER4,
    team: 'RADIANT',
    ...overrides,
  } as JwtPayload;
}

function makeSalesHead(): JwtPayload {
  return makeRequester({ sub: SALES_HEAD_ID, tier: UserTier.TIER5_SALES_HEAD });
}

function makeAdmin(): JwtPayload {
  return makeRequester({ sub: 'admin-id', tier: UserTier.TIER5_SYSTEM_ADMIN });
}

const ROOT_DTO = {
  assignedToId: 'tier4-id',
  category: ProductCategory.LOTION,
  period: TargetPeriod.MONTHLY,
  year: 2026,
  month: 6,
  targetCartons: 1000,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TargetAssignmentService', () => {
  let service: TargetAssignmentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TargetAssignmentService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TargetAssignmentService>(TargetAssignmentService);
    jest.resetAllMocks();

    mockPrisma.$transaction.mockImplementation(
      (ops: Promise<unknown>[]) => Promise.all(ops),
    );
  });

  // ── createRoot ─────────────────────────────────────────────────────────────

  describe('createRoot()', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(TIER4_USER);
      mockPrisma.targetAssignment.create.mockResolvedValue(ASSIGNMENT_DETAIL);
    });

    it('creates a root target when called by the Sales Head', async () => {
      const result = await service.createRoot(ROOT_DTO, makeSalesHead());
      expect(result).toEqual(ASSIGNMENT_DETAIL);

      const data = mockPrisma.targetAssignment.create.mock.calls[0][0].data;
      expect(data.parentAssignmentId).toBeNull();
      expect(data.assignedById).toBe(SALES_HEAD_ID);
    });

    it('throws ForbiddenException when called by anyone other than the Sales Head', async () => {
      await expect(
        service.createRoot(ROOT_DTO, makeRequester({ tier: UserTier.TIER4 })),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when assignee does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.createRoot(ROOT_DTO, makeSalesHead()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when assignee is deactivated', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...TIER4_USER, isActive: false });
      await expect(
        service.createRoot(ROOT_DTO, makeSalesHead()),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when assignee is not exactly TIER4', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...TIER4_USER, tier: UserTier.TIER3 });
      await expect(
        service.createRoot(ROOT_DTO, makeSalesHead()),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when assignee does not report to the requester', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...TIER4_USER, reportsToId: 'someone-else' });
      await expect(
        service.createRoot(ROOT_DTO, makeSalesHead()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when period is MONTHLY but month is missing', async () => {
      const dto = { ...ROOT_DTO, month: undefined };
      await expect(
        service.createRoot(dto as any, makeSalesHead()),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when period is QUARTERLY but quarter is missing', async () => {
      const dto = { ...ROOT_DTO, period: TargetPeriod.QUARTERLY, month: undefined };
      await expect(
        service.createRoot(dto as any, makeSalesHead()),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── split ──────────────────────────────────────────────────────────────────

  describe('split()', () => {
    const SPLIT_DTO = {
      children: [
        { assignedToId: 'tier3-a-id', targetCartons: 600 },
        { assignedToId: 'tier3-b-id', targetCartons: 400 },
      ],
    };

    beforeEach(() => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue(ROOT_ASSIGNMENT);
      mockPrisma.targetAssignment.findMany.mockResolvedValue([]); // no existing conflicts
      mockPrisma.user.findUnique
        .mockImplementation((args: any) => {
          const id = args.where.id;
          if (id === 'tier3-a-id') return Promise.resolve(TIER3_USER_A);
          if (id === 'tier3-b-id') return Promise.resolve(TIER3_USER_B);
          return Promise.resolve(null);
        });
      mockPrisma.targetAssignment.create.mockImplementation((args: any) =>
        Promise.resolve({ ...ASSIGNMENT_DETAIL, ...args.data }),
      );
    });

    it('splits a target into children that sum exactly to the parent', async () => {
      const result = await service.split('root-assignment-id', SPLIT_DTO, makeRequester());
      expect(result).toHaveLength(2);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('sets parentAssignmentId on every child to the parent id', async () => {
      await service.split('root-assignment-id', SPLIT_DTO, makeRequester());
      const txOps = mockPrisma.$transaction.mock.calls[0][0];
      expect(txOps).toHaveLength(2);
    });

    it('throws NotFoundException when the parent assignment does not exist', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue(null);
      await expect(
        service.split('bad-id', SPLIT_DTO, makeRequester()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the requester did not receive the parent target', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ROOT_ASSIGNMENT, assignedToId: 'someone-else',
      });
      await expect(
        service.split('root-assignment-id', SPLIT_DTO, makeRequester()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when children do not sum to the parent target', async () => {
      const badDto = {
        children: [
          { assignedToId: 'tier3-a-id', targetCartons: 600 },
          { assignedToId: 'tier3-b-id', targetCartons: 300 }, // 900, not 1000
        ],
      };
      await expect(
        service.split('root-assignment-id', badDto, makeRequester()),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.targetAssignment.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for the requester\'s tier having no tier below it', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ROOT_ASSIGNMENT, assignedToId: 'tier1-id',
      });
      await expect(
        service.split(
          'root-assignment-id',
          SPLIT_DTO,
          makeRequester({ sub: 'tier1-id', tier: UserTier.TIER1 }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when a child assignee is the wrong tier', async () => {
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === 'tier3-a-id') {
          return Promise.resolve({ ...TIER3_USER_A, tier: UserTier.TIER2 }); // wrong tier
        }
        return Promise.resolve(TIER3_USER_B);
      });
      await expect(
        service.split('root-assignment-id', SPLIT_DTO, makeRequester()),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when a child assignee does not report to the requester', async () => {
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === 'tier3-a-id') {
          return Promise.resolve({ ...TIER3_USER_A, reportsToId: 'someone-else' });
        }
        return Promise.resolve(TIER3_USER_B);
      });
      await expect(
        service.split('root-assignment-id', SPLIT_DTO, makeRequester()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the same assignee appears twice', async () => {
      const dupDto = {
        children: [
          { assignedToId: 'tier3-a-id', targetCartons: 500 },
          { assignedToId: 'tier3-a-id', targetCartons: 500 },
        ],
      };
      await expect(
        service.split('root-assignment-id', dupDto, makeRequester()),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when a child already has a target for this period', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([
        { assignedToId: 'tier3-a-id' },
      ]);
      await expect(
        service.split('root-assignment-id', SPLIT_DTO, makeRequester()),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update()', () => {
    const UPDATE_DTO = { targetCartons: 1200 };

    it('updates the target when called by the original assigner', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        id: 'assignment-id', assignedById: SALES_HEAD_ID, targetCartons: 1000, children: [],
      });
      mockPrisma.targetAssignment.update.mockResolvedValue({
        ...ASSIGNMENT_DETAIL, targetCartons: 1200,
      });

      const result = await service.update('assignment-id', UPDATE_DTO, makeSalesHead());
      expect(result.targetCartons).toBe(1200);
      expect(mockPrisma.targetAssignment.updateMany).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when called by someone other than the original assigner', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        id: 'assignment-id', assignedById: SALES_HEAD_ID, targetCartons: 1000, children: [],
      });
      await expect(
        service.update('assignment-id', UPDATE_DTO, makeRequester()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for an unknown assignment', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue(null);
      await expect(
        service.update('bad-id', UPDATE_DTO, makeSalesHead()),
      ).rejects.toThrow(NotFoundException);
    });

    it('flags children stale when the value changes and children exist', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        id: 'assignment-id',
        assignedById: SALES_HEAD_ID,
        targetCartons: 1000,
        children: [{ id: 'child-1' }, { id: 'child-2' }],
      });
      mockPrisma.targetAssignment.update.mockResolvedValue({
        ...ASSIGNMENT_DETAIL, targetCartons: 1200,
      });

      await service.update('assignment-id', UPDATE_DTO, makeSalesHead());

      expect(mockPrisma.targetAssignment.updateMany).toHaveBeenCalledWith({
        where: { parentAssignmentId: 'assignment-id' },
        data: { isStale: true },
      });
    });

    it('does NOT flag children stale when the value is unchanged', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        id: 'assignment-id',
        assignedById: SALES_HEAD_ID,
        targetCartons: 1200, // same as UPDATE_DTO.targetCartons
        children: [{ id: 'child-1' }],
      });
      mockPrisma.targetAssignment.update.mockResolvedValue(ASSIGNMENT_DETAIL);

      await service.update('assignment-id', UPDATE_DTO, makeSalesHead());

      expect(mockPrisma.targetAssignment.updateMany).not.toHaveBeenCalled();
    });

    it('does NOT flag stale when value changes but there are no children', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        id: 'assignment-id', assignedById: SALES_HEAD_ID, targetCartons: 1000, children: [],
      });
      mockPrisma.targetAssignment.update.mockResolvedValue(ASSIGNMENT_DETAIL);

      await service.update('assignment-id', UPDATE_DTO, makeSalesHead());

      expect(mockPrisma.targetAssignment.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('non-admin sees only targets assigned to or by them', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([]);
      await service.findAll({}, makeRequester());

      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { assignedToId: 'tier4-id' },
        { assignedById: 'tier4-id' },
      ]);
    });

    it('Sales Head sees everything — no OR filter', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([]);
      await service.findAll({}, makeSalesHead());

      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
    });

    it('System Admin sees everything', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([]);
      await service.findAll({}, makeAdmin());

      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
    });

    it('applies isStale filter when explicitly provided as false', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([]);
      await service.findAll({ isStale: false }, makeAdmin());

      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.isStale).toBe(false);
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns the assignment for the assignee', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue(ASSIGNMENT_DETAIL);
      const result = await service.findById('assignment-id', makeRequester());
      expect(result).toEqual(ASSIGNMENT_DETAIL);
    });

    it('returns the assignment for the assigner', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue(ASSIGNMENT_DETAIL);
      const result = await service.findById('assignment-id', makeSalesHead());
      expect(result).toEqual(ASSIGNMENT_DETAIL);
    });

    it('throws ForbiddenException for an unrelated user', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue(ASSIGNMENT_DETAIL);
      await expect(
        service.findById('assignment-id', makeRequester({ sub: 'random-user' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for an unknown ID', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue(null);
      await expect(
        service.findById('bad-id', makeAdmin()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getMyPerformance ───────────────────────────────────────────────────────

  describe('getMyPerformance()', () => {
    beforeEach(() => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([
        { category: ProductCategory.LOTION, targetCartons: 1000, isStale: false },
      ]);
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'lotion-id', category: ProductCategory.LOTION },
      ]);
    });

    it('combines Secondary Sales and Purchase Order quantities into one achieved total', async () => {
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([
        { productId: 'lotion-id', _sum: { quantityCartons: 300 } },
      ]);
      mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([
        { productId: 'lotion-id', _sum: { quantityCartons: 200 } },
      ]);

      const result = await service.getMyPerformance(makeRequester(), 2026, 6);

      expect(result).toHaveLength(1);
      expect(result[0].achievedCartons).toBe(500);
      expect(result[0].achievedFromSecondarySales).toBe(300);
      expect(result[0].achievedFromPurchaseOrders).toBe(200);
      expect(result[0].balanceCartons).toBe(500);
      expect(result[0].percentAchieved).toBe(50);
    });

    it('excludes PENDING_APPROVAL and CANCELLED purchase orders from achievement', async () => {
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([]);
      mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([]);

      await service.getMyPerformance(makeRequester(), 2026, 6);

      const poCall = mockPrisma.purchaseOrderItem.groupBy.mock.calls[0][0];
      expect(poCall.where.purchaseOrder.status.notIn).toEqual([
        'PENDING_APPROVAL', 'CANCELLED',
      ]);
    });

    it('returns 0% achieved with no data from either source', async () => {
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([]);
      mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([]);
      mockPrisma.product.findMany.mockResolvedValue([]);

      const result = await service.getMyPerformance(makeRequester(), 2026, 6);
      expect(result[0].achievedCartons).toBe(0);
      expect(result[0].percentAchieved).toBe(0);
    });

    it('carries the isStale flag through from the target', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([
        { category: ProductCategory.LOTION, targetCartons: 1000, isStale: true },
      ]);
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([]);
      mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([]);

      const result = await service.getMyPerformance(makeRequester(), 2026, 6);
      expect(result[0].isStale).toBe(true);
    });

    it('queries both sources scoped to the requester and the given month', async () => {
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([]);
      mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([]);

      await service.getMyPerformance(makeRequester(), 2026, 6);

      const ssCall = mockPrisma.secondarySaleItem.groupBy.mock.calls[0][0];
      expect(ssCall.where.secondarySale.userId).toBe('tier4-id');

      const poCall = mockPrisma.purchaseOrderItem.groupBy.mock.calls[0][0];
      expect(poCall.where.purchaseOrder.createdById).toBe('tier4-id');
    });

    it('returns an empty array when the requester has no targets for that month', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([]);
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([]);
      mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([]);

      const result = await service.getMyPerformance(makeRequester(), 2026, 6);
      expect(result).toEqual([]);
    });
  });
});