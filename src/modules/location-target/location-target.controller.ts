
import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { LocationTargetService } from './location-target.service';
import { LocationTargetQueryDto, SetLocationTargetDto } from './dto/location-target.dto';

@ApiTags('Location Targets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('location-targets')
export class LocationTargetController {
  constructor(private readonly locationTargetService: LocationTargetService) {}

  @ApiResponse({ status: 200, description: 'Location target created or updated (upsert — safe to call repeatedly for the same location+category+period).', schema: { example: { success: true, data: { id: 'lt-id', locationId: 'loc-id', location: { name: 'Ikeja', state: 'lagos', region: 'SOUTH_WEST' }, category: 'LOTION', periodMonth: '2026-07', targetValue: 5000, createdAt: '2026-07-25T10:49:41.366Z', updatedAt: '2026-07-25T10:49:41.366Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Only Admin or Sales Head can set location targets', schema: { example: { success: false, statusCode: 403, message: 'Forbidden resource', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Post()
  @HttpCode(HttpStatus.OK) // 200 not 201 because upsert may update not create
  @ApiOperation({
    summary: 'Set a location target for a given month and category (upsert)',
    description:
      'Creates or updates the target. Calling this twice with the same ' +
      'locationId + category + periodMonth updates the existing row.',
  })
  set(@Body() dto: SetLocationTargetDto, @CurrentUser() user: JwtPayload) {
    return this.locationTargetService.set(dto, user);
  }

  @ApiResponse({ status: 200, description: 'Location targets for the specified period. Filter by periodMonth (YYYY-MM) and optionally by locationId.', schema: { example: { success: true, data: [{ id: 'lt-id', locationId: 'loc-id', location: { name: 'Ikeja', state: 'lagos', region: 'SOUTH_WEST' }, category: 'LOTION', periodMonth: '2026-07', targetValue: 5000, createdAt: '2026-07-25T10:49:41.366Z', updatedAt: '2026-07-25T10:49:41.366Z' }], timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Get()
  @ApiOperation({ summary: 'List location targets with optional filters' })
  findAll(@Query() query: LocationTargetQueryDto) {
    return this.locationTargetService.findAll(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.locationTargetService.findById(id);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a location target (Admin/Sales Head only)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.locationTargetService.remove(id, user);
  }
}