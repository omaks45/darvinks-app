// src/modules/dashboard/dashboard.service.ts
//
// One polymorphic GET /dashboard endpoint — the response shape varies by
// the caller's tier, but the entry point and query contract are identical
// for everyone. Each tier branch is a private method so the whole thing
// stays testable in isolation (mock one branch's dependencies, not all
// eight at once) while still presenting as a single smart endpoint to the
// frontend, per the confirmed design decision.
//
// This service is deliberately a CONSUMER of every other Phase 1-3 service
// rather than re-querying Prisma directly wherever an existing method
// already does the right scoping/validation. Re-implementing "field staff
// see only their own X" a second time here would be exactly the kind of
// DRY violation the rest of this codebase has avoided — if a service
// already answers a sub-question correctly, this service asks it, it
// doesn't re-derive the answer.

import { Injectable } from '@nestjs/common';
import { PurchaseOrderStatus, UserTier } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { AttendanceService } from '@modules/attendance/attendance.service';
import { TargetAssignmentService } from '@modules/target-assignment/target-assignment.service';
import { SecondarySaleService } from '@modules/seconday-sales/seconday-sales.service';
import { CompetitorReportService } from '@modules/competitor-report/competitor-report.service';
import { PurchaseOrderService } from '@modules/purchase/purchase.service';
import { CustomerService } from '@modules/customer/customer.service';
import { WarehouseService } from '@modules/warehouse/warehouse.service';
import { UsersService } from '@modules/user/user.service';
import type { DashboardQueryDto } from './dto/dashboard.dto';

