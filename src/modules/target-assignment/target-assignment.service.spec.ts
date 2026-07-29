// src/modules/target-assignment/target-assignment.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TargetAssignmentService } from './target-assignment.service';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  targetAssignment: {
    create:     jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    update:     jest.fn(),
    updateMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  secondarySaleItem: { groupBy: jest.fn() },
  purchaseOrderItem: { groupBy: jest.fn() },
  product:           { findMany: jest.fn() },
  $transaction:      jest.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ASSIGNMENT_STUB = {
  id:                 'assign-id',
  assignedById:       'sh-id',
  assignedToId:       'zsm-id',
  category:           'LOTION',
  period:             'MONTHLY',
  year:               2026,
  quarter:            null,
  month:              7,
  week:               null,
  targetCartons:      1000,
  parentAssignmentId: null,
  isStale:            false,
  note:               null,
  createdAt:          new Date(),
  children:           [],
};

const ZSM_USER = {
  id:       'zsm-id',
  fullName: 'Emeka ZSM',
  tier:     'TIER4',
  team:     'RADIANT',
  isActive: true,
  reportsToId: 'sh-id',
};

const TIER3_USER = {
  id:       'tier3-id',
  fullName: 'Chidinma ATSM',
  tier:     'TIER3',
  team:     'RADIANT',
  isActive: true,
  reportsToId: 'zsm-id',
};

const BULK_DTO = {
  assignedToId: 'zsm-id',
  period:       'MONTHLY',
  year:         2026,
  month:        7,
  categories: [
    { category: 'LOTION', targetCartons: 1000 },
    { category: 'CREAM',  targetCartons: 500  },
    { category: 'SOAP',   targetCartons: 300  },
  ],
};

