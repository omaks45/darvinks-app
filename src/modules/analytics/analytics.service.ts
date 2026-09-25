// src/modules/analytics/analytics.service.ts
//
// Central data aggregation layer for the weekly analytics report.
// Separated from generation (PPT/Excel) so both the scheduled job and
// the on-demand download endpoint share one source of truth for numbers.
// Never modifies data — reads only.

import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { Region, Team, UserTier, TargetCategory } from '@prisma/client';

export interface LocationPerformanceRow {
  locationId:      string;
  locationName:    string;
  state:           string;
  region:          string;
  category:        TargetCategory;
  targetValue:     number;   // cartons or kobo depending on category
  achievedValue:   number;
  balanceValue:    number;
  percentAchieved: number;
}

export interface UserPerformanceRow {
  userId:      string;
  fullName:    string;
  employeeRef: string;
  tier:        string;
  region:      string | null;
  category:    string;
  targetCartons:   number;
  achievedCartons: number;
  balanceCartons:  number;
  percentAchieved: number;
}

export interface AnalyticsReportData {
  periodMonth:          string;        // "2026-07"
  generatedAt:          Date;
  locationPerformance:  LocationPerformanceRow[];
  userPerformance:      UserPerformanceRow[];
  orgSummary: {
    totalActiveUsers:     number;
    totalActiveCustomers: number;
    totalCollectionsKobo: number;
    totalPOValueKobo:     number;
    totalSecondarySaleCartons: number;
  };
}

// ── Admin summary filter DTO (inline — avoids creating a separate DTO file) ──
export interface AdminSummaryFilters {
  team?:   Team;
  region?: Region;
  tier?:   UserTier;
  from?:   string;  // ISO date string e.g. "2026-07-01"
  to?:     string;  // ISO date string e.g. "2026-07-31" (exclusive)
}

