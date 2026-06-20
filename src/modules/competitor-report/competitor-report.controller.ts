
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
import { CompetitorReportService } from './competitor-report.service';
import {
  CreateCompetitorReportDto,
  CompetitorReportQueryDto,
} from './dto/competitor-report.dto';

@ApiTags('Competitor Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('competitor-reports')
export class CompetitorReportController {
  constructor(private readonly competitorReportService: CompetitorReportService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ClockInGuard) // same absence rule as Secondary Sales
  @ApiOperation({
    summary: 'Submit a competitor report (Tier 1-4 only, requires clock-in today)',
    description:
      'Fire-and-forget — no approval workflow. Sales Head/Admin view these ' +
      'as a feed via GET /competitor-reports.',
  })
  @ApiBody({ type: CreateCompetitorReportDto })
  create(
    @Body() dto: CreateCompetitorReportDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.competitorReportService.create(dto, user);
  }

  @Get()
  @ApiOperation({
    summary: 'List competitor reports',
    description: 'Field staff see only their own. Sales Head/Admin/GM see the full feed.',
  })
  findAll(
    @Query() query: CompetitorReportQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.competitorReportService.findAll(query, user);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Get a single competitor report by ID' })
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.competitorReportService.findById(id, user);
  }
}