
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

import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { RolesGuard } from '@common/guards/roles.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { attendancePhotoFilter } from '@modules/auths/auths.constant';
import { AttendanceService, PaginatedResult } from './attendance.service';
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

  // ─── KD Visit Arrival ─────────────────────────────────────────────────────

  @Post('kd-visit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Log KD visit arrival (Tier 1–4)',
    description:
      'Records that the field agent has arrived at a KD location. ' +
      'The response includes the new event ID — the mobile client must store this ' +
      'ID and send it as `parentEventId` when calling POST /attendance/kd-visit/end. ' +
      'Both endpoints require a selfie photo and GPS coordinates.',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_ATTENDANCE_PHOTO_BYTES },
      fileFilter: attendancePhotoFilter,
    }),
  )
  @ApiResponse({
    status: 201,
    description: 'KD visit arrival recorded. Store the returned `id` — send it as `parentEventId` when ending this visit.',
    schema: {
      example: {
        success: true,
        data: {
          id: 'visit-start-uuid',
          type: 'KD_VISIT',
          flag: 'ON_TIME',
          kdAccountId: 'customer-uuid',
          latitude: 6.5244,
          longitude: 3.3792,
          address: '45 Allen Avenue, Ikeja, Lagos',
          photoUrl: 'https://res.cloudinary.com/...',
          deviceTime: '2026-08-02T09:10:00.000Z',
          serverTime: '2026-08-02T09:10:02.000Z',
          note: null,
        },
        timestamp: '2026-08-02T09:10:02.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Open visit already exists for this KD today' })
  @ApiResponse({ status: 403, description: 'Only field agents (Tier 1–4) can log KD visits' })
  recordKdVisit(
    @CurrentUser() user: JwtPayload,
    @Body() dto: KdVisitDto,
    @UploadedFile() photo: Express.Multer.File,
  ) {
    return this.attendanceService.recordKdVisit(user, dto, photo);
  }

  // ─── KD Visit Departure ───────────────────────────────────────────────────

  @Post('kd-visit/end')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Log KD visit departure (Tier 1–4)',
    description:
      'Records that the field agent has left the KD location. ' +
      'Send the `parentEventId` field in the request body — it must be the `id` ' +
      'returned when the visit was opened via POST /attendance/kd-visit. ' +
      'The server uses this to link the departure to the exact arrival record, ' +
      'which allows correct pairing even when the same customer is visited twice in one day. ' +
      'The server validates that an open arrival record exists for this KD today before creating the departure.',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_ATTENDANCE_PHOTO_BYTES },
      fileFilter: attendancePhotoFilter,
    }),
  )
  @ApiResponse({
    status: 201,
    description: 'KD visit departure recorded. The `parentEventId` field on the response links this departure back to the arrival.',
    schema: {
      example: {
        success: true,
        data: {
          id: 'visit-end-uuid',
          type: 'KD_VISIT_END',
          flag: 'ON_TIME',
          kdAccountId: 'customer-uuid',
          parentEventId: 'visit-start-uuid',
          latitude: 6.5244,
          longitude: 3.3792,
          address: '45 Allen Avenue, Ikeja, Lagos',
          photoUrl: 'https://res.cloudinary.com/...',
          deviceTime: '2026-08-02T10:30:00.000Z',
          serverTime: '2026-08-02T10:30:02.000Z',
          note: null,
        },
        timestamp: '2026-08-02T10:30:02.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'No open KD visit found for this KD today, or already ended' })
  @ApiResponse({ status: 403, description: 'Only field agents (Tier 1–4) can log KD visits' })
  endKdVisit(
    @CurrentUser() user: JwtPayload,
    @Body() dto: KdVisitDto,
    @UploadedFile() photo: Express.Multer.File,
  ) {
    return this.attendanceService.endKdVisit(user, dto, photo);
  }

  // ─── Offline Batch Sync ───────────────────────────────────────────────────

  @Post('sync')
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

  // ─── Today's Status ───────────────────────────────────────────────────────

  @Get('today')
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

  // ─── TIER5_FIELD_SUPPORT: All Attendance (platform-wide) ─────────────────

  @Get('support/all')
  @Roles('TIER5_FIELD_SUPPORT')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: 'All attendance records — platform-wide (Field Support only)',
    description:
      'Returns all attendance events across the platform. ' +
      'Filter by team, tier, region, userId, event type, or date range. ' +
      'Restricted to TIER5_FIELD_SUPPORT.',
  })
  @ApiQuery({ name: 'team',   required: false, description: 'Filter by team (e.g. RADIANT)' })
  @ApiQuery({ name: 'tier',   required: false, description: 'Filter by user tier (e.g. TIER2)' })
  @ApiQuery({ name: 'region', required: false, description: 'Filter by region (e.g. SOUTH_WEST)' })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by a specific user UUID' })
  @ApiQuery({ name: 'type',   required: false, enum: ['CLOCK_IN', 'CLOCK_OUT', 'KD_VISIT', 'KD_VISIT_END'], description: 'Filter by event type' })
  @ApiQuery({ name: 'from',   required: false, description: 'Start date inclusive — ISO 8601 (e.g. 2026-08-01)' })
  @ApiQuery({ name: 'to',     required: false, description: 'End date inclusive — ISO 8601 (e.g. 2026-08-31)' })
  @ApiQuery({ name: 'page',   required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit',  required: false, type: Number, description: 'Results per page, max 100 (default: 20)' })
  @ApiResponse({
    status: 200,
    description: 'Paginated platform-wide attendance events',
    schema: {
      example: {
        success: true,
        data: {
          data: [
            {
              id: 'event-id', type: 'CLOCK_IN', flag: 'ON_TIME',
              photoUrl: 'https://res.cloudinary.com/...',
              latitude: 6.5244, longitude: 3.3792,
              address: '12 Kolade Street, Ilupeju, Lagos',
              deviceTime: '2026-08-02T08:45:00.000Z',
              serverTime: '2026-08-02T08:45:02.000Z',
              note: null, kdAccountId: null, kdAccount: null,
              user: { id: 'user-id', fullName: 'Emeka Obi', employeeRef: 'Dar-00000003', role: 'MERCHANDISER', tier: 'TIER2', team: 'RADIANT', region: 'SOUTH_WEST' },
            },
          ],
          meta: { total: 1540, page: 1, limit: 20, totalPages: 77 },
        },
        timestamp: '2026-08-02T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden — TIER5_FIELD_SUPPORT only' })
  getSupportAllAttendance(
    @CurrentUser() user: JwtPayload,
    @Query() query: {
      team?: string; tier?: string; region?: string; userId?: string;
      type?: string; from?: string; to?: string;
      page?: number; limit?: number;
    },
  ) {
    return this.attendanceService.findAllForSupport(query, user);
  }

  // ─── TIER5_FIELD_SUPPORT: Attendance by User (daily scored format) ────────

  @Get('support/user/:userId')
  @Roles('TIER5_FIELD_SUPPORT')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: "Get a user's attendance history — daily scored format (Field Support only)",
    description:
      'Returns the attendance history for the given user grouped by calendar day. ' +
      'Each day shows a `clockIn` score (1 = ON_TIME, 0 = LATE/OUTSIDE_WINDOW/absent) ' +
      'and a `clockOut` score on the same basis. ' +
      '`totalPoints` is the sum — max 2 per day. ' +
      'This scoring format is used by the Field Support team for payment calculation. ' +
      'Restricted to TIER5_FIELD_SUPPORT.',
  })
  @ApiParam({ name: 'userId', description: 'UUID of the target user' })
  @ApiQuery({ name: 'from',  required: false, description: 'Start date inclusive — ISO 8601' })
  @ApiQuery({ name: 'to',    required: false, description: 'End date inclusive — ISO 8601' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number — paginates by day, not by raw event (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Days per page (default: 31, max: 100)' })
  @ApiResponse({
    status: 200,
    description: 'Daily scored attendance history for payment calculation',
    schema: {
      example: {
        success: true,
        data: {
          data: [
            {
              date:         '2026-08-02',
              clockIn:      1,
              clockInFlag:  'ON_TIME',
              clockInTime:  '2026-08-02T08:45:02.000Z',
              clockOut:     1,
              clockOutFlag: 'ON_TIME',
              clockOutTime: '2026-08-02T17:00:02.000Z',
              totalPoints:  2,
            },
            {
              date:         '2026-08-01',
              clockIn:      1,
              clockInFlag:  'ON_TIME',
              clockInTime:  '2026-08-01T08:55:01.000Z',
              clockOut:     0,
              clockOutFlag: 'LATE',
              clockOutTime: '2026-08-01T18:10:00.000Z',
              totalPoints:  1,
            },
            {
              date:         '2026-07-31',
              clockIn:      0,
              clockInFlag:  'OUTSIDE_WINDOW',
              clockInTime:  '2026-07-31T11:00:00.000Z',
              clockOut:     null,
              clockOutFlag: null,
              clockOutTime: null,
              totalPoints:  0,
            },
          ],
          meta: { total: 22, page: 1, limit: 31, totalPages: 1 },
        },
        timestamp: '2026-08-02T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden — TIER5_FIELD_SUPPORT only' })
  @ApiResponse({ status: 404, description: 'User not found' })
  getSupportAttendanceByUser(
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: { from?: string; to?: string; page?: number; limit?: number },
  ) {
    return this.attendanceService.findAttendanceByUserForSupport(userId, query, user);
  }

  // ─── TIER5_FIELD_SUPPORT: All KD Visits (with timeSpent) ─────────────────

  @Get('support/kd-visits')
  @Roles('TIER5_FIELD_SUPPORT')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: 'All KD visits with time spent — platform-wide (Field Support only)',
    description:
      'Returns KD_VISIT events each paired with their KD_VISIT_END departure. ' +
      'Includes computed timeSpentSeconds and timeSpentMinutes (null if visit not yet ended). ' +
      'Filter by team, tier, region, userId, or date range. ' +
      'Restricted to TIER5_FIELD_SUPPORT.',
  })
  @ApiQuery({ name: 'team',   required: false, description: 'Filter by team (e.g. RADIANT)' })
  @ApiQuery({ name: 'tier',   required: false, description: 'Filter by user tier (e.g. TIER2)' })
  @ApiQuery({ name: 'region', required: false, description: 'Filter by region (e.g. SOUTH_WEST)' })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by a specific user UUID' })
  @ApiQuery({ name: 'from',   required: false, description: 'Start date inclusive — ISO 8601' })
  @ApiQuery({ name: 'to',     required: false, description: 'End date inclusive — ISO 8601' })
  @ApiQuery({ name: 'page',   required: false, type: Number })
  @ApiQuery({ name: 'limit',  required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Paginated KD visit pairs with computed time spent',
    schema: {
      example: {
        success: true,
        data: {
          data: [
            {
              id: 'visit-start-id', type: 'KD_VISIT', flag: 'ON_TIME',
              photoUrl: 'https://res.cloudinary.com/...',
              latitude: 6.5244, longitude: 3.3792,
              address: '45 Allen Avenue, Ikeja, Lagos',
              deviceTime: '2026-08-02T09:10:00.000Z',
              serverTime: '2026-08-02T09:10:02.000Z',
              note: null,
              kdAccountId: 'customer-uuid',
              kdAccount: { id: 'customer-uuid', businessName: 'Ore Ofe Distributors' },
              user: { id: 'user-id', fullName: 'Emeka Obi', employeeRef: 'Dar-00000003', role: 'MERCHANDISER', tier: 'TIER2', team: 'RADIANT', region: 'SOUTH_WEST' },
              visitEnd: {
                id: 'visit-end-id', type: 'KD_VISIT_END',
                photoUrl: 'https://res.cloudinary.com/...',
                latitude: 6.5244, longitude: 3.3792,
                address: '45 Allen Avenue, Ikeja, Lagos',
                deviceTime: '2026-08-02T10:30:00.000Z',
                serverTime: '2026-08-02T10:30:02.000Z',
                note: 'Completed order review',
              },
              timeSpentSeconds: 4800,
              timeSpentMinutes: 80,
            },
          ],
          meta: { total: 210, page: 1, limit: 20, totalPages: 11 },
        },
        timestamp: '2026-08-02T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden — TIER5_FIELD_SUPPORT only' })
  getSupportAllKdVisits(
    @Query() query: {
      team?: string; tier?: string; region?: string; userId?: string;
      from?: string; to?: string; page?: number; limit?: number;
    },
  ) {
    return this.attendanceService.findAllKdVisitsForSupport(query);
  }

  // ─── TIER5_FIELD_SUPPORT: Single KD Visit detail with activities ──────────

  @Get('support/kd-visits/:eventId')
  @Roles('TIER5_FIELD_SUPPORT')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: 'Single KD visit with activities performed during the visit (Field Support only)',
    description:
      'Returns a KD_VISIT event paired with its KD_VISIT_END departure and all activities ' +
      'the agent performed at that customer during the visit window (arrival → departure). ' +
      '\n\nActivities included:\n' +
      '- **purchaseOrders** — POs raised for this customer by this agent\n' +
      '- **collections** — cash/transfer payments collected from this customer\n' +
      '- **secondarySales** — secondary sales logged at this KD account\n' +
      '- **stockCollections** — stock pick-ups from this KD\n' +
      '- **invoices** — secondary sale invoices raised against this customer\n\n' +
      'If the visit has not ended yet, activities are fetched up to the current time. ' +
      'Restricted to TIER5_FIELD_SUPPORT.',
  })
  @ApiParam({ name: 'eventId', description: 'UUID of the KD_VISIT attendance event' })
  @ApiResponse({
    status: 200,
    description: 'KD visit detail with departure pair, time spent, and all activities',
    schema: {
      example: {
        success: true,
        data: {
          id: 'visit-start-id', type: 'KD_VISIT', flag: 'ON_TIME',
          photoUrl: 'https://res.cloudinary.com/...',
          latitude: 6.5244, longitude: 3.3792,
          address: '45 Allen Avenue, Ikeja, Lagos',
          deviceTime: '2026-08-02T09:10:00.000Z',
          serverTime: '2026-08-02T09:10:02.000Z',
          note: null,
          kdAccountId: 'customer-uuid',
          kdAccount: { id: 'customer-uuid', businessName: 'Ore Ofe Distributors', customerType: 'PRIMARY' },
          user: { id: 'user-id', fullName: 'Emeka Obi', employeeRef: 'Dar-00000003', role: 'MERCHANDISER', tier: 'TIER2', team: 'RADIANT', region: 'SOUTH_WEST' },
          visitEnd: {
            id: 'visit-end-id', type: 'KD_VISIT_END',
            photoUrl: 'https://res.cloudinary.com/...',
            latitude: 6.5244, longitude: 3.3792,
            address: '45 Allen Avenue, Ikeja, Lagos',
            deviceTime: '2026-08-02T10:30:00.000Z',
            serverTime: '2026-08-02T10:30:02.000Z',
            note: 'Completed order review',
          },
          timeSpentSeconds: 4800,
          timeSpentMinutes: 80,
          activities: {
            summary: {
              hasPurchaseOrders: true,
              hasCollections: false,
              hasSecondarySales: true,
              hasStockCollections: false,
              hasInvoices: false,
              totalActivities: 2,
            },
            purchaseOrders: [
              {
                id: 'po-id', orderRef: 'PO-000042', status: 'PENDING',
                totalKobo: 250000,
                createdAt: '2026-08-02T09:25:00.000Z',
                items: [
                  { product: { id: 'prod-id', name: 'Darvinks Cream 100g', category: 'CREAM' }, quantityCartons: 2, lineTotalKobo: 120000 },
                ],
              },
            ],
            collections: [],
            secondarySales: [
              {
                id: 'sale-id',
                deviceTime: '2026-08-02T09:40:00.000Z',
                note: null,
                items: [
                  { buyerType: 'RETAILER', quantityCartons: 1, quantityRows: 0, quantityPieces: 0, product: { id: 'prod-id', name: 'Darvinks Cream 100g', category: 'CREAM' } },
                ],
              },
            ],
            stockCollections: [],
            invoices: [],
          },
        },
        timestamp: '2026-08-02T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden — TIER5_FIELD_SUPPORT only' })
  @ApiResponse({ status: 404, description: 'KD visit event not found' })
  getSupportKdVisitById(@Param('eventId') eventId: string) {
    return this.attendanceService.findKdVisitByIdForSupport(eventId);
  }

  // ─── List All Attendance Events ───────────────────────────────────────────

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
              id: 'event-id', type: 'CLOCK_IN', flag: 'ON_TIME',
              photoUrl: 'https://res.cloudinary.com/...',
              latitude: 6.5244, longitude: 3.3792,
              address: '12 Kolade Street, Ilupeju, Lagos',
              deviceTime: '2026-08-02T08:45:00.000Z',
              serverTime: '2026-08-02T08:45:02.000Z',
              note: null, kdAccountId: null, kdAccount: null,
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
              id: 'visit-start-id', type: 'KD_VISIT', flag: 'ON_TIME',
              photoUrl: 'https://res.cloudinary.com/...',
              latitude: 6.5244, longitude: 3.3792,
              address: '45 Allen Avenue, Ikeja, Lagos',
              deviceTime: '2026-08-02T09:10:00.000Z',
              serverTime: '2026-08-02T09:10:02.000Z',
              note: null,
              kdAccountId: 'customer-uuid',
              kdAccount: { id: 'customer-uuid', businessName: 'Ore Ofe Distributors' },
              user: { id: 'user-id', fullName: 'Emeka Obi', employeeRef: 'Dar-00000003', role: 'MERCHANDISER', team: 'RADIANT', region: 'SOUTH_WEST' },
              visitEnd: {
                id: 'visit-end-id', type: 'KD_VISIT_END', flag: 'ON_TIME',
                photoUrl: 'https://res.cloudinary.com/...',
                latitude: 6.5244, longitude: 3.3792,
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

  // ─── Single User History (scored daily format) ────────────────────────────

  @Get('user/:userId')
  @ApiOperation({
    summary: "Get a specific user's attendance history — daily scored format",
    description:
      'Returns the attendance history for the given user grouped by calendar day. ' +
      'Each day shows `clockIn` (1 = ON_TIME, 0 = LATE/absent) and `clockOut` scores. ' +
      '`totalPoints` is the sum per day (max 2). ' +
      'Field agents may only request their own history — passing another userId returns 403. ' +
      'Oversight roles (FIELD_SUPPORT and above) can view any user.',
  })
  @ApiParam({ name: 'userId', description: 'UUID of the target user' })
  @ApiQuery({ name: 'from',  required: false, description: 'Start date inclusive — ISO 8601' })
  @ApiQuery({ name: 'to',    required: false, description: 'End date inclusive — ISO 8601' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number — paginates by day (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Days per page (default: 31, max: 100)' })
  @ApiResponse({
    status: 200,
    description: 'Daily scored attendance history',
    schema: {
      example: {
        success: true,
        data: {
          data: [
            { date: '2026-08-02', clockIn: 1, clockInFlag: 'ON_TIME', clockInTime: '2026-08-02T08:45:02.000Z', clockOut: 1, clockOutFlag: 'ON_TIME', clockOutTime: '2026-08-02T17:00:02.000Z', totalPoints: 2 },
            { date: '2026-08-01', clockIn: 1, clockInFlag: 'ON_TIME', clockInTime: '2026-08-01T08:55:01.000Z', clockOut: 0, clockOutFlag: 'LATE', clockOutTime: '2026-08-01T18:10:00.000Z', totalPoints: 1 },
            { date: '2026-07-31', clockIn: 0, clockInFlag: 'OUTSIDE_WINDOW', clockInTime: '2026-07-31T11:00:00.000Z', clockOut: null, clockOutFlag: null, clockOutTime: null, totalPoints: 0 },
          ],
          meta: { total: 22, page: 1, limit: 31, totalPages: 1 },
        },
        timestamp: '2026-08-02T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 403, description: "Field agents cannot view another user's attendance" })
  findByUser(
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: AttendanceQueryDto & { page?: number; limit?: number },
  ) {
    return this.attendanceService.findByUser(userId, query, user);
  }
}