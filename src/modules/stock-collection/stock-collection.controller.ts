// src/modules/stock-collection/stock-collection.controller.ts
import {
  Body, Controller, Get, HttpCode, HttpStatus, Param,
  ParseUUIDPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StockCollectionService } from './stock-collection.service';
import { CreateStockCollectionDto, StockCollectionQueryDto } from './dto/stock-collection.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { ClockInGuard } from '@common/guards/clock-in.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

@ApiTags('Stock Collections')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('stock-collections')
export class StockCollectionController {
  constructor(private readonly service: StockCollectionService) {}

  // ── POST /stock-collections ───────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ClockInGuard)
  @ApiOperation({
    summary: 'Collect stock from a Primary Customer (KD)',
    description:
      'Tier 1-3 visits a KD, selects products and quantities from the full catalogue, ' +
      'and submits. Prices are fixed from the product catalogue (cartonPriceKobo). ' +
      'Agent in-hand inventory increases by the collected quantities. ' +
      'A branded PDF invoice is generated automatically after submission — ' +
      'check invoiceUrl after ~5 seconds via GET /stock-collections/:id.',
  })
  @ApiBody({ type: CreateStockCollectionDto })
  @ApiResponse({
    status: 201,
    description: 'Stock collected — inventory updated, invoice generation queued',
    schema: {
      example: {
        success: true,
        data: {
          id:            'coll-id',
          collectionRef: 'SC-000001',
          userId:        'agent-id',
          user:          { fullName: 'Kenny Solape', employeeRef: 'Dar-00000007', tier: 'TIER1' },
          sourceId:      'kd-id',
          source:        { businessName: 'Ore Ofe Distributors', address: '12 Kolade St, Ilupeju, Lagos', region: 'SOUTH_WEST' },
          status:        'CONFIRMED',
          subtotalKobo:  945000000,
          invoiceUrl:    null,
          submittedAt:   '2026-08-10T09:51:00.000Z',
          note:          null,
          createdAt:     '2026-08-10T09:51:02.000Z',
          items: [{
            id:              'item-id',
            productId:       'prod-id',
            product:         { name: 'Visita Essence B Whitening Lotion (250ml)', category: 'LOTION' },
            quantityCartons: 150,
            unitPriceKobo:   6300000,
            lineTotalKobo:   945000000,
          }],
        },
        timestamp: '2026-08-10T09:51:02.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Source is not a PRIMARY customer, or product not found/inactive', schema: { example: { success: false, statusCode: 400, message: 'Stock can only be collected from PRIMARY customers (Key Distributors)', timestamp: '2026-08-10T09:51:02.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-10T09:51:02.000Z' } } })
  @ApiResponse({ status: 403, description: 'Not clocked in or wrong tier', schema: { example: { success: false, statusCode: 403, message: 'You must clock in before performing this action', timestamp: '2026-08-10T09:51:02.000Z' } } })
  create(
    @Body() dto: CreateStockCollectionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(dto, user);
  }

  // ── GET /stock-collections/my-inventory ──────────────────────────────────────

  @Get('my-inventory')
  @ApiOperation({
    summary: "Agent's current in-hand stock",
    description:
      'Returns all products the agent currently holds in hand after collections, ' +
      'minus what has already been sold to secondary customers. ' +
      'This is the source for the secondary sale "sell product" page.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current in-hand inventory',
    schema: {
      example: {
        success: true,
        data: [{
          id:              'inv-id',
          productId:       'prod-id',
          product:         { name: 'Visita Essence B Whitening Lotion (250ml)', category: 'LOTION', cartonPriceKobo: 6300000 },
          quantityCartons: 120,
          valueKobo:       756000000,
          updatedAt:       '2026-08-10T09:51:02.000Z',
        }],
        timestamp: '2026-08-10T09:51:02.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-10T09:51:02.000Z' } } })
  getMyInventory(@CurrentUser() user: JwtPayload) {
    return this.service.getMyInventory(user);
  }

  // ── GET /stock-collections ────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List stock collections (invoice history)',
    description: 'Field staff see only their own. Admins see all. Filter by sourceId, status, date range.',
  })
  @ApiResponse({
    status: 200,
    description: 'Stock collection list — invoice history page',
    schema: {
      example: {
        success: true,
        data: [{
          id:            'coll-id',
          collectionRef: 'SC-000001',
          source:        { businessName: 'Ore Ofe Distributors', region: 'SOUTH_WEST' },
          status:        'CONFIRMED',
          subtotalKobo:  945000000,
          invoiceUrl:    'https://res.cloudinary.com/dwiouwwom/.../SC-000001-invoice.pdf',
          submittedAt:   '2026-08-10T09:51:00.000Z',
          items:         [],
        }],
        timestamp: '2026-08-10T09:51:02.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-10T09:51:02.000Z' } } })
  findAll(
    @Query() query: StockCollectionQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.findAll(query, user);
  }

  // ── GET /stock-collections/:id ────────────────────────────────────────────────

  @Get(':id')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Get stock collection detail with invoice URL' })
  @ApiResponse({ status: 200, description: 'Stock collection detail', schema: { example: { success: true, data: { id: 'coll-id', collectionRef: 'SC-000001', invoiceUrl: 'https://res.cloudinary.com/...pdf', items: [] }, timestamp: '2026-08-10T09:51:02.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-10T09:51:02.000Z' } } })
  @ApiResponse({ status: 403, description: 'Not your collection', schema: { example: { success: false, statusCode: 403, message: 'You can only view your own stock collections', timestamp: '2026-08-10T09:51:02.000Z' } } })
  @ApiResponse({ status: 404, description: 'Not found', schema: { example: { success: false, statusCode: 404, message: 'Stock collection not found', timestamp: '2026-08-10T09:51:02.000Z' } } })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.findOne(id, user);
  }
}