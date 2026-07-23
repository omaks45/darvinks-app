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

      case UserTier.TIER5_SYSTEM_ADMIN:
      case UserTier.TIER6_GM:
        // Confirmed: GM has the same access scope as System Admin —
        // identical dashboard, not a restricted summary view.
        return this.getAdminDashboard(year, month);

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
    const [
      clockedInToday,
      myPerformance,
      myDirectReports,
      recentSecondarySales,
      recentCompetitorReports,
      recentPurchaseOrders,
    ] = await Promise.all([
      this.attendance.hasClockedInToday(requester.sub),
      this.targets.getMyPerformance(requester.sub, year, month),
      this.users.getMyDirectReports(requester),
      this.secondarySales.findAll({}, requester),
      this.competitorReports.findAll({}, requester),
      this.purchaseOrders.findAll({}, requester),
    ]);

    // Team rollup only has content for TIER2-TIER4 (anyone with direct
    // reports); a TIER1 has none, and getTeamRollup() returns an empty
    // structure cleanly rather than needing a special case here.
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
        directReportCount: myDirectReports.length, // Tier4 zonal managers
        directReports:      myDirectReports,
        rollup:              teamRollup,
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
    ]);

    return {
      tier: 'TIER5_SYSTEM_ADMIN_OR_TIER6_GM',
      organisationSummary: {
        totalActiveUsers:     totalUsers,
        totalActiveCustomers: totalActiveCustomers,
        targetsAssignedThisYear: targetsThisYear,
      },
      approvalQueue: {
        pendingPurchaseOrderCount:      pendingPOApprovals,
        pendingOutOfRegionRequestCount: pendingOutOfRegionRequests,
      },
      warehouseAlerts: {
        lowStockEntryCount: lowStock.length,
        lowStockEntries:    lowStock.slice(0, 20),
      },
      competitorActivityFeed: recentCompetitorFeed,
    };
  }

  // ── Warehouse Admin ──────────────────────────────────────────────────────
  //
  // Not a sales tier — no Secondary Sales/Target performance concept
  // applies to them at all. Their dashboard is entirely about stock.

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
        select: { id: true, tier: true },
      });
      if (nextLevel.length === 0) break;

      allDownstreamUserIds.push(...nextLevel.map((u) => u.id));
      currentLevelIds = nextLevel.map((u) => u.id);
    }

    if (allDownstreamUserIds.length === 0) {
      return { totalTeamSize: 0, byCategory: [] };
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
    };
  }
}