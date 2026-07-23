
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