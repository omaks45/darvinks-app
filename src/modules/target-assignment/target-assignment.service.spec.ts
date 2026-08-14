// src/modules/target-assignments/target-assignment.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TargetAssignmentService } from './target-assignment.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { PushNotificationService } from '@modules/notifications/push-notification.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  user:             { findUnique: jest.fn() },
  targetAssignment: {
    create:     jest.fn(),
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    update:     jest.fn(),
    updateMany: jest.fn(),
  },
  secondarySaleItem:   { groupBy: jest.fn() },
  purchaseOrderItem:   { groupBy: jest.fn() },
  product:             { findMany: jest.fn() },
  $transaction:        jest.fn(),
};

const mockPush = { notifyTargetAssigned: jest.fn(), notifyTargetStale: jest.fn() };

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Sales Head (assigner of root targets)
function makeSalesHead(): JwtPayload {
  return { sub: 'sh-id', email: 'sh@test.com', tier: 'TIER5_SALES_HEAD', team: 'RADIANT' } as JwtPayload;
}

// Tier 4 ZSM (receives root targets, splits to Tier 3)
function makeTier4(): JwtPayload {
  return { sub: 'tier4-id', email: 'zsm@test.com', tier: 'TIER4', team: 'RADIANT' } as JwtPayload;
}

// Tier 3 (receives split targets, splits to Tier 2)
function makeTier3(): JwtPayload {
  return { sub: 'tier3-id', email: 'tsm@test.com', tier: 'TIER3', team: 'RADIANT' } as JwtPayload;
}

// Tier 2 (receives leaf targets)
function makeTier2(): JwtPayload {
  return { sub: 'tier2-id', email: 'rep@test.com', tier: 'TIER2', team: 'RADIANT' } as JwtPayload;
}

function makeAdmin(): JwtPayload {
  return { sub: 'admin-id', email: 'admin@test.com', tier: 'TIER5_SYSTEM_ADMIN', team: 'RADIANT' } as JwtPayload;
}

const TIER4_USER = {
  id:          'tier4-id',
  fullName:    'Emeka ZSM',
  tier:        'TIER4',
  team:        'RADIANT',
  isActive:    true,
  reportsToId: 'sh-id',
};

const TIER3_USER = {
  id:          'tier3-id',
  fullName:    'Chidinma TSM',
  tier:        'TIER3',
  team:        'RADIANT',
  isActive:    true,
  reportsToId: 'tier4-id',
};

const TIER2_USER = {
  id:          'tier2-id',
  fullName:    'Kenny Rep',
  tier:        'TIER2',
  team:        'RADIANT',
  isActive:    true,
  reportsToId: 'tier3-id',
};

const ASSIGNMENT_STUB = {
  id:                 'assign-id',
  assignedById:       'sh-id',
  assignedToId:       'tier4-id',
  category:           'LOTION',
  period:             'MONTHLY',
  year:               2026,
  month:              8,
  quarter:            null,
  week:               null,
  targetCartons:      1000,
  achievedCartons:    0,
  isStale:            false,
  parentAssignmentId: null,
  note:               null,
  createdAt:          new Date(),
  updatedAt:          new Date(),
  assignedTo:         { fullName: 'Emeka ZSM', tier: 'TIER4' },
  assignedBy:         { fullName: 'Sales Head' },
  children:           [],
};

const ROOT_DTO = {
  assignedToId: 'tier4-id',
  period:       'MONTHLY',
  year:         2026,
  month:        8,
  categories: [
    { category: 'LOTION', targetCartons: 1000 },
    { category: 'CREAM',  targetCartons: 500  },
  ],
};

