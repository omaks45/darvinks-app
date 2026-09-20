
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard }     from '@common/guards/jwt-auth.guard';
import { SkipClockInCheck } from '@common/guards/clock-in.guard';
import { CurrentUser }      from '@common/decorators/current-user.decorator';
import type { JwtPayload }  from '@modules/auths/strategies/jwt.strategies';
import { attendancePhotoFilter } from '@modules/auths/auths.constant';
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

  // ─── Clock In ─────────────────────────────────────────────────────────────
  // @SkipClockInCheck — this IS the action that satisfies the guard; must be
  // reachable before any clock-in exists for today.

  @Post('clock-in')
  @SkipClockInCheck()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit clock-in (GPS photo mandatory, gallery blocked)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_ATTENDANCE_PHOTO_BYTES },
      fileFilter: attendancePhotoFilter,
    }),
  )
  @ApiResponse({ status: 201, description: 'Clocked in successfully. Photo uploaded to Cloudinary. Address resolved from GPS via Google Maps.', schema: { example: { success: true, data: { id: 'event-id', userId: 'agent-id', type: 'CLOCK_IN', latitude: 6.5244, longitude: 3.3792, address: '12 Kolade Street, Ilupeju, Lagos', photoUrl: 'https://res.cloudinary.com/dwiouwwom/image/upload/v.../photo.jpg', deviceTime: '2026-07-29T08:45:00.000Z', serverTime: '2026-07-29T08:45:02.000Z', flag: 'ON_TIME', note: null, createdAt: '2026-07-29T08:45:02.000Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Photo file required or already clocked in today', schema: { example: { success: false, statusCode: 400, message: 'A photo is required for attendance. Send the image as multipart/form-data with field name "photo".', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 409, description: 'Already clocked in today', schema: { example: { success: false, statusCode: 409, message: 'You have already clocked in today', timestamp: '2026-07-29T12:00:00.000Z' } } })
  clockIn(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ClockEventDto,
    @UploadedFile() photo: Express.Multer.File,
  ) {
    return this.attendanceService.clockIn(user, dto, photo);
  }

  // ─── Clock Out ────────────────────────────────────────────────────────────
  // @SkipClockInCheck — clock-out is valid after clock-in; the guard would
  // pass anyway, but skipping avoids the extra DB lookup since the service
  // already asserts a prior clock-in exists.

  @Post('clock-out')
  @SkipClockInCheck()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit clock-out (GPS photo mandatory)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_ATTENDANCE_PHOTO_BYTES },
      fileFilter: attendancePhotoFilter,
    }),
  )
  @ApiResponse({ status: 201, description: 'Clocked out successfully.', schema: { example: { success: true, data: { id: 'event-id', userId: 'agent-id', type: 'CLOCK_OUT', latitude: 6.5244, longitude: 3.3792, address: '12 Kolade Street, Ilupeju, Lagos', photoUrl: 'https://res.cloudinary.com/dwiouwwom/image/upload/v.../photo.jpg', deviceTime: '2026-07-29T17:00:00.000Z', serverTime: '2026-07-29T17:00:02.000Z', flag: 'ON_TIME', note: null, createdAt: '2026-07-29T17:00:02.000Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Photo required or no clock-in found for today', schema: { example: { success: false, statusCode: 400, message: 'You have not clocked in today', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  clockOut(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ClockEventDto,
    @UploadedFile() photo: Express.Multer.File,
  ) {
    return this.attendanceService.clockOut(user, dto, photo);
  }

  // ─── Today's Status ───────────────────────────────────────────────────────
  // @SkipClockInCheck — the mobile app reads this on launch to decide whether
  // to show the "Clock In" screen; must work before any clock-in exists.

  @Get('today')
  @SkipClockInCheck()
  @ApiOperation({
    summary: "Today's clock-in/out status",
    description:
      "Returns the authenticated user's attendance status for today — " +
      'whether they have clocked in, clocked out, the exact times, ' +
      'addresses resolved from GPS, flag (ON_TIME / LATE / OUTSIDE_WINDOW), ' +
      'and total duration on the clock. ' +
      'status is one of: NOT_CLOCKED_IN | CLOCKED_IN | CLOCKED_OUT',
  })
  @ApiResponse({
    status: 200,
    description: "Today's attendance status",
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
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getTodayStatus(@CurrentUser() user: JwtPayload) {
    return this.attendanceService.getTodayStatus(user.sub);
  }

  // ─── KD Visit Arrival ─────────────────────────────────────────────────────
  // Guard is ACTIVE — user must have clocked in before recording a KD visit.

  @Post('kd-visit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Log KD visit arrival (Tier 1–4)',
    description:
      'Records that the field agent has arrived at a KD location. ' +
      'Call POST /attendance/kd-visit/end when the agent leaves. ' +
      'Both endpoints require a selfie photo and GPS coordinates.',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_ATTENDANCE_PHOTO_BYTES },
      fileFilter: attendancePhotoFilter,
    }),
  )
  @ApiResponse({ status: 201, description: 'KD visit arrival recorded' })
  @ApiResponse({ status: 400, description: 'Open visit already exists for this KD today' })
  @ApiResponse({ status: 403, description: 'Clock in first, or only field agents (Tier 1–4) can log KD visits' })
  recordKdVisit(
    @CurrentUser() user: JwtPayload,
    @Body() dto: KdVisitDto,
    @UploadedFile() photo: Express.Multer.File,
  ) {
    return this.attendanceService.recordKdVisit(user, dto, photo);
  }

  // ─── KD Visit Departure ───────────────────────────────────────────────────
  // Guard is ACTIVE — user must have clocked in before ending a KD visit.

  @Post('kd-visit/end')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Log KD visit departure (Tier 1–4)',
    description:
      'Records that the field agent has left the KD location. ' +
      'Must be called after POST /attendance/kd-visit for the same KD and same day. ' +
      'The server validates that an open arrival record exists for this KD today before creating the departure record. ' +
      'The frontend pairs the arrival (KD_VISIT) and departure (KD_VISIT_END) records ' +
      'by matching kdAccountId + date to calculate visit duration.',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_ATTENDANCE_PHOTO_BYTES },
      fileFilter: attendancePhotoFilter,
    }),
  )
  @ApiResponse({ status: 201, description: 'KD visit departure recorded' })
  @ApiResponse({ status: 400, description: 'No open KD visit found for this KD today, or already ended' })
  @ApiResponse({ status: 403, description: 'Clock in first, or only field agents (Tier 1–4) can log KD visits' })
  endKdVisit(
    @CurrentUser() user: JwtPayload,
    @Body() dto: KdVisitDto,
    @UploadedFile() photo: Express.Multer.File,
  ) {
    return this.attendanceService.endKdVisit(user, dto, photo);
  }

  // ─── Offline Batch Sync ───────────────────────────────────────────────────
  // @SkipClockInCheck — the batch may itself contain the clock-in event that
  // was captured offline. Blocking sync until clock-in is present on the
  // server would create a chicken-and-egg deadlock for offline users.

  @Post('sync')
  @SkipClockInCheck()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Offline batch sync — submit queued attendance events' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('photos', 20, {
      limits: { fileSize: MAX_ATTENDANCE_PHOTO_BYTES },
      fileFilter: attendancePhotoFilter,
    }),
  )
  @ApiResponse({ status: 200, description: 'Batch processed. Returns { processed, skipped } counts.' })
  syncOffline(
    @CurrentUser() user: JwtPayload,
    @Body('events') eventsJson: string,
    @UploadedFiles() photos: Express.Multer.File[],
  ) {
    const events: OfflineSyncItemDto[] = JSON.parse(eventsJson);
    return this.attendanceService.syncOfflineBatch(user, events, photos);
  }

  // ─── List All Attendance Events ───────────────────────────────────────────
  // Guard is ACTIVE — field agents must clock in before querying records.

  @Get()
  @ApiOperation({
    summary: 'List attendance events (clock-in / clock-out)',
    description:
      'Field staff see their own records only. ' +
      'Oversight roles (FIELD_SUPPORT and above) see all — ' +
      'optionally filtered by userId, type, or date range. ' +
      'Defaults to CLOCK_IN + CLOCK_OUT events; pass ?type= to see KD visits.',
  })
  @ApiQuery({ name: 'type',   required: false, enum: ['CLOCK_IN', 'CLOCK_OUT', 'KD_VISIT', 'KD_VISIT_END'], description: 'Filter by event type (default: CLOCK_IN + CLOCK_OUT)' })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by a specific user — oversight roles only' })
  @ApiQuery({ name: 'from',   required: false, description: 'Start date inclusive — ISO 8601 (e.g. 2026-08-01)' })
  @ApiQuery({ name: 'to',     required: false, description: 'End date inclusive — ISO 8601 (e.g. 2026-08-31)' })
  @ApiQuery({ name: 'page',   required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit',  required: false, type: Number, description: 'Results per page, max 100 (default: 20)' })
  @ApiResponse({
    status: 200,
    description: 'Paginated attendance events',
    schema: {
      example: {
        success: true,
        data: {
          data: [
            {
              id: 'event-id',
              type: 'CLOCK_IN',
              flag: 'ON_TIME',
              photoUrl: 'https://res.cloudinary.com/...',
              latitude: 6.5244,
              longitude: 3.3792,
              address: '12 Kolade Street, Ilupeju, Lagos',
              deviceTime: '2026-08-02T08:45:00.000Z',
              serverTime: '2026-08-02T08:45:02.000Z',
              note: null,
              kdAccountId: null,
              kdAccount: null,
              user: { id: 'user-id', fullName: 'Emeka Obi', employeeRef: 'Dar-00000003', role: 'MERCHANDISER', team: 'RADIANT', region: 'SOUTH_WEST' },
            },
          ],
          meta: { total: 120, page: 1, limit: 20, totalPages: 6 },
        },
        timestamp: '2026-08-02T12:00:00.000Z',
      },
    },
  })
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: AttendanceQueryDto & { page?: number; limit?: number },
  ) {
    return this.attendanceService.findAll(query, user);
  }

  // ─── KD Visit Pairs ───────────────────────────────────────────────────────
  // Guard is ACTIVE.

  @Get('kd-visits')
  @ApiOperation({
    summary: 'List KD visit pairs (arrival + departure)',
    description:
      'Each result contains the KD_VISIT event plus a `visitEnd` field ' +
      '(null if the agent has not yet ended the visit). ' +
      'Field staff see their own visits only; oversight roles see all.',
  })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by user — oversight roles only' })
  @ApiQuery({ name: 'from',   required: false, description: 'Start date inclusive — ISO 8601' })
  @ApiQuery({ name: 'to',     required: false, description: 'End date inclusive — ISO 8601' })
  @ApiQuery({ name: 'page',   required: false, type: Number })
  @ApiQuery({ name: 'limit',  required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Paginated KD visit pairs',
    schema: {
      example: {
        success: true,
        data: {
          data: [
            {
              id: 'visit-start-id',
              type: 'KD_VISIT',
              flag: 'ON_TIME',
              photoUrl: 'https://res.cloudinary.com/...',
              latitude: 6.5244,
              longitude: 3.3792,
              address: '45 Allen Avenue, Ikeja, Lagos',
              deviceTime: '2026-08-02T09:10:00.000Z',
              serverTime: '2026-08-02T09:10:02.000Z',
              note: null,
              kdAccountId: 'customer-uuid',
              kdAccount: { id: 'customer-uuid', businessName: 'Ore Ofe Distributors' },
              user: { id: 'user-id', fullName: 'Emeka Obi', employeeRef: 'Dar-00000003', role: 'MERCHANDISER', team: 'RADIANT', region: 'SOUTH_WEST' },
              visitEnd: {
                id: 'visit-end-id',
                type: 'KD_VISIT_END',
                flag: 'ON_TIME',
                photoUrl: 'https://res.cloudinary.com/...',
                latitude: 6.5244,
                longitude: 3.3792,
                address: '45 Allen Avenue, Ikeja, Lagos',
                deviceTime: '2026-08-02T10:30:00.000Z',
                serverTime: '2026-08-02T10:30:02.000Z',
                note: 'Completed order review',
              },
            },
          ],
          meta: { total: 14, page: 1, limit: 20, totalPages: 1 },
        },
        timestamp: '2026-08-02T12:00:00.000Z',
      },
    },
  })
  findKdVisits(
    @CurrentUser() user: JwtPayload,
    @Query() query: AttendanceQueryDto & { page?: number; limit?: number },
  ) {
    return this.attendanceService.findKdVisits(query, user);
  }

  // ─── Single User History ──────────────────────────────────────────────────
  // Guard is ACTIVE.

  @Get('user/:userId')
  @ApiOperation({
    summary: "Get a specific user's attendance history",
    description:
      'Field agents may only request their own history — passing another userId returns 403. ' +
      'Oversight roles (FIELD_SUPPORT and above) can view any user. ' +
      'Supports the same filters as GET /attendance (type, from, to, page, limit).',
  })
  @ApiParam({ name: 'userId', description: 'UUID of the target user' })
  @ApiQuery({ name: 'type',  required: false, enum: ['CLOCK_IN', 'CLOCK_OUT', 'KD_VISIT', 'KD_VISIT_END'] })
  @ApiQuery({ name: 'from',  required: false, description: 'Start date inclusive — ISO 8601' })
  @ApiQuery({ name: 'to',    required: false, description: 'End date inclusive — ISO 8601' })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: "Paginated attendance history for the target user" })
  @ApiResponse({ status: 403, description: "Field agents cannot view another user's attendance, or clock in required" })
  findByUser(
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: AttendanceQueryDto & { page?: number; limit?: number },
  ) {
    return this.attendanceService.findByUser(userId, query, user);
  }
}