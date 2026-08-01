
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
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

  @ApiResponse({ status: 201, description: 'Competitor report submitted. TEXT type: send as JSON. IMAGE/VIDEO/PDF: send as multipart/form-data with a \"file\" field — server uploads to Cloudinary automatically.', schema: { example: { success: true, data: { id: 'report-id', submittedById: 'agent-id', submittedBy: { fullName: 'Kenny Solape', employeeRef: 'Dar-00000007', tier: 'TIER2' }, region: 'SOUTH_WEST', state: null, mediaType: 'TEXT', mediaUrl: null, textContent: 'Competitor X launched a new lotion at lower price in Mushin', tags: ['pricing', 'new-product'], createdAt: '2026-07-27T22:50:51.785Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'File required when mediaType is IMAGE, VIDEO, or PDF', schema: { example: { success: false, statusCode: 400, message: 'A file is required when mediaType is IMAGE', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Not clocked in or wrong tier', schema: { example: { success: false, statusCode: 403, message: 'You must clock in before performing this action', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ClockInGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'For TEXT reports: send as JSON (Content-Type: application/json). ' +
      'For IMAGE/VIDEO/PDF reports: send as multipart/form-data with a "file" field.',
    schema: {
      type: 'object',
      required: ['mediaType'],
      properties: {
        mediaType:   { type: 'string', enum: ['TEXT', 'IMAGE', 'VIDEO', 'PDF'] },
        textContent: { type: 'string', description: 'Required when mediaType is TEXT' },
        tags:        { type: 'array', items: { type: 'string' } },
        note:        { type: 'string' },
        file: {
          type: 'string',
          format: 'binary',
          description: 'Required when mediaType is IMAGE, VIDEO, or PDF',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Submit a competitor report (Tier 1-4, clock-in required)',
    description:
      'TEXT reports: send as JSON with textContent field. ' +
      'IMAGE/VIDEO/PDF reports: send as multipart/form-data with a file attached. ' +
      'Server uploads the file to Cloudinary automatically.',
  })
  @UseInterceptors(FileInterceptor('file'))
  create(
    @Body() dto: CreateCompetitorReportDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (dto.mediaType !== 'TEXT' && !file) {
      throw new BadRequestException(
        `A file is required when mediaType is ${dto.mediaType}`,
      );
    }
    return this.competitorReportService.create(dto, file, user);
  }

  @ApiResponse({ status: 200, description: 'Competitor reports. Field staff see only their own. Sales Head and Admin see all.', schema: { example: { success: true, data: [{ id: 'report-id', submittedById: 'agent-id', submittedBy: { fullName: 'Kenny Solape', employeeRef: 'Dar-00000007', tier: 'TIER2' }, region: 'SOUTH_WEST', mediaType: 'TEXT', mediaUrl: null, textContent: 'Competitor X launched a new lotion at lower price', tags: ['pricing'], createdAt: '2026-07-27T22:50:51.785Z' }], timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
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