// src/modules/seconday-sales/seconday-sales.controller.ts
import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { RolesGuard } from '@common/guards/roles.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { SecondaySalesService, PaginatedResult } from './seconday-sales.service';

@ApiTags('Secondary Sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('secondary-sales')
export class SecondaySalesController {
  constructor(private readonly secondaySalesService: SecondaySalesService) {}

  // ─── TIER5_SALES_SUPPORT: All Secondary Sales (platform-wide) ────────────

  /**
   * GET /secondary-sales/support/all
   *
   * Platform-wide secondary sales for TIER5_SALES_SUPPORT.
   * Filterable by team, tier, region, userId, from, to.
   *
   * NOTE: This route MUST be registered before GET /secondary-sales/:id so
   * NestJS does not mistakenly treat "support" as a sale UUID.
   */
  @Get('support/all')
  @Roles('TIER5_SALES_SUPPORT')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: 'All secondary sales — platform-wide (Sales Support only)',
    description:
      'Returns all secondary sales records across the platform. ' +
      'Filter by team, tier, region, userId, or date range. ' +
      'Restricted to TIER5_SALES_SUPPORT.',
  })
  @ApiQuery({ name: 'team',   required: false, description: 'Filter by team (e.g. RADIANT)' })
  @ApiQuery({ name: 'tier',   required: false, description: 'Filter by user tier (e.g. TIER2)' })
  @ApiQuery({ name: 'region', required: false, description: 'Filter by region (e.g. SOUTH_WEST)' })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by a specific user UUID' })
  @ApiQuery({ name: 'from',   required: false, description: 'Start date inclusive — ISO 8601 (e.g. 2026-08-01)' })
  @ApiQuery({ name: 'to',     required: false, description: 'End date inclusive — ISO 8601 (e.g. 2026-08-31)' })
  @ApiQuery({ name: 'page',   required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit',  required: false, type: Number, description: 'Results per page, max 100 (default: 20)' })
  @ApiResponse({
    status: 200,
    description: 'Paginated platform-wide secondary sales',
    schema: {
      example: {
        success: true,
        data: {
          data: [
            {
              id: 'sale-uuid',
              userId: 'user-uuid',
              kdAccountId: 'customer-uuid',
              latitude: 6.5244,
              longitude: 3.3792,
              deviceTime: '2026-08-02T10:00:00.000Z',
              serverTime: '2026-08-02T10:00:02.000Z',
              note: null,
              createdAt: '2026-08-02T10:00:02.000Z',
              user: { id: 'user-uuid', fullName: 'Emeka Obi', employeeRef: 'Dar-00000003', role: 'MERCHANDISER', tier: 'TIER2', team: 'RADIANT', region: 'SOUTH_WEST' },
              kdAccount: { id: 'customer-uuid', businessName: 'Ore Ofe Distributors' },
              items: [
                {
                  id: 'item-uuid',
                  productId: 'product-uuid',
                  buyerType: 'DISTRIBUTOR',
                  quantityCartons: 10,
                  quantityRows: 0,
                  quantityPieces: 0,
                  product: { id: 'product-uuid', name: 'Hollandia Yoghurt 500ml', sku: 'HY-500' },
                },
              ],
            },
          ],
          meta: { total: 320, page: 1, limit: 20, totalPages: 16 },
        },
        timestamp: '2026-08-02T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden — TIER5_SALES_SUPPORT only' })
  getSupportAllSales(
    @CurrentUser() user: JwtPayload,
    @Query() query: {
      team?: string; tier?: string; region?: string; userId?: string;
      from?: string; to?: string; page?: number; limit?: number;
    },
  ) {
    return this.secondaySalesService.findAllForSupport(query, user);
  }

  // ─── TIER5_SALES_SUPPORT: Sales by User ───────────────────────────────────

  /**
   * GET /secondary-sales/support/user/:userId
   *
   * Full secondary sales history for any specific user.
   * TIER5_SALES_SUPPORT only.
   */
  @Get('support/user/:userId')
  @Roles('TIER5_SALES_SUPPORT')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: "Get a specific user's secondary sales (Sales Support only)",
    description:
      'Returns all secondary sales submitted by the given user. ' +
      'Optionally filter by date range. ' +
      'Restricted to TIER5_SALES_SUPPORT.',
  })
  @ApiParam({ name: 'userId', description: 'UUID of the target field agent' })
  @ApiQuery({ name: 'from',  required: false, description: 'Start date inclusive — ISO 8601' })
  @ApiQuery({ name: 'to',    required: false, description: 'End date inclusive — ISO 8601' })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: "Paginated secondary sales for the target user" })
  @ApiResponse({ status: 403, description: 'Forbidden — TIER5_SALES_SUPPORT only' })
  getSupportSalesByUser(
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: { from?: string; to?: string; page?: number; limit?: number },
  ) {
    return this.secondaySalesService.findByUserForSupport(userId, query, user);
  }

  // ─── List all (own or by ?userId for oversight) ───────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List secondary sales',
    description:
      'Field agents see their own sales only. ' +
      'Oversight roles can optionally filter by ?userId.',
  })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by user — oversight roles only' })
  @ApiQuery({ name: 'from',   required: false, description: 'Start date inclusive — ISO 8601' })
  @ApiQuery({ name: 'to',     required: false, description: 'End date inclusive — ISO 8601' })
  @ApiQuery({ name: 'page',   required: false, type: Number })
  @ApiQuery({ name: 'limit',  required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated secondary sales' })
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: { userId?: string; from?: string; to?: string; page?: number; limit?: number },
  ) {
    return this.secondaySalesService.findAll(query, user);
  }

  // ─── Get one ──────────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single secondary sale by ID',
    description:
      'Field agents can only fetch their own sales. ' +
      'Oversight roles can fetch any sale.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the secondary sale' })
  @ApiResponse({ status: 200, description: 'Secondary sale record' })
  @ApiResponse({ status: 403, description: 'Field agents cannot view other users\' sales' })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.secondaySalesService.findById(id, user);
  }
}