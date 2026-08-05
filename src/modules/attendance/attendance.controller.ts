// src/modules/attendance/attendance.controller.ts
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
  ApiResponse,
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

  @ApiResponse({ status: 201, description: 'Clocked in successfully. Photo uploaded to Cloudinary. Address resolved from GPS via Google Maps.', schema: { example: { success: true, data: { id: 'event-id', userId: 'agent-id', type: 'CLOCK_IN', latitude: 6.5244, longitude: 3.3792, address: '12 Kolade Street, Ilupeju, Lagos', photoUrl: 'https://res.cloudinary.com/dwiouwwom/image/upload/v.../photo.jpg', deviceTime: '2026-07-29T08:45:00.000Z', serverTime: '2026-07-29T08:45:02.000Z', flag: 'ON_TIME', note: null, createdAt: '2026-07-29T08:45:02.000Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Photo file required or already clocked in today', schema: { example: { success: false, statusCode: 400, message: 'A photo is required for attendance. Send the image as multipart/form-data with field name \"photo\".', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 409, description: 'Already clocked in today', schema: { example: { success: false, statusCode: 409, message: 'You have already clocked in today', timestamp: '2026-07-29T12:00:00.000Z' } } })
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

  @ApiResponse({ status: 201, description: 'Clocked out successfully.', schema: { example: { success: true, data: { id: 'event-id', userId: 'agent-id', type: 'CLOCK_OUT', latitude: 6.5244, longitude: 3.3792, address: '12 Kolade Street, Ilupeju, Lagos', photoUrl: 'https://res.cloudinary.com/dwiouwwom/image/upload/v.../photo.jpg', deviceTime: '2026-07-29T17:00:00.000Z', serverTime: '2026-07-29T17:00:02.000Z', flag: 'ON_TIME', note: null, createdAt: '2026-07-29T17:00:02.000Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Photo required or no clock-in found for today', schema: { example: { success: false, statusCode: 400, message: 'You have not clocked in today', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
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

  @ApiResponse({ status: 200, description: 'Attendance history for the requesting user. Admins can filter by userId.', schema: { example: { success: true, data: [{ id: 'event-id', userId: 'agent-id', type: 'CLOCK_IN', latitude: 6.5244, longitude: 3.3792, address: '12 Kolade Street, Ilupeju, Lagos', photoUrl: 'https://res.cloudinary.com/dwiouwwom/image/upload/v.../photo.jpg', deviceTime: '2026-07-29T08:45:00.000Z', serverTime: '2026-07-29T08:45:02.000Z', flag: 'ON_TIME', note: null, createdAt: '2026-07-29T08:45:02.000Z' }], timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Get('today')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Today's clock-in/out status",
    description:
      'Returns the authenticated user\'s attendance status for today — ' +
      'whether they have clocked in, clocked out, the exact times, ' +
      'addresses resolved from GPS, flag (ON_TIME / LATE / OUTSIDE_WINDOW), ' +
      'and total duration on the clock. ' +
      'status field is one of: NOT_CLOCKED_IN | CLOCKED_IN | CLOCKED_OUT',
  })
  @ApiResponse({
    status: 200,
    description: 'Today\'s attendance status',
    schema: {
      example: {
        success: true,
        data: {
          date:            '2026-08-02',
          status:          'CLOCKED_IN',
          clockedInToday:  true,
          clockedOutToday: false,
          clockIn: {
            id:         'event-id',
            time:       '2026-08-02T08:45:02.000Z',
            deviceTime: '2026-08-02T08:45:00.000Z',
            address:    '12 Kolade Street, Ilupeju, Lagos',
            photoUrl:   'https://res.cloudinary.com/dwiouwwom/image/upload/v.../photo.jpg',
            flag:       'ON_TIME',
            latitude:   6.5244,
            longitude:  3.3792,
          },
          clockOut:        null,
          durationMinutes: null,
        },
        timestamp: '2026-08-02T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Example when fully clocked out',
    schema: {
      example: {
        success: true,
        data: {
          date:            '2026-08-02',
          status:          'CLOCKED_OUT',
          clockedInToday:  true,
          clockedOutToday: true,
          clockIn: {
            id:         'event-in-id',
            time:       '2026-08-02T08:45:02.000Z',
            deviceTime: '2026-08-02T08:45:00.000Z',
            address:    '12 Kolade Street, Ilupeju, Lagos',
            photoUrl:   'https://res.cloudinary.com/dwiouwwom/image/upload/v.../photo.jpg',
            flag:       'ON_TIME',
            latitude:   6.5244,
            longitude:  3.3792,
          },
          clockOut: {
            id:         'event-out-id',
            time:       '2026-08-02T17:00:05.000Z',
            deviceTime: '2026-08-02T17:00:00.000Z',
            address:    '14 Broad Street, Lagos Island',
            photoUrl:   'https://res.cloudinary.com/dwiouwwom/image/upload/v.../photo.jpg',
            flag:       'ON_TIME',
            latitude:   6.4541,
            longitude:  3.3947,
          },
          durationMinutes: 495,
        },
        timestamp: '2026-08-02T17:05:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-02T12:00:00.000Z' } },
  })
  getTodayStatus(@CurrentUser() user: JwtPayload) {
    return this.attendanceService.getTodayStatus(user.sub);
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