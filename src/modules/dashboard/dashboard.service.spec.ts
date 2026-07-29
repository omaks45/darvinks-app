// src/modules/dashboard/dashboard.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
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

const mockPrisma = {
  user: {
    count:    jest.fn(),
    findMany: jest.fn(),
  },
  customer:           { count: jest.fn() },
  purchaseOrder:      { count: jest.fn() },
  outOfRegionRequest: { count: jest.fn() },
  targetAssignment:   { count: jest.fn() },
  competitorReport:   { findMany: jest.fn() },
};

const mockAttendance       = { hasClockedInToday:  jest.fn() };
const mockTargets          = { getMyPerformance:   jest.fn(), findAll: jest.fn() };
const mockSecondarySales   = { findAll:            jest.fn() };
const mockCompetitorReports= { findAll:            jest.fn() };
const mockPurchaseOrders   = { findAll:            jest.fn() };
const mockCustomers        = { findPendingOutOfRegionRequests: jest.fn() };
const mockWarehouse        = { getStockLevels: jest.fn(), getMovements: jest.fn() };
const mockUsers            = { getMyDirectReports: jest.fn() };

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PERF_ROW = {
  category:        'LOTION',
  targetCartons:   1000,
  achievedCartons: 400,
  balanceCartons:  600,
  percentAchieved: 40,
};

const DIRECT_REPORT = {
  id:                'tier4-id',
  employeeRef:       'Dar-00000002',
  fullName:          'Emeka ZSM',
  email:             'zsm@darvinks.com',
  phone:             '08033333331',
  tier:              'TIER4',
  team:              'RADIANT',
  region:            'SOUTH_WEST',
  state:             'lagos',
  profilePictureUrl: null,
  idCardUrl:         null,
  isActive:          true,
  reportsToId:       'sh-id',
};

const TIER3_MEMBER = {
  ...DIRECT_REPORT,
  id:          'tier3-id',
  employeeRef: 'Dar-00000003',
  fullName:    'Chidinma ATSM',
  tier:        'TIER3',
  reportsToId: 'tier4-id',
};

const STOCK_ENTRY = {
  productId: 'prod-id',
  product:   { name: 'Visita Lotion 250ml', category: 'LOTION' },
  warehouseLocation: 'LAGOS_HQ',
  quantityCartons:   5,
  lowStock:          true,
};

const COMPETITOR_REPORT = {
  id:          'report-id',
  region:      'SOUTH_WEST',
  mediaType:   'TEXT',
  createdAt:   new Date(),
  submittedBy: { fullName: 'Kenny Rep' },
};

const PO_STUB = { id: 'po-id', orderRef: 'PO-000001', status: 'PENDING_APPROVAL' };
const OOR_STUB = { id: 'oor-id', status: 'PENDING' };

const USER_STUB = {
  id:          'user-id',
  employeeRef: 'Dar-00000001',
  fullName:    'Omaka Admin',
  email:       'admin@darvinks.com',
  phone:       '+2349104095397',
  tier:        'TIER5_SYSTEM_ADMIN',
  team:        null,
  region:      null,
  state:       null,
  role:        'SYSTEM_ADMIN',
  roleLabel:   'System Administrator',
  isActive:    true,
  profilePictureUrl: null,
  idCardUrl:   null,
  createdAt:   new Date(),
  reportsToId: null,
};

// ─── Requester factories ───────────────────────────────────────────────────────

function makeTier(tier: string, sub = 'user-id'): JwtPayload {
  return { sub, email: `${tier}@test.com`, tier, team: 'RADIANT',
    region: 'SOUTH_WEST' } as JwtPayload;
}

const QUERY = { year: 2026, month: 7 };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService,          useValue: mockPrisma },
        { provide: AttendanceService,      useValue: mockAttendance },
        { provide: TargetAssignmentService,useValue: mockTargets },
        { provide: SecondarySaleService,   useValue: mockSecondarySales },
        { provide: CompetitorReportService,useValue: mockCompetitorReports },
        { provide: PurchaseOrderService,   useValue: mockPurchaseOrders },
        { provide: CustomerService,        useValue: mockCustomers },
        { provide: WarehouseService,       useValue: mockWarehouse },
        { provide: UsersService,           useValue: mockUsers },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    jest.resetAllMocks();

    // Safe defaults for all mocks
    mockAttendance.hasClockedInToday.mockResolvedValue(true);
    mockTargets.getMyPerformance.mockResolvedValue([PERF_ROW]);
    mockTargets.findAll.mockResolvedValue([]);
    mockSecondarySales.findAll.mockResolvedValue([]);
    mockCompetitorReports.findAll.mockResolvedValue([]);
    mockPurchaseOrders.findAll.mockResolvedValue([]);
    mockCustomers.findPendingOutOfRegionRequests.mockResolvedValue([]);
    mockWarehouse.getStockLevels.mockResolvedValue([]);
    mockWarehouse.getMovements.mockResolvedValue([]);
    mockUsers.getMyDirectReports.mockResolvedValue([DIRECT_REPORT]);
    mockPrisma.user.count.mockResolvedValue(7);
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.customer.count.mockResolvedValue(3);
    mockPrisma.purchaseOrder.count.mockResolvedValue(0);
    mockPrisma.outOfRegionRequest.count.mockResolvedValue(0);
    mockPrisma.targetAssignment.count.mockResolvedValue(2);
    mockPrisma.competitorReport.findMany.mockResolvedValue([]);
  });

  // ── getDashboard() dispatch ────────────────────────────────────────────────

  describe('getDashboard() — tier dispatch', () => {
    it('routes TIER1 to field staff dashboard', async () => {
      const result = await service.getDashboard(makeTier('TIER1'), QUERY) as any;
      expect(result.tier).toBe('TIER1');
      expect(result.status).toBeDefined();
      expect(result.myPerformance).toBeDefined();
    });

    it('routes TIER2 to field staff dashboard', async () => {
      const result = await service.getDashboard(makeTier('TIER2'), QUERY) as any;
      expect(result.tier).toBe('TIER2');
      expect(result.myPerformance).toBeDefined();
    });

    it('routes TIER3 to field staff dashboard', async () => {
      const result = await service.getDashboard(makeTier('TIER3'), QUERY) as any;
      expect(result.tier).toBe('TIER3');
    });

    it('routes TIER4 to field staff dashboard', async () => {
      const result = await service.getDashboard(makeTier('TIER4'), QUERY) as any;
      expect(result.tier).toBe('TIER4');
    });

    it('routes TIER5_SALES_HEAD to sales head dashboard', async () => {
      const result = await service.getDashboard(
        makeTier('TIER5_SALES_HEAD', 'sh-id'), QUERY) as any;
      expect(result.tier).toBe('TIER5_SALES_HEAD');
      expect(result.approvalQueue).toBeDefined();
      expect(result.myTeam).toBeDefined();
    });

    it('routes TIER5_SYSTEM_ADMIN to admin dashboard', async () => {
      const result = await service.getDashboard(makeTier('TIER5_SYSTEM_ADMIN'), QUERY) as any;
      expect(result.tier).toBe('TIER5_SYSTEM_ADMIN_OR_TIER6_GM');
      expect(result.organisationSummary).toBeDefined();
    });

    it('routes TIER6_GM to admin dashboard — same scope as System Admin', async () => {
      const result = await service.getDashboard(makeTier('TIER6_GM'), QUERY) as any;
      expect(result.tier).toBe('TIER5_SYSTEM_ADMIN_OR_TIER6_GM');
    });

    it('routes WAREHOUSE_ADMIN to warehouse dashboard', async () => {
      const result = await service.getDashboard(makeTier('WAREHOUSE_ADMIN'), QUERY) as any;
      expect(result.tier).toBe('WAREHOUSE_ADMIN');
      expect(result.stockSummary).toBeDefined();
    });

    it('throws for an unknown tier', async () => {
      await expect(
        service.getDashboard(makeTier('UNKNOWN_TIER'), QUERY),
      ).rejects.toThrow();
    });

    it('defaults year and month to current date when not provided', async () => {
      const now = new Date();
      await service.getDashboard(makeTier('TIER2'), {} as any);
      expect(mockTargets.getMyPerformance).toHaveBeenCalledWith(
        'user-id', now.getFullYear(), now.getMonth() + 1,
      );
    });
  });

  // ── Field staff dashboard ──────────────────────────────────────────────────

  describe('field staff dashboard (TIER1–TIER4)', () => {
    it('includes clock-in status', async () => {
      mockAttendance.hasClockedInToday.mockResolvedValue(false);
      const result = await service.getDashboard(makeTier('TIER2'), QUERY) as any;
      expect(result.status.clockedInToday).toBe(false);
    });

    it('includes myPerformance from TargetAssignmentService', async () => {
      const result = await service.getDashboard(makeTier('TIER2'), QUERY) as any;
      expect(result.myPerformance).toEqual([PERF_ROW]);
      expect(mockTargets.getMyPerformance).toHaveBeenCalledWith('user-id', 2026, 7);
    });

    it('includes myTeam with directReports', async () => {
      const result = await service.getDashboard(makeTier('TIER2'), QUERY) as any;
      expect(result.myTeam.directReports).toEqual([DIRECT_REPORT]);
      expect(result.myTeam.directReportCount).toBe(1);
    });

    it('includes recentActivity with last 10 of each type', async () => {
      const many = Array(15).fill({ id: 'x' });
      mockSecondarySales.findAll.mockResolvedValue(many);
      mockPurchaseOrders.findAll.mockResolvedValue(many);
      mockCompetitorReports.findAll.mockResolvedValue(many);

      const result = await service.getDashboard(makeTier('TIER2'), QUERY) as any;
      expect(result.recentActivity.secondarySales).toHaveLength(10);
      expect(result.recentActivity.purchaseOrders).toHaveLength(10);
      expect(result.recentActivity.competitorReports).toHaveLength(10);
    });

    it('TIER1 has empty team rollup — no direct reports tier exists below', async () => {
      mockUsers.getMyDirectReports.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.getDashboard(makeTier('TIER1'), QUERY) as any;
      expect(result.myTeam.rollup.totalTeamSize).toBe(0);
      expect(result.myTeam.rollup.byCategory).toHaveLength(0);
    });

    it('TIER4 team rollup includes entire downstream tree', async () => {
      // TIER4 has TIER3 reports, who have TIER2 reports
      mockPrisma.user.findMany
        .mockResolvedValueOnce([{ ...TIER3_MEMBER, id: 'tier3-id' }])  // TIER3 level
        .mockResolvedValueOnce([{ ...DIRECT_REPORT, id: 'tier2-id', tier: 'TIER2',
          reportsToId: 'tier3-id' }])                                   // TIER2 level
        .mockResolvedValueOnce([]);                                      // TIER1 level — empty

      mockTargets.getMyPerformance
        .mockResolvedValueOnce([PERF_ROW]) // requester's own (field staff call)
        .mockResolvedValueOnce([{ ...PERF_ROW, targetCartons: 500, achievedCartons: 200 }])
        .mockResolvedValueOnce([{ ...PERF_ROW, targetCartons: 300, achievedCartons: 100 }]);

      const result = await service.getDashboard(makeTier('TIER4'), QUERY) as any;
      expect(result.myTeam.rollup.totalTeamSize).toBe(2);
    });

    it('sums performance across the entire downstream tree in rollup', async () => {
      mockPrisma.user.findMany
        .mockResolvedValueOnce([{ ...TIER3_MEMBER, id: 'tier3-a' },
                                { ...TIER3_MEMBER, id: 'tier3-b' }])
        .mockResolvedValueOnce([]);

      // getMyPerformance called 3 times:
      //   call 1 = requester's own (getFieldStaffDashboard)
      //   calls 2-3 = tier3-a and tier3-b (getTeamRollup)
      mockTargets.getMyPerformance
        .mockResolvedValueOnce([PERF_ROW])                                    // requester
        .mockResolvedValueOnce([{ ...PERF_ROW, achievedCartons: 200 }])       // tier3-a
        .mockResolvedValueOnce([{ ...PERF_ROW, achievedCartons: 150 }]);      // tier3-b

      const result = await service.getDashboard(makeTier('TIER4'), QUERY) as any;
      const lotion = result.myTeam.rollup.byCategory.find(
        (c: any) => c.category === 'LOTION',
      );
      expect(lotion.achievedCartons).toBe(350); // 200 + 150
    });
  });

  // ── Sales Head dashboard ───────────────────────────────────────────────────

  describe('Sales Head dashboard', () => {
    const SH = makeTier('TIER5_SALES_HEAD', 'sh-id');

    it('includes approvalQueue with pending POs', async () => {
      mockPurchaseOrders.findAll.mockResolvedValue([PO_STUB]);
      const result = await service.getDashboard(SH, QUERY) as any;
      expect(result.approvalQueue.pendingPurchaseOrders).toHaveLength(1);
      expect(result.approvalQueue.totalPendingCount).toBe(1);
    });

    it('includes pending out-of-region requests in approval queue', async () => {
      mockCustomers.findPendingOutOfRegionRequests.mockResolvedValue([OOR_STUB]);
      const result = await service.getDashboard(SH, QUERY) as any;
      expect(result.approvalQueue.pendingOutOfRegionRequests).toHaveLength(1);
      expect(result.approvalQueue.totalPendingCount).toBe(1);
    });

    it('sums both PO and OOR counts in totalPendingCount', async () => {
      mockPurchaseOrders.findAll.mockResolvedValue([PO_STUB, PO_STUB]);
      mockCustomers.findPendingOutOfRegionRequests.mockResolvedValue([OOR_STUB]);
      const result = await service.getDashboard(SH, QUERY) as any;
      expect(result.approvalQueue.totalPendingCount).toBe(3);
    });

    it('includes directReports (Tier4 only — who targets are assigned to)', async () => {
      const result = await service.getDashboard(SH, QUERY) as any;
      expect(result.myTeam.directReports).toHaveLength(1);
      expect(result.myTeam.directReports[0].tier).toBe('TIER4');
    });

    it('includes allMembers with full downstream tree', async () => {
      // Sales Head -> Tier4 -> Tier3
      mockPrisma.user.findMany
        .mockResolvedValueOnce([{ ...DIRECT_REPORT, id: 'tier4-id' }])  // Tier4 level
        .mockResolvedValueOnce([{ ...TIER3_MEMBER,  id: 'tier3-id' }])  // Tier3 level
        .mockResolvedValueOnce([]);                                       // Tier2 level

      mockTargets.getMyPerformance.mockResolvedValue([]);

      const result = await service.getDashboard(SH, QUERY) as any;
      expect(result.myTeam.allMemberCount).toBe(2);
      expect(result.myTeam.allMembers).toHaveLength(2);
    });

    it('allMembers includes users from every tier below Sales Head', async () => {
      mockPrisma.user.findMany
        .mockResolvedValueOnce([
          { ...DIRECT_REPORT, id: 't4', tier: 'TIER4' },
        ])
        .mockResolvedValueOnce([
          { ...TIER3_MEMBER, id: 't3', tier: 'TIER3', reportsToId: 't4' },
        ])
        .mockResolvedValueOnce([
          { ...DIRECT_REPORT, id: 't2', tier: 'TIER2', reportsToId: 't3' },
        ])
        .mockResolvedValueOnce([]);

      mockTargets.getMyPerformance.mockResolvedValue([]);
      const result = await service.getDashboard(SH, QUERY) as any;
      const tiers = result.myTeam.allMembers.map((m: any) => m.tier);
      expect(tiers).toContain('TIER4');
      expect(tiers).toContain('TIER3');
      expect(tiers).toContain('TIER2');
    });

    it('caps approval queue display at 20 items each', async () => {
      const many = Array(25).fill(PO_STUB);
      mockPurchaseOrders.findAll.mockResolvedValue(many);
      const result = await service.getDashboard(SH, QUERY) as any;
      expect(result.approvalQueue.pendingPurchaseOrders).toHaveLength(20);
    });

    it('caps competitor feed at 15 items', async () => {
      const many = Array(20).fill(COMPETITOR_REPORT);
      mockCompetitorReports.findAll.mockResolvedValue(many);
      const result = await service.getDashboard(SH, QUERY) as any;
      expect(result.competitorActivityFeed).toHaveLength(15);
    });

    it('team rollup returns empty when Sales Head has no Tier4 reports yet', async () => {
      mockUsers.getMyDirectReports.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);
      const result = await service.getDashboard(SH, QUERY) as any;
      expect(result.myTeam.rollup.totalTeamSize).toBe(0);
      expect(result.myTeam.allMemberCount).toBe(0);
    });

    it('includes targetsAssignedThisYear count', async () => {
      mockTargets.findAll.mockResolvedValue([{}, {}, {}]);
      const result = await service.getDashboard(SH, QUERY) as any;
      expect(result.targetsAssignedThisYear).toBe(3);
    });
  });

  // ── System Admin / GM dashboard ───────────────────────────────────────────

  describe('System Admin / GM dashboard', () => {
    const ADMIN = makeTier('TIER5_SYSTEM_ADMIN');

    it('includes organisation summary with active user and customer counts', async () => {
      mockPrisma.user.count.mockResolvedValue(12);
      mockPrisma.customer.count.mockResolvedValue(45);
      const result = await service.getDashboard(ADMIN, QUERY) as any;
      expect(result.organisationSummary.totalActiveUsers).toBe(12);
      expect(result.organisationSummary.totalActiveCustomers).toBe(45);
    });

    it('includes approval queue counts', async () => {
      mockPrisma.purchaseOrder.count.mockResolvedValue(3);
      mockPrisma.outOfRegionRequest.count.mockResolvedValue(2);
      const result = await service.getDashboard(ADMIN, QUERY) as any;
      expect(result.approvalQueue.pendingPurchaseOrderCount).toBe(3);
      expect(result.approvalQueue.pendingOutOfRegionRequestCount).toBe(2);
    });

    it('includes warehouse alerts with low stock entries', async () => {
      mockWarehouse.getStockLevels.mockResolvedValue([STOCK_ENTRY, STOCK_ENTRY]);
      const result = await service.getDashboard(ADMIN, QUERY) as any;
      expect(result.warehouseAlerts.lowStockEntryCount).toBe(2);
      expect(result.warehouseAlerts.lowStockEntries).toHaveLength(2);
    });

    it('caps warehouse alerts display at 20 entries', async () => {
      mockWarehouse.getStockLevels.mockResolvedValue(Array(25).fill(STOCK_ENTRY));
      const result = await service.getDashboard(ADMIN, QUERY) as any;
      expect(result.warehouseAlerts.lowStockEntries).toHaveLength(20);
    });

    it('includes users list with profiles for every active user', async () => {
      mockPrisma.user.findMany.mockResolvedValue([USER_STUB, USER_STUB]);
      const result = await service.getDashboard(ADMIN, QUERY) as any;
      expect(result.users).toHaveLength(2);
    });

    it('users list includes id and tier for each member (needed for action endpoints)', async () => {
      mockPrisma.user.findMany.mockResolvedValue([USER_STUB]);
      const result = await service.getDashboard(ADMIN, QUERY) as any;
      expect(result.users[0].id).toBeDefined();
      expect(result.users[0].tier).toBeDefined();
      expect(result.users[0].isActive).toBeDefined();
      expect(result.users[0].employeeRef).toBeDefined();
    });

    it('includes targetsAssignedThisYear in organisation summary', async () => {
      mockPrisma.targetAssignment.count.mockResolvedValue(8);
      const result = await service.getDashboard(ADMIN, QUERY) as any;
      expect(result.organisationSummary.targetsAssignedThisYear).toBe(8);
    });

    it('includes competitor activity feed', async () => {
      mockPrisma.competitorReport.findMany.mockResolvedValue([COMPETITOR_REPORT]);
      const result = await service.getDashboard(ADMIN, QUERY) as any;
      expect(result.competitorActivityFeed).toHaveLength(1);
    });

    it('GM gets identical dashboard to System Admin', async () => {
      const gmResult    = await service.getDashboard(makeTier('TIER6_GM'), QUERY) as any;
      const adminResult = await service.getDashboard(ADMIN, QUERY) as any;
      expect(gmResult.tier).toBe(adminResult.tier);
      expect(Object.keys(gmResult)).toEqual(Object.keys(adminResult));
    });
  });

  // ── Warehouse Admin dashboard ──────────────────────────────────────────────

  describe('Warehouse Admin dashboard', () => {
    const WH = makeTier('WAREHOUSE_ADMIN');

    it('returns stockSummary with total and low stock counts', async () => {
      mockWarehouse.getStockLevels
        .mockResolvedValueOnce([STOCK_ENTRY, STOCK_ENTRY, STOCK_ENTRY]) // all stock
        .mockResolvedValueOnce([STOCK_ENTRY]);                           // low stock only

      const result = await service.getDashboard(WH, QUERY) as any;
      expect(result.stockSummary.totalProductLocationEntries).toBe(3);
      expect(result.stockSummary.lowStockCount).toBe(1);
      expect(result.stockSummary.lowStockEntries).toHaveLength(1);
    });

    it('includes recent stock movements', async () => {
      mockWarehouse.getMovements.mockResolvedValue([{ id: 'mov-1' }, { id: 'mov-2' }]);
      const result = await service.getDashboard(WH, QUERY) as any;
      expect(result.recentMovements).toHaveLength(2);
    });

    it('caps recent movements at 20', async () => {
      mockWarehouse.getMovements.mockResolvedValue(Array(30).fill({ id: 'x' }));
      const result = await service.getDashboard(WH, QUERY) as any;
      expect(result.recentMovements).toHaveLength(20);
    });

    it('does NOT call attendance, targets, or sales services', async () => {
      await service.getDashboard(WH, QUERY);
      expect(mockAttendance.hasClockedInToday).not.toHaveBeenCalled();
      expect(mockTargets.getMyPerformance).not.toHaveBeenCalled();
      expect(mockSecondarySales.findAll).not.toHaveBeenCalled();
    });
  });

  // ── Team rollup — shared logic ─────────────────────────────────────────────

  describe('team rollup — getTeamRollup()', () => {
    it('returns empty rollup when user has no downstream reports', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      const result = await service.getDashboard(makeTier('TIER2'), QUERY) as any;
      expect(result.myTeam.rollup.totalTeamSize).toBe(0);
      expect(result.myTeam.rollup.byCategory).toHaveLength(0);
    });

    it('rolls up performance by category across all downstream users', async () => {
      mockPrisma.user.findMany
        .mockResolvedValueOnce([{ ...DIRECT_REPORT, id: 'r1', tier: 'TIER3' },
                                { ...DIRECT_REPORT, id: 'r2', tier: 'TIER3' }])
        .mockResolvedValueOnce([]);

      // Field staff call + 2 downstream users
      mockTargets.getMyPerformance
        .mockResolvedValueOnce([PERF_ROW])
        .mockResolvedValueOnce([{ ...PERF_ROW, targetCartons: 600, achievedCartons: 300 }])
        .mockResolvedValueOnce([{ ...PERF_ROW, targetCartons: 400, achievedCartons: 100 }]);

      const result = await service.getDashboard(makeTier('TIER4'), QUERY) as any;
      const lotion = result.myTeam.rollup.byCategory.find(
        (c: any) => c.category === 'LOTION',
      );
      expect(lotion.targetCartons).toBe(1000);   // 600 + 400
      expect(lotion.achievedCartons).toBe(400);   // 300 + 100
      expect(lotion.balanceCartons).toBe(600);
      expect(lotion.percentAchieved).toBe(40);
    });

    it('includes allMembers for every user in the downstream tree', async () => {
      mockPrisma.user.findMany
        .mockResolvedValueOnce([{ ...DIRECT_REPORT, id: 'tier3-x', tier: 'TIER3' }])
        .mockResolvedValueOnce([]);

      mockTargets.getMyPerformance
        .mockResolvedValueOnce([PERF_ROW])  // field staff own perf
        .mockResolvedValueOnce([]);

      const result = await service.getDashboard(makeTier('TIER4'), QUERY) as any;
      expect(result.myTeam.rollup.allMembers).toHaveLength(1);
      expect(result.myTeam.rollup.allMembers[0].id).toBe('tier3-x');
    });

    it('handles multiple categories in the rollup', async () => {
      const CREAM_ROW = {
        category: 'CREAM', targetCartons: 500,
        achievedCartons: 200, balanceCartons: 300, percentAchieved: 40,
      };
      mockPrisma.user.findMany
        .mockResolvedValueOnce([{ ...DIRECT_REPORT, id: 'r1', tier: 'TIER3' }])
        .mockResolvedValueOnce([]);

      mockTargets.getMyPerformance
        .mockResolvedValueOnce([PERF_ROW, CREAM_ROW])  // field staff
        .mockResolvedValueOnce([PERF_ROW, CREAM_ROW]); // downstream r1

      const result = await service.getDashboard(makeTier('TIER4'), QUERY) as any;
      expect(result.myTeam.rollup.byCategory).toHaveLength(2);
    });
  });
});