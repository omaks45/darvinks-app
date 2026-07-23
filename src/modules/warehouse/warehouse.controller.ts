// src/modules/warehouse/warehouse.controller.ts
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