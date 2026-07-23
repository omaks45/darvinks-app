// src/modules/dashboard/dashboard.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrderStatus, UserTier } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { AttendanceService } from '@modules/attendance/attendance.service';
import { TargetAssignmentService } from '@modules/target-assignment/target-assignment.service';
import { SecondarySaleService } from '@modules/seconday-sales/seconday-sales.service';
import { CompetitorReportService } from '@modules/competitor-report/competitor-report.service';
import { PurchaseOrderService } from '@modules/purchase/purchase.service';
import { CustomerService } from '@modules/customer/customer.service';
import { WarehouseService } from '@modules/warehouse/warehouse.service';
import { UsersService } from '@modules/user/user.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Direct Prisma calls in DashboardService (admin dashboard + getTeamRollup)
const mockPrisma = {
  user:              { count: jest.fn(), findMany: jest.fn() },
  customer:          { count: jest.fn() },
  purchaseOrder:     { count: jest.fn() },
  outOfRegionRequest:{ count: jest.fn() },
  competitorReport:  { findMany: jest.fn() },
  targetAssignment:  { count: jest.fn() },
};

// Every injected service — one mock per service, keyed by the method(s)
// the dashboard actually calls. No extra methods mocked — YAGNI.
const mockAttendance = { hasClockedInToday:     jest.fn() };
const mockTargets    = { getMyPerformance:       jest.fn(), findAll: jest.fn() };
const mockSecondarySales    = { findAll: jest.fn() };
const mockCompetitorReports = { findAll: jest.fn() };
const mockPurchaseOrders    = { findAll: jest.fn() };
const mockCustomers  = { findPendingOutOfRegionRequests: jest.fn() };
const mockWarehouse  = { getStockLevels: jest.fn(), getMovements: jest.fn() };
const mockUsers      = { getMyDirectReports: jest.fn() };

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PERF_ROW = {
  category:                  'LOTION',
  targetCartons:             1000,
  achievedCartons:           400,
  achievedFromSecondarySales: 250,
  achievedFromPurchaseOrders: 150,
  balanceCartons:            600,
  percentAchieved:           40,
  isStale:                   false,
};

const STOCK_ENTRY  = { id: 'stock-id', warehouseLocation: 'LAGOS_HQ', quantityCartons: 5 };
const MOVEMENT     = { id: 'mv-id', type: 'INBOUND', quantityCartons: 100 };
const PO_STUB      = { id: 'po-id', orderRef: 'PO-000001', status: 'PENDING_APPROVAL' };
const OOR_STUB     = { id: 'oor-id', status: 'PENDING' };
const REPORT_STUB  = { id: 'r-id', region: 'LAGOS_2', mediaType: 'TEXT' };
const DIRECT_REPORT = { id: 'tier3-id', fullName: 'Chuka', tier: UserTier.TIER3 };

function makeRequester(tier: UserTier, sub = 'user-id'): JwtPayload {
  return {
    sub,
    email:  'agent@darvinks.com',
    tier,
    team:   'RADIANT',
    region: 'LAGOS_2',
  } as JwtPayload;
}