// Bounded-depth descent through the fixed 5-tier cascade
// (Sales Head -> Tier4 -> Tier3 -> Tier2 -> Tier1). Never more than 4 hops
// in the worst case, so an iterative breadth-first walk costs at most 4 DB
// round trips — a recursive CTE would be the right tool for an unbounded
// org chart, but this hierarchy has a known small depth, so the simpler
// approach that stays inside Prisma's query builder (consistent with every
// other service in this codebase, fully mockable in specs) is the correct
// choice here, not a shortcut.
const CASCADE_ORDER: UserTier[] = [
  UserTier.TIER5_SALES_HEAD,
  UserTier.TIER4,
  UserTier.TIER3,
  UserTier.TIER2,
  UserTier.TIER1,
];

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma:           PrismaService,
    private readonly attendance:       AttendanceService,
    private readonly targets:          TargetAssignmentService,
    private readonly secondarySales:   SecondarySaleService,
    private readonly competitorReports: CompetitorReportService,
    private readonly purchaseOrders:   PurchaseOrderService,
    private readonly customers:        CustomerService,
    private readonly warehouse:        WarehouseService,
    private readonly users:            UsersService,
  ) {}

  // ── Entry point ──────────────────────────────────────────────────────────

  async getDashboard(requester: JwtPayload, query: DashboardQueryDto) {
    const now   = new Date();
    const year  = query.year  ?? now.getFullYear();
    const month = query.month ?? now.getMonth() + 1;

    switch (requester.tier) {
      case UserTier.TIER1:
      case UserTier.TIER2:
      case UserTier.TIER3:
      case UserTier.TIER4:
        return this.getFieldStaffDashboard(requester, year, month);

      case UserTier.TIER5_SALES_HEAD:
        return this.getSalesHeadDashboard(requester, year, month);

      case UserTier.TIER5_SALES_SUPPORT:
      case UserTier.TIER6_GM:
        return this.getAdminDashboard(year, month);

      case UserTier.TIER5_FIELD_SUPPORT:
        return this.getFieldSupportDashboard(year, month);

      case UserTier.WAREHOUSE_ADMIN:
        return this.getWarehouseAdminDashboard();

      default:
        // Exhaustiveness guard — if a new UserTier value is ever added to
        // the schema without a matching branch here, fail loudly at
        // runtime rather than silently returning undefined.
        throw new Error(`No dashboard defined for tier: ${requester.tier}`);
    }
  }

  // ── Tier 1-4: Field staff ────────────────────────────────────────────────
  //
  // Shared by every field tier because the underlying activities are
  // identical (clock in, log sales, submit reports) — what differs between
  // a Tier1 and a Tier4 is the SIZE of their downstream team, not the
  // shape of their own dashboard. A Tier1 simply has an empty team rollup.

  private async getFieldStaffDashboard(
    requester: JwtPayload,
    year: number,
    month: number,
  ) {
    const now         = new Date();
    const weekStart   = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay()); // Sunday
    weekStart.setUTCHours(0, 0, 0, 0);

    const [
      clockedInToday,
      myPerformance,
      myDirectReports,
      recentSecondarySales,
      recentCompetitorReports,
      recentPurchaseOrders,
      // Analytics — this week
      weeklyCollections,
      weeklySecondaryInvoices,
      newSecondaryCustomersThisWeek,
      saleItemsRaw,   // invoices with their items — used for both SKU breakdown and daily chart
    ] = await Promise.all([
      this.attendance.hasClockedInToday(requester.sub),
      this.targets.getMyPerformance(requester.sub, year, month),
      this.users.getMyDirectReports(requester),
      this.secondarySales.findAll({}, requester),
      this.competitorReports.findAll({}, requester),
      this.purchaseOrders.findAll({}, requester),

      // Total cash collected this week
      this.prisma.collection.aggregate({
        where: {
          recordedById: requester.sub,
          collectedAt:  { gte: weekStart },
        },
        _sum: { amountKobo: true },
      }),

      // Total from secondary sale invoices this week
      this.prisma.secondarySaleInvoice.aggregate({
        where: {
          soldById:  requester.sub,
          createdAt: { gte: weekStart },
        },
        _sum:   { totalKobo: true },
        _count: { id: true },
      }),

      // New secondary customers created this week
      this.prisma.customer.count({
        where: {
          ownerId:      requester.sub,
          customerType: 'SECONDARY',
          createdAt:    { gte: weekStart },
        },
      }),

      // SKU + daily chart: get all sale items for this agent this week
      // then aggregate in JS — avoids Prisma v7 groupBy circular type errors
      this.prisma.secondarySaleInvoice.findMany({
        where:  { soldById: requester.sub, createdAt: { gte: weekStart } },
        select: {
          id:    true,
          items: {
            select: {
              productId:       true,
              quantityCartons: true,
              lineTotalKobo:   true,
              createdAt:       true,
            },
          },
        },
      }),
    ]);

    // Flatten all items from all invoices
    const allSaleItems: Array<{
      productId:       string;
      quantityCartons: number;
      lineTotalKobo:   bigint;
      createdAt:       Date;
    }> = (saleItemsRaw as any[]).flatMap((inv: any) => inv.items ?? []);

    // Aggregate SKU breakdown by productId — for donut chart
    const skuMap = new Map<string, number>();
    for (const item of allSaleItems) {
      skuMap.set(item.productId, (skuMap.get(item.productId) ?? 0) + item.quantityCartons);
    }
    const productSalesBreakdown = Array.from(skuMap.entries()).map(([productId, qty]) => ({
      productId,
      _sum: { quantityCartons: qty },
    }));

    // Aggregate daily totals for bar chart
    const dailySalesRaw = allSaleItems;

    // Resolve product names for the SKU breakdown
    const productIds = productSalesBreakdown.map((p: any) => p.productId);
    const products   = productIds.length > 0
      ? await this.prisma.product.findMany({
          where:  { id: { in: productIds } },
          select: { id: true, name: true, category: true, imageUrl: true },
        })
      : [];

    const productMap = new Map(products.map((p: any) => [p.id, p]));

    // Total SKU cartons sold this week
    const totalSkuSold = productSalesBreakdown.reduce(
      (sum: number, p: any) => sum + (p._sum.quantityCartons ?? 0),
      0,
    );

    // Total amount received this week (collections + invoice payments)
    const totalCollectionsKobo    = Number(weeklyCollections._sum.amountKobo ?? 0);
    const totalInvoiceTotalKobo   = Number(weeklySecondaryInvoices._sum.totalKobo ?? 0);
    const totalAmountReceivedKobo = totalCollectionsKobo + totalInvoiceTotalKobo;

    // Build daily bar chart data — bucket by day of week
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyTotals: Record<string, number> = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
    for (const row of dailySalesRaw as any[]) {
      const day = DAYS[new Date(row.createdAt).getDay()];
      dailyTotals[day] = (dailyTotals[day] ?? 0) + Number(row.lineTotalKobo ?? 0);
    }

    // SKU breakdown with percentages — for donut chart
    const skuBreakdown = productSalesBreakdown.map((p: any) => {
      const product = productMap.get(p.productId);
      const qty     = p._sum.quantityCartons ?? 0;
      return {
        productId:      p.productId,
        name:           product?.name ?? 'Unknown Product',
        category:       product?.category ?? null,
        imageUrl:       product?.imageUrl ?? null,
        cartonsSOld:    qty,
        percentOfTotal: totalSkuSold > 0 ? Math.round((qty / totalSkuSold) * 100) : 0,
      };
    }).sort((a: any, b: any) => b.cartonsSOld - a.cartonsSOld);

    const teamRollup = await this.getTeamRollup(requester, year, month);

    return {
      tier:   requester.tier,
      status: {
        clockedInToday,
        canPerformFieldActivities: clockedInToday || requester.tier === UserTier.TIER5_SALES_HEAD,
      },
      myPerformance,
      myTeam: {
        directReportCount: myDirectReports.length,
        directReports:     myDirectReports,
        rollup:            teamRollup,
      },
      recentActivity: {
        secondarySales:    recentSecondarySales.slice(0, 10),
        competitorReports: recentCompetitorReports.slice(0, 10),
        purchaseOrders:    recentPurchaseOrders.slice(0, 10),
      },
      // ── Analytics (this week) ──────────────────────────────────────────────
      analytics: {
        period: 'THIS_WEEK',
        // Summary cards
        totalAmountReceivedKobo,
        totalSkuSold,
        newSecondaryCustomers:  newSecondaryCustomersThisWeek,
        targetSummary:          myPerformance, // TGT / ACHV / BAL per category
        // Bar chart — daily sales value (kobo) for last 7 days
        salesOverview: DAYS.map((day) => ({
          day,
          totalKobo: dailyTotals[day] ?? 0,
        })),
        // Donut chart — product breakdown by cartons sold this week
        productBreakdown: skuBreakdown,
      },
    };
  }

  // ── Tier 5: Sales Head ───────────────────────────────────────────────────

  private async getSalesHeadDashboard(
    requester: JwtPayload,
    year: number,
    month: number,
  ) {
    const [
      pendingPOApprovals,
      pendingOutOfRegionRequests,
      recentCompetitorFeed,
      myDirectReports,
      orgWideTargets,
    ] = await Promise.all([
      this.purchaseOrders.findAll({ status: PurchaseOrderStatus.PENDING_APPROVAL }, requester),
      this.customers.findPendingOutOfRegionRequests(requester),
      this.competitorReports.findAll({}, requester),
      this.users.getMyDirectReports(requester), // their Tier4 reports
      this.targets.findAll({ year }, requester),
    ]);

    const teamRollup = await this.getTeamRollup(requester, year, month);

    return {
      tier: requester.tier,
      approvalQueue: {
        pendingPurchaseOrders:      pendingPOApprovals.slice(0, 20),
        pendingOutOfRegionRequests: pendingOutOfRegionRequests.slice(0, 20),
        totalPendingCount:
          pendingPOApprovals.length + pendingOutOfRegionRequests.length,
      },
      myTeam: {
        // directReports = immediate Tier4 ZSMs (who the Sales Head assigns targets to)
        directReportCount: myDirectReports.length,
        directReports:     myDirectReports,
        // allMembers = everyone in the entire downstream tree (Tier4 + Tier3 + Tier2 + Tier1)
        // grouped so the frontend can render the org chart
        allMemberCount: teamRollup.allMembers.length,
        allMembers:     teamRollup.allMembers,
        rollup:         teamRollup,
      },
      targetsAssignedThisYear: orgWideTargets.length,
      competitorActivityFeed: recentCompetitorFeed.slice(0, 15),
    };
  }

  // ── Tier 5 System Admin + Tier 6 GM ─────────────────────────────────────
  //
  // Identical scope, per confirmed decision — GM is not a restricted view.

  private async getAdminDashboard(year: number, month: number) {
    const [
      totalUsers,
      totalActiveCustomers,
      pendingPOApprovals,
      pendingOutOfRegionRequests,
      lowStock,
      recentCompetitorFeed,
      targetsThisYear,
      allUsers,
      // POs that are APPROVED but have no approval receipt yet —
      // Admin needs to upload the receipt so field agents can update their KD ledgers
      posNeedingReceipt,
      // Collections broken down by tier for the current month
      collectionsByTier,
    ] = await Promise.all([
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.customer.count({ where: { isActive: true } }),
      this.prisma.purchaseOrder.count({ where: { status: 'PENDING_APPROVAL' } }),
      this.prisma.outOfRegionRequest.count({ where: { status: 'PENDING' } }),
      this.warehouse.getStockLevels({ lowStockOnly: true }),
      this.prisma.competitorReport.findMany({
        orderBy: { createdAt: 'desc' },
        take:    15,
        select: {
          id: true, region: true, mediaType: true, createdAt: true,
          submittedBy: { select: { fullName: true } },
        },
      }),
      this.prisma.targetAssignment.count({ where: { year } }),
      // All users — Admin can deactivate/reactivate/view any user from here
      this.prisma.user.findMany({
        orderBy: [{ tier: 'asc' }, { fullName: 'asc' }],
        select: {
          id:                true,
          employeeRef:       true,
          fullName:          true,
          email:             true,
          phone:             true,
          tier:              true,
          team:              true,
          region:            true,
          state:             true,
          role:              true,
          roleLabel:         true,
          isActive:          true,
          profilePictureUrl: true,
          idCardUrl:         true,
          createdAt:         true,
          reportsToId:       true,
        },
      }),
      // POsNeedingReceipt: approved POs where the admin has not yet uploaded
      // the approval receipt — the field agent is waiting for this to update
      // their KD ledger. Shown so admin can take immediate action.
      this.prisma.purchaseOrder.findMany({
        where: {
          status:             { in: ['APPROVED', 'PAYMENT_RECEIVED', 'DO_UPLOADED', 'DELIVERED'] },
          approvalReceiptUrl: null,
        },
        select: {
          id:          true,
          orderRef:    true,
          status:      true,
          totalKobo:   true,
          approvedAt:  true,
          customer:    { select: { businessName: true, region: true } },
          createdBy:   { select: { fullName: true, employeeRef: true, tier: true } },
          approvedBy:  { select: { fullName: true } },
        },
        orderBy: { approvedAt: 'asc' }, // oldest approved first — most urgent
        take:    50,
      }),
      // Collections this month — fetch all, aggregate by tier in JS
      this.prisma.collection.findMany({
        where: {
          createdAt: {
            gte: new Date(year, month - 1, 1),
            lt:  new Date(year, month,     1),
          },
        },
        select: {
          amountKobo:   true,
          recordedById: true,
          recordedBy:   { select: { tier: true } },
        },
      }),
    ]);

    // Roll up collections by tier — tier is embedded via recordedBy relation
    const tierCollectionMap = new Map<string, { totalKobo: bigint; count: number }>();
    for (const row of collectionsByTier as any[]) {
      const tier     = row.recordedBy?.tier ?? 'UNKNOWN';
      const existing = tierCollectionMap.get(tier) ?? { totalKobo: BigInt(0), count: 0 };
      tierCollectionMap.set(tier, {
        totalKobo: existing.totalKobo + BigInt(row.amountKobo ?? 0),
        count:     existing.count + 1,
      });
    }

    const collectionSummaryByTier = Array.from(tierCollectionMap.entries())
      .map(([tier, data]) => ({
        tier,
        totalCollectedKobo: data.totalKobo,
        collectionCount:    data.count,
      }))
      .sort((a, b) => a.tier.localeCompare(b.tier));

    const grandTotalCollectedKobo = collectionSummaryByTier.reduce(
      (sum, row) => sum + row.totalCollectedKobo,
      BigInt(0),
    );

    return {
      tier: 'TIER5_SYSTEM_ADMIN_OR_TIER6_GM',
      organisationSummary: {
        totalActiveUsers:        totalUsers,
        totalActiveCustomers:    totalActiveCustomers,
        targetsAssignedThisYear: targetsThisYear,
      },
      approvalQueue: {
        pendingPurchaseOrderCount:      pendingPOApprovals,
        pendingOutOfRegionRequestCount: pendingOutOfRegionRequests,
      },

      // ── Receipt upload queue ──────────────────────────────────────────────
      // POs that have been approved but the admin has not yet uploaded the
      // receipt. Field agents are waiting — upload the receipt so they can
      // update their KD ledger. Upload via:
      //   POST /kd-ledger/by-po/:purchaseOrderId/receipt (multipart, field: file)
      receiptUploadQueue: {
        count: posNeedingReceipt.length,
        items: posNeedingReceipt,
      },

      // ── Collections by tier ───────────────────────────────────────────────
      // How much cash was collected from KDs this month, broken down by the
      // tier of the agent who recorded it.
      collectionsThisMonth: {
        period:                 `${year}-${String(month).padStart(2, '0')}`,
        grandTotalKobo:         grandTotalCollectedKobo,
        byTier:                 collectionSummaryByTier,
      },

      warehouseAlerts: {
        lowStockEntryCount: lowStock.length,
        lowStockEntries:    lowStock.slice(0, 20),
      },
      competitorActivityFeed: recentCompetitorFeed,
      users: allUsers,
    };
  }

  // ── Warehouse Admin ──────────────────────────────────────────────────────
  //
  // Not a sales tier — no Secondary Sales/Target performance concept
  // applies to them at all. Their dashboard is entirely about stock.

  // ── Field Support Agent dashboard ─────────────────────────────────────────
  // Attendance oversight, KD visit monitoring, customer management (all regions)

  private async getFieldSupportDashboard(year: number, month: number) {
    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd   = new Date(Date.UTC(year, month,     1));
    const todayStart  = new Date(new Date().setUTCHours(0, 0, 0, 0));

    const [
      clockedInGroupBy,
      lateCount,
      outsideWindowCount,
      kdVisitsTodayCount,
      totalActiveAgents,
      primaryCount,
      secondaryCount,
      recentFlags,
      recentKdVisits,
      allCustomers,
    ] = await Promise.all([

      // Who clocked in today — distinct userIds, using findMany + JS dedup
      this.prisma.attendanceEvent.findMany({
        where:  { type: 'CLOCK_IN', serverTime: { gte: todayStart } },
        select: { userId: true },
      }),

      // Late clock-ins today
      this.prisma.attendanceEvent.count({
        where: { type: 'CLOCK_IN', flag: 'LATE', serverTime: { gte: todayStart } },
      }),

      // Outside window today
      this.prisma.attendanceEvent.count({
        where: { type: 'CLOCK_IN', flag: 'OUTSIDE_WINDOW', serverTime: { gte: todayStart } },
      }),

      // KD visits today (all tiers 1–4)
      this.prisma.attendanceEvent.count({
        where: { type: 'KD_VISIT', serverTime: { gte: todayStart } },
      }),

      // Active field agents
      this.prisma.user.count({
        where: { isActive: true, tier: { in: ['TIER1', 'TIER2', 'TIER3', 'TIER4'] } },
      }),

      // Primary customer count
      this.prisma.customer.count({ where: { customerType: 'PRIMARY', isActive: true } }),

      // Secondary customer count
      this.prisma.customer.count({ where: { customerType: 'SECONDARY', isActive: true } }),

      // Flagged attendance this month
      this.prisma.attendanceEvent.findMany({
        where: {
          flag:       { in: ['LATE', 'OUTSIDE_WINDOW'] },
          serverTime: { gte: periodStart, lt: periodEnd },
        },
        select: {
          id:         true,
          type:       true,
          flag:       true,
          serverTime: true,
          address:    true,
          latitude:   true,
          longitude:  true,
          user: { select: { id: true, fullName: true, employeeRef: true, tier: true, team: true, region: true } },
        },
        orderBy: { serverTime: 'desc' },
        take:    100,
      }),

      // KD visits this month — includes start and end times
      // Each KD_VISIT_START and KD_VISIT_END pair represents a full visit
      this.prisma.attendanceEvent.findMany({
        where: {
          type:       { in: ['KD_VISIT', 'KD_VISIT_START', 'KD_VISIT_END'] as any },
          serverTime: { gte: periodStart, lt: periodEnd },
        },
        select: {
          id:         true,
          type:       true,
          serverTime: true,
          address:    true,
          latitude:   true,
          longitude:  true,
          note:       true,
          user: { select: { id: true, fullName: true, employeeRef: true, tier: true, team: true, region: true } },
        },
        orderBy: { serverTime: 'desc' },
        take:    200,
      }),

      // All customers with owner info — who created which customer and type
      this.prisma.customer.findMany({
        where:   { isActive: true },
        select: {
          id:                    true,
          businessName:          true,
          address:               true,
          region:                true,
          state:                 true,
          customerType:          true,
          secondaryCustomerType: true,
          balanceKobo:           true,
          isActive:              true,
          owner: {
            select: {
              id:          true,
              fullName:    true,
              employeeRef: true,
              tier:        true,
              team:        true,
              region:      true,
            },
          },
          createdAt: true,
        },
        orderBy: [{ region: 'asc' }, { businessName: 'asc' }],
      }),
    ]);

    const clockedInCount  = new Set((clockedInGroupBy as any[]).map((e: any) => e.userId)).size;
    const notClockedIn    = Math.max(0, totalActiveAgents - clockedInCount);

    // Derive breakdowns from allCustomers list — avoids groupBy type errors
    const countByField = <T extends Record<string, any>>(arr: T[], key: keyof T) => {
      const map: Record<string, number> = {};
      for (const item of arr) {
        const k = String(item[key] ?? 'UNKNOWN');
        map[k] = (map[k] ?? 0) + 1;
      }
      return Object.entries(map).map(([k, count]) => ({ [key as string]: k, count }));
    };

    const byTeam = Object.entries(
      (allCustomers as any[]).reduce((acc: Record<string, number>, c: any) => {
        const t = c.owner?.team ?? 'UNKNOWN';
        acc[t] = (acc[t] ?? 0) + 1;
        return acc;
      }, {}),
    ).map(([team, count]) => ({ team, count }));

    const byRegion = countByField(allCustomers as any[], 'region');
    const byState  = countByField(allCustomers as any[], 'state')
      .sort((a: any, b: any) => b.count - a.count);

    return {
      tier: 'TIER5_FIELD_SUPPORT',

      // ── Attendance today ──────────────────────────────────────────────────
      attendanceToday: {
        totalActiveFieldAgents: totalActiveAgents,
        clockedIn:              clockedInCount,
        notClockedIn,
        late:                   lateCount,
        outsideWindow:          outsideWindowCount,
        onTime:                 clockedInCount - lateCount - outsideWindowCount,
      },

      // ── KD visits today ───────────────────────────────────────────────────
      kdVisitsToday: kdVisitsTodayCount,

      // ── Flagged attendance this month ─────────────────────────────────────
      attendanceFlags: {
        period: `${year}-${String(month).padStart(2, '0')}`,
        count:  recentFlags.length,
        items:  recentFlags,
      },

      // ── KD visit feed this month (start + end pairs) ──────────────────────
      kdVisitFeed: {
        period: `${year}-${String(month).padStart(2, '0')}`,
        count:  recentKdVisits.length,
        items:  recentKdVisits,
      },

      // ── Customer overview with ownership ──────────────────────────────────
      customers: {
        totalPrimary:   primaryCount,
        totalSecondary: secondaryCount,
        total:          primaryCount + secondaryCount,
        byTeam,
        byRegion,
        byState,
        all:             allCustomers,
      },
    };
  }

  private async getWarehouseAdminDashboard() {
    const [allStock, lowStock, recentMovements] = await Promise.all([
      this.warehouse.getStockLevels({}),
      this.warehouse.getStockLevels({ lowStockOnly: true }),
      this.warehouse.getMovements({}),
    ]);

    return {
      tier: 'WAREHOUSE_ADMIN',
      stockSummary: {
        totalProductLocationEntries: allStock.length,
        lowStockCount:               lowStock.length,
        lowStockEntries:             lowStock,
      },
      recentMovements: recentMovements.slice(0, 20),
    };
  }

  // ── Shared: recursive-bounded team rollup ───────────────────────────────

  /**
   * Aggregates target/achievement across the requester's ENTIRE downstream
   * tree, not just direct reports — confirmed requirement. Walks the
   * org-chart one tier at a time via reportsToId, accumulating every user
   * encountered at each level, then sums getMyPerformance() for all of them.
   *
   * Bounded at 4 iterations maximum (the cascade's fixed depth), so this
   * is a small, predictable number of round trips regardless of team size
   * — NOT an N+1 over individual users; each level is one findMany() for
   * however many users are at that level.
   */
  private async getTeamRollup(requester: JwtPayload, year: number, month: number) {
    const allDownstreamUserIds: string[] = [];
    const allDownstreamUsers: Array<{
      id: string; tier: string; employeeRef: string; fullName: string;
      email: string; phone: string; team: string | null; region: string | null;
      state: string | null; profilePictureUrl: string | null;
      idCardUrl: string | null; isActive: boolean; reportsToId: string | null;
    }> = [];
    let currentLevelIds = [requester.sub];

    const cascadeIdx = CASCADE_ORDER.indexOf(requester.tier as UserTier);
    const hasDownstream = cascadeIdx !== -1 && cascadeIdx < CASCADE_ORDER.length - 1;

    if (!hasDownstream) {
      return { totalTeamSize: 0, byCategory: [] };
    }

    // Walk down at most (CASCADE_ORDER.length - 1 - cascadeIdx) levels —
    // for a TIER4 starting point that's 3 levels (Tier3, Tier2, Tier1);
    // for TIER5_SALES_HEAD it's 4. Either way, bounded and small.
    for (let i = 0; i < CASCADE_ORDER.length; i++) {
      const nextLevel = await this.prisma.user.findMany({
        where:  { reportsToId: { in: currentLevelIds } },
        select: {
          id:                true,
          tier:              true,
          employeeRef:       true,
          fullName:          true,
          email:             true,
          phone:             true,
          team:              true,
          region:            true,
          state:             true,
          profilePictureUrl: true,
          idCardUrl:         true,
          isActive:          true,
          reportsToId:       true,
        },
      });
      if (nextLevel.length === 0) break;

      allDownstreamUsers.push(...nextLevel);
      allDownstreamUserIds.push(...nextLevel.map((u) => u.id));
      currentLevelIds = nextLevel.map((u) => u.id);
    }

    if (allDownstreamUserIds.length === 0) {
      return { totalTeamSize: 0, byCategory: [], allMembers: [] };
    }

    // Aggregate every downstream user's performance and roll up by
    // category. Each getMyPerformance() call is itself already batched
    // (no N+1 inside it — see target-assignment.service.ts), so this is
    // "small bounded team size" calls, not "small bounded team size
    // squared" calls.
    const perUserPerformance = await Promise.all(
      allDownstreamUserIds.map((userId) =>
        this.targets.getMyPerformance(userId, year, month),
      ),
    );

    const rollupByCategory = new Map<string, {
      targetCartons: number; achievedCartons: number;
    }>();

    for (const userPerf of perUserPerformance) {
      for (const row of userPerf) {
        const existing = rollupByCategory.get(row.category) ?? {
          targetCartons: 0, achievedCartons: 0,
        };
        existing.targetCartons   += row.targetCartons;
        existing.achievedCartons += row.achievedCartons;
        rollupByCategory.set(row.category, existing);
      }
    }

    const byCategory = Array.from(rollupByCategory.entries()).map(
      ([category, totals]) => ({
        category,
        targetCartons:   totals.targetCartons,
        achievedCartons: totals.achievedCartons,
        balanceCartons:  totals.targetCartons - totals.achievedCartons,
        percentAchieved: totals.targetCartons > 0
          ? Math.round((totals.achievedCartons / totals.targetCartons) * 100)
          : 0,
      }),
    );

    return {
      totalTeamSize: allDownstreamUserIds.length,
      byCategory,
      // Full user profiles for every member in the downstream tree,
      // grouped by tier so the frontend can render a hierarchical view
      allMembers: allDownstreamUsers,
    };
  }
}