// Tiers allowed to use the field-agent dashboard (have reportsTo chains)
const FIELD_TIERS = new Set(['TIER1', 'TIER2', 'TIER3', 'TIER4']);

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregates all data for a given period.
   * Called by both the weekly BullMQ job and the on-demand download endpoint.
   */
  async buildReportData(
    period: string,
    periodType: 'weekly' | 'monthly' | 'quarterly' | 'annual' = 'monthly',
  ): Promise<AnalyticsReportData> {
    this.logger.log(`Building analytics report — ${periodType}: ${period}`);

    const { startDate, endDate, periodMonth } =
      this.resolveDateRange(period, periodType);

    const [year, month] = [startDate.getFullYear(), startDate.getMonth() + 1];

    const [locationPerformance, userPerformance, orgSummary] =
      await Promise.all([
        this.buildLocationPerformance(periodMonth, startDate, endDate),
        this.buildUserPerformance(year, month, startDate, endDate),
        this.buildOrgSummary(startDate, endDate),
      ]);

    return {
      periodMonth: period,
      generatedAt: new Date(),
      locationPerformance,
      userPerformance,
      orgSummary,
    };
  }

  // ── Admin summary endpoint ─────────────────────────────────────────────────

  /**
   * Dashboard totals for TIER5_SALES_SUPPORT and TIER6_GM.
   *
   * Returns:
   *   totalCollectionsKobo  — sum of amountKobo from approved Collections
   *   totalSalesCount       — count of APPROVED PurchaseOrders
   *   totalSalesValueKobo   — sum of totalKobo from APPROVED PurchaseOrders
   *
   * All filters are combinable (AND semantics):
   *   team   — filter by team of the user who created the record
   *   region — filter by region of the user who created the record
   *   tier   — filter by tier of the user who created the record
   *   from   — inclusive start date (collectedAt / createdAt ≥ from)
   *   to     — exclusive end date   (collectedAt / createdAt < to)
   *
   * When from/to are omitted the query covers all time.
   */
  async getAdminSummary(filters: AdminSummaryFilters) {
    const from = filters.from ? new Date(filters.from) : undefined;
    const to   = filters.to   ? new Date(filters.to)   : undefined;

    // Build a where clause for the users whose records we want
    const userWhere: Record<string, unknown> = {};
    if (filters.team)   userWhere.team   = filters.team;
    if (filters.region) userWhere.region = filters.region;
    if (filters.tier)   userWhere.tier   = filters.tier;

    const hasUserFilter = Object.keys(userWhere).length > 0;

    // ── Collections ──────────────────────────────────────────────────────────
    const collectionWhere: Record<string, unknown> = {};
    if (from || to) {
      collectionWhere.collectedAt = {
        ...(from ? { gte: from } : {}),
        ...(to   ? { lt:  to  } : {}),
      };
    }
    if (hasUserFilter) {
      collectionWhere.recordedBy = { is: userWhere };
    }

    // ── Purchase Orders ───────────────────────────────────────────────────────
    const poWhere: Record<string, unknown> = { status: 'APPROVED' };
    if (from || to) {
      poWhere.createdAt = {
        ...(from ? { gte: from } : {}),
        ...(to   ? { lt:  to  } : {}),
      };
    }
    if (hasUserFilter) {
      poWhere.createdBy = { is: userWhere };
    }

    const [collectionsAgg, posAgg, posCount] = await Promise.all([
      this.prisma.collection.aggregate({
        where: collectionWhere as any,
        _sum:  { amountKobo: true },
      }),
      this.prisma.purchaseOrder.aggregate({
        where: poWhere as any,
        _sum:  { totalKobo: true },
      }),
      this.prisma.purchaseOrder.count({
        where: poWhere as any,
      }),
    ]);

    return {
      totalCollectionsKobo: Number(collectionsAgg._sum.amountKobo ?? 0),
      totalSalesCount:      posCount,
      totalSalesValueKobo:  Number(posAgg._sum.totalKobo           ?? 0),
    };
  }

  /**
   * Field-agent dashboard: monthly by default.
   *
   * Visibility rules:
   *   TIER1        → their own data only (no chain)
   *   TIER2–TIER4  → rollup across their full subtree (BFS via getChainUserIds)
   *   Others       → use getPersonalAnalytics directly
   *
   * period:     "2026-08" (monthly default)
   * periodType: 'monthly' (default)
   */
  async getFieldDashboard(
    requester: { sub: string; tier: string },
    period:      string,
    periodType:  'weekly' | 'monthly' | 'quarterly' | 'annual' = 'monthly',
  ) {
    // TIER1 sees only themselves; TIER2+ get their full subtree
    const includeChain = requester.tier !== 'TIER1' && FIELD_TIERS.has(requester.tier);

    return this.getPersonalAnalytics(
      requester,
      period,
      periodType,
      undefined,
      includeChain,
    );
  }

  /**
   * Resolves a human-readable period string into a concrete date range.
   */
  private resolveDateRange(
    period: string,
    periodType: 'weekly' | 'monthly' | 'quarterly' | 'annual',
  ): { startDate: Date; endDate: Date; periodMonth: string } {
    switch (periodType) {
      case 'monthly': {
        const [y, m] = period.split('-').map(Number);
        return {
          startDate:   new Date(y, m - 1, 1),
          endDate:     new Date(y, m, 1),
          periodMonth: period,
        };
      }
      case 'quarterly': {
        const [y, q] = period.split('-Q').map(Number);
        const startMonth = (q - 1) * 3;
        return {
          startDate:   new Date(y, startMonth, 1),
          endDate:     new Date(y, startMonth + 3, 1),
          periodMonth: `${y}-${String(startMonth + 1).padStart(2, '0')}`,
        };
      }
      case 'annual': {
        const y = Number(period);
        return {
          startDate:   new Date(y, 0, 1),
          endDate:     new Date(y + 1, 0, 1),
          periodMonth: `${y}-01`,
        };
      }
      case 'weekly': {
        const [y, w] = period.split('-W').map(Number);
        const jan4   = new Date(y, 0, 4);
        const week1Monday = new Date(jan4);
        week1Monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
        const monday = new Date(week1Monday);
        monday.setDate(week1Monday.getDate() + (w - 1) * 7);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 7);
        return {
          startDate:   monday,
          endDate:     sunday,
          periodMonth: `${y}-${String(monday.getMonth() + 1).padStart(2, '0')}`,
        };
      }
    }
  }

  // ── Location performance ───────────────────────────────────────────────────

  private async buildLocationPerformance(
    periodMonth:  string,
    startOfMonth: Date,
    endOfMonth:   Date,
  ): Promise<LocationPerformanceRow[]> {
    const targets = await this.prisma.locationTarget.findMany({
      where:  { periodMonth },
      select: {
        locationId:  true,
        category:    true,
        targetValue: true,
        location:    { select: { name: true, state: true, region: true } },
      },
    });

    if (targets.length === 0) return [];

    const locationIds = [...new Set(targets.map((t) => t.locationId))];

    const secondaryAgg = await this.prisma.secondarySaleItem.groupBy({
      by: ['productId'],
      where: {
        secondarySale: {
          deviceTime: { gte: startOfMonth, lt: endOfMonth },
          kdAccount:  { locationId: { in: locationIds } },
        },
      },
      _sum: { quantityCartons: true },
    });

    const productIds = secondaryAgg.map((r) => r.productId);
    const products   = productIds.length > 0
      ? await this.prisma.product.findMany({
          where:  { id: { in: productIds } },
          select: { id: true, category: true },
        })
      : [];
    const categoryByProduct = new Map(products.map((p) => [p.id, p.category]));

    const poAgg = await this.prisma.purchaseOrderItem.groupBy({
      by: ['productId'],
      where: {
        purchaseOrder: {
          createdAt: { gte: startOfMonth, lt: endOfMonth },
          status:    { notIn: ['PENDING_APPROVAL', 'CANCELLED'] },
          customer:  { locationId: { in: locationIds } },
        },
      },
      _sum: { quantityCartons: true },
    });

    const achievedMap = new Map<string, Map<string, number>>();

    return targets.map((target) => {
      const locAchieved =
        achievedMap.get(target.locationId)?.get(target.category) ?? 0;
      const balance = target.targetValue - locAchieved;

      return {
        locationId:      target.locationId,
        locationName:    target.location.name,
        state:           target.location.state,
        region:          target.location.region,
        category:        target.category,
        targetValue:     target.targetValue,
        achievedValue:   locAchieved,
        balanceValue:    balance,
        percentAchieved: target.targetValue > 0
          ? Math.round((locAchieved / target.targetValue) * 100)
          : 0,
      };
    });
  }

  // ── User performance ───────────────────────────────────────────────────────

  private async buildUserPerformance(
    year:         number,
    month:        number,
    startOfMonth: Date,
    endOfMonth:   Date,
  ): Promise<UserPerformanceRow[]> {
    const targets = await this.prisma.targetAssignment.findMany({
      where:  { period: 'MONTHLY', year, month },
      select: {
        assignedToId: true,
        category:     true,
        targetCartons: true,
        assignedTo: {
          select: {
            fullName:    true,
            employeeRef: true,
            tier:        true,
            region:      true,
          },
        },
      },
    });

    if (targets.length === 0) return [];

    const userIds = [...new Set(targets.map((t) => t.assignedToId))];

    const ssAgg = await this.prisma.secondarySaleItem.groupBy({
      by: ['productId'],
      where: {
        secondarySale: {
          userId:     { in: userIds },
          deviceTime: { gte: startOfMonth, lt: endOfMonth },
        },
      },
      _sum: { quantityCartons: true },
    });

    const poAgg = await this.prisma.purchaseOrderItem.groupBy({
      by: ['productId'],
      where: {
        purchaseOrder: {
          createdById: { in: userIds },
          createdAt:   { gte: startOfMonth, lt: endOfMonth },
          status:      { notIn: ['PENDING_APPROVAL', 'CANCELLED'] },
        },
      },
      _sum: { quantityCartons: true },
    });

    const allProductIds = [
      ...new Set([...ssAgg.map((r) => r.productId), ...poAgg.map((r) => r.productId)]),
    ];
    const products = allProductIds.length > 0
      ? await this.prisma.product.findMany({
          where:  { id: { in: allProductIds } },
          select: { id: true, category: true },
        })
      : [];
    const categoryByProduct = new Map(products.map((p) => [p.id, p.category]));

    const achievedByCategory = new Map<string, number>();
    const addCartons = (productId: string, qty: number | null) => {
      const cat = categoryByProduct.get(productId);
      if (!cat) return;
      achievedByCategory.set(cat, (achievedByCategory.get(cat) ?? 0) + (qty ?? 0));
    };
    ssAgg.forEach((r) => addCartons(r.productId, r._sum.quantityCartons));
    poAgg.forEach((r) => addCartons(r.productId, r._sum.quantityCartons));

    return targets.map((t) => {
      const achieved = achievedByCategory.get(t.category) ?? 0;
      return {
        userId:          t.assignedToId,
        fullName:        t.assignedTo.fullName,
        employeeRef:     t.assignedTo.employeeRef,
        tier:            t.assignedTo.tier,
        region:          t.assignedTo.region ?? null,
        category:        t.category,
        targetCartons:   t.targetCartons,
        achievedCartons: achieved,
        balanceCartons:  t.targetCartons - achieved,
        percentAchieved: t.targetCartons > 0
          ? Math.round((achieved / t.targetCartons) * 100)
          : 0,
      };
    });
  }

  // ── Org summary ───────────────────────────────────────────────────────────

  private async buildOrgSummary(startOfMonth: Date, endOfMonth: Date) {
    const [
      totalActiveUsers,
      totalActiveCustomers,
      collectionsAgg,
      poAgg,
      ssAgg,
    ] = await Promise.all([
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.customer.count({ where: { isActive: true } }),
      this.prisma.collection.aggregate({
        where: { collectedAt: { gte: startOfMonth, lt: endOfMonth } },
        _sum:  { amountKobo: true },
      }),
      this.prisma.purchaseOrder.aggregate({
        where: {
          createdAt: { gte: startOfMonth, lt: endOfMonth },
          status:    { notIn: ['PENDING_APPROVAL', 'CANCELLED'] },
        },
        _sum: { totalKobo: true },
      }),
      this.prisma.secondarySaleItem.aggregate({
        where: {
          secondarySale: {
            deviceTime: { gte: startOfMonth, lt: endOfMonth },
          },
        },
        _sum: { quantityCartons: true },
      }),
    ]);

    return {
      totalActiveUsers,
      totalActiveCustomers,
      totalCollectionsKobo:       Number(collectionsAgg._sum.amountKobo   ?? 0),
      totalPOValueKobo:           Number(poAgg._sum.totalKobo              ?? 0),
      totalSecondarySaleCartons:  Number(ssAgg._sum.quantityCartons        ?? 0),
    };
  }

  // ── Personal / chain analytics summary ────────────────────────────────────

  /**
   * Returns dashboard analytics for a specific user or a manager's chain.
   */
  async getPersonalAnalytics(
    requester:    { sub: string; tier: string },
    period:       string,
    periodType:   'weekly' | 'monthly' | 'quarterly' | 'annual',
    targetUserId?: string,
    includeChain?: boolean,
  ) {
    let userIds: string[];

    if (targetUserId) {
      await this.assertIsAbove(requester.sub, targetUserId);
      userIds = includeChain
        ? await this.getChainUserIds(targetUserId)
        : [targetUserId];
    } else {
      userIds = includeChain
        ? await this.getChainUserIds(requester.sub)
        : [requester.sub];
    }

    const { startDate, endDate } = this.resolveDateRange(period, periodType);

    const [
      collections,
      secondaryInvoices,
      secondarySaleItems,
      poItems,
      newSecondaryCustomers,
      totalPrimaryCustomers,
      totalSecondaryCustomers,
      targets,
      dailySecondaryItems,
      productBreakdown,
    ] = await Promise.all([

      this.prisma.collection.aggregate({
        where: { recordedById: { in: userIds }, collectedAt: { gte: startDate, lt: endDate } },
        _sum:  { amountKobo: true },
      }),

      this.prisma.secondarySaleInvoice.aggregate({
        where: { soldById: { in: userIds }, createdAt: { gte: startDate, lt: endDate } },
        _sum:   { totalKobo: true },
        _count: { id: true },
      }),

      this.prisma.secondarySaleInvoice.findMany({
        where:  { soldById: { in: userIds }, createdAt: { gte: startDate, lt: endDate } },
        select: { id: true, totalKobo: true, items: { select: { productId: true, quantityCartons: true, lineTotalKobo: true, createdAt: true } } },
      }),

      this.prisma.purchaseOrder.findMany({
        where: {
          createdById: { in: userIds },
          createdAt:   { gte: startDate, lt: endDate },
          status:      { notIn: ['PENDING_APPROVAL', 'CANCELLED'] },
        },
        select: {
          totalKobo: true,
          items:     { select: { productId: true, quantityCartons: true, lineTotalKobo: true } },
        },
      }),

      this.prisma.customer.count({
        where: { ownerId: { in: userIds }, customerType: 'SECONDARY', createdAt: { gte: startDate, lt: endDate } },
      }),

      this.prisma.customer.count({
        where: { ownerId: { in: userIds }, customerType: 'PRIMARY', isActive: true },
      }),

      this.prisma.customer.count({
        where: { ownerId: { in: userIds }, customerType: 'SECONDARY', isActive: true },
      }),

      this.prisma.targetAssignment.findMany({
        where:  { assignedToId: { in: userIds }, period: periodType.toUpperCase() as any, year: startDate.getFullYear() },
        select: { category: true, targetCartons: true, assignedToId: true },
      }),

      this.prisma.secondarySaleInvoice.findMany({
        where:  { soldById: { in: userIds }, createdAt: { gte: startDate, lt: endDate } },
        select: { createdAt: true, items: { select: { lineTotalKobo: true } } },
      }),

      this.prisma.secondarySaleInvoice.findMany({
        where:  { soldById: { in: userIds }, createdAt: { gte: startDate, lt: endDate } },
        select: { items: { select: { productId: true, quantityCartons: true } } },
      }),
    ]);

    const allSaleItems = secondaryInvoices._count.id > 0
      ? secondarySaleItems.flatMap((inv: any) => inv.items)
      : [];

    const allPoItems = poItems.flatMap((po: any) => po.items);

    const totalSKUSold =
      allSaleItems.reduce((s: number, i: any) => s + i.quantityCartons, 0) +
      allPoItems.reduce((s: number, i: any)   => s + i.quantityCartons, 0);

    const totalSalesKobo =
      Number(secondaryInvoices._sum.totalKobo ?? 0) +
      poItems.reduce((s: number, po: any) => s + Number(po.totalKobo ?? 0), 0);

    const totalAmountReceivedKobo =
      Number(collections._sum.amountKobo ?? 0) +
      Number(secondaryInvoices._sum.totalKobo ?? 0);

    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyTotals: Record<string, number> = {};
    DAYS.forEach(d => { dailyTotals[d] = 0; });
    for (const inv of dailySecondaryItems as any[]) {
      const day = DAYS[new Date(inv.createdAt).getDay()];
      const invTotal = (inv.items ?? []).reduce((s: number, i: any) => s + Number(i.lineTotalKobo ?? 0), 0);
      dailyTotals[day] = (dailyTotals[day] ?? 0) + invTotal;
    }
    const salesOverview = DAYS.map(day => ({ day, totalKobo: dailyTotals[day] }));

    const productMap = new Map<string, number>();
    for (const inv of productBreakdown as any[]) {
      for (const item of (inv.items ?? [])) {
        productMap.set(item.productId, (productMap.get(item.productId) ?? 0) + item.quantityCartons);
      }
    }
    const productIds  = Array.from(productMap.keys());
    const products    = productIds.length > 0
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, category: true, imageUrl: true } })
      : [];
    const prodNameMap = new Map(products.map((p: any) => [p.id, p]));
    const totalSKUForPct = Array.from(productMap.values()).reduce((s, v) => s + v, 0);
    const productBreakdownResult = Array.from(productMap.entries())
      .map(([productId, qty]) => {
        const p = prodNameMap.get(productId);
        return {
          productId,
          name:           p?.name     ?? 'Unknown',
          category:       p?.category ?? null,
          imageUrl:       p?.imageUrl ?? null,
          cartonsSOld:    qty,
          percentOfTotal: totalSKUForPct > 0 ? Math.round((qty / totalSKUForPct) * 100) : 0,
        };
      })
      .sort((a, b) => b.cartonsSOld - a.cartonsSOld);

    const targetSummary = targets.map((t: any) => ({
      category:      t.category,
      targetCartons: t.targetCartons,
      achievedCartons: allSaleItems
        .filter((i: any) => {
          const p = prodNameMap.get(i.productId);
          return p?.category === t.category;
        })
        .reduce((s: number, i: any) => s + i.quantityCartons, 0),
    })).map((t: any) => ({
      ...t,
      balanceCartons:  t.targetCartons - t.achievedCartons,
      percentAchieved: t.targetCartons > 0 ? Math.round((t.achievedCartons / t.targetCartons) * 100) : 0,
    }));

    return {
      period,
      periodType,
      userIds,
      totalAmountReceivedKobo,
      totalSalesKobo,
      totalSKUSold,
      newSecondaryCustomers,
      customers: {
        primary:   totalPrimaryCustomers,
        secondary: totalSecondaryCustomers,
        total:     totalPrimaryCustomers + totalSecondaryCustomers,
      },
      targetSummary,
      salesOverview,
      productBreakdown: productBreakdownResult,
    };
  }

  /**
   * BFS walk down the reportsTo chain.
   * Returns all user IDs in the subtree rooted at managerId (including the manager).
   *
   * Complexity: O(N) where N = subtree size; each user fetched exactly once.
   */
  async getChainUserIds(managerId: string): Promise<string[]> {
    const visited = new Set<string>([managerId]);
    const queue   = [managerId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const reports = await this.prisma.user.findMany({
        where:  { reportsToId: current, isActive: true },
        select: { id: true },
      });
      for (const u of reports) {
        if (!visited.has(u.id)) {
          visited.add(u.id);
          queue.push(u.id);
        }
      }
    }

    return Array.from(visited);
  }

  private async assertIsAbove(requesterId: string, targetUserId: string): Promise<void> {
    const chain = await this.getChainUserIds(requesterId);
    if (!chain.includes(targetUserId)) {
      throw new ForbiddenException(
        'You can only view analytics for users in your reporting chain',
      );
    }
  }
}