// src/modules/competitor-reports/competitor-report.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { Region } from '@prisma/client';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type {
  CreateCompetitorReportDto,
  CompetitorReportQueryDto,
} from './dto/competitor-report.dto';

// Field tiers only, same as Secondary Sales. Confirmed scope: fire-and-forget
// submission, no approval workflow — Sales Head/Admin just view a feed.
// Restricting creation to field tiers also sidesteps a real edge case:
// JwtPayload.region is undefined for TIER5_SYSTEM_ADMIN/TIER6_GM/
// WAREHOUSE_ADMIN (they have no region at all), and a CompetitorReport
// without a region would be meaningless — better to never let it happen
// than to handle an undefined region after the fact.
const FIELD_TIERS = ['TIER1', 'TIER2', 'TIER3', 'TIER4'];
const VIEWER_TIERS = ['TIER5_SALES_HEAD', 'TIER5_SYSTEM_ADMIN', 'TIER6_GM'];

const REPORT_SELECT = {
  id:            true,
  submittedById: true,
  submittedBy:   { select: { fullName: true, employeeRef: true, tier: true } },
  region:        true,
  state:         true,
  mediaType:     true,
  mediaUrl:      true,
  textContent:   true,
  tags:          true,
  createdAt:     true,
} as const;

@Injectable()
export class CompetitorReportService {
  private readonly logger = new Logger(CompetitorReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(dto: CreateCompetitorReportDto, requester: JwtPayload) {
    if (!FIELD_TIERS.includes(requester.tier as string)) {
      throw new ForbiddenException(
        'Only field staff (Tier 1-4) can submit competitor reports',
      );
    }

    if (!requester.region) {
      // Defensive — should be unreachable given the tier gate above, since
      // every field-tier JWT carries a region, but fail loudly rather than
      // silently writing region: undefined if that assumption is ever wrong.
      throw new BadRequestException(
        'Your account has no region set — cannot submit a report',
      );
    }

    const report = await this.prisma.competitorReport.create({
      data: {
        submittedById: requester.sub,
        // JwtPayload.region is typed as a plain string (it's untyped at
        // the token layer since back-office roles carry no region at all),
        // but we've already confirmed it's set and field staff regions are
        // always valid Region enum values at issuance time — same cast
        // pattern customer.service.ts uses for requester.region elsewhere.
        region:        requester.region as Region,
        // state is intentionally left null at creation — JwtPayload carries
        // region only, not state, and a competitor sighting has no natural
        // "state" source the way a Customer record does (no address being
        // entered here). The schema field stays nullable for this reason;
        // an Admin-facing edit endpoint could backfill it later if needed.
        state:         null,
        mediaType:     dto.mediaType,
        mediaUrl:      dto.mediaUrl ?? null,
        textContent:   dto.textContent ?? null,
        tags:          dto.tags ?? [],
      },
      select: REPORT_SELECT,
    });

    this.logger.log(
      `Competitor report submitted by ${requester.sub} in ${requester.region}`,
    );
    return report;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * Fire-and-forget design: no approval workflow. Field staff see only
   * their own submissions; Sales Head/Admin/GM view the full feed across
   * every region, filterable by region/tag/date.
   */
  async findAll(query: CompetitorReportQueryDto, requester: JwtPayload) {
    const isViewer = VIEWER_TIERS.includes(requester.tier as string);
    const dateFilter = this.buildDateFilter(query.from, query.to);

    return this.prisma.competitorReport.findMany({
      where: {
        ...(isViewer ? {} : { submittedById: requester.sub }),
        ...(query.region ? { region: query.region } : {}),
        ...(query.tag    ? { tags: { has: query.tag } } : {}),
        ...(dateFilter   ? { createdAt: dateFilter } : {}),
      },
      select:  REPORT_SELECT,
      orderBy: { createdAt: 'desc' },
      take:    200,
    });
  }

  async findById(id: string, requester: JwtPayload) {
    const report = await this.prisma.competitorReport.findUnique({
      where:  { id },
      select: REPORT_SELECT,
    });
    if (!report) throw new NotFoundException(`Competitor report ${id} not found`);

    const isViewer = VIEWER_TIERS.includes(requester.tier as string);
    if (!isViewer && report.submittedById !== requester.sub) {
      throw new ForbiddenException('You can only view your own competitor reports');
    }

    return report;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildDateFilter(
    from?: string,
    to?: string,
  ): { gte?: Date; lte?: Date } | null {
    if (!from && !to) return null;
    return {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to) }   : {}),
    };
  }
}