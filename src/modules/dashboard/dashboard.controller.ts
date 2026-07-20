// src/modules/dashboard/dashboard.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  getDashboard(
    @CurrentUser() user: JwtPayload,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getDashboard(user, query);
  }
}