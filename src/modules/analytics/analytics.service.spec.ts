
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException }  from '@nestjs/common';
import { AnalyticsService }    from './analytics.service';
import { PrismaService }       from '@common/prisma/prisma.service';

// ─── Mock ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  collection:           { aggregate: jest.fn() },
  secondarySaleInvoice: { aggregate: jest.fn(), findMany: jest.fn() },
  purchaseOrder:        { findMany: jest.fn() },
  customer:             { count: jest.fn() },
  targetAssignment:     { findMany: jest.fn(), count: jest.fn() },
  user:                 { findMany: jest.fn() },
  product:              { findMany: jest.fn() },
  attendanceEvent:      { count: jest.fn(), findMany: jest.fn() },
  secondarySaleItem:    { groupBy: jest.fn(), findMany: jest.fn() },
  purchaseOrderItem:    { groupBy: jest.fn(), findMany: jest.fn() },
  location:             { findMany: jest.fn() },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeAgent   = (tier = 'TIER2', sub = 'agent-id') => ({ sub, tier });
const makeManager = (sub = 'mgr-id') => ({ sub, tier: 'TIER3' });

function setupDefaults() {
  mockPrisma.collection.aggregate.mockResolvedValue({ _sum: { amountKobo: BigInt(0) } });
  mockPrisma.secondarySaleInvoice.aggregate.mockResolvedValue({ _sum: { totalKobo: BigInt(0) }, _count: { id: 0 } });
  mockPrisma.secondarySaleInvoice.findMany.mockResolvedValue([]);
  mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
  mockPrisma.customer.count.mockResolvedValue(0);
  mockPrisma.targetAssignment.findMany.mockResolvedValue([]);
  mockPrisma.targetAssignment.count.mockResolvedValue(0);
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.product.findMany.mockResolvedValue([]);
  mockPrisma.attendanceEvent.count.mockResolvedValue(0);
  mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);
  mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([]);
  mockPrisma.secondarySaleItem.findMany.mockResolvedValue([]);
  mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([]);
  mockPrisma.purchaseOrderItem.findMany.mockResolvedValue([]);
  mockPrisma.location.findMany.mockResolvedValue([]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<AnalyticsService>(AnalyticsService);
    jest.resetAllMocks();
    setupDefaults();
  });

  // ── getPersonalAnalytics — shape ───────────────────────────────────────────

  describe('getPersonalAnalytics()', () => {
    it('returns period and periodType', async () => {
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      expect(r.period).toBe('2026-08');
      expect(r.periodType).toBe('monthly');
    });

    it('has totalAmountReceivedKobo field', async () => {
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      expect(r).toHaveProperty('totalAmountReceivedKobo');
    });

    it('has totalSalesKobo field', async () => {
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      expect(r).toHaveProperty('totalSalesKobo');
    });

    it('has totalSKUSold field', async () => {
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      expect(r).toHaveProperty('totalSKUSold');
    });

    it('newSecondaryCustomers reflects customer.count result', async () => {
      mockPrisma.customer.count.mockResolvedValueOnce(3);
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      expect(r.newSecondaryCustomers).toBe(3);
    });

    it('customers has primary, secondary, total', async () => {
      mockPrisma.customer.count
        .mockResolvedValueOnce(5)   // new secondary
        .mockResolvedValueOnce(10)  // primary
        .mockResolvedValueOnce(20); // secondary
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      expect(r.customers.primary).toBe(10);
      expect(r.customers.secondary).toBe(20);
      expect(r.customers.total).toBe(30);
    });

    it('salesOverview has 7 entries labelled Sun–Sat', async () => {
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      expect(r.salesOverview).toHaveLength(7);
      expect(r.salesOverview.map((d: any) => d.day))
        .toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    });

    it('productBreakdown is an array', async () => {
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      expect(Array.isArray(r.productBreakdown)).toBe(true);
    });

    it('targetSummary is an array', async () => {
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      expect(Array.isArray(r.targetSummary)).toBe(true);
    });

    it('userIds contains requester sub when no targetUserId', async () => {
      const r = await service.getPersonalAnalytics(makeAgent('TIER2', 'my-id'), '2026-08', 'monthly') as any;
      expect(r.userIds).toContain('my-id');
    });
  });

  // ── calculations ───────────────────────────────────────────────────────────

  describe('getPersonalAnalytics() — calculations', () => {
    it('totalAmountReceived = collections + invoice total', async () => {
      mockPrisma.collection.aggregate.mockResolvedValue({ _sum: { amountKobo: BigInt(500000000) } });
      mockPrisma.secondarySaleInvoice.aggregate.mockResolvedValue({
        _sum: { totalKobo: BigInt(300000000) }, _count: { id: 2 },
      });
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      expect(r.totalAmountReceivedKobo).toBe(800000000);
    });

    it('totalSKUSold = secondary cartons + PO cartons', async () => {
      // aggregate must show count > 0 so the service includes secondary items
      mockPrisma.secondarySaleInvoice.aggregate.mockResolvedValue({
        _sum:   { totalKobo: BigInt(0) },
        _count: { id: 1 },
      });
      mockPrisma.secondarySaleInvoice.findMany.mockResolvedValue([{
        id: 'inv-1', totalKobo: BigInt(0),
        items: [{ productId: 'p1', quantityCartons: 30, lineTotalKobo: BigInt(0), createdAt: new Date() }],
      }]);
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([{
        totalKobo: BigInt(0),
        items: [{ productId: 'p2', quantityCartons: 20, lineTotalKobo: BigInt(0) }],
      }]);
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      expect(r.totalSKUSold).toBe(50); // 30 secondary + 20 PO
    });

    it('productBreakdown resolves product name from DB', async () => {
      mockPrisma.secondarySaleInvoice.aggregate.mockResolvedValue({
        _sum: { totalKobo: BigInt(0) }, _count: { id: 1 },
      });
      mockPrisma.secondarySaleInvoice.findMany.mockResolvedValue([{
        id: 'inv-1', totalKobo: BigInt(0),
        items: [{ productId: 'prod-a', quantityCartons: 50, lineTotalKobo: BigInt(0), createdAt: new Date() }],
      }]);
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'prod-a', name: 'Acneway Cream 30g', category: 'CREAM', imageUrl: null },
      ]);
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      expect(r.productBreakdown[0].name).toBe('Acneway Cream 30g');
      expect(r.productBreakdown[0].cartonsSOld).toBe(50);
      expect(r.productBreakdown[0].percentOfTotal).toBe(100);
    });

    it('productBreakdown percentages are correct across multiple products', async () => {
      mockPrisma.secondarySaleInvoice.aggregate.mockResolvedValue({
        _sum: { totalKobo: BigInt(0) }, _count: { id: 1 },
      });
      mockPrisma.secondarySaleInvoice.findMany.mockResolvedValue([{
        id: 'inv-1', totalKobo: BigInt(0),
        items: [
          { productId: 'p1', quantityCartons: 75, lineTotalKobo: BigInt(0), createdAt: new Date() },
          { productId: 'p2', quantityCartons: 25, lineTotalKobo: BigInt(0), createdAt: new Date() },
        ],
      }]);
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'p1', name: 'Product A', category: 'CREAM',  imageUrl: null },
        { id: 'p2', name: 'Product B', category: 'LOTION', imageUrl: null },
      ]);
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      expect(r.productBreakdown.find((p: any) => p.productId === 'p1').percentOfTotal).toBe(75);
      expect(r.productBreakdown.find((p: any) => p.productId === 'p2').percentOfTotal).toBe(25);
    });

    it('daily bar chart buckets Monday sales into Mon slot', async () => {
      const monday = new Date('2026-08-17T10:00:00Z');
      mockPrisma.secondarySaleInvoice.findMany.mockResolvedValue([{
        createdAt: monday,
        items: [{ lineTotalKobo: BigInt(100000000) }],
      }]);
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      expect(r.salesOverview.find((d: any) => d.day === 'Mon').totalKobo).toBe(100000000);
    });

    it('targetSummary has category, targetCartons, achievedCartons, balanceCartons, percentAchieved', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([
        { category: 'LOTION', targetCartons: 1000, assignedToId: 'agent-id' },
      ]);
      const r = await service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly') as any;
      const t = r.targetSummary.find((t: any) => t.category === 'LOTION');
      expect(t).toBeDefined();
      expect(t.targetCartons).toBe(1000);
      expect(t).toHaveProperty('achievedCartons');
      expect(t).toHaveProperty('balanceCartons');
      expect(t).toHaveProperty('percentAchieved');
    });
  });

  // ── period types ───────────────────────────────────────────────────────────

  describe('getPersonalAnalytics() — period types', () => {
    it('accepts weekly', async () => {
      await expect(service.getPersonalAnalytics(makeAgent(), '2026-W35', 'weekly')).resolves.not.toThrow();
    });
    it('accepts monthly', async () => {
      await expect(service.getPersonalAnalytics(makeAgent(), '2026-08', 'monthly')).resolves.not.toThrow();
    });
    it('accepts quarterly', async () => {
      await expect(service.getPersonalAnalytics(makeAgent(), '2026-Q3', 'quarterly')).resolves.not.toThrow();
    });
    it('accepts annual', async () => {
      await expect(service.getPersonalAnalytics(makeAgent(), '2026', 'annual')).resolves.not.toThrow();
    });
  });

  // ── chain access ───────────────────────────────────────────────────────────

  describe('getPersonalAnalytics() — chain access', () => {
    it('manager can view subordinate in their chain', async () => {
      mockPrisma.user.findMany
        .mockResolvedValueOnce([{ id: 'tier2-id' }])
        .mockResolvedValueOnce([]);
      await expect(
        service.getPersonalAnalytics(makeManager(), '2026-08', 'monthly', 'tier2-id'),
      ).resolves.not.toThrow();
    });

    it('throws ForbiddenException for user outside the chain', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await expect(
        service.getPersonalAnalytics(makeManager('mgr-id'), '2026-08', 'monthly', 'unrelated-id'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('includeChain=true includes all chain users', async () => {
      mockPrisma.user.findMany
        .mockResolvedValueOnce([{ id: 'tier1-a' }, { id: 'tier1-b' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const r = await service.getPersonalAnalytics(
        makeAgent('TIER2', 'tier2-id'), '2026-08', 'monthly', undefined, true,
      ) as any;
      expect(r.userIds).toContain('tier2-id');
      expect(r.userIds).toContain('tier1-a');
      expect(r.userIds).toContain('tier1-b');
    });

    it('includeChain=false returns only single user', async () => {
      const r = await service.getPersonalAnalytics(
        makeAgent('TIER2', 'tier2-id'), '2026-08', 'monthly', undefined, false,
      ) as any;
      expect(r.userIds).toEqual(['tier2-id']);
    });
  });

  // ── getChainUserIds ────────────────────────────────────────────────────────

  describe('getChainUserIds()', () => {
    it('always includes the root manager', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      const ids = await service.getChainUserIds('mgr-id');
      expect(ids).toContain('mgr-id');
    });

    it('walks down two levels', async () => {
      mockPrisma.user.findMany
        .mockResolvedValueOnce([{ id: 'tier2-a' }])
        .mockResolvedValueOnce([{ id: 'tier1-a' }])
        .mockResolvedValueOnce([]);
      const ids = await service.getChainUserIds('tier3-id');
      expect(ids).toEqual(expect.arrayContaining(['tier3-id', 'tier2-a', 'tier1-a']));
    });

    it('returns only the manager when chain is empty', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      const ids = await service.getChainUserIds('solo-id');
      expect(ids).toEqual(['solo-id']);
    });

    it('never duplicates a user ID', async () => {
      mockPrisma.user.findMany
        .mockResolvedValueOnce([{ id: 'report-1' }])
        .mockResolvedValueOnce([{ id: 'mgr-id' }])
        .mockResolvedValueOnce([]);
      const ids = await service.getChainUserIds('mgr-id');
      expect(ids).toHaveLength([...new Set(ids)].length);
    });
  });
});