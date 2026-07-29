// src/modules/target-assignments/target-assignment.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserTier } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type {
  CreateRootTargetDto,
  SplitTargetDto,
  UpdateTargetDto,
  TargetAssignmentQueryDto,
} from './dto/target-assignment.dto';

// ── Tier hierarchy ───────────────────────────────────────────────────────────
// The cascade always flows exactly one tier down. This map is the single
// source of truth for "who is allowed to assign to whom" — used both to
// validate root-target creation (Sales Head -> Tier4) and every split
// (TierN -> TierN-1). KISS: one ordered list, not a tangle of if/else tier
// comparisons scattered through the service.
const CASCADE_ORDER: UserTier[] = [
  UserTier.TIER5_SALES_HEAD,
  UserTier.TIER4,
  UserTier.TIER3,
  UserTier.TIER2,
  UserTier.TIER1,
];

function expectedChildTier(parentTier: UserTier): UserTier | null {
  const idx = CASCADE_ORDER.indexOf(parentTier);
  if (idx === -1 || idx === CASCADE_ORDER.length - 1) return null;
  return CASCADE_ORDER[idx + 1];
}

const ASSIGNMENT_SELECT = {
  id:                 true,
  assignedById:       true,
  assignedBy:         { select: { fullName: true, employeeRef: true, tier: true } },
  assignedToId:       true,
  assignedTo:         { select: { fullName: true, employeeRef: true, tier: true } },
  category:           true,
  period:             true,
  year:                true,
  quarter:            true,
  month:              true,
  week:               true,
  targetCartons:      true,
  parentAssignmentId: true,
  isStale:            true,
  note:               true,
  createdAt:          true,
  updatedAt:          true,
} as const;

