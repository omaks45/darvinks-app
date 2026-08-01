
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { WarehouseLocation } from '@prisma/client';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { WarehouseService } from './warehouse.service';
import {
  StockInboundDto,
  StockAdjustmentDto,
  StockQueryDto,
  MovementQueryDto,
} from './dto/warehouse.dto';

@ApiTags('Warehouse')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  // ── Stock levels (readable by all authenticated users) ─────────────────────

  @ApiResponse({ status: 200, description: 'Current stock levels. Filter by warehouseLocation to see a specific warehouse.', schema: { example: { success: true, data: [{ id: 'stock-id', productId: 'prod-id', product: { name: 'Visita Essence B Whitening Lotion (250ml)', category: 'LOTION' }, warehouseLocation: 'LAGOS_HQ', quantityCartons: 200, updatedAt: '2026-07-25T10:49:41.366Z' }], timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Get('stock')
  @ApiOperation({
    summary: 'Get current stock levels',
    description: 'Optional filters: warehouseLocation, lowStockOnly.',
  })
  getStockLevels(@Query() query: StockQueryDto) {
    return this.warehouseService.getStockLevels(query);
  }

  @Get('stock/:warehouseLocation/:productId')
  @ApiOperation({ summary: 'Get stock level for a specific product at a warehouse' })
  @ApiParam({ name: 'warehouseLocation', enum: WarehouseLocation })
  @ApiParam({ name: 'productId', type: 'string', format: 'uuid' })
  getStockForProduct(
    @Param('warehouseLocation', new ParseEnumPipe(WarehouseLocation))
    warehouseLocation: WarehouseLocation,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.warehouseService.getStockForProduct(productId, warehouseLocation);
  }

  // ── Stock movements (Warehouse Admin / System Admin only) ──────────────────

  @ApiResponse({ status: 201, description: 'Inbound stock recorded. quantityCartons added to existing stock for that product + warehouse location.', schema: { example: { success: true, data: { id: 'stock-id', productId: 'prod-id', product: { name: 'Visita Essence B Whitening Lotion (250ml)', category: 'LOTION' }, warehouseLocation: 'LAGOS_HQ', quantityCartons: 200, updatedAt: '2026-07-25T10:49:41.366Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Only Warehouse Admin or System Admin can record inbound stock', schema: { example: { success: false, statusCode: 403, message: 'Forbidden resource', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Post('inbound')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Record inbound stock (Warehouse Admin / System Admin)',
    description:
      'Upserts stock entry and creates an INBOUND movement record. ' +
      'Product must be active.',
  })
  @ApiBody({ type: StockInboundDto })
  recordInbound(
    @Body() dto: StockInboundDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.recordInbound(dto, user);
  }

  @Post('adjustment')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Adjust stock (Warehouse Admin / System Admin)',
    description:
      'Positive quantity increases stock, negative decreases it. ' +
      'Cannot result in negative stock. Requires a reason note.',
  })
  @ApiBody({ type: StockAdjustmentDto })
  adjustStock(
    @Body() dto: StockAdjustmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.adjustStock(dto, user);
  }

  // ── Movement history (readable by all authenticated users) ─────────────────

  @Get('movements')
  @ApiOperation({
    summary: 'Get stock movement history',
    description:
      'Returns up to 200 most recent movements. ' +
      'Filter by warehouseLocation, type, or productId.',
  })
  getMovements(@Query() query: MovementQueryDto) {
    return this.warehouseService.getMovements(query);
  }
}