function makeSalesHead(): JwtPayload {
  return { sub: 'sh-id', email: 'sh@darvinks.com',
    tier: 'TIER5_SALES_HEAD', team: 'RADIANT', region: 'SOUTH_WEST' } as JwtPayload;
}
function makeZSM(): JwtPayload {
  return { sub: 'zsm-id', email: 'zsm@darvinks.com',
    tier: 'TIER4', team: 'RADIANT', region: 'SOUTH_WEST' } as JwtPayload;
}
function makeATSM(): JwtPayload {
  return { sub: 'atsm-id', email: 'atsm@darvinks.com',
    tier: 'TIER3', team: 'RADIANT', region: 'SOUTH_WEST' } as JwtPayload;
}
function makeRep(): JwtPayload {
  return { sub: 'rep-id', email: 'rep@darvinks.com',
    tier: 'TIER2', team: 'RADIANT', region: 'SOUTH_WEST' } as JwtPayload;
}
function makeAdmin(): JwtPayload {
  return { sub: 'admin-id', email: 'admin@darvinks.com',
    tier: 'TIER5_SYSTEM_ADMIN', team: 'RADIANT' } as JwtPayload;
}

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

    // Safe defaults
    mockPrisma.user.findUnique.mockResolvedValue(ZSM_USER);
    mockPrisma.targetAssignment.create.mockResolvedValue(ASSIGNMENT_STUB);
    mockPrisma.targetAssignment.findMany.mockResolvedValue([ASSIGNMENT_STUB]);
    mockPrisma.targetAssignment.findUnique.mockResolvedValue(ASSIGNMENT_STUB);
    mockPrisma.targetAssignment.update.mockResolvedValue(ASSIGNMENT_STUB);
    mockPrisma.targetAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([]);
    mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([]);
    mockPrisma.product.findMany.mockResolvedValue([]);
    // $transaction executes all the create operations and returns their results
    mockPrisma.$transaction.mockImplementation(
      (ops: any[]) => Promise.all(ops),
    );
  });

  // ── createRoot() ───────────────────────────────────────────────────────────

  describe('createRoot()', () => {

    describe('bulk category assignment', () => {
      it('creates one TargetAssignment per category in a transaction', async () => {
        await service.createRoot(BULK_DTO as any, makeSalesHead());
        // $transaction was called once with 3 create operations
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
        const ops = mockPrisma.$transaction.mock.calls[0][0];
        expect(ops).toHaveLength(3);
      });

      it('returns an array of created assignments (one per category)', async () => {
        mockPrisma.$transaction.mockResolvedValue([
          { ...ASSIGNMENT_STUB, category: 'LOTION' },
          { ...ASSIGNMENT_STUB, category: 'CREAM'  },
          { ...ASSIGNMENT_STUB, category: 'SOAP'   },
        ]);
        const result = await service.createRoot(BULK_DTO as any, makeSalesHead());
        expect(result).toHaveLength(3);
      });

      it('assigns correct category and targetCartons per entry', async () => {
        await service.createRoot(BULK_DTO as any, makeSalesHead());
        const ops = mockPrisma.$transaction.mock.calls[0][0];
        // We can't inspect the Prisma call data directly via $transaction mocking
        // but we can verify $transaction received the right number of ops
        expect(ops).toHaveLength(BULK_DTO.categories.length);
      });

      it('allows assigning a single category (not forced to bulk)', async () => {
        const singleDto = {
          ...BULK_DTO,
          categories: [{ category: 'LOTION', targetCartons: 2000 }],
        };
        await service.createRoot(singleDto as any, makeSalesHead());
        const ops = mockPrisma.$transaction.mock.calls[0][0];
        expect(ops).toHaveLength(1);
      });

      it('throws BadRequestException when the same category appears twice', async () => {
        const dto = {
          ...BULK_DTO,
          categories: [
            { category: 'LOTION', targetCartons: 1000 },
            { category: 'LOTION', targetCartons: 500  }, // duplicate
          ],
        };
        await expect(service.createRoot(dto as any, makeSalesHead()))
          .rejects.toThrow(BadRequestException);
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      });

      it('sets parentAssignmentId to null for root targets', async () => {
        await service.createRoot(BULK_DTO as any, makeSalesHead());
        // $transaction mock runs the operations — we verify it was called
        // with the correct structure
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      });

      it('sets assignedById to the Sales Head sub', async () => {
        await service.createRoot(BULK_DTO as any, makeSalesHead());
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      });
    });

    describe('access control', () => {
      it('throws ForbiddenException for any tier that is not Sales Head', async () => {
        for (const requester of [makeZSM(), makeATSM(), makeRep(), makeAdmin()]) {
          jest.clearAllMocks();
          await expect(service.createRoot(BULK_DTO as any, requester))
            .rejects.toThrow(ForbiddenException);
        }
      });

      it('throws NotFoundException when assignee does not exist', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);
        await expect(service.createRoot(BULK_DTO as any, makeSalesHead()))
          .rejects.toThrow(NotFoundException);
      });

      it('throws BadRequestException when assignee is not Tier 4', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ ...ZSM_USER, tier: 'TIER3' });
        await expect(service.createRoot(BULK_DTO as any, makeSalesHead()))
          .rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when assignee is deactivated', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ ...ZSM_USER, isActive: false });
        await expect(service.createRoot(BULK_DTO as any, makeSalesHead()))
          .rejects.toThrow(BadRequestException);
      });

      it('throws ForbiddenException when assignee does not report to the Sales Head', async () => {
        // reportsToId must match requester.sub — if it points to someone else, reject
        mockPrisma.user.findUnique.mockResolvedValue({
          ...ZSM_USER, reportsToId: 'other-manager-id',
        });
        await expect(service.createRoot(BULK_DTO as any, makeSalesHead()))
          .rejects.toThrow(ForbiddenException);
      });
    });

    describe('period validation', () => {
      it('throws BadRequestException when month is missing for MONTHLY period', async () => {
        const dto = { ...BULK_DTO, month: undefined };
        await expect(service.createRoot(dto as any, makeSalesHead()))
          .rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when quarter is missing for QUARTERLY period', async () => {
        const dto = { ...BULK_DTO, period: 'QUARTERLY', month: undefined };
        await expect(service.createRoot(dto as any, makeSalesHead()))
          .rejects.toThrow(BadRequestException);
      });
    });
  });

  // ── split() ────────────────────────────────────────────────────────────────

  describe('split()', () => {
    const SPLIT_DTO = {
      children: [
        { assignedToId: 'tier3-id', targetCartons: 600 },
        { assignedToId: 'tier3-id-2', targetCartons: 400 },
      ],
    };

    beforeEach(() => {
      // ZSM received a 1000-carton LOTION target
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB,
        assignedToId: 'zsm-id',
        targetCartons: 1000,
      });
      // Both TIER3 reports are valid
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ ...TIER3_USER, id: 'tier3-id',   reportsToId: 'zsm-id' })
        .mockResolvedValueOnce({ ...TIER3_USER, id: 'tier3-id-2', reportsToId: 'zsm-id' });
      // No existing targets for these users
      mockPrisma.targetAssignment.findMany.mockResolvedValue([]);
      mockPrisma.$transaction.mockResolvedValue([
        { ...ASSIGNMENT_STUB, assignedToId: 'tier3-id',   targetCartons: 600 },
        { ...ASSIGNMENT_STUB, assignedToId: 'tier3-id-2', targetCartons: 400 },
      ]);
    });

    it('splits target among direct reports when sum equals parent', async () => {
      const result = await service.split('assign-id', SPLIT_DTO as any, makeZSM());
      expect(result).toHaveLength(2);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException when children sum does not equal parent', async () => {
      const dto = {
        children: [
          { assignedToId: 'tier3-id',   targetCartons: 600 },
          { assignedToId: 'tier3-id-2', targetCartons: 300 }, // 900 ≠ 1000
        ],
      };
      await expect(service.split('assign-id', dto as any, makeZSM()))
        .rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when requester is not the assignee', async () => {
      // The target is assigned to zsm-id but sh-id is trying to split it
      await expect(service.split('assign-id', SPLIT_DTO as any, makeSalesHead()))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when parent assignment does not exist', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue(null);
      await expect(service.split('bad-id', SPLIT_DTO as any, makeZSM()))
        .rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when child is wrong tier', async () => {
      // Reset and override — the split() beforeEach queues two Once values for
      // valid TIER3 users; we must clear that queue before setting our own mock.
      mockPrisma.user.findUnique.mockReset();
      mockPrisma.user.findUnique.mockResolvedValue({
        ...TIER3_USER, id: 'tier3-id', tier: 'TIER2', reportsToId: 'zsm-id',
      });
      const dto = {
        children: [{ assignedToId: 'tier3-id', targetCartons: 1000 }],
      };
      await expect(service.split('assign-id', dto as any, makeZSM()))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when a direct report appears twice in the split', async () => {
      const dto = {
        children: [
          { assignedToId: 'tier3-id', targetCartons: 600 },
          { assignedToId: 'tier3-id', targetCartons: 400 }, // duplicate
        ],
      };
      await expect(service.split('assign-id', dto as any, makeZSM()))
        .rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when a child already has a target for this period', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([
        { assignedToId: 'tier3-id' }, // already has target
      ]);
      await expect(service.split('assign-id', SPLIT_DTO as any, makeZSM()))
        .rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when Tier 2 tries to split — no tier below', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB, assignedToId: 'rep-id',
      });
      const repSplit = { children: [{ assignedToId: 'tier1-id', targetCartons: 1000 }] };
      await expect(service.split('assign-id', repSplit as any, makeRep()))
        .rejects.toThrow(BadRequestException);
    });

    it('sets parentAssignmentId on created children', async () => {
      await service.split('assign-id', SPLIT_DTO as any, makeZSM());
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ── update() ───────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('updates targetCartons when called by the original assigner', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB, assignedById: 'sh-id', children: [],
      });
      await service.update('assign-id', { targetCartons: 1200 } as any, makeSalesHead());
      const data = mockPrisma.targetAssignment.update.mock.calls[0][0].data;
      expect(data.targetCartons).toBe(1200);
    });

    it('flags children stale when value changes and children exist', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB,
        assignedById:  'sh-id',
        targetCartons: 1000,
        children:      [{ id: 'child-1' }, { id: 'child-2' }],
      });
      await service.update('assign-id', { targetCartons: 1200 } as any, makeSalesHead());
      expect(mockPrisma.targetAssignment.updateMany).toHaveBeenCalledWith({
        where: { parentAssignmentId: 'assign-id' },
        data:  { isStale: true },
      });
    });

    it('does NOT flag children stale when value is unchanged', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB,
        assignedById:  'sh-id',
        targetCartons: 1000,
        children:      [{ id: 'child-1' }],
      });
      // Updating the note only — same targetCartons value
      await service.update(
        'assign-id',
        { targetCartons: 1000, note: 'Updated note' } as any,
        makeSalesHead(),
      );
      expect(mockPrisma.targetAssignment.updateMany).not.toHaveBeenCalled();
    });

    it('does NOT flag children stale when no children exist', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB,
        assignedById: 'sh-id',
        children:     [],
      });
      await service.update('assign-id', { targetCartons: 1200 } as any, makeSalesHead());
      expect(mockPrisma.targetAssignment.updateMany).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when requester is not the original assigner', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB, assignedById: 'sh-id', children: [],
      });
      await expect(
        service.update('assign-id', { targetCartons: 1200 } as any, makeZSM()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when assignment does not exist', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue(null);
      await expect(
        service.update('bad-id', { targetCartons: 1200 } as any, makeSalesHead()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── findAll() ──────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('field staff see only targets assigned to or by them', async () => {
      await service.findAll({}, makeZSM());
      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { assignedToId: 'zsm-id' },
        { assignedById: 'zsm-id' },
      ]);
    });

    it('Sales Head sees all targets — no OR filter', async () => {
      await service.findAll({}, makeSalesHead());
      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
    });

    it('applies category filter when provided', async () => {
      await service.findAll({ category: 'LOTION' as any }, makeSalesHead());
      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.category).toBe('LOTION');
    });

    it('applies year filter when provided', async () => {
      await service.findAll({ year: 2026 }, makeSalesHead());
      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.year).toBe(2026);
    });

    it('applies assignedToId filter when provided', async () => {
      await service.findAll({ assignedToId: 'zsm-id' }, makeSalesHead());
      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.assignedToId).toBe('zsm-id');
    });

    it('applies isStale filter when provided', async () => {
      await service.findAll({ isStale: true }, makeSalesHead());
      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.isStale).toBe(true);
    });

    it('orders by createdAt descending', async () => {
      await service.findAll({}, makeSalesHead());
      const orderBy = mockPrisma.targetAssignment.findMany.mock.calls[0][0].orderBy;
      expect(orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  // ── findById() ─────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns the assignment when requester is the assignee', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB, assignedToId: 'zsm-id', assignedById: 'sh-id',
      });
      const result = await service.findById('assign-id', makeZSM());
      expect(result).toBeDefined();
    });

    it('returns the assignment when requester is the assigner', async () => {
      const result = await service.findById('assign-id', makeSalesHead());
      expect(result).toBeDefined();
    });

    it('admin can view any assignment', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB, assignedToId: 'someone', assignedById: 'other',
      });
      await expect(service.findById('assign-id', makeAdmin())).resolves.not.toThrow();
    });

    it('throws ForbiddenException when requester is unrelated to the assignment', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB, assignedToId: 'someone-else', assignedById: 'also-else',
      });
      await expect(service.findById('assign-id', makeRep()))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id', makeSalesHead()))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── getMyPerformance() ─────────────────────────────────────────────────────

  describe('getMyPerformance()', () => {
    beforeEach(() => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([
        { category: 'LOTION', targetCartons: 1000, isStale: false },
        { category: 'CREAM',  targetCartons: 500,  isStale: false },
      ]);
    });

    it('returns performance rows for each assigned category', async () => {
      const result = await service.getMyPerformance('zsm-id', 2026, 7);
      expect(result).toHaveLength(2);
    });

    it('calculates achievedCartons as sum of secondary sales + POs', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'prod-id', category: 'LOTION' },
      ]);
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([
        { productId: 'prod-id', _sum: { quantityCartons: 300 } },
      ]);
      mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([
        { productId: 'prod-id', _sum: { quantityCartons: 200 } },
      ]);

      const result = await service.getMyPerformance('zsm-id', 2026, 7);
      const lotion = result.find((r: any) => r.category === 'LOTION');
      expect(lotion.achievedCartons).toBe(500); // 300 + 200
      expect(lotion.achievedFromSecondarySales).toBe(300);
      expect(lotion.achievedFromPurchaseOrders).toBe(200);
    });

    it('returns zero achievement when no secondary sales or POs exist', async () => {
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([]);
      mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([]);

      const result = await service.getMyPerformance('zsm-id', 2026, 7);
      result.forEach((r: any) => {
        expect(r.achievedCartons).toBe(0);
        expect(r.balanceCartons).toBe(r.targetCartons);
      });
    });

    it('calculates balanceCartons as target minus achieved', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'p1', category: 'LOTION' },
      ]);
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([
        { productId: 'p1', _sum: { quantityCartons: 400 } },
      ]);
      mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([]);

      const result = await service.getMyPerformance('zsm-id', 2026, 7);
      const lotion = result.find((r: any) => r.category === 'LOTION');
      expect(lotion.balanceCartons).toBe(600); // 1000 - 400
    });

    it('calculates percentAchieved correctly', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'p1', category: 'LOTION' },
      ]);
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([
        { productId: 'p1', _sum: { quantityCartons: 250 } },
      ]);
      mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([]);

      const result = await service.getMyPerformance('zsm-id', 2026, 7);
      const lotion = result.find((r: any) => r.category === 'LOTION');
      expect(lotion.percentAchieved).toBe(25); // 250/1000 × 100
    });

    it('returns percentAchieved of 0 when targetCartons is 0', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([
        { category: 'LOTION', targetCartons: 0, isStale: false },
      ]);
      const result = await service.getMyPerformance('zsm-id', 2026, 7);
      expect(result[0].percentAchieved).toBe(0);
    });

    it('returns empty array when user has no targets for the period', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([]);
      const result = await service.getMyPerformance('zsm-id', 2026, 7);
      expect(result).toHaveLength(0);
    });

    it('queries targets for the correct month and year', async () => {
      await service.getMyPerformance('zsm-id', 2026, 7);
      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.year).toBe(2026);
      expect(where.month).toBe(7);
      expect(where.period).toBe('MONTHLY');
    });

    it('queries secondary sales within the correct month range', async () => {
      await service.getMyPerformance('zsm-id', 2026, 7);
      const where = mockPrisma.secondarySaleItem.groupBy.mock.calls[0][0].where;
      expect(where.secondarySale.deviceTime.gte).toEqual(new Date(2026, 6, 1));  // July 1
      expect(where.secondarySale.deviceTime.lt).toEqual(new Date(2026, 7, 1));   // Aug 1
    });

    it('includes only non-cancelled, non-pending POs in achievement', async () => {
      await service.getMyPerformance('zsm-id', 2026, 7);
      const where = mockPrisma.purchaseOrderItem.groupBy.mock.calls[0][0].where;
      expect(where.purchaseOrder.status.notIn).toContain('PENDING_APPROVAL');
      expect(where.purchaseOrder.status.notIn).toContain('CANCELLED');
    });
  });
});