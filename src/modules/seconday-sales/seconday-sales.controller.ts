// src/modules/secondary-sales/secondary-sale.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { ClockInGuard } from '@common/guards/clock-in.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { SecondarySaleService } from './seconday-sales.service';
import { CreateSecondarySaleDto, SecondarySaleQueryDto } from './dto/seconday-sale.dto';

@ApiTags('Secondary Sales')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('secondary-sales')
export class SecondarySaleController {
  constructor(private readonly secondarySaleService: SecondarySaleService) {}

  @ApiResponse({ status: 201, description: 'Secondary sale logged. GPS address auto-resolved. Clock-in required.', schema: { example: { success: true, data: { id: 'sale-id', userId: 'agent-id', kdAccountId: 'cust-id', latitude: 6.5244, longitude: 3.3792, address: '12 Kolade Street, Ilupeju, Lagos', deviceTime: '2026-07-29T10:30:00.000Z', serverTime: '2026-07-29T10:30:02.000Z', note: null, items: [{ id: 'item-id', productId: 'prod-id', product: { name: 'Visita Essence B Whitening Lotion (250ml)', category: 'LOTION' }, buyerType: 'WHOLESALER', quantityCartons: 5 }], createdAt: '2026-07-29T10:30:02.000Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Not clocked in today', schema: { example: { success: false, statusCode: 403, message: 'You must clock in before performing this action', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ClockInGuard) // must have clocked in today — absent staff cannot log sales
  @ApiOperation({
    summary: 'Log a secondary sale (Tier 1-4 only, requires clock-in today)',
    description:
      'Records sales witnessed/made at a KD location to sub-distributors, ' +
      'wholesalers, or retailers. Blocked if the field agent has not clocked in today.',
  })
  @ApiBody({ type: CreateSecondarySaleDto })
  create(
    @Body() dto: CreateSecondarySaleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.secondarySaleService.create(dto, user);
  }

  @ApiResponse({ status: 200, description: 'Secondary sales history. Field staff see their own. Admins see all.', schema: { example: { success: true, data: [{ id: 'sale-id', userId: 'agent-id', kdAccountId: 'cust-id', address: '12 Kolade Street, Ilupeju, Lagos', deviceTime: '2026-07-29T10:30:00.000Z', items: [{ productId: 'prod-id', product: { name: 'Visita Essence B Whitening Lotion (250ml)', category: 'LOTION' }, buyerType: 'WHOLESALER', quantityCartons: 5 }], createdAt: '2026-07-29T10:30:02.000Z' }], timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Get()
  @ApiOperation({
    summary: 'List secondary sales',
    description: 'Field staff see only their own. Admins see all.',
  })
  findAll(
    @Query() query: SecondarySaleQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.secondarySaleService.findAll(query, user);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Get a single secondary sale by ID' })
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.secondarySaleService.findById(id, user);
  }
}