import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import {
  attendancePhotoFilter,
} from '@modules/auths/auths.constant';
import { AttendanceService } from './attendance.service';
import {
  AttendanceQueryDto,
  ClockEventDto,
  KdVisitDto,
  OfflineSyncItemDto,
} from './dto/clock-event.dto';

const MAX_ATTENDANCE_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('clock-in')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit clock-in (GPS photo mandatory, gallery blocked)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_ATTENDANCE_PHOTO_BYTES },
      fileFilter: attendancePhotoFilter,
    }),
  )
  clockIn(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ClockEventDto,
    @UploadedFile() photo: Express.Multer.File,
  ) {
    return this.attendanceService.clockIn(user, dto, photo);
  }

  @Post('clock-out')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit clock-out (GPS photo mandatory)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_ATTENDANCE_PHOTO_BYTES },
      fileFilter: attendancePhotoFilter,
    }),
  )
  clockOut(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ClockEventDto,
    @UploadedFile() photo: Express.Multer.File,
  ) {
    return this.attendanceService.clockOut(user, dto, photo);
  }

  @Post('kd-visit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Log a KD visit (Tier 1 only)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_ATTENDANCE_PHOTO_BYTES },
      fileFilter: attendancePhotoFilter,
    }),
  )
  recordKdVisit(
    @CurrentUser() user: JwtPayload,
    @Body() dto: KdVisitDto,
    @UploadedFile() photo: Express.Multer.File,
  ) {
    return this.attendanceService.recordKdVisit(user, dto, photo);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Offline batch sync — submit queued attendance events',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('photos', 20, {
      limits: { fileSize: MAX_ATTENDANCE_PHOTO_BYTES },
      fileFilter: attendancePhotoFilter,
    }),
  )
  syncOffline(
    @CurrentUser() user: JwtPayload,
    @Body('events') eventsJson: string,
    @UploadedFiles() photos: Express.Multer.File[],
  ) {
    const events: OfflineSyncItemDto[] = JSON.parse(eventsJson);
    return this.attendanceService.syncOfflineBatch(user, events, photos);
  }

  @Get()
  @ApiOperation({ summary: 'Query attendance events (visibility enforced per tier)' })
  findEvents(
    @CurrentUser() user: JwtPayload,
    @Query() query: AttendanceQueryDto,
  ) {
    return this.attendanceService.findEvents(user, query);
  }
}