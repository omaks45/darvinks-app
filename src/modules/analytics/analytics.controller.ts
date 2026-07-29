
import {
  Controller, ForbiddenException, Get, Post, Query, Res, UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth, ApiOperation, ApiQuery, ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { AnalyticsService } from './analytics.service';
import { ReportGeneratorService } from './report-generator.service';
import { AnalyticsScheduler } from './jobs/analytics.scheduler';

// PPT: all tiers access the download. Field staff get personal scope,
// privileged tiers get org-wide scope.
const ORG_SCOPE_TIERS = ['TIER5_SYSTEM_ADMIN', 'TIER5_SALES_HEAD', 'TIER6_GM'];

// Excel: System Admin and Sales Head only. GM confirmed excluded.
// Rationale: Excel contains full row-level user data that GM does not
// need — GM's dashboard and the PPT org summary already give them the
// aggregate picture they need.
const EXCEL_TIERS = ['TIER5_SYSTEM_ADMIN', 'TIER5_SALES_HEAD'];

type PeriodType = 'weekly' | 'monthly' | 'quarterly' | 'annual';

// Period format examples by type:
//   weekly:    "2026-W30"
//   monthly:   "2026-07"
//   quarterly: "2026-Q2"
//   annual:    "2026"
const PERIOD_DEFAULTS: Record<PeriodType, () => string> = {
  weekly:    () => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const week = Math.ceil(
      ((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7,
    );
    return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
  },
  monthly:   () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  },
  quarterly: () => {
    const now = new Date();
    const q = Math.ceil((now.getMonth() + 1) / 3);
    return `${now.getFullYear()}-Q${q}`;
  },
  annual:    () => String(new Date().getFullYear()),
};

@ApiTags('Analytics')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly reportGenerator:  ReportGeneratorService,
    private readonly scheduler:        AnalyticsScheduler,
  ) {}

  // ── PPT download ────────────────────────────────────────────────────────────

  @Get('report/ppt')
  @ApiOperation({
    summary: 'Download the performance report as a PowerPoint file',
    description:
      'Tier 1–4 receive a personal performance deck. ' +
      'Sales Head, System Admin, and GM receive the org-wide report. ' +
      'Use periodType to choose the time window and period for the exact range.',
  })
  @ApiQuery({
    name: 'periodType', required: false,
    enum: ['weekly', 'monthly', 'quarterly', 'annual'],
    description: 'Defaults to monthly',
  })
  @ApiQuery({
    name: 'period', required: false,
    description:
      'Period string matching the periodType — ' +
      'weekly: "2026-W30" | monthly: "2026-07" | quarterly: "2026-Q2" | annual: "2026". ' +
      'Defaults to the current period.',
  })
  async downloadPpt(
    @Query('periodType') periodType: PeriodType = 'monthly',
    @Query('period')     period: string | undefined,
    @CurrentUser()       user: JwtPayload,
    @Res()               res: Response,
  ) {
    const resolvedType   = this.normalizePeriodType(periodType);
    const resolvedPeriod = period ?? PERIOD_DEFAULTS[resolvedType]();
    const scope = ORG_SCOPE_TIERS.includes(user.tier as string) ? 'org' : 'personal';

    const data   = await this.analyticsService.buildReportData(resolvedPeriod, resolvedType);
    const buffer = await this.reportGenerator.generatePpt(data, scope, user.sub);

    const filename = `darvinks-${resolvedType}-report-${resolvedPeriod}.pptx`;
    const pptBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length':      pptBuffer.length,
      'Cache-Control':       'no-cache',
    });
    res.end(pptBuffer);
  }

  // ── Excel download ─────────────────────────────────────────────────────────

  @Get('report/excel')
  @ApiOperation({
    summary: 'Download the report as Excel (System Admin and Sales Head only)',
    description:
      'Contains full row-level user and location data. ' +
      'System Admin sees the full org. Sales Head sees their team. ' +
      'GM is excluded from Excel — use the PPT or dashboard for org-wide summaries.',
  })
  @ApiQuery({
    name: 'periodType', required: false,
    enum: ['weekly', 'monthly', 'quarterly', 'annual'],
    description: 'Defaults to monthly',
  })
  @ApiQuery({ name: 'period', required: false })
  async downloadExcel(
    @Query('periodType') periodType: PeriodType = 'monthly',
    @Query('period')     period: string | undefined,
    @CurrentUser()       user: JwtPayload,
    @Res()               res: Response,
  ) {
    if (!EXCEL_TIERS.includes(user.tier as string)) {
      throw new ForbiddenException(
        'Excel export is available for System Admin and Sales Head only',
      );
    }

    const resolvedType   = this.normalizePeriodType(periodType);
    const resolvedPeriod = period ?? PERIOD_DEFAULTS[resolvedType]();

    const data   = await this.analyticsService.buildReportData(resolvedPeriod, resolvedType);
    const buffer = await this.reportGenerator.generateExcel(data);

    const filename = `darvinks-${resolvedType}-report-${resolvedPeriod}.xlsx`;
    const xlsxBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length':      xlsxBuffer.length,
      'Cache-Control':       'no-cache',
    });
    res.end(xlsxBuffer);
  }

  // ── Manual trigger (System Admin only) ────────────────────────────────────

  @Post('trigger')
  @ApiOperation({
    summary: 'Manually trigger a report generation job (System Admin only)',
  })
  @ApiQuery({ name: 'period',     required: false, example: '2026-07' })
  @ApiQuery({
    name: 'periodType', required: false,
    enum: ['weekly', 'monthly', 'quarterly', 'annual'],
  })
  async triggerManual(
    @Query('period')     period: string | undefined,
    @Query('periodType') periodType: PeriodType = 'monthly',
    @CurrentUser()       user: JwtPayload,
  ) {
    if (user.tier !== 'TIER5_SYSTEM_ADMIN') {
      throw new ForbiddenException('Only System Admin can manually trigger reports');
    }
    const resolvedType   = this.normalizePeriodType(periodType);
    const resolvedPeriod = period ?? PERIOD_DEFAULTS[resolvedType]();
    await this.scheduler.triggerManually(resolvedPeriod, resolvedType);
    return {
      message: `Report generation queued — ${resolvedType}: ${resolvedPeriod}`,
    };
  }

  // ── Helper ─────────────────────────────────────────────────────────────────

  private normalizePeriodType(raw: string): PeriodType {
    const valid: PeriodType[] = ['weekly', 'monthly', 'quarterly', 'annual'];
    return valid.includes(raw as PeriodType) ? (raw as PeriodType) : 'monthly';
  }
}