const SPLIT_DTO = {
  children: [
    { assignedToId: 'child-1', targetCartons: 600, note: null },
    { assignedToId: 'child-2', targetCartons: 400, note: null },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TargetAssignmentService', () => {
  let service: TargetAssignmentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TargetAssignmentService,
        { provide: PrismaService,           useValue: mockPrisma },
        { provide: PushNotificationService, useValue: mockPush },
      ],
    }).compile();

    service = module.get<TargetAssignmentService>(TargetAssignmentService);
    jest.resetAllMocks();

    mockPrisma.user.findUnique.mockResolvedValue(TIER4_USER);
    mockPrisma.targetAssignment.create.mockResolvedValue(ASSIGNMENT_STUB);
    mockPrisma.targetAssignment.findUnique.mockResolvedValue(ASSIGNMENT_STUB);
    mockPrisma.targetAssignment.findMany.mockResolvedValue([ASSIGNMENT_STUB]);
    mockPrisma.targetAssignment.update.mockResolvedValue(ASSIGNMENT_STUB);
    mockPrisma.targetAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([]);
    mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([]);
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));
    mockPush.notifyTargetAssigned.mockResolvedValue(undefined);
    mockPush.notifyTargetStale.mockResolvedValue(undefined);
  });

  // ── createRoot() ───────────────────────────────────────────────────────────

  describe('createRoot()', () => {
    describe('access control', () => {
      it('Sales Head can create root targets', async () => {
        await expect(service.createRoot(ROOT_DTO as any, makeSalesHead())).resolves.not.toThrow();
      });

      it('throws ForbiddenException for System Admin', async () => {
        await expect(service.createRoot(ROOT_DTO as any, makeAdmin()))
          .rejects.toThrow(ForbiddenException);
      });

      it('throws ForbiddenException for Tier 4', async () => {
        await expect(service.createRoot(ROOT_DTO as any, makeTier4()))
          .rejects.toThrow(ForbiddenException);
      });

      it('throws ForbiddenException for Tier 2', async () => {
        await expect(service.createRoot(ROOT_DTO as any, makeTier2()))
          .rejects.toThrow(ForbiddenException);
      });
    });

    describe('assignee validation', () => {
      it('throws BadRequestException when assigning to a non-Tier4 user', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(TIER3_USER); // Tier 3, not Tier 4
        await expect(service.createRoot(ROOT_DTO as any, makeSalesHead()))
          .rejects.toThrow(BadRequestException);
      });

      it('throws NotFoundException when assignee does not exist', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);
        await expect(service.createRoot(ROOT_DTO as any, makeSalesHead()))
          .rejects.toThrow(NotFoundException);
      });
    });

    describe('category validation', () => {
      it('throws BadRequestException when duplicate categories in same request', async () => {
        const dto = {
          ...ROOT_DTO,
          categories: [
            { category: 'LOTION', targetCartons: 600 },
            { category: 'LOTION', targetCartons: 400 }, // duplicate
          ],
        };
        await expect(service.createRoot(dto as any, makeSalesHead()))
          .rejects.toThrow(BadRequestException);
      });

      it('creates one assignment per category', async () => {
        // Transaction called with array of creates — one per category
        await service.createRoot(ROOT_DTO as any, makeSalesHead());
        const transactionArg = mockPrisma.$transaction.mock.calls[0][0];
        expect(transactionArg).toHaveLength(2); // LOTION + CREAM
      });
    });

    describe('period validation', () => {
      it('creates MONTHLY targets with year and month', async () => {
        await service.createRoot(ROOT_DTO as any, makeSalesHead());
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      });

      it('throws BadRequestException when MONTHLY target has no month', async () => {
        const dto = { ...ROOT_DTO, month: undefined };
        await expect(service.createRoot(dto as any, makeSalesHead()))
          .rejects.toThrow(BadRequestException);
      });
    });

    describe('push notification', () => {
      it('sends a push notification to the assigned ZSM after creation', async () => {
        await service.createRoot(ROOT_DTO as any, makeSalesHead());
        await new Promise((r) => setTimeout(r, 0));
        expect(mockPush.notifyTargetAssigned).toHaveBeenCalledWith(
          expect.objectContaining({ assignedToId: 'tier4-id' }),
        );
      });

      it('includes all category names in the push notification', async () => {
        await service.createRoot(ROOT_DTO as any, makeSalesHead());
        await new Promise((r) => setTimeout(r, 0));
        const call = mockPush.notifyTargetAssigned.mock.calls[0][0];
        expect(call.categories).toEqual(expect.arrayContaining(['LOTION', 'CREAM']));
      });
    });
  });

  // ── split() ────────────────────────────────────────────────────────────────

  describe('split()', () => {
    const PARENT = {
      ...ASSIGNMENT_STUB,
      assignedToId:  'tier4-id', // this is who received it — they split it
      targetCartons: 1000,
    };

    beforeEach(() => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue(PARENT);
      mockPrisma.targetAssignment.findMany.mockResolvedValue([]); // no existing children
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ ...TIER3_USER, id: 'child-1', reportsToId: 'tier4-id', isActive: true })
        .mockResolvedValueOnce({ ...TIER3_USER, id: 'child-2', reportsToId: 'tier4-id', isActive: true });
    });

    describe('access control', () => {
      it('the recipient of the target can split it', async () => {
        await expect(service.split('assign-id', SPLIT_DTO as any, makeTier4()))
          .resolves.not.toThrow();
      });

      it('throws ForbiddenException when non-recipient tries to split', async () => {
        // tier3-id is trying to split a target assigned to tier4-id
        await expect(service.split('assign-id', SPLIT_DTO as any, makeTier3()))
          .rejects.toThrow(ForbiddenException);
      });
    });

    describe('sum invariant — MUST equal parent exactly', () => {
      it('accepts split that sums exactly to parent target', async () => {
        // 600 + 400 = 1000 ✓
        await expect(service.split('assign-id', SPLIT_DTO as any, makeTier4()))
          .resolves.not.toThrow();
      });

      it('throws BadRequestException when split sum is less than parent', async () => {
        const dto = {
          children: [
            { assignedToId: 'child-1', targetCartons: 400 },
            { assignedToId: 'child-2', targetCartons: 400 }, // 800 ≠ 1000
          ],
        };
        await expect(service.split('assign-id', dto as any, makeTier4()))
          .rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when split sum exceeds parent', async () => {
        const dto = {
          children: [
            { assignedToId: 'child-1', targetCartons: 700 },
            { assignedToId: 'child-2', targetCartons: 700 }, // 1400 ≠ 1000
          ],
        };
        await expect(service.split('assign-id', dto as any, makeTier4()))
          .rejects.toThrow(BadRequestException);
      });
    });

    describe('duplicate children', () => {
      it('throws BadRequestException when same direct report appears twice', async () => {
        const dto = {
          children: [
            { assignedToId: 'child-1', targetCartons: 500 },
            { assignedToId: 'child-1', targetCartons: 500 }, // duplicate
          ],
        };
        await expect(service.split('assign-id', dto as any, makeTier4()))
          .rejects.toThrow(BadRequestException);
      });
    });

    describe('existing target conflict', () => {
      it('throws ConflictException when a child already has a target for this period', async () => {
        mockPrisma.targetAssignment.findMany.mockResolvedValue([
          { assignedToId: 'child-1' }, // already has a target
        ]);
        await expect(service.split('assign-id', SPLIT_DTO as any, makeTier4()))
          .rejects.toThrow(ConflictException);
      });
    });

    describe('tier validation', () => {
      it('throws BadRequestException when assigning to wrong tier', async () => {
        // Tier4 splitting to Tier2 (should only split to Tier3)
        mockPrisma.user.findUnique
          .mockResolvedValueOnce({ ...TIER2_USER, id: 'child-1', reportsToId: 'tier4-id', isActive: true })
          .mockResolvedValueOnce({ ...TIER2_USER, id: 'child-2', reportsToId: 'tier4-id', isActive: true });
        await expect(service.split('assign-id', SPLIT_DTO as any, makeTier4()))
          .rejects.toThrow(BadRequestException);
      });
    });

    describe('NotFoundException', () => {
      it('throws when parent assignment does not exist', async () => {
        mockPrisma.targetAssignment.findUnique.mockResolvedValue(null);
        await expect(service.split('bad-id', SPLIT_DTO as any, makeTier4()))
          .rejects.toThrow(NotFoundException);
      });
    });
  });

  // ── update() ───────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('the original assigner can update a target', async () => {
      // assignedById === sh-id, requester is Sales Head
      await expect(
        service.update('assign-id', { targetCartons: 1200 } as any, makeSalesHead()),
      ).resolves.not.toThrow();
    });

    it('throws ForbiddenException when non-assigner tries to update', async () => {
      // Tier4 did not assign the target, Sales Head did
      await expect(
        service.update('assign-id', { targetCartons: 1200 } as any, makeTier4()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('flags children as stale when value changes and children exist', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB,
        assignedById: 'sh-id',
        targetCartons: 1000,
        children: [{ id: 'child-assign-1' }, { id: 'child-assign-2' }],
      });
      await service.update('assign-id', { targetCartons: 1200 } as any, makeSalesHead());
      expect(mockPrisma.targetAssignment.updateMany).toHaveBeenCalledWith({
        where: { parentAssignmentId: 'assign-id' },
        data:  { isStale: true },
      });
    });

    it('does NOT flag children stale when value does not change', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB,
        assignedById: 'sh-id',
        targetCartons: 1000, // same value
        children: [{ id: 'child-assign-1' }],
      });
      await service.update('assign-id', { targetCartons: 1000 } as any, makeSalesHead());
      expect(mockPrisma.targetAssignment.updateMany).not.toHaveBeenCalled();
    });

    it('does NOT flag children stale when target has no children', async () => {
      // children: [] — no children
      await service.update('assign-id', { targetCartons: 1200 } as any, makeSalesHead());
      expect(mockPrisma.targetAssignment.updateMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for unknown assignment', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue(null);
      await expect(
        service.update('bad-id', { targetCartons: 1200 } as any, makeSalesHead()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── findAll() ──────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('field agents see targets assigned TO or BY them', async () => {
      await service.findAll({} as any, makeTier2());
      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { assignedToId: 'tier2-id' },
          { assignedById: 'tier2-id' },
        ]),
      );
    });

    it('Sales Head sees all assignments — no OR filter', async () => {
      await service.findAll({} as any, makeSalesHead());
      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
    });

    it('Admin sees all assignments', async () => {
      await service.findAll({} as any, makeAdmin());
      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
    });

    it('applies category filter when provided', async () => {
      await service.findAll({ category: 'LOTION' } as any, makeSalesHead());
      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.category).toBe('LOTION');
    });

    it('applies year filter when provided', async () => {
      await service.findAll({ year: 2026 } as any, makeSalesHead());
      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.year).toBe(2026);
    });

    it('applies isStale filter when provided', async () => {
      await service.findAll({ isStale: true } as any, makeSalesHead());
      const where = mockPrisma.targetAssignment.findMany.mock.calls[0][0].where;
      expect(where.isStale).toBe(true);
    });
  });

  // ── findById() ─────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns assignment when requester is the assignee', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB, assignedToId: 'tier4-id', assignedById: 'sh-id',
      });
      await expect(service.findById('assign-id', makeTier4())).resolves.not.toThrow();
    });

    it('returns assignment when requester is the assigner', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB, assignedToId: 'tier4-id', assignedById: 'sh-id',
      });
      await expect(service.findById('assign-id', makeSalesHead())).resolves.not.toThrow();
    });

    it('Admin can view any assignment', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB, assignedToId: 'someone', assignedById: 'someone-else',
      });
      await expect(service.findById('assign-id', makeAdmin())).resolves.not.toThrow();
    });

    it('throws ForbiddenException when unrelated agent views the assignment', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue({
        ...ASSIGNMENT_STUB, assignedToId: 'other-user', assignedById: 'another-user',
      });
      await expect(service.findById('assign-id', makeTier2()))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for unknown assignment', async () => {
      mockPrisma.targetAssignment.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id', makeSalesHead()))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── getMyPerformance() ─────────────────────────────────────────────────────

  describe('getMyPerformance()', () => {
    const TARGET = {
      category:      'LOTION',
      targetCartons: 1000,
      isStale:       false,
    };

    beforeEach(() => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([TARGET]);
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([
        { productId: 'prod-a', _sum: { quantityCartons: 250 } },
      ]);
      mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([
        { productId: 'prod-a', _sum: { quantityCartons: 150 } },
      ]);
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'prod-a', category: 'LOTION' },
      ]);
    });

    it('combines secondary sales and PO achievements', async () => {
      const result = await service.getMyPerformance('agent-id', 2026, 8) as any[];
      expect(result[0].achievedCartons).toBe(400); // 250 + 150
    });

    it('calculates correct balance cartons', async () => {
      const result = await service.getMyPerformance('agent-id', 2026, 8) as any[];
      expect(result[0].balanceCartons).toBe(600); // 1000 - 400
    });

    it('calculates correct percentage achieved', async () => {
      const result = await service.getMyPerformance('agent-id', 2026, 8) as any[];
      expect(result[0].percentAchieved).toBe(40); // 400/1000 × 100
    });

    it('returns isStale flag from the target', async () => {
      const result = await service.getMyPerformance('agent-id', 2026, 8) as any[];
      expect(result[0].isStale).toBe(false);
    });

    it('returns isStale: true when target is stale', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([{ ...TARGET, isStale: true }]);
      const result = await service.getMyPerformance('agent-id', 2026, 8) as any[];
      expect(result[0].isStale).toBe(true);
    });

    it('returns achievedCartons: 0 when no sales or POs exist', async () => {
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([]);
      mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([]);
      const result = await service.getMyPerformance('agent-id', 2026, 8) as any[];
      expect(result[0].achievedCartons).toBe(0);
      expect(result[0].balanceCartons).toBe(1000);
      expect(result[0].percentAchieved).toBe(0);
    });

    it('returns empty array when no targets assigned for the month', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([]);
      const result = await service.getMyPerformance('agent-id', 2026, 8);
      expect(result).toHaveLength(0);
    });

    it('correctly attributes secondary sales to the right category', async () => {
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([
        { productId: 'prod-lotion', _sum: { quantityCartons: 200 } },
        { productId: 'prod-cream',  _sum: { quantityCartons: 100 } },
      ]);
      mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([]);
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'prod-lotion', category: 'LOTION' },
        { id: 'prod-cream',  category: 'CREAM'  },
      ]);
      mockPrisma.targetAssignment.findMany.mockResolvedValue([
        { category: 'LOTION', targetCartons: 1000, isStale: false },
        { category: 'CREAM',  targetCartons: 500,  isStale: false },
      ]);

      const result = await service.getMyPerformance('agent-id', 2026, 8) as any[];
      const lotion = result.find((r) => r.category === 'LOTION');
      const cream  = result.find((r) => r.category === 'CREAM');
      expect(lotion?.achievedCartons).toBe(200);
      expect(cream?.achievedCartons).toBe(100);
    });
  });
});