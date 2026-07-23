// src/modules/locations/location.controller.ts
import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { LocationService } from './location.service';
import { CreateLocationDto, LocationQueryDto } from './dto/location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@ApiTags('Locations')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('locations')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a location (Admin/Sales Head only)' })
  create(@Body() dto: CreateLocationDto, @CurrentUser() user: JwtPayload) {
    return this.locationService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List all locations, optionally filtered by region/state' })
  findAll(@Query() query: LocationQueryDto) {
    return this.locationService.findAll(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Get a single location with its active customers' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.locationService.findById(id);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Update a location (Admin/Sales Head only)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.locationService.update(id, dto, user);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a location — blocked if customers or targets exist' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.locationService.remove(id, user);
  }
}