// src/modules/collections/collection.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CollectionService } from './collections.service';
import { PrismaService }     from '@common/prisma/prisma.service';
import type { JwtPayload }   from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  collection: {
    create:      jest.fn(),
    findMany:    jest.fn(),
    findUnique:  jest.fn(),
    aggregate:   jest.fn(),
  },
  customer:   { findUnique: jest.fn(), update: jest.fn() },
  user:       { findMany: jest.fn() },
  $transaction: jest.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COLLECTION_STUB = {
  id:           'coll-id',
  amountKobo:   BigInt(50000000),
  paymentMode:  'CASH',
  collectedAt:  new Date(),
  recordedById: 'agent-id',
  customerId:   'cust-id',
  recordedBy:   { fullName: 'Kenny Solape', tier: 'TIER2' },
  customer:     { businessName: 'Ore Ofe Distributors', region: 'SOUTH_WEST' },
};

const CREATE_DTO = {
  amountKobo:  50000000,
  paymentMode: 'CASH',
  customerId:  'cust-id',
  collectedAt: new Date().toISOString(),
};

function makeAgent(tier = 'TIER2', sub = 'agent-id'): JwtPayload {
  return { sub, email: 'a@t.com', tier, team: 'RADIANT', region: 'SOUTH_WEST' } as JwtPayload;
}
function makeAdmin(): JwtPayload {
  return { sub: 'admin-id', email: 'admin@t.com', tier: 'TIER5_SALES_SUPPORT', team: 'RADIANT' } as JwtPayload;
}
function makeFieldSupport(): JwtPayload {
  return { sub: 'fs-id', email: 'fs@t.com', tier: 'TIER5_FIELD_SUPPORT', team: 'RADIANT' } as JwtPayload;
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

    // Customer must have isActive:true and businessName for create() to pass
    mockPrisma.customer.findUnique.mockResolvedValue({
      id:           'cust-id',
      isActive:     true,
      businessName: 'Ore Ofe Distributors',
      balanceKobo:  BigInt(0),
      region:       'SOUTH_WEST',
      ownerId:      'agent-id',
    });
    mockPrisma.collection.create.mockResolvedValue(COLLECTION_STUB);
    mockPrisma.collection.findMany.mockResolvedValue([COLLECTION_STUB]);
    mockPrisma.collection.findUnique.mockResolvedValue(COLLECTION_STUB);
    mockPrisma.collection.aggregate.mockResolvedValue({ _sum: { amountKobo: BigInt(50000000) } });
    // create() wraps in $transaction — return [collection, updatedCustomer]
    mockPrisma.$transaction.mockResolvedValue([COLLECTION_STUB, { balanceKobo: BigInt(0) }]);
    mockPrisma.customer.update.mockResolvedValue({ balanceKobo: BigInt(0) });
    mockPrisma.user.findMany.mockResolvedValue([]);
  });

  // ── create() ───────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates a collection and returns it', async () => {
      const result = await service.create(CREATE_DTO as any, makeAgent());
      expect(mockPrisma.collection.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual(COLLECTION_STUB);
    });

    it('sets recordedById to the requester sub', async () => {
      await service.create(CREATE_DTO as any, makeAgent());
      const data = mockPrisma.collection.create.mock.calls[0][0].data;
      expect(data.recordedById).toBe('agent-id');
    });
  });

  // ── findAll() — ownership scoping (THE CORE RULE) ──────────────────────────

  describe('findAll() — ownership scoping', () => {

    describe('Tier 1 — own collections only', () => {
      it('applies ownerId filter with their sub', async () => {
        await service.findAll({} as any, makeAgent('TIER1', 'tier1-id'));
        const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
        expect(where.recordedById).toEqual({ in: ['tier1-id'] });
      });

      it('does NOT show other agents collections', async () => {
        await service.findAll({} as any, makeAgent('TIER1', 'agent-a'));
        const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
        expect(where.recordedById.in).not.toContain('agent-b');
      });
    });

    describe('Tier 2 — own + reporting chain', () => {
      it('includes own sub and all users in chain', async () => {
        // BFS returns tier2 + their direct reports
        mockPrisma.user.findMany
          .mockResolvedValueOnce([{ id: 'tier1-a' }, { id: 'tier1-b' }]) // direct reports
          .mockResolvedValueOnce([])                                        // no further reports
          .mockResolvedValueOnce([]);

        await service.findAll({} as any, makeAgent('TIER2', 'tier2-id'));
        const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
        expect(where.recordedById.in).toContain('tier2-id');
        expect(where.recordedById.in).toContain('tier1-a');
        expect(where.recordedById.in).toContain('tier1-b');
      });

      it('does not include agents outside the chain', async () => {
        mockPrisma.user.findMany.mockResolvedValue([]);
        await service.findAll({} as any, makeAgent('TIER2', 'tier2-id'));
        const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
        expect(where.recordedById.in).not.toContain('unrelated-agent');
      });
    });

    describe('Tier 3 — own + full downward chain (Tier 2 + Tier 1)', () => {
      it('walks two levels down the chain', async () => {
        mockPrisma.user.findMany
          .mockResolvedValueOnce([{ id: 'tier2-a' }]) // tier3 direct reports (tier2)
          .mockResolvedValueOnce([{ id: 'tier1-a' }]) // tier2-a's reports (tier1)
          .mockResolvedValueOnce([]);                  // tier1 has no reports

        await service.findAll({} as any, makeAgent('TIER3', 'tier3-id'));
        const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
        expect(where.recordedById.in).toContain('tier3-id');
        expect(where.recordedById.in).toContain('tier2-a');
        expect(where.recordedById.in).toContain('tier1-a');
      });
    });

    describe('Tier 4 — own + full chain (Tier 3 + Tier 2 + Tier 1)', () => {
      it('walks the full three-level chain', async () => {
        mockPrisma.user.findMany
          .mockResolvedValueOnce([{ id: 'tier3-a' }])
          .mockResolvedValueOnce([{ id: 'tier2-a' }])
          .mockResolvedValueOnce([{ id: 'tier1-a' }])
          .mockResolvedValueOnce([]);

        await service.findAll({} as any, makeAgent('TIER4', 'tier4-id'));
        const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
        expect(where.recordedById.in).toContain('tier4-id');
        expect(where.recordedById.in).toContain('tier3-a');
        expect(where.recordedById.in).toContain('tier2-a');
        expect(where.recordedById.in).toContain('tier1-a');
      });
    });

    describe('Admin tiers — see all collections', () => {
      it('Sales Support Agent sees all — no recordedById filter', async () => {
        await service.findAll({} as any, makeAdmin());
        const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
        expect(where.recordedById).toBeUndefined();
      });

      it('Field Support Agent sees all — no recordedById filter', async () => {
        await service.findAll({} as any, makeFieldSupport());
        const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
        expect(where.recordedById).toBeUndefined();
      });
    });

    describe('filters', () => {
      it('applies customerId filter', async () => {
        await service.findAll({ customerId: 'cust-id' } as any, makeAdmin());
        const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
        expect(where.customerId).toBe('cust-id');
      });

      it('applies paymentMode filter', async () => {
        await service.findAll({ paymentMode: 'TRANSFER' } as any, makeAdmin());
        const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
        expect(where.paymentMode).toBe('TRANSFER');
      });

      it('applies date range filter', async () => {
        await service.findAll({ from: '2026-08-01', to: '2026-08-31' } as any, makeAdmin());
        const where = mockPrisma.collection.findMany.mock.calls[0][0].where;
        expect(where.collectedAt).toBeDefined();
      });
    });
  });

  // ── findById() ─────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns the collection when requester is the recorder', async () => {
      await expect(service.findById('coll-id', makeAgent())).resolves.not.toThrow();
    });

    it('throws ForbiddenException when non-owner tries to access', async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...COLLECTION_STUB,
        recordedById: 'someone-else',
      });
      await expect(service.findById('coll-id', makeAgent('TIER2', 'not-the-owner')))
        .rejects.toThrow(ForbiddenException);
    });

    it('admin can access any collection', async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...COLLECTION_STUB,
        recordedById: 'someone-else',
      });
      await expect(service.findById('coll-id', makeAdmin())).resolves.not.toThrow();
    });

    it('throws NotFoundException when collection does not exist', async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id', makeAgent()))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── getChainUserIds() — BFS chain walk ─────────────────────────────────────

  describe('getChainUserIds() — BFS chain walk', () => {
    it('includes the manager themselves', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      const ids = await (service as any).getChainUserIds('manager-id');
      expect(ids).toContain('manager-id');
    });

    it('includes one level of direct reports', async () => {
      mockPrisma.user.findMany
        .mockResolvedValueOnce([{ id: 'report-1' }, { id: 'report-2' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const ids = await (service as any).getChainUserIds('manager-id');
      expect(ids).toContain('report-1');
      expect(ids).toContain('report-2');
    });

    it('handles cycles gracefully — never visits the same user twice', async () => {
      // report-1 somehow points back to manager
      mockPrisma.user.findMany
        .mockResolvedValueOnce([{ id: 'report-1' }])
        .mockResolvedValueOnce([{ id: 'manager-id' }]) // cycle
        .mockResolvedValueOnce([]);
      const ids = await (service as any).getChainUserIds('manager-id');
      // manager-id should appear only once
      expect(ids.filter((id: string) => id === 'manager-id').length).toBe(1);
    });

    it('returns only the manager when they have no direct reports', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      const ids = await (service as any).getChainUserIds('solo-manager');
      expect(ids).toEqual(['solo-manager']);
    });
  });
});