const QUERY = { year: 2026, month: 6 };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService,           useValue: mockPrisma },
        { provide: AttendanceService,        useValue: mockAttendance },
        { provide: TargetAssignmentService,  useValue: mockTargets },
        { provide: SecondarySaleService,     useValue: mockSecondarySales },
        { provide: CompetitorReportService,  useValue: mockCompetitorReports },
        { provide: PurchaseOrderService,     useValue: mockPurchaseOrders },
        { provide: CustomerService,          useValue: mockCustomers },
        { provide: WarehouseService,         useValue: mockWarehouse },
        { provide: UsersService,             useValue: mockUsers },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    jest.resetAllMocks();

    // ── Safe defaults — every mock returns a benign empty value ──────────────
    // Tests that care about specific return values override these explicitly.
    mockAttendance.hasClockedInToday.mockResolvedValue(true);
    mockTargets.getMyPerformance.mockResolvedValue([PERF_ROW]);
    mockTargets.findAll.mockResolvedValue([]);
    mockSecondarySales.findAll.mockResolvedValue([]);
    mockCompetitorReports.findAll.mockResolvedValue([]);
    mockPurchaseOrders.findAll.mockResolvedValue([]);
    mockCustomers.findPendingOutOfRegionRequests.mockResolvedValue([]);
    mockWarehouse.getStockLevels.mockResolvedValue([]);
    mockWarehouse.getMovements.mockResolvedValue([]);
    mockUsers.getMyDirectReports.mockResolvedValue([]);
    // Team rollup: no downstream users by default
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.user.count.mockResolvedValue(10);
    mockPrisma.customer.count.mockResolvedValue(50);
    mockPrisma.purchaseOrder.count.mockResolvedValue(3);
    mockPrisma.outOfRegionRequest.count.mockResolvedValue(1);
    mockPrisma.competitorReport.findMany.mockResolvedValue([]);
    mockPrisma.targetAssignment.count.mockResolvedValue(20);
  });

  // ── getDashboard — routing ─────────────────────────────────────────────────

  describe('getDashboard() — tier routing', () => {
    it('routes TIER1 to the field staff dashboard', async () => {
      const result = await service.getDashboard(makeRequester(UserTier.TIER1), QUERY) as any;
      expect(result.tier).toBe(UserTier.TIER1);
      expect(result).toHaveProperty('myPerformance');
      expect(result).toHaveProperty('status');
    });

    it('routes TIER2 to the field staff dashboard', async () => {
      const result = await service.getDashboard(makeRequester(UserTier.TIER2), QUERY) as any;
      expect(result.tier).toBe(UserTier.TIER2);
      expect(result).toHaveProperty('myPerformance');
    });

    it('routes TIER3 to the field staff dashboard', async () => {
      const result = await service.getDashboard(makeRequester(UserTier.TIER3), QUERY) as any;
      expect(result.tier).toBe(UserTier.TIER3);
      expect(result).toHaveProperty('myPerformance');
    });

    it('routes TIER4 to the field staff dashboard', async () => {
      const result = await service.getDashboard(makeRequester(UserTier.TIER4), QUERY) as any;
      expect(result.tier).toBe(UserTier.TIER4);
      expect(result).toHaveProperty('myPerformance');
    });

    it('routes TIER5_SALES_HEAD to the sales head dashboard', async () => {
      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SALES_HEAD), QUERY,
      ) as any;
      expect(result).toHaveProperty('approvalQueue');
      expect(result).toHaveProperty('competitorActivityFeed');
    });

    it('routes TIER5_SYSTEM_ADMIN to the admin dashboard', async () => {
      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SYSTEM_ADMIN), QUERY,
      ) as any;
      expect(result).toHaveProperty('organisationSummary');
      expect(result).toHaveProperty('approvalQueue');
    });

    it('routes TIER6_GM to the SAME admin dashboard as System Admin', async () => {
      const result = await service.getDashboard(
        makeRequester(UserTier.TIER6_GM), QUERY,
      ) as any;
      // GM and System Admin share identical dashboard shape — confirmed requirement
      expect(result).toHaveProperty('organisationSummary');
      expect(result).toHaveProperty('approvalQueue');
    });

    it('routes WAREHOUSE_ADMIN to the warehouse dashboard', async () => {
      mockWarehouse.getStockLevels.mockResolvedValue([STOCK_ENTRY]);
      mockWarehouse.getMovements.mockResolvedValue([MOVEMENT]);

      const result = await service.getDashboard(
        makeRequester(UserTier.WAREHOUSE_ADMIN), QUERY,
      ) as any;
      expect(result).toHaveProperty('stockSummary');
      expect(result).toHaveProperty('recentMovements');
    });

    it('defaults year/month to the current period when omitted from the query', async () => {
      const now = new Date();
      await service.getDashboard(makeRequester(UserTier.TIER2), {});

      // getMyPerformance should have been called with current year/month
      const [, year, month] = mockTargets.getMyPerformance.mock.calls[0];
      expect(year).toBe(now.getFullYear());
      expect(month).toBe(now.getMonth() + 1);
    });
  });

  // ── Field staff dashboard (Tier 1-4) ──────────────────────────────────────

  describe('field staff dashboard (TIER1–TIER4)', () => {
    it('includes the clock-in status from AttendanceService', async () => {
      mockAttendance.hasClockedInToday.mockResolvedValue(false);

      const result = await service.getDashboard(makeRequester(UserTier.TIER2), QUERY) as any;

      expect(result.status.clockedInToday).toBe(false);
    });

    it('includes this month\'s performance from TargetAssignmentService', async () => {
      mockTargets.getMyPerformance.mockResolvedValue([PERF_ROW]);

      const result = await service.getDashboard(makeRequester(UserTier.TIER2), QUERY) as any;

      expect(result.myPerformance).toEqual([PERF_ROW]);
      expect(mockTargets.getMyPerformance).toHaveBeenCalledWith('user-id', 2026, 6);
    });

    it('caps recent activity lists at 10 items each', async () => {
      const manyItems = Array.from({ length: 25 }, (_, i) => ({ id: `id-${i}` }));
      mockSecondarySales.findAll.mockResolvedValue(manyItems);
      mockCompetitorReports.findAll.mockResolvedValue(manyItems);
      mockPurchaseOrders.findAll.mockResolvedValue(manyItems);

      const result = await service.getDashboard(makeRequester(UserTier.TIER2), QUERY) as any;

      expect(result.recentActivity.secondarySales).toHaveLength(10);
      expect(result.recentActivity.competitorReports).toHaveLength(10);
      expect(result.recentActivity.purchaseOrders).toHaveLength(10);
    });

    it('includes the direct report count from UsersService', async () => {
      mockUsers.getMyDirectReports.mockResolvedValue([DIRECT_REPORT, DIRECT_REPORT]);

      const result = await service.getDashboard(makeRequester(UserTier.TIER3), QUERY) as any;

      expect(result.myTeam.directReportCount).toBe(2);
      expect(result.myTeam.directReports).toHaveLength(2);
    });

    it('TIER1 returns an empty team rollup since they have no downstream tier', async () => {
      const result = await service.getDashboard(makeRequester(UserTier.TIER1), QUERY) as any;

      // TIER1 is the bottom of the cascade — no one below them
      expect(result.myTeam.rollup.totalTeamSize).toBe(0);
      expect(result.myTeam.rollup.byCategory).toEqual([]);
      // Prisma user.findMany should NOT be called — short-circuit before the loop
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    });

    it('queries all three activity sources with the requester', async () => {
      const requester = makeRequester(UserTier.TIER2);
      await service.getDashboard(requester, QUERY);

      expect(mockSecondarySales.findAll).toHaveBeenCalledWith({}, requester);
      expect(mockCompetitorReports.findAll).toHaveBeenCalledWith({}, requester);
      expect(mockPurchaseOrders.findAll).toHaveBeenCalledWith({}, requester);
    });
  });

  // ── Team rollup (getTeamRollup — tested indirectly through getDashboard) ──

  describe('team rollup — TIER4 with a two-level downstream tree', () => {
    // Simulate a Tier4 who has two Tier3 direct reports,
    // each of whom has one Tier2 report.
    // getTeamRollup should walk two levels and aggregate performance.

    beforeEach(() => {
      // First prisma.user.findMany call: returns Tier3 reports
      // Second call: returns Tier2 reports under those Tier3s
      // Third call: returns empty (no Tier1s under the Tier2s) → stops loop
      mockPrisma.user.findMany
        .mockResolvedValueOnce([
          { id: 'tier3-a', tier: UserTier.TIER3 },
          { id: 'tier3-b', tier: UserTier.TIER3 },
        ])
        .mockResolvedValueOnce([
          { id: 'tier2-a', tier: UserTier.TIER2 },
        ])
        .mockResolvedValueOnce([]); // no Tier1s — terminates the loop

      // Each downstream user has some performance data
      mockTargets.getMyPerformance
        .mockResolvedValueOnce([{ ...PERF_ROW, targetCartons: 500, achievedCartons: 200 }])
        .mockResolvedValueOnce([{ ...PERF_ROW, targetCartons: 300, achievedCartons: 100 }])
        .mockResolvedValueOnce([{ ...PERF_ROW, targetCartons: 200, achievedCartons:  50 }]);
    });

    it('includes all downstream users in the total team size', async () => {
      const result = await service.getDashboard(
        makeRequester(UserTier.TIER4), QUERY,
      ) as any;

      // 2 Tier3s + 1 Tier2 = 3 total
      expect(result.myTeam.rollup.totalTeamSize).toBe(3);
    });

    it('sums performance across the entire downstream tree', async () => {
      const result = await service.getDashboard(
        makeRequester(UserTier.TIER4), QUERY,
      ) as any;

      const lotion = result.myTeam.rollup.byCategory.find(
        (r: any) => r.category === 'LOTION',
      );
      expect(lotion).toBeDefined();
      // 200 + 100 + 50 = 350 achieved; 500 + 300 + 200 = 1000 target
      expect(lotion.achievedCartons).toBe(350);
      expect(lotion.targetCartons).toBe(1000);
      expect(lotion.balanceCartons).toBe(650);
      expect(lotion.percentAchieved).toBe(35);
    });

    it('calls getMyPerformance once per downstream user — not per level', async () => {
      await service.getDashboard(makeRequester(UserTier.TIER4), QUERY);

      // 3 downstream users → 3 calls (plus 1 for the requester's own performance)
      expect(mockTargets.getMyPerformance).toHaveBeenCalledTimes(4);
    });

    it('stops the tree walk when a level returns no users', async () => {
      await service.getDashboard(makeRequester(UserTier.TIER4), QUERY);

      // Called 3 times: Tier3s found, Tier2s found, then empty → stopped
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(3);
    });
  });

  // ── Sales Head dashboard ───────────────────────────────────────────────────

  describe('sales head dashboard (TIER5_SALES_HEAD)', () => {
    it('includes the pending PO approval queue', async () => {
      mockPurchaseOrders.findAll.mockResolvedValue([PO_STUB, PO_STUB]);

      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SALES_HEAD), QUERY,
      ) as any;

      expect(result.approvalQueue.pendingPurchaseOrders).toHaveLength(2);
    });

    it('queries purchase orders filtered by PENDING_APPROVAL status', async () => {
      const requester = makeRequester(UserTier.TIER5_SALES_HEAD);
      await service.getDashboard(requester, QUERY);

      expect(mockPurchaseOrders.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ status: PurchaseOrderStatus.PENDING_APPROVAL }),
        requester,
      );
    });

    it('includes the pending Out-of-Region requests', async () => {
      mockCustomers.findPendingOutOfRegionRequests.mockResolvedValue([OOR_STUB, OOR_STUB]);

      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SALES_HEAD), QUERY,
      ) as any;

      expect(result.approvalQueue.pendingOutOfRegionRequests).toHaveLength(2);
    });

    it('sums the total pending count across both queues', async () => {
      mockPurchaseOrders.findAll.mockResolvedValue([PO_STUB, PO_STUB, PO_STUB]); // 3
      mockCustomers.findPendingOutOfRegionRequests.mockResolvedValue([OOR_STUB]); // 1

      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SALES_HEAD), QUERY,
      ) as any;

      expect(result.approvalQueue.totalPendingCount).toBe(4);
    });

    it('includes the competitor report feed', async () => {
      mockCompetitorReports.findAll.mockResolvedValue([REPORT_STUB, REPORT_STUB]);

      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SALES_HEAD), QUERY,
      ) as any;

      expect(result.competitorActivityFeed).toHaveLength(2);
    });

    it('caps the competitor feed at 15 items', async () => {
      const manyReports = Array.from({ length: 30 }, (_, i) => ({ id: `r-${i}` }));
      mockCompetitorReports.findAll.mockResolvedValue(manyReports);

      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SALES_HEAD), QUERY,
      ) as any;

      expect(result.competitorActivityFeed).toHaveLength(15);
    });

    it('caps the approval queue at 20 items each', async () => {
      const manyPOs  = Array.from({ length: 30 }, (_, i) => ({ id: `po-${i}` }));
      const manyOORs = Array.from({ length: 30 }, (_, i) => ({ id: `oor-${i}` }));
      mockPurchaseOrders.findAll.mockResolvedValue(manyPOs);
      mockCustomers.findPendingOutOfRegionRequests.mockResolvedValue(manyOORs);

      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SALES_HEAD), QUERY,
      ) as any;

      expect(result.approvalQueue.pendingPurchaseOrders).toHaveLength(20);
      expect(result.approvalQueue.pendingOutOfRegionRequests).toHaveLength(20);
    });

    it('includes the team rollup for the Tier4 downstream tree', async () => {
      // Tier4 direct reports
      mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'tier4-id', tier: UserTier.TIER4 }])
                               .mockResolvedValueOnce([]); // no further depth
      mockTargets.getMyPerformance.mockResolvedValue([PERF_ROW]);

      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SALES_HEAD), QUERY,
      ) as any;

      expect(result.myTeam.rollup.totalTeamSize).toBe(1);
    });
  });

  // ── Admin / GM dashboard ───────────────────────────────────────────────────

  describe('admin dashboard (TIER5_SYSTEM_ADMIN + TIER6_GM)', () => {
    it('includes the total active user count', async () => {
      mockPrisma.user.count.mockResolvedValue(42);

      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SYSTEM_ADMIN), QUERY,
      ) as any;

      expect(result.organisationSummary.totalActiveUsers).toBe(42);
    });

    it('includes the total active customer count', async () => {
      mockPrisma.customer.count.mockResolvedValue(88);

      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SYSTEM_ADMIN), QUERY,
      ) as any;

      expect(result.organisationSummary.totalActiveCustomers).toBe(88);
    });

    it('includes the pending PO count from the database directly', async () => {
      mockPrisma.purchaseOrder.count.mockResolvedValue(7);

      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SYSTEM_ADMIN), QUERY,
      ) as any;

      expect(result.approvalQueue.pendingPurchaseOrderCount).toBe(7);
    });

    it('includes the pending Out-of-Region request count', async () => {
      mockPrisma.outOfRegionRequest.count.mockResolvedValue(3);

      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SYSTEM_ADMIN), QUERY,
      ) as any;

      expect(result.approvalQueue.pendingOutOfRegionRequestCount).toBe(3);
    });

    it('includes the number of targets assigned this year', async () => {
      mockPrisma.targetAssignment.count.mockResolvedValue(15);

      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SYSTEM_ADMIN), QUERY,
      ) as any;

      expect(result.organisationSummary.targetsAssignedThisYear).toBe(15);
    });

    it('includes low-stock entries in the warehouse alert', async () => {
      mockWarehouse.getStockLevels.mockResolvedValue([STOCK_ENTRY, STOCK_ENTRY]);

      const result = await service.getDashboard(
        makeRequester(UserTier.TIER5_SYSTEM_ADMIN), QUERY,
      ) as any;

      expect(result.warehouseAlerts.lowStockEntryCount).toBe(2);
      expect(result.warehouseAlerts.lowStockEntries).toHaveLength(2);
    });

    it('TIER6_GM gets exactly the same dashboard shape as TIER5_SYSTEM_ADMIN', async () => {
      const adminResult = await service.getDashboard(
        makeRequester(UserTier.TIER5_SYSTEM_ADMIN), QUERY,
      ) as any;
      jest.resetAllMocks();

      // Restore defaults
      mockPrisma.user.count.mockResolvedValue(10);
      mockPrisma.customer.count.mockResolvedValue(50);
      mockPrisma.purchaseOrder.count.mockResolvedValue(3);
      mockPrisma.outOfRegionRequest.count.mockResolvedValue(1);
      mockPrisma.competitorReport.findMany.mockResolvedValue([]);
      mockPrisma.targetAssignment.count.mockResolvedValue(20);
      mockWarehouse.getStockLevels.mockResolvedValue([]);

      const gmResult = await service.getDashboard(
        makeRequester(UserTier.TIER6_GM), QUERY,
      ) as any;

      expect(Object.keys(gmResult)).toEqual(Object.keys(adminResult));
    });
  });

  // ── Warehouse Admin dashboard ──────────────────────────────────────────────

  describe('warehouse admin dashboard (WAREHOUSE_ADMIN)', () => {
    it('includes the full stock inventory count', async () => {
      mockWarehouse.getStockLevels.mockResolvedValue([STOCK_ENTRY, STOCK_ENTRY, STOCK_ENTRY]);

      const result = await service.getDashboard(
        makeRequester(UserTier.WAREHOUSE_ADMIN), QUERY,
      ) as any;

      expect(result.stockSummary.totalProductLocationEntries).toBe(3);
    });

    it('includes the low-stock count separately', async () => {
      // First call is getStockLevels({}) → all stock
      // Second call is getStockLevels({ lowStockOnly: true }) → only low stock
      mockWarehouse.getStockLevels
        .mockResolvedValueOnce([STOCK_ENTRY, STOCK_ENTRY, STOCK_ENTRY]) // all
        .mockResolvedValueOnce([STOCK_ENTRY]);                           // low only

      const result = await service.getDashboard(
        makeRequester(UserTier.WAREHOUSE_ADMIN), QUERY,
      ) as any;

      expect(result.stockSummary.totalProductLocationEntries).toBe(3);
      expect(result.stockSummary.lowStockCount).toBe(1);
    });

    it('includes recent stock movements capped at 20', async () => {
      const manyMovements = Array.from({ length: 30 }, (_, i) => ({ id: `mv-${i}` }));
      mockWarehouse.getMovements.mockResolvedValue(manyMovements);

      const result = await service.getDashboard(
        makeRequester(UserTier.WAREHOUSE_ADMIN), QUERY,
      ) as any;

      expect(result.recentMovements).toHaveLength(20);
    });

    it('does NOT call TargetAssignmentService or AttendanceService for Warehouse Admin', async () => {
      await service.getDashboard(makeRequester(UserTier.WAREHOUSE_ADMIN), QUERY);

      expect(mockTargets.getMyPerformance).not.toHaveBeenCalled();
      expect(mockAttendance.hasClockedInToday).not.toHaveBeenCalled();
    });
  });
});