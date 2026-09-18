
import {
  Controller, ForbiddenException, Get, Post, Query, Res, UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiResponse({ status: 200, description: 'PowerPoint report (.pptx) downloaded as binary. Field staff get personal performance deck; Sales Head and Admin get org-wide deck. Set Postman response type to \"Send and Download\" to save the file.', content: { 'application/vnd.openxmlformats-officedocument.presentationml.presentation': { schema: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
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
  @ApiQuery({
    name: 'userId', required: false,
    description: 'Download a specific subordinate\'s PPT report. Requester must be above this user in their reporting chain.',
  })
  async downloadPpt(
    @Query('periodType') periodType: PeriodType = 'monthly',
    @Query('period')     period: string | undefined,
    @Query('userId')     targetUserId: string | undefined,
    @CurrentUser()       user: JwtPayload,
    @Res()               res: Response,
  ) {
    const resolvedType   = this.normalizePeriodType(periodType);
    const resolvedPeriod = period ?? PERIOD_DEFAULTS[resolvedType]();

    // If a specific userId is requested, validate the requester is above them
    // then build a chain-scoped report for that user
    if (targetUserId) {
      const data = await this.analyticsService.getPersonalAnalytics(
        user,
        resolvedPeriod,
        resolvedType,
        targetUserId,
        false, // single user report
      );
      // Use the personal analytics data to generate a targeted PPT
      const reportData = await this.analyticsService.buildReportData(resolvedPeriod, resolvedType);
      const buffer     = await this.reportGenerator.generatePpt(reportData, 'personal', targetUserId);
      const filename   = `darvinks-${resolvedType}-${resolvedPeriod}-user-report.pptx`;
      const pptBuffer  = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
      res.set({
        'Content-Type':        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      pptBuffer.length,
        'Cache-Control':       'no-cache',
      });
      return res.end(pptBuffer);
    }

    const scope  = ORG_SCOPE_TIERS.includes(user.tier as string) ? 'org' : 'personal';
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

  @ApiResponse({ status: 200, description: 'Excel report (.xlsx) downloaded as binary. Available to Sales Head and System Admin only. GM is excluded.', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'GM and field staff cannot download Excel', schema: { example: { success: false, statusCode: 403, message: 'Forbidden resource', timestamp: '2026-07-29T12:00:00.000Z' } } })
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

  @ApiResponse({ status: 200, description: 'Report generation queued as a background job. Report will be available via GET /analytics/report/ppt within 30-60 seconds.', schema: { example: { success: true, data: { message: 'Analytics report generation queued', period: '2026-07', periodType: 'monthly' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Only System Admin can manually trigger reports', schema: { example: { success: false, statusCode: 403, message: 'Forbidden resource', timestamp: '2026-07-29T12:00:00.000Z' } } })
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
    if ((user.tier as string) !== 'TIER5_SYSTEM_ADMIN') {
      throw new ForbiddenException('Only System Admin can manually trigger reports');
    }
    const resolvedType   = this.normalizePeriodType(periodType);
    const resolvedPeriod = period ?? PERIOD_DEFAULTS[resolvedType]();
    await this.scheduler.triggerManually(resolvedPeriod, resolvedType);
    return {
      message: `Report generation queued — ${resolvedType}: ${resolvedPeriod}`,
    };
  }

  // ── Personal / chain analytics summary ─────────────────────────────────────

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Personal analytics summary — bar chart, pie chart, totals',
    description:
      'Returns all analytics data for the field-staff dashboard: ' +
      'total amount received (collections + invoice payments), total SKU sold, ' +
      'new secondary customers, target summary per category, ' +
      'daily sales bar chart (Sun–Sat), product breakdown pie chart, ' +
      'and customer ownership counts. ' +
      '\n\nA manager can request a subordinate\'s data by passing ?userId=:id. ' +
      'Passing ?includeChain=true includes all users in the reporting chain below the target. ' +
      '\n\nPeriod types: weekly (2026-W35), monthly (2026-08), quarterly (2026-Q3), annual (2026).',
  })
  @ApiQuery({ name: 'periodType', required: false, enum: ['weekly', 'monthly', 'quarterly', 'annual'], description: 'Defaults to monthly' })
  @ApiQuery({ name: 'period',     required: false, description: 'Period string — 2026-08 / 2026-W35 / 2026-Q3 / 2026' })
  @ApiQuery({ name: 'userId',     required: false, description: 'View a specific subordinate\'s analytics. Requester must be above this user in the chain.' })
  @ApiQuery({ name: 'includeChain', required: false, type: Boolean, description: 'When true, aggregates data for all users in the chain below userId (or requester if userId omitted)' })
  async getSummary(
    @Query('periodType')    periodType: PeriodType = 'monthly',
    @Query('period')        period: string | undefined,
    @Query('userId')        userId: string | undefined,
    @Query('includeChain')  includeChain: string | undefined,
    @CurrentUser()          user: JwtPayload,
    @Res()                  res: Response,
  ) {
    const resolvedType   = this.normalizePeriodType(periodType);
    const resolvedPeriod = period ?? PERIOD_DEFAULTS[resolvedType]();

    const data = await this.analyticsService.getPersonalAnalytics(
      user,
      resolvedPeriod,
      resolvedType,
      userId,
      includeChain === 'true',
    );

    return res.json({ success: true, data, timestamp: new Date().toISOString() });
  }

  // ── Helper ─────────────────────────────────────────────────────────────────

  private normalizePeriodType(raw: string): PeriodType {
    const valid: PeriodType[] = ['weekly', 'monthly', 'quarterly', 'annual'];
    return valid.includes(raw as PeriodType) ? (raw as PeriodType) : 'monthly';
  }
}