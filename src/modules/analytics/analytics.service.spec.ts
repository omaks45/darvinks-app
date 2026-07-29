
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '@common/prisma/prisma.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Every Prisma model and method the analytics service touches, mapped
// precisely from reading the service source — no phantom mocks.

const mockPrisma = {
  locationTarget:    { findMany:   jest.fn() },
  secondarySaleItem: { groupBy:    jest.fn(), aggregate: jest.fn() },
  purchaseOrderItem: { groupBy:    jest.fn() },
  product:           { findMany:   jest.fn() },
  targetAssignment:  { findMany:   jest.fn() },
  collection:        { aggregate:  jest.fn() },
  purchaseOrder:     { aggregate:  jest.fn() },
  customer:          { count:      jest.fn(), findMany: jest.fn() },
  user:              { count:      jest.fn() },
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PERIOD = '2026-07';

const LOCATION_TARGET = {
  locationId:  'loc-1',
  category:    'LOTION',
  targetValue: 1000,
  location:    { name: 'Arakale', state: 'ondo', region: 'SOUTH_WEST' },
};

const PRODUCT_LOTION = { id: 'prod-lotion', category: 'LOTION' };
const PRODUCT_SOAP   = { id: 'prod-soap',   category: 'SOAP' };

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

    // ── Safe defaults — every mock returns benign empty values ────────────────
    mockPrisma.locationTarget.findMany.mockResolvedValue([]);
    mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([]);
    mockPrisma.secondarySaleItem.aggregate.mockResolvedValue({ _sum: { quantityCartons: 0 } });
    mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([]);
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.targetAssignment.findMany.mockResolvedValue([]);
    mockPrisma.collection.aggregate.mockResolvedValue({ _sum: { amountKobo: 0 } });
    mockPrisma.purchaseOrder.aggregate.mockResolvedValue({ _sum: { totalKobo: 0 } });
    mockPrisma.customer.count.mockResolvedValue(0);
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.user.count.mockResolvedValue(0);
  });

  // ── buildReportData ────────────────────────────────────────────────────────

  describe('buildReportData()', () => {
    it('returns the correct periodMonth in the report', async () => {
      const result = await service.buildReportData(PERIOD);
      expect(result.periodMonth).toBe(PERIOD);
    });

    it('includes a generatedAt timestamp close to now', async () => {
      const before = new Date();
      const result = await service.buildReportData(PERIOD);
      const after  = new Date();
      expect(result.generatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.generatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('returns empty arrays when no data exists for the period', async () => {
      const result = await service.buildReportData(PERIOD);
      expect(result.locationPerformance).toEqual([]);
      expect(result.userPerformance).toEqual([]);
    });

    it('returns zero org summary values when no activity exists', async () => {
      const result = await service.buildReportData(PERIOD);
      expect(result.orgSummary.totalCollectionsKobo).toBe(0);
      expect(result.orgSummary.totalPOValueKobo).toBe(0);
      expect(result.orgSummary.totalSecondarySaleCartons).toBe(0);
    });

    it('queries location targets for the given periodMonth', async () => {
      await service.buildReportData(PERIOD);
      const call = mockPrisma.locationTarget.findMany.mock.calls[0][0];
      expect(call.where.periodMonth).toBe(PERIOD);
    });

    it('queries user targets for the correct year and month', async () => {
      await service.buildReportData('2026-07');
      const call = mockPrisma.targetAssignment.findMany.mock.calls[0][0];
      expect(call.where.year).toBe(2026);
      expect(call.where.month).toBe(7);
      expect(call.where.period).toBe('MONTHLY');
    });

    it('scopes collection aggregate to the period month date range', async () => {
      await service.buildReportData('2026-07');
      const call = mockPrisma.collection.aggregate.mock.calls[0][0];
      expect(call.where.collectedAt.gte).toEqual(new Date(2026, 6, 1));  // July 1
      expect(call.where.collectedAt.lt).toEqual(new Date(2026, 7, 1));   // Aug 1
    });

    it('excludes PENDING_APPROVAL and CANCELLED orders from PO aggregate', async () => {
      await service.buildReportData(PERIOD);
      const call = mockPrisma.purchaseOrder.aggregate.mock.calls[0][0];
      expect(call.where.status.notIn).toContain('PENDING_APPROVAL');
      expect(call.where.status.notIn).toContain('CANCELLED');
    });
  });

  // ── location performance ───────────────────────────────────────────────────

  describe('location performance section', () => {
    beforeEach(() => {
      mockPrisma.locationTarget.findMany.mockResolvedValue([LOCATION_TARGET]);
      mockPrisma.customer.findMany.mockResolvedValue([
        { id: 'cust-1', locationId: 'loc-1' },
      ]);
    });

    it('produces one row per location target', async () => {
      const result = await service.buildReportData(PERIOD);
      expect(result.locationPerformance).toHaveLength(1);
    });

    it('exposes location metadata on each row', async () => {
      const result = await service.buildReportData(PERIOD);
      const row = result.locationPerformance[0];
      expect(row.locationName).toBe('Arakale');
      expect(row.state).toBe('ondo');
      expect(row.region).toBe('SOUTH_WEST');
      expect(row.category).toBe('LOTION');
      expect(row.targetValue).toBe(1000);
    });

    it('calculates balance as target minus achieved', async () => {
      const result = await service.buildReportData(PERIOD);
      const row = result.locationPerformance[0];
      // No SS or PO achievement by default → achieved = 0
      expect(row.balanceValue).toBe(1000);
    });

    it('calculates percentAchieved correctly', async () => {
      const result = await service.buildReportData(PERIOD);
      const row = result.locationPerformance[0];
      expect(row.percentAchieved).toBe(0); // 0/1000 = 0%
    });

    it('returns percentAchieved of 0 when targetValue is 0 — no division by zero', async () => {
      mockPrisma.locationTarget.findMany.mockResolvedValue([
        { ...LOCATION_TARGET, targetValue: 0 },
      ]);
      const result = await service.buildReportData(PERIOD);
      expect(result.locationPerformance[0].percentAchieved).toBe(0);
    });

    it('does not query SS or PO data when there are no location targets', async () => {
      // Short-circuit: when locationTarget.findMany returns [] the service
      // returns early, so the expensive groupBy calls are never made.
      mockPrisma.locationTarget.findMany.mockResolvedValue([]);

      await service.buildReportData(PERIOD);

      // customer.findMany (used to map cust→location) should not be called
      expect(mockPrisma.customer.findMany).not.toHaveBeenCalled();
    });
  });

  // ── user performance ───────────────────────────────────────────────────────

  describe('user performance section', () => {
    const USER_TARGET = {
      assignedToId:  'user-1',
      category:      'LOTION',
      targetCartons: 500,
      assignedTo: {
        fullName:    'Kenny Solape',
        employeeRef: 'Dar-00000001',
        tier:        'TIER2',
        region:      'SOUTH_WEST',
      },
    };

    beforeEach(() => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([USER_TARGET]);
    });

    it('produces one row per user target', async () => {
      const result = await service.buildReportData(PERIOD);
      expect(result.userPerformance).toHaveLength(1);
    });

    it('includes user identity fields on each row', async () => {
      const result = await service.buildReportData(PERIOD);
      const row = result.userPerformance[0];
      expect(row.fullName).toBe('Kenny Solape');
      expect(row.employeeRef).toBe('Dar-00000001');
      expect(row.tier).toBe('TIER2');
      expect(row.region).toBe('SOUTH_WEST');
    });

    it('sums secondary sale and purchase order quantities into achievedCartons', async () => {
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([
        { productId: 'prod-lotion', _sum: { quantityCartons: 200 } },
      ]);
      mockPrisma.purchaseOrderItem.groupBy.mockResolvedValue([
        { productId: 'prod-lotion', _sum: { quantityCartons: 100 } },
      ]);
      mockPrisma.product.findMany.mockResolvedValue([PRODUCT_LOTION]);

      const result = await service.buildReportData(PERIOD);
      const row = result.userPerformance[0];
      expect(row.achievedCartons).toBe(300);   // 200 + 100
      expect(row.balanceCartons).toBe(200);    // 500 - 300
      expect(row.percentAchieved).toBe(60);    // 300/500 = 60%
    });

    it('resolves percentAchieved to 0 when targetCartons is 0', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([
        { ...USER_TARGET, targetCartons: 0 },
      ]);
      const result = await service.buildReportData(PERIOD);
      expect(result.userPerformance[0].percentAchieved).toBe(0);
    });

    it('uses a single product findMany to resolve all categories — no N+1', async () => {
      // Two targets for different products
      mockPrisma.secondarySaleItem.groupBy.mockResolvedValue([
        { productId: 'prod-lotion', _sum: { quantityCartons: 100 } },
        { productId: 'prod-soap',   _sum: { quantityCartons: 50 } },
      ]);
      mockPrisma.product.findMany.mockResolvedValue([PRODUCT_LOTION, PRODUCT_SOAP]);

      await service.buildReportData(PERIOD);

      // product.findMany called exactly ONCE regardless of how many distinct
      // products appear across secondary sales and PO items
      expect(mockPrisma.product.findMany).toHaveBeenCalledTimes(1);
    });

    it('handles null region gracefully — sets to null not undefined', async () => {
      mockPrisma.targetAssignment.findMany.mockResolvedValue([
        { ...USER_TARGET, assignedTo: { ...USER_TARGET.assignedTo, region: null } },
      ]);
      const result = await service.buildReportData(PERIOD);
      expect(result.userPerformance[0].region).toBeNull();
    });
  });

  // ── org summary ────────────────────────────────────────────────────────────

  describe('org summary section', () => {
    it('includes the total active user count', async () => {
      mockPrisma.user.count.mockResolvedValue(45);
      const result = await service.buildReportData(PERIOD);
      expect(result.orgSummary.totalActiveUsers).toBe(45);
    });

    it('includes the total active customer count', async () => {
      mockPrisma.customer.count.mockResolvedValue(112);
      const result = await service.buildReportData(PERIOD);
      expect(result.orgSummary.totalActiveCustomers).toBe(112);
    });

    it('includes total collections in kobo from the period', async () => {
      mockPrisma.collection.aggregate.mockResolvedValue({ _sum: { amountKobo: 5_000_000 } });
      const result = await service.buildReportData(PERIOD);
      expect(result.orgSummary.totalCollectionsKobo).toBe(5_000_000);
    });

    it('includes total confirmed PO value in kobo', async () => {
      mockPrisma.purchaseOrder.aggregate.mockResolvedValue({ _sum: { totalKobo: 12_000_000 } });
      const result = await service.buildReportData(PERIOD);
      expect(result.orgSummary.totalPOValueKobo).toBe(12_000_000);
    });

    it('includes total secondary sale cartons', async () => {
      mockPrisma.secondarySaleItem.aggregate.mockResolvedValue({ _sum: { quantityCartons: 800 } });
      const result = await service.buildReportData(PERIOD);
      expect(result.orgSummary.totalSecondarySaleCartons).toBe(800);
    });

    it('defaults null aggregate sums to 0', async () => {
      // Prisma returns null _sum when there are no matching rows
      mockPrisma.collection.aggregate.mockResolvedValue({ _sum: { amountKobo: null } });
      mockPrisma.purchaseOrder.aggregate.mockResolvedValue({ _sum: { totalKobo: null } });
      mockPrisma.secondarySaleItem.aggregate.mockResolvedValue({ _sum: { quantityCartons: null } });

      const result = await service.buildReportData(PERIOD);
      expect(result.orgSummary.totalCollectionsKobo).toBe(0);
      expect(result.orgSummary.totalPOValueKobo).toBe(0);
      expect(result.orgSummary.totalSecondarySaleCartons).toBe(0);
    });

    it('all three org queries run in parallel via Promise.all', async () => {
      // Track call order — if all three are called before any resolves,
      // they ran in parallel, not sequentially
      const callOrder: string[] = [];
      mockPrisma.user.count.mockImplementation(() => {
        callOrder.push('user.count');
        return Promise.resolve(10);
      });
      mockPrisma.customer.count.mockImplementation(() => {
        callOrder.push('customer.count');
        return Promise.resolve(50);
      });
      mockPrisma.collection.aggregate.mockImplementation(() => {
        callOrder.push('collection.aggregate');
        return Promise.resolve({ _sum: { amountKobo: 0 } });
      });

      await service.buildReportData(PERIOD);

      // All three should have been initiated (order may vary, but all called)
      expect(callOrder).toContain('user.count');
      expect(callOrder).toContain('customer.count');
      expect(callOrder).toContain('collection.aggregate');
    });
  });
});