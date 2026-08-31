
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard.dto';

@ApiTags('Dashboard')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: "Get the current user's dashboard",
    description:
      'Single polymorphic endpoint — the response shape varies by the ' +
      "caller's tier (field staff, Sales Head, System Admin/GM, Warehouse " +
      'Admin). year/month default to the current period if omitted.',
  })
  @ApiResponse({
    status: 200,
    description: `Dashboard — shape depends on caller tier.

**TIER1–TIER4 (Field Staff):** clockedInToday, myPerformance (TGT/ACHV/BAL per category), myTeam (directReports + rollup + allMembers), recentActivity (last 10 secondary sales, POs, competitor reports)

**TIER5_SALES_HEAD:** approvalQueue (pending POs + OOR requests with counts), myTeam (directReports = Tier4 only for target assignment + allMembers = full downstream tree), competitorActivityFeed, targetsAssignedThisYear

**TIER5_SALES_SUPPORT / TIER6_GM:** organisationSummary (totalActiveUsers, totalActiveCustomers, targetsAssignedThisYear), approvalQueue counts, warehouseAlerts (lowStockEntries), competitorActivityFeed, users (full user list with id/tier/isActive for management actions)

**WAREHOUSE_ADMIN:** stockSummary (totalProductLocationEntries, lowStockCount, lowStockEntries), recentMovements`,
    schema: {
      example: {
        success: true,
        data: {
          tier: 'TIER2',
          status: { clockedInToday: true },
          myPerformance: [
            {
              category: 'LOTION',
              targetCartons: 1000,
              achievedCartons: 400,
              achievedFromSecondarySales: 250,
              achievedFromPurchaseOrders: 150,
              balanceCartons: 600,
              percentAchieved: 40,
              isStale: false,
            },
          ],
          myTeam: {
            directReportCount: 0,
            directReports: [],
            rollup: { totalTeamSize: 0, byCategory: [], allMembers: [] },
          },
          recentActivity: {
            secondarySales: [],
            purchaseOrders: [],
            competitorReports: [],
          },
        },
        timestamp: '2026-07-29T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } },
  })
  getDashboard(
    @CurrentUser() user: JwtPayload,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getDashboard(user, query);
  }
}