@Injectable()
export class TargetAssignmentService {
  private readonly logger = new Logger(TargetAssignmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Create root targets (Sales Head -> Tier4) — bulk by category ──────────

  async createRoot(dto: CreateRootTargetDto, requester: JwtPayload) {
    if (requester.tier !== UserTier.TIER5_SALES_HEAD) {
      throw new ForbiddenException(
        'Only the Sales Head can create a root target assignment',
      );
    }

    const assignee = await this.assertValidAssignee(
      dto.assignedToId,
      UserTier.TIER4,
      requester,
    );

    this.assertPeriodFieldsMatch(dto.period, dto);

    // Validate no duplicate categories in the same request
    const cats = dto.categories.map((c) => c.category);
    if (new Set(cats).size !== cats.length) {
      throw new BadRequestException(
        'Each category may appear at most once per bulk assignment',
      );
    }

    // Create one TargetAssignment row per category in a single transaction
    const assignments = await this.prisma.$transaction(
      dto.categories.map((entry) =>
        this.prisma.targetAssignment.create({
          data: {
            assignedById:       requester.sub,
            assignedToId:       assignee.id,
            category:           entry.category,
            period:             dto.period,
            year:               dto.year,
            quarter:            dto.quarter ?? null,
            month:              dto.month   ?? null,
            week:               dto.week    ?? null,
            targetCartons:      entry.targetCartons,
            parentAssignmentId: null,
            note:               entry.note ?? null,
          },
          select: ASSIGNMENT_SELECT,
        }),
      ),
    );

    this.logger.log(
      `Root targets created for ${assignee.fullName} by Sales Head ${requester.sub}: ` +
      dto.categories.map((c) => `${c.category}=${c.targetCartons}`).join(', '),
    );
    return assignments;
  }

  // ── Split a target among direct reports ──────────────────────────────────

  async split(
    parentAssignmentId: string,
    dto: SplitTargetDto,
    requester: JwtPayload,
  ) {
    const parent = await this.prisma.targetAssignment.findUnique({
      where:  { id: parentAssignmentId },
      select: {
        id:            true,
        assignedToId:  true,
        targetCartons: true,
        category:      true,
        period:        true,
        year:          true,
        quarter:       true,
        month:         true,
        week:          true,
      },
    });
    if (!parent) {
      throw new NotFoundException(`Target assignment ${parentAssignmentId} not found`);
    }

    // Only the person who RECEIVED this target may split it further —
    // matches "it is the higher tier who assigned it" + that same person
    // is the one distributing it down, not some unrelated higher tier.
    if (parent.assignedToId !== requester.sub) {
      throw new ForbiddenException(
        'You can only split a target that was assigned to you',
      );
    }

    const childTier = expectedChildTier(requester.tier as UserTier);
    if (!childTier) {
      throw new BadRequestException(
        `${requester.tier} has no tier below it to split a target to`,
      );
    }

    // Sum-must-equal-parent invariant — the one rule the system enforces;
    // HOW the split is weighted is entirely the assigner's call (confirmed:
    // manual entry per child, no auto-even-split).
    const sum = dto.children.reduce((s, c) => s + c.targetCartons, 0);
    if (sum !== parent.targetCartons) {
      throw new BadRequestException(
        `Children must sum to exactly ${parent.targetCartons} cartons ` +
        `(received ${sum})`,
      );
    }

    // Validate every child assignee is a real direct report of the correct tier
    const assignees = await Promise.all(
      dto.children.map((c) =>
        this.assertValidAssignee(c.assignedToId, childTier, requester),
      ),
    );

    // No duplicate assignees in the same split
    const uniqueIds = new Set(dto.children.map((c) => c.assignedToId));
    if (uniqueIds.size !== dto.children.length) {
      throw new BadRequestException('Each direct report can only appear once in a split');
    }

    // Reject if any of these direct reports already has a target for this
    // exact category+period+year+quarter+month+week — re-splitting should
    // go through update(), not create a second conflicting row.
    const existing = await this.prisma.targetAssignment.findMany({
      where: {
        assignedToId: { in: dto.children.map((c) => c.assignedToId) },
        category:     parent.category,
        period:       parent.period,
        year:         parent.year,
        quarter:      parent.quarter,
        month:        parent.month,
        week:         parent.week,
      },
      select: { assignedToId: true },
    });
    if (existing.length > 0) {
      const names = existing.map((e) => e.assignedToId).join(', ');
      throw new ConflictException(
        `Target already exists for this period for: ${names}. Use update instead.`,
      );
    }

    const created = await this.prisma.$transaction(
      dto.children.map((child) =>
        this.prisma.targetAssignment.create({
          data: {
            assignedById:       requester.sub,
            assignedToId:       child.assignedToId,
            category:           parent.category,
            period:             parent.period,
            year:               parent.year,
            quarter:            parent.quarter,
            month:              parent.month,
            week:               parent.week,
            targetCartons:      child.targetCartons,
            parentAssignmentId: parent.id,
            note:               child.note ?? null,
          },
          select: ASSIGNMENT_SELECT,
        }),
      ),
    );

    this.logger.log(
      `Target ${parent.id} split into ${created.length} child assignments by ${requester.sub}`,
    );
    return created;
  }

  // ── Update (re-adjustment) ─────────────────────────────────────────────────

  async update(id: string, dto: UpdateTargetDto, requester: JwtPayload) {
    const target = await this.prisma.targetAssignment.findUnique({
      where:  { id },
      select: { id: true, assignedById: true, targetCartons: true, children: { select: { id: true } } },
    });
    if (!target) throw new NotFoundException(`Target assignment ${id} not found`);

    // Only the original assigner may edit — "the higher tier who assigned
    // a target can edit the target." The assignee themselves cannot
    // silently inflate or shrink a target they were given.
    if (target.assignedById !== requester.sub) {
      throw new ForbiddenException(
        'Only the person who assigned this target can edit it',
      );
    }

    const hasChildren = target.children.length > 0;
    const valueChanged = dto.targetCartons !== target.targetCartons;

    const updated = await this.prisma.targetAssignment.update({
      where: { id },
      data: {
        targetCartons: dto.targetCartons,
        note:          dto.note ?? undefined,
      },
      select: ASSIGNMENT_SELECT,
    });

    // Confirmed behaviour: flag children stale, leave their values untouched.
    // A human must review and re-split if the new total demands it — we
    // never auto-cascade an edit down through the tree.
    if (hasChildren && valueChanged) {
      await this.prisma.targetAssignment.updateMany({
        where: { parentAssignmentId: id },
        data:  { isStale: true },
      });
      this.logger.warn(
        `Target ${id} edited with existing children — ${target.children.length} ` +
        `child assignment(s) flagged stale and require review`,
      );
    }

    return updated;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findAll(query: TargetAssignmentQueryDto, requester: JwtPayload) {
    const adminTiers: UserTier[] = [
      UserTier.TIER5_SALES_HEAD,
      UserTier.TIER5_SYSTEM_ADMIN,
      UserTier.TIER6_GM,
    ];
    const isSalesHeadOrAdmin = adminTiers.includes(requester.tier as UserTier);

    return this.prisma.targetAssignment.findMany({
      where: {
        // Non-admins see only targets assigned TO them or BY them —
        // never someone else's unrelated branch of the tree.
        ...(isSalesHeadOrAdmin
          ? {}
          : {
              OR: [
                { assignedToId: requester.sub },
                { assignedById: requester.sub },
              ],
            }),
        ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
        ...(query.category     ? { category: query.category }        : {}),
        ...(query.year          ? { year: query.year }                 : {}),
        ...(query.isStale !== undefined ? { isStale: query.isStale }   : {}),
      },
      select:  ASSIGNMENT_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, requester: JwtPayload) {
    const target = await this.prisma.targetAssignment.findUnique({
      where:  { id },
      select: ASSIGNMENT_SELECT,
    });
    if (!target) throw new NotFoundException(`Target assignment ${id} not found`);

    const adminTiers: UserTier[] = [
      UserTier.TIER5_SALES_HEAD,
      UserTier.TIER5_SYSTEM_ADMIN,
      UserTier.TIER6_GM,
    ];
    const isAdmin = adminTiers.includes(requester.tier as UserTier);

    if (
      !isAdmin &&
      target.assignedToId !== requester.sub &&
      target.assignedById !== requester.sub
    ) {
      throw new ForbiddenException('You do not have access to this target assignment');
    }

    return target;
  }

  /**
   * Returns the target + achievement for a given user, for a given month —
   * feeds the "my performance" widget every dashboard shows, regardless
   * of tier.
   *
   * Takes a plain userId rather than a JwtPayload: the underlying queries
   * only ever needed the user's ID, never their tier/region/team from the
   * token. Accepting a bare ID also lets DashboardService compute a whole
   * downstream team's rollup by calling this once per team member without
   * fabricating a fake JwtPayload for each one — a JwtPayload represents
   * "who is making this request," which is meaningless for "whose
   * performance am I looking up on someone else's behalf."
   *
   * Achievement combines TWO sources, summed per category:
   *   1. Secondary Sales — sell-through the agent witnessed/made at a KD
   *   2. Purchase Orders the agent created — confirmed, since "individual
   *      performance" should reflect total selling activity, not only
   *      secondary sell-through. Only orders that progressed past
   *      PENDING_APPROVAL and weren't CANCELLED count — a submitted-but-
   *      not-yet-approved order isn't a real achievement yet.
   */
  async getMyPerformance(userId: string, year: number, month: number) {
    const targets = await this.prisma.targetAssignment.findMany({
      where: {
        assignedToId: userId,
        period:       'MONTHLY',
        year,
        month,
      },
      select: { category: true, targetCartons: true, isStale: true },
    });

    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth   = new Date(year, month, 1);

    // ── Source 1: Secondary Sales ─────────────────────────────────────────
    const secondaryAgg = await this.prisma.secondarySaleItem.groupBy({
      by: ['productId'],
      where: {
        secondarySale: {
          userId,
          deviceTime: { gte: startOfMonth, lt: endOfMonth },
        },
      },
      _sum: { quantityCartons: true },
    });

    // ── Source 2: Purchase Orders (confirmed orders only) ─────────────────
    const poAgg = await this.prisma.purchaseOrderItem.groupBy({
      by: ['productId'],
      where: {
        purchaseOrder: {
          createdById: userId,
          createdAt:   { gte: startOfMonth, lt: endOfMonth },
          status:      { notIn: ['PENDING_APPROVAL', 'CANCELLED'] },
        },
      },
      _sum: { quantityCartons: true },
    });

    // Batch-load every distinct product referenced by either source in one
    // query — same no-N+1 discipline as the rest of the codebase, even
    // though here it's two small aggregations rather than one.
    const allProductIds = [
      ...new Set([
        ...secondaryAgg.map((r) => r.productId),
        ...poAgg.map((r) => r.productId),
      ]),
    ];
    const products = await this.prisma.product.findMany({
      where:  { id: { in: allProductIds } },
      select: { id: true, category: true },
    });
    const categoryByProduct = new Map(products.map((p) => [p.id, p.category]));

    const fromSecondary = this.sumByCategory(secondaryAgg, categoryByProduct);
    const fromPO        = this.sumByCategory(poAgg, categoryByProduct);

    return targets.map((t) => {
      const secondaryCartons = fromSecondary.get(t.category) ?? 0;
      const poCartons        = fromPO.get(t.category) ?? 0;
      const achievedCartons  = secondaryCartons + poCartons;

      return {
        category:        t.category,
        targetCartons:   t.targetCartons,
        achievedCartons,
        achievedFromSecondarySales: secondaryCartons,
        achievedFromPurchaseOrders: poCartons,
        balanceCartons:  t.targetCartons - achievedCartons,
        percentAchieved: t.targetCartons > 0
          ? Math.round((achievedCartons / t.targetCartons) * 100)
          : 0,
        isStale: t.isStale,
      };
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Confirms the assignee exists, is active, has the EXACT expected tier
   * (not "at or below" — exact, since the cascade only ever moves one
   * tier at a time), and reports to the requester per the org hierarchy.
   */
  private async assertValidAssignee(
    assigneeId: string,
    expectedTier: UserTier,
    requester: JwtPayload,
  ) {
    const assignee = await this.prisma.user.findUnique({
      where:  { id: assigneeId },
      select: { id: true, fullName: true, tier: true, isActive: true, reportsToId: true },
    });
    if (!assignee) throw new NotFoundException(`User ${assigneeId} not found`);
    if (!assignee.isActive) {
      throw new BadRequestException(`User "${assignee.fullName}" is deactivated`);
    }
    if (assignee.tier !== expectedTier) {
      throw new BadRequestException(
        `Expected a ${expectedTier} user but ${assignee.fullName} is ${assignee.tier}`,
      );
    }
    if (assignee.reportsToId !== requester.sub) {
      throw new ForbiddenException(
        `${assignee.fullName} does not report to you — cannot assign a target to them`,
      );
    }
    return assignee;
  }

  private assertPeriodFieldsMatch(
    period: string,
    dto: { quarter?: number; month?: number; week?: number },
  ): void {
    if (period === 'QUARTERLY' && !dto.quarter) {
      throw new BadRequestException('quarter is required when period is QUARTERLY');
    }
    if (period === 'MONTHLY' && !dto.month) {
      throw new BadRequestException('month is required when period is MONTHLY');
    }
    if (period === 'WEEKLY' && !dto.week) {
      throw new BadRequestException('week is required when period is WEEKLY');
    }
  }

  /**
   * Reduces a productId-grouped aggregation into a category-keyed total,
   * using the same productId -> category map for either source. Shared by
   * both the Secondary Sales and Purchase Order achievement aggregations
   * in getMyPerformance — one reduction implementation, not two copies
   * that would silently drift apart over time.
   */
  private sumByCategory(
    rows: Array<{ productId: string; _sum: { quantityCartons: number | null } }>,
    categoryByProduct: Map<string, string>,
  ): Map<string, number> {
    const result = new Map<string, number>();
    for (const row of rows) {
      const category = categoryByProduct.get(row.productId);
      if (!category) continue;
      const current = result.get(category) ?? 0;
      result.set(category, current + (row._sum.quantityCartons ?? 0));
    }
    return result;
  }
}