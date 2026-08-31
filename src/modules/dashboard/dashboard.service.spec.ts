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
  user:                 { findMany: jest.fn(), count: jest.fn() },
  customer:             { count: jest.fn(), findMany: jest.fn() },
  purchaseOrder:        { count: jest.fn(), findMany: jest.fn() },
  outOfRegionRequest:   { count: jest.fn() },
  competitorReport:     { findMany: jest.fn() },
  targetAssignment:     { findMany: jest.fn(), count: jest.fn() },
  // attendanceEvent uses findMany + count only — no groupBy
  attendanceEvent:      { findMany: jest.fn(), count: jest.fn() },
  // collection uses findMany only — no groupBy
  collection:           { findMany: jest.fn(), aggregate: jest.fn() },
  secondarySaleItem:    { findMany: jest.fn() },
  purchaseOrderItem:    { findMany: jest.fn() },
  // secondarySaleInvoice uses findMany + aggregate
  secondarySaleInvoice: { aggregate: jest.fn(), findMany: jest.fn() },
  product:              { findMany: jest.fn() },
};

const mockAttendance       = { hasClockedInToday: jest.fn() };
const mockTargets          = { getMyPerformance: jest.fn(), findAll: jest.fn() };
const mockSecondarySales   = { findAll: jest.fn() };
const mockCompetitorReports = { findAll: jest.fn() };
const mockPurchaseOrders   = { findAll: jest.fn() };
const mockCustomers        = { findPendingOutOfRegionRequests: jest.fn() };
const mockWarehouse        = { getStockLevels: jest.fn(), getMovements: jest.fn() };
const mockUsers            = { getMyDirectReports: jest.fn() };

// ─── Requester factories ──────────────────────────────────────────────────────

function makeField(tier = 'TIER2'): JwtPayload {
  return { sub: 'agent-id', email: 'a@t.com', tier, team: 'RADIANT', region: 'SOUTH_WEST' } as JwtPayload;
}
function makeSalesHead(): JwtPayload {
  return { sub: 'sh-id', email: 'sh@t.com', tier: 'TIER5_SALES_HEAD', team: 'RADIANT' } as JwtPayload;
}
function makeSalesSupport(): JwtPayload {
  return { sub: 'ss-id', email: 'ss@t.com', tier: 'TIER5_SALES_SUPPORT', team: 'RADIANT' } as JwtPayload;
}
function makeFieldSupport(): JwtPayload {
  return { sub: 'fs-id', email: 'fs@t.com', tier: 'TIER5_FIELD_SUPPORT', team: 'RADIANT' } as JwtPayload;
}
function makeGM(): JwtPayload {
  return { sub: 'gm-id', email: 'gm@t.com', tier: 'TIER6_GM', team: 'RADIANT' } as JwtPayload;
}
function makeWarehouseAdmin(): JwtPayload {
  return { sub: 'wh-id', email: 'wh@t.com', tier: 'WAREHOUSE_ADMIN', team: 'RADIANT' } as JwtPayload;
}

// ─── Default mocks ────────────────────────────────────────────────────────────

function setupDefaults() {
  // Service mocks
  mockAttendance.hasClockedInToday.mockResolvedValue(true);
  mockTargets.getMyPerformance.mockResolvedValue([]);
  mockTargets.findAll.mockResolvedValue([]);
  mockSecondarySales.findAll.mockResolvedValue([]);
  mockCompetitorReports.findAll.mockResolvedValue([]);
  mockPurchaseOrders.findAll.mockResolvedValue([]);
  mockCustomers.findPendingOutOfRegionRequests.mockResolvedValue([]);
  mockWarehouse.getStockLevels.mockResolvedValue([]);
  mockWarehouse.getMovements.mockResolvedValue([]);
  mockUsers.getMyDirectReports.mockResolvedValue([]);

  // Prisma mocks — all findMany (no groupBy anywhere)
  mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);
  mockPrisma.attendanceEvent.count.mockResolvedValue(0);
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.user.count.mockResolvedValue(10);
  mockPrisma.customer.count.mockResolvedValue(5);
  mockPrisma.customer.findMany.mockResolvedValue([]);
  mockPrisma.purchaseOrder.count.mockResolvedValue(0);
  mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
  mockPrisma.outOfRegionRequest.count.mockResolvedValue(0);
  mockPrisma.competitorReport.findMany.mockResolvedValue([]);
  mockPrisma.targetAssignment.findMany.mockResolvedValue([]);
  mockPrisma.targetAssignment.count.mockResolvedValue(0);
  // collection uses findMany now — returns rows with amountKobo + recordedBy.tier
  mockPrisma.collection.findMany.mockResolvedValue([]);
  mockPrisma.collection.aggregate.mockResolvedValue({ _sum: { amountKobo: BigInt(0) } });
  // secondarySaleInvoice.findMany returns invoices with embedded items
  mockPrisma.secondarySaleInvoice.findMany.mockResolvedValue([]);
  mockPrisma.secondarySaleInvoice.aggregate.mockResolvedValue({
    _sum: { totalKobo: BigInt(0) }, _count: { id: 0 },
  });
  mockPrisma.secondarySaleItem.findMany.mockResolvedValue([]);
  mockPrisma.purchaseOrderItem.findMany.mockResolvedValue([]);
  mockPrisma.product.findMany.mockResolvedValue([]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService,           useValue: mockPrisma },
        { provide: AttendanceService,       useValue: mockAttendance },
        { provide: TargetAssignmentService, useValue: mockTargets },
        { provide: SecondarySaleService,    useValue: mockSecondarySales },
        { provide: CompetitorReportService, useValue: mockCompetitorReports },
        { provide: PurchaseOrderService,    useValue: mockPurchaseOrders },
        { provide: CustomerService,         useValue: mockCustomers },
        { provide: WarehouseService,        useValue: mockWarehouse },
        { provide: UsersService,            useValue: mockUsers },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    jest.resetAllMocks();
    setupDefaults();
  });

  // ── Tier routing ───────────────────────────────────────────────────────────

  describe('getDashboard() — tier routing', () => {
    it('routes Tier 1 to field staff dashboard', async () => {
      const result = await service.getDashboard(makeField('TIER1'), { year: 2026, month: 8 }) as any;
      expect(result.tier).toBe('TIER1');
    });

    it('routes Tier 2 to field staff dashboard', async () => {
      const result = await service.getDashboard(makeField('TIER2'), { year: 2026, month: 8 }) as any;
      expect(result.tier).toBe('TIER2');
    });

    it('routes Tier 3 to field staff dashboard', async () => {
      const result = await service.getDashboard(makeField('TIER3'), { year: 2026, month: 8 }) as any;
      expect(result.tier).toBe('TIER3');
    });

    it('routes Tier 4 to field staff dashboard', async () => {
      const result = await service.getDashboard(makeField('TIER4'), { year: 2026, month: 8 }) as any;
      expect(result.tier).toBe('TIER4');
    });

    it('routes TIER5_SALES_HEAD to sales head dashboard', async () => {
      const result = await service.getDashboard(makeSalesHead(), { year: 2026, month: 8 }) as any;
      expect(result.tier).toBe('TIER5_SALES_HEAD');
    });

    it('routes TIER5_SALES_SUPPORT to admin dashboard', async () => {
      const result = await service.getDashboard(makeSalesSupport(), { year: 2026, month: 8 }) as any;
      expect(result.tier).toBe('TIER5_SYSTEM_ADMIN_OR_TIER6_GM');
    });

    it('routes TIER6_GM to admin dashboard', async () => {
      const result = await service.getDashboard(makeGM(), { year: 2026, month: 8 }) as any;
      expect(result.tier).toBe('TIER5_SYSTEM_ADMIN_OR_TIER6_GM');
    });

    it('routes TIER5_FIELD_SUPPORT to field support dashboard', async () => {
      const result = await service.getDashboard(makeFieldSupport(), { year: 2026, month: 8 }) as any;
      expect(result.tier).toBe('TIER5_FIELD_SUPPORT');
    });

    it('routes WAREHOUSE_ADMIN to warehouse dashboard', async () => {
      const result = await service.getDashboard(makeWarehouseAdmin(), { year: 2026, month: 8 }) as any;
      expect(result.tier).toBe('WAREHOUSE_ADMIN');
    });

    it('throws for an unknown tier', async () => {
      const bogus = { sub: 'x', tier: 'UNKNOWN_TIER', team: 'RADIANT' } as any;
      await expect(service.getDashboard(bogus, { year: 2026, month: 8 })).rejects.toThrow();
    });
  });

  // ── Field Staff Dashboard ──────────────────────────────────────────────────

  describe('Field Staff Dashboard (Tier 1–4)', () => {
    it('includes clockedInToday status', async () => {
      mockAttendance.hasClockedInToday.mockResolvedValue(true);
      const result = await service.getDashboard(makeField('TIER2'), { year: 2026, month: 8 }) as any;
      expect(result.status.clockedInToday).toBe(true);
    });

    it('includes myPerformance array', async () => {
      const result = await service.getDashboard(makeField('TIER2'), { year: 2026, month: 8 }) as any;
      expect(Array.isArray(result.myPerformance)).toBe(true);
    });

    it('includes myTeam with directReportCount', async () => {
      mockUsers.getMyDirectReports.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      const result = await service.getDashboard(makeField('TIER3'), { year: 2026, month: 8 }) as any;
      expect(result.myTeam.directReportCount).toBe(2);
    });

    it('includes recentActivity with three sub-arrays', async () => {
      const result = await service.getDashboard(makeField('TIER2'), { year: 2026, month: 8 }) as any;
      expect(result.recentActivity).toHaveProperty('secondarySales');
      expect(result.recentActivity).toHaveProperty('competitorReports');
      expect(result.recentActivity).toHaveProperty('purchaseOrders');
    });

    // ── Analytics block ──────────────────────────────────────────────────────

    describe('analytics — this week', () => {
      it('includes analytics object with period = THIS_WEEK', async () => {
        const result = await service.getDashboard(makeField('TIER2'), { year: 2026, month: 8 }) as any;
        expect(result.analytics.period).toBe('THIS_WEEK');
      });

      it('includes totalAmountReceivedKobo', async () => {
        const result = await service.getDashboard(makeField('TIER2'), { year: 2026, month: 8 }) as any;
        expect(result.analytics).toHaveProperty('totalAmountReceivedKobo');
      });

      it('includes totalSkuSold', async () => {
        const result = await service.getDashboard(makeField('TIER2'), { year: 2026, month: 8 }) as any;
        expect(result.analytics).toHaveProperty('totalSkuSold');
      });

      it('includes newSecondaryCustomers', async () => {
        const result = await service.getDashboard(makeField('TIER2'), { year: 2026, month: 8 }) as any;
        expect(result.analytics).toHaveProperty('newSecondaryCustomers');
      });

      it('salesOverview has exactly 7 day entries Sun–Sat', async () => {
        const result = await service.getDashboard(makeField('TIER2'), { year: 2026, month: 8 }) as any;
        expect(result.analytics.salesOverview).toHaveLength(7);
        expect(result.analytics.salesOverview.map((d: any) => d.day))
          .toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
      });

      it('productBreakdown is an array', async () => {
        const result = await service.getDashboard(makeField('TIER2'), { year: 2026, month: 8 }) as any;
        expect(Array.isArray(result.analytics.productBreakdown)).toBe(true);
      });

      it('totalAmountReceived combines collections aggregate + invoice aggregate', async () => {
        mockPrisma.collection.aggregate.mockResolvedValue({
          _sum: { amountKobo: BigInt(500000000) },
        });
        mockPrisma.secondarySaleInvoice.aggregate.mockResolvedValue({
          _sum: { totalKobo: BigInt(300000000) }, _count: { id: 3 },
        });
        const result = await service.getDashboard(makeField('TIER2'), { year: 2026, month: 8 }) as any;
        // 500_000_000 + 300_000_000 = 800_000_000
        expect(result.analytics.totalAmountReceivedKobo).toBe(800000000);
      });

      it('productBreakdown derives name from product lookup', async () => {
        // secondarySaleInvoice.findMany returns invoice with embedded items
        mockPrisma.secondarySaleInvoice.findMany.mockResolvedValue([{
          id:    'inv-1',
          items: [{ productId: 'prod-a', quantityCartons: 50, lineTotalKobo: BigInt(3150000), createdAt: new Date() }],
        }]);
        mockPrisma.product.findMany.mockResolvedValue([{
          id:       'prod-a',
          name:     'Visita Essence B Whitening Lotion 250ml',
          category: 'LOTION',
          imageUrl: null,
        }]);
        const result = await service.getDashboard(makeField('TIER2'), { year: 2026, month: 8 }) as any;
        const breakdown = result.analytics.productBreakdown;
        expect(breakdown).toHaveLength(1);
        expect(breakdown[0].name).toBe('Visita Essence B Whitening Lotion 250ml');
        expect(breakdown[0].cartonsSOld).toBe(50);
        expect(breakdown[0].percentOfTotal).toBe(100);
      });

      it('totalSkuSold sums cartons across all products', async () => {
        mockPrisma.secondarySaleInvoice.findMany.mockResolvedValue([{
          id:    'inv-1',
          items: [
            { productId: 'prod-a', quantityCartons: 30, lineTotalKobo: BigInt(0), createdAt: new Date() },
            { productId: 'prod-b', quantityCartons: 20, lineTotalKobo: BigInt(0), createdAt: new Date() },
          ],
        }]);
        const result = await service.getDashboard(makeField('TIER2'), { year: 2026, month: 8 }) as any;
        expect(result.analytics.totalSkuSold).toBe(50);
      });

      it('daily bar chart buckets items by day of week', async () => {
        const monday = new Date('2026-08-17T10:00:00Z'); // Monday
        mockPrisma.secondarySaleInvoice.findMany.mockResolvedValue([{
          id:    'inv-1',
          items: [{ productId: 'prod-a', quantityCartons: 10, lineTotalKobo: BigInt(630000000), createdAt: monday }],
        }]);
        const result = await service.getDashboard(makeField('TIER2'), { year: 2026, month: 8 }) as any;
        const mon = result.analytics.salesOverview.find((d: any) => d.day === 'Mon');
        expect(mon.totalKobo).toBe(630000000);
      });
    });
  });

  // ── Sales Head Dashboard ───────────────────────────────────────────────────

  describe('Sales Head Dashboard', () => {
    it('includes approvalQueue with pendingPurchaseOrders', async () => {
      const result = await service.getDashboard(makeSalesHead(), { year: 2026, month: 8 }) as any;
      expect(result.approvalQueue).toHaveProperty('pendingPurchaseOrders');
    });

    it('includes approvalQueue with pendingOutOfRegionRequests', async () => {
      const result = await service.getDashboard(makeSalesHead(), { year: 2026, month: 8 }) as any;
      expect(result.approvalQueue).toHaveProperty('pendingOutOfRegionRequests');
    });

    it('totalPendingCount reflects sum of both queues', async () => {
      mockPurchaseOrders.findAll.mockResolvedValue([{ id: 'po-1' }, { id: 'po-2' }]);
      mockCustomers.findPendingOutOfRegionRequests.mockResolvedValue([{ id: 'req-1' }]);
      const result = await service.getDashboard(makeSalesHead(), { year: 2026, month: 8 }) as any;
      expect(result.approvalQueue.totalPendingCount).toBe(3);
    });

    it('includes competitorActivityFeed', async () => {
      const result = await service.getDashboard(makeSalesHead(), { year: 2026, month: 8 }) as any;
      expect(result).toHaveProperty('competitorActivityFeed');
    });

    it('includes myTeam with directReports', async () => {
      const result = await service.getDashboard(makeSalesHead(), { year: 2026, month: 8 }) as any;
      expect(result.myTeam).toHaveProperty('directReports');
    });
  });

  // ── Sales Support Agent Dashboard ──────────────────────────────────────────

  describe('Sales Support Agent Dashboard (formerly System Admin)', () => {
    it('includes organisationSummary with totalActiveUsers and totalActiveCustomers', async () => {
      const result = await service.getDashboard(makeSalesSupport(), { year: 2026, month: 8 }) as any;
      expect(result.organisationSummary).toHaveProperty('totalActiveUsers');
      expect(result.organisationSummary).toHaveProperty('totalActiveCustomers');
    });

    it('includes receiptUploadQueue with count and items', async () => {
      const result = await service.getDashboard(makeSalesSupport(), { year: 2026, month: 8 }) as any;
      expect(result.receiptUploadQueue).toHaveProperty('count');
      expect(result.receiptUploadQueue).toHaveProperty('items');
    });

    it('includes collectionsThisMonth with byTier and grandTotalKobo', async () => {
      const result = await service.getDashboard(makeSalesSupport(), { year: 2026, month: 8 }) as any;
      expect(result.collectionsThisMonth).toHaveProperty('byTier');
      expect(result.collectionsThisMonth).toHaveProperty('grandTotalKobo');
    });

    it('collects tier rollup from findMany rows with embedded recordedBy.tier', async () => {
      // collection.findMany now returns rows with amountKobo + recordedBy.tier
      mockPrisma.collection.findMany.mockResolvedValue([
        { amountKobo: BigInt(500000000), recordedById: 'u1', recordedBy: { tier: 'TIER2' } },
        { amountKobo: BigInt(300000000), recordedById: 'u2', recordedBy: { tier: 'TIER2' } },
        { amountKobo: BigInt(200000000), recordedById: 'u3', recordedBy: { tier: 'TIER3' } },
      ]);
      const result = await service.getDashboard(makeSalesSupport(), { year: 2026, month: 8 }) as any;
      const tier2  = result.collectionsThisMonth.byTier.find((t: any) => t.tier === 'TIER2');
      const tier3  = result.collectionsThisMonth.byTier.find((t: any) => t.tier === 'TIER3');
      expect(tier2?.collectionCount).toBe(2);
      expect(tier3?.collectionCount).toBe(1);
    });

    it('grandTotalKobo sums all collection amounts', async () => {
      mockPrisma.collection.findMany.mockResolvedValue([
        { amountKobo: BigInt(500000000), recordedById: 'u1', recordedBy: { tier: 'TIER2' } },
        { amountKobo: BigInt(300000000), recordedById: 'u2', recordedBy: { tier: 'TIER3' } },
      ]);
      const result = await service.getDashboard(makeSalesSupport(), { year: 2026, month: 8 }) as any;
      expect(result.collectionsThisMonth.grandTotalKobo).toBe(BigInt(800000000));
    });

    it('includes warehouseAlerts', async () => {
      const result = await service.getDashboard(makeSalesSupport(), { year: 2026, month: 8 }) as any;
      expect(result).toHaveProperty('warehouseAlerts');
    });

    it('GM receives same dashboard shape as Sales Support Agent', async () => {
      const ss = await service.getDashboard(makeSalesSupport(), { year: 2026, month: 8 }) as any;
      const gm = await service.getDashboard(makeGM(),           { year: 2026, month: 8 }) as any;
      expect(ss.tier).toBe(gm.tier);
      expect(ss.tier).toBe('TIER5_SYSTEM_ADMIN_OR_TIER6_GM');
    });
  });

  // ── Field Support Agent Dashboard ─────────────────────────────────────────

  describe('Field Support Agent Dashboard', () => {
    it('includes attendanceToday with all 6 fields', async () => {
      const result = await service.getDashboard(makeFieldSupport(), { year: 2026, month: 8 }) as any;
      const a = result.attendanceToday;
      expect(a).toHaveProperty('totalActiveFieldAgents');
      expect(a).toHaveProperty('clockedIn');
      expect(a).toHaveProperty('notClockedIn');
      expect(a).toHaveProperty('late');
      expect(a).toHaveProperty('outsideWindow');
      expect(a).toHaveProperty('onTime');
    });

    it('clockedIn uses distinct userId count from attendanceEvent.findMany', async () => {
      // findMany returns rows — service deduplicates via Set
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([
        { userId: 'u1' }, { userId: 'u2' }, { userId: 'u2' }, // u2 appears twice — still 2 unique
      ]);
      mockPrisma.user.count.mockResolvedValue(10);
      const result = await service.getDashboard(makeFieldSupport(), { year: 2026, month: 8 }) as any;
      expect(result.attendanceToday.clockedIn).toBe(2);
      expect(result.attendanceToday.notClockedIn).toBe(8); // 10 - 2
    });

    it('notClockedIn cannot be negative when more clocked in than total agents', async () => {
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([
        { userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' },
      ]);
      mockPrisma.user.count.mockResolvedValue(2); // edge case
      const result = await service.getDashboard(makeFieldSupport(), { year: 2026, month: 8 }) as any;
      expect(result.attendanceToday.notClockedIn).toBe(0); // Math.max(0, ...)
    });

    it('includes kdVisitsToday from attendanceEvent.count', async () => {
      mockPrisma.attendanceEvent.count.mockResolvedValue(14);
      const result = await service.getDashboard(makeFieldSupport(), { year: 2026, month: 8 }) as any;
      expect(result.kdVisitsToday).toBe(14);
    });

    it('includes attendanceFlags with period and items array', async () => {
      const result = await service.getDashboard(makeFieldSupport(), { year: 2026, month: 8 }) as any;
      expect(result.attendanceFlags.period).toBe('2026-08');
      expect(Array.isArray(result.attendanceFlags.items)).toBe(true);
    });

    it('includes kdVisitFeed with period and items array', async () => {
      const result = await service.getDashboard(makeFieldSupport(), { year: 2026, month: 8 }) as any;
      expect(result.kdVisitFeed.period).toBe('2026-08');
      expect(Array.isArray(result.kdVisitFeed.items)).toBe(true);
    });

    it('includes customers with totalPrimary, totalSecondary, total, all', async () => {
      mockPrisma.customer.count
        .mockResolvedValueOnce(120)  // primary
        .mockResolvedValueOnce(340); // secondary
      const result = await service.getDashboard(makeFieldSupport(), { year: 2026, month: 8 }) as any;
      expect(result.customers.totalPrimary).toBe(120);
      expect(result.customers.totalSecondary).toBe(340);
      expect(result.customers.total).toBe(460);
      expect(Array.isArray(result.customers.all)).toBe(true);
    });

    it('byTeam groups customers by owner.team field', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        { id: '1', region: 'SOUTH_WEST', state: 'lagos', owner: { id: 'u1', fullName: 'A', employeeRef: 'D1', tier: 'TIER2', team: 'RADIANT', region: 'SOUTH_WEST' } },
        { id: '2', region: 'SOUTH_WEST', state: 'lagos', owner: { id: 'u2', fullName: 'B', employeeRef: 'D2', tier: 'TIER2', team: 'RADIANT', region: 'SOUTH_WEST' } },
        { id: '3', region: 'NORTH_BRIGHT', state: 'kogi', owner: { id: 'u3', fullName: 'C', employeeRef: 'D3', tier: 'TIER2', team: 'BRIGHT', region: 'NORTH_BRIGHT' } },
      ]);
      const result = await service.getDashboard(makeFieldSupport(), { year: 2026, month: 8 }) as any;
      const radiant = result.customers.byTeam.find((t: any) => t.team === 'RADIANT');
      const bright  = result.customers.byTeam.find((t: any) => t.team === 'BRIGHT');
      expect(radiant?.count).toBe(2);
      expect(bright?.count).toBe(1);
    });

    it('byRegion groups customers by region field', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        { id: '1', region: 'SOUTH_WEST',  state: 'lagos', owner: { team: 'RADIANT' } },
        { id: '2', region: 'SOUTH_WEST',  state: 'ogun',  owner: { team: 'RADIANT' } },
        { id: '3', region: 'NORTH_BRIGHT', state: 'kogi',  owner: { team: 'BRIGHT'  } },
      ]);
      const result = await service.getDashboard(makeFieldSupport(), { year: 2026, month: 8 }) as any;
      const sw = result.customers.byRegion.find((r: any) => r.region === 'SOUTH_WEST');
      expect(sw?.count).toBe(2);
    });

    it('byState groups customers by state and sorts by count descending', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        { id: '1', region: 'SOUTH_WEST', state: 'lagos', owner: { team: 'RADIANT' } },
        { id: '2', region: 'SOUTH_WEST', state: 'lagos', owner: { team: 'RADIANT' } },
        { id: '3', region: 'SOUTH_WEST', state: 'ogun',  owner: { team: 'RADIANT' } },
      ]);
      const result = await service.getDashboard(makeFieldSupport(), { year: 2026, month: 8 }) as any;
      expect(result.customers.byState[0].state).toBe('lagos'); // highest count first
      expect(result.customers.byState[0].count).toBe(2);
    });

    it('customer.all includes owner object showing who created each customer', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([{
        id:           'cust-1',
        businessName: 'Ore Ofe Distributors',
        customerType: 'PRIMARY',
        team:         'RADIANT',
        region:       'SOUTH_WEST',
        state:        'lagos',
        owner: {
          id:          'agent-id',
          fullName:    'Kenny Solape',
          employeeRef: 'Dar-00000007',
          tier:        'TIER2',
          team:        'RADIANT',
          region:      'SOUTH_WEST',
        },
        createdAt: new Date(),
      }]);
      const result = await service.getDashboard(makeFieldSupport(), { year: 2026, month: 8 }) as any;
      expect(result.customers.all[0].owner.fullName).toBe('Kenny Solape');
      expect(result.customers.all[0].owner.tier).toBe('TIER2');
    });
  });

  // ── Warehouse Admin Dashboard ──────────────────────────────────────────────

  describe('Warehouse Admin Dashboard', () => {
    it('includes stockSummary and recentMovements', async () => {
      const result = await service.getDashboard(makeWarehouseAdmin(), { year: 2026, month: 8 }) as any;
      expect(result.tier).toBe('WAREHOUSE_ADMIN');
      expect(result).toHaveProperty('stockSummary');
      expect(result).toHaveProperty('recentMovements');
    });
  });

  // ── Query parameter defaults ───────────────────────────────────────────────

  describe('query defaults', () => {
    it('works without year or month — defaults to current period', async () => {
      await expect(service.getDashboard(makeField('TIER2'), {})).resolves.not.toThrow();
    });

    it('works with only year provided', async () => {
      await expect(service.getDashboard(makeField('TIER2'), { year: 2026 })).resolves.not.toThrow();
    });
  });
});