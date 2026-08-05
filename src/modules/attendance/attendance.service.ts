// src/modules/attendance/attendance.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AttendanceFlag, AttendanceType } from '@prisma/client';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

import { PrismaService } from '@common/prisma/prisma.service';
import { GoogleMapsService } from '@common/google/google-map.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import {
  checkAttendanceWindow,
} from '@common/utils/attendance-window.util';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type {
  ClockEventDto,
  KdVisitDto,
  AttendanceQueryDto,
  OfflineSyncItemDto,
} from './dto/clock-event.dto';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly prisma:     PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly maps:       GoogleMapsService,
    @InjectQueue('notifications') private readonly notifyQueue: Queue,
  ) {}

  // ─── Clock In ─────────────────────────────────────────────────────────────

  async clockIn(
    requester: JwtPayload,
    dto: ClockEventDto,
    photo: Express.Multer.File,
  ) {
    const deviceTime = new Date(dto.deviceTime);

    // Prevent duplicate clock-in on the same calendar day
    await this.assertNoDuplicateEvent(
      requester.sub,
      AttendanceType.CLOCK_IN,
      deviceTime,
    );

    const windowCheck = checkAttendanceWindow(
      AttendanceType.CLOCK_IN,
      deviceTime,
    );

    const photoUrl = await this.uploadAttendancePhoto(
      photo,
      'attendance/clock-in',
      requester.sub,
      deviceTime,
      dto.latitude,
      dto.longitude,
    );

    // Reverse-geocode GPS to human-readable address — never blocks clock-in
    const { address } = await this.maps.reverseGeocode(dto.latitude, dto.longitude);

    const event = await this.prisma.attendanceEvent.create({
      data: {
        userId:   requester.sub,
        type:     AttendanceType.CLOCK_IN,
        flag:     windowCheck.flag,
        photoUrl,
        latitude:  dto.latitude,
        longitude: dto.longitude,
        address:   address ?? null,
        deviceTime,
        note:      dto.note,
      },
    });

    // Alert admin if late or outside window
    if (windowCheck.flag !== AttendanceFlag.ON_TIME) {
      await this.notifyQueue.add('attendance-flag', {
        userId: requester.sub,
        eventId: event.id,
        type: AttendanceType.CLOCK_IN,
        flag: windowCheck.flag,
        message: windowCheck.message,
      });
    }

    return event;
  }

  // ─── Clock Out ────────────────────────────────────────────────────────────

  async clockOut(
    requester: JwtPayload,
    dto: ClockEventDto,
    photo: Express.Multer.File,
  ) {
    const deviceTime = new Date(dto.deviceTime);

    // Must have clocked in today first
    await this.assertClockInExists(requester.sub, deviceTime);

    // Prevent duplicate clock-out on the same day
    await this.assertNoDuplicateEvent(
      requester.sub,
      AttendanceType.CLOCK_OUT,
      deviceTime,
    );

    const windowCheck = checkAttendanceWindow(
      AttendanceType.CLOCK_OUT,
      deviceTime,
    );

    const photoUrl = await this.uploadAttendancePhoto(
      photo,
      'attendance/clock-out',
      requester.sub,
      deviceTime,
      dto.latitude,
      dto.longitude,
    );

    const { address: clockOutAddress } = await this.maps.reverseGeocode(dto.latitude, dto.longitude);

    const event = await this.prisma.attendanceEvent.create({
      data: {
        userId:    requester.sub,
        type:      AttendanceType.CLOCK_OUT,
        flag:      windowCheck.flag,
        photoUrl,
        latitude:  dto.latitude,
        longitude: dto.longitude,
        address:   clockOutAddress ?? null,
        deviceTime,
        note:      dto.note,
      },
    });

    if (windowCheck.flag !== AttendanceFlag.ON_TIME) {
      await this.notifyQueue.add('attendance-flag', {
        userId: requester.sub,
        eventId: event.id,
        type: AttendanceType.CLOCK_OUT,
        flag: windowCheck.flag,
      });
    }

    return event;
  }

  // ─── KD Visit (Tier 1 only) ───────────────────────────────────────────────

  async recordKdVisit(
    requester: JwtPayload,
    dto: KdVisitDto,
    photo: Express.Multer.File,
  ) {
    if (requester.tier !== 'TIER1') {
      throw new ForbiddenException('KD visits are recorded by Tier 1 agents only');
    }

    const deviceTime = new Date(dto.deviceTime);

    const photoUrl = await this.uploadAttendancePhoto(
      photo,
      'attendance/kd-visits',
      requester.sub,
      deviceTime,
      dto.latitude,
      dto.longitude,
    );

    const { address: kdAddress } = await this.maps.reverseGeocode(dto.latitude, dto.longitude);

    return this.prisma.attendanceEvent.create({
      data: {
        userId:      requester.sub,
        type:        AttendanceType.KD_VISIT,
        flag:        AttendanceFlag.ON_TIME,
        photoUrl,
        latitude:    dto.latitude,
        longitude:   dto.longitude,
        address:     kdAddress ?? null,
        kdAccountId: dto.kdAccountId,
        deviceTime,
        note:        dto.note,
      },
    });
  }

  // ─── Offline Batch Sync ───────────────────────────────────────────────────

  /**
   * Accepts a batch of offline-queued events from the mobile device.
   * Events are deduplicated by (userId, type, deviceDate) before insert.
   * Returns a summary of processed vs skipped records.
   */
  async syncOfflineBatch(
    requester: JwtPayload,
    events: OfflineSyncItemDto[],
    photos: Express.Multer.File[],
  ): Promise<{ processed: number; skipped: number }> {
    let processed = 0;
    let skipped = 0;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const photo = photos[i];

      if (!photo) {
        skipped++;
        continue;
      }

      try {
        const type = event.type as AttendanceType;
        const deviceTime = new Date(event.deviceTime);

        const exists = await this.checkDuplicateEvent(
          requester.sub,
          type,
          deviceTime,
        );
        if (exists) { skipped++; continue; }

        const folder =
          type === AttendanceType.CLOCK_IN
            ? 'attendance/clock-in'
            : type === AttendanceType.CLOCK_OUT
            ? 'attendance/clock-out'
            : 'attendance/kd-visits';

        const windowCheck = checkAttendanceWindow(type, deviceTime);

        const photoUrl = await this.uploadAttendancePhoto(
          photo,
          folder,
          requester.sub,
          deviceTime,
          event.latitude,
          event.longitude,
        );

        await this.prisma.attendanceEvent.create({
          data: {
            userId: requester.sub,
            type,
            flag: windowCheck.flag,
            photoUrl,
            latitude: event.latitude,
            longitude: event.longitude,
            kdAccountId: event.kdAccountId,
            deviceTime,
            note: event.note,
          },
        });

        processed++;
      } catch (err) {
        this.logger.warn(`Offline sync: skipped event ${i}`, err);
        skipped++;
      }
    }

    return { processed, skipped };
  }

  // ─── Query ────────────────────────────────────────────────────────────────

  async findEvents(requester: JwtPayload, query: AttendanceQueryDto) {
    const { userId, from, to, type } = query;

    // Tier 1 can only see their own events
    const resolvedUserId =
      requester.tier === 'TIER1' ? requester.sub : (userId ?? requester.sub);

    return this.prisma.attendanceEvent.findMany({
      where: {
        userId: resolvedUserId,
        ...(type ? { type: type as AttendanceType } : {}),
        ...(from || to
          ? {
              deviceTime: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { deviceTime: 'desc' },
    });
  }

  /**
   * Non-throwing clock-in status check for today, scoped to the SERVER's
   * calendar day via serverTime — the same signal ClockInGuard checks, so
   * the dashboard's "you're marked absent" banner always agrees with
   * whether write endpoints will actually let the person through.
   *
   * Deliberately NOT reused from checkDuplicateEvent()/assertClockInExists()
   * above: those check deviceTime (the field agent's phone clock, which
   * offline sync can backdate or delay), while this checks serverTime —
   * the two are different signals for different purposes. ClockInGuard
   * and this method both care "did the server actually receive a clock-in
   * today," not "what date did the agent's phone claim."
   */
  async hasClockedInToday(userId: string): Promise<boolean> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const event = await this.prisma.attendanceEvent.findFirst({
      where: {
        userId,
        type:       AttendanceType.CLOCK_IN,
        serverTime: { gte: startOfDay },
      },
      select: { id: true, serverTime: true },
    });

    return event !== null;
  }

  // ── Today's clock-in/out status ───────────────────────────────────────────

  async getTodayStatus(userId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayEvents = await this.prisma.attendanceEvent.findMany({
      where: {
        userId,
        serverTime: { gte: startOfDay },
        type: { in: [AttendanceType.CLOCK_IN, AttendanceType.CLOCK_OUT] },
      },
      select: {
        id:         true,
        type:       true,
        serverTime: true,
        deviceTime: true,
        address:    true,
        photoUrl:   true,
        flag:       true,
        latitude:   true,
        longitude:  true,
      },
      orderBy: { serverTime: 'asc' },
    });

    const clockIn  = todayEvents.find((e) => e.type === AttendanceType.CLOCK_IN)  ?? null;
    const clockOut = todayEvents.find((e) => e.type === AttendanceType.CLOCK_OUT) ?? null;

    // Determine current status
    let status: 'NOT_CLOCKED_IN' | 'CLOCKED_IN' | 'CLOCKED_OUT';
    if (!clockIn) {
      status = 'NOT_CLOCKED_IN';
    } else if (!clockOut) {
      status = 'CLOCKED_IN';
    } else {
      status = 'CLOCKED_OUT';
    }

    // Duration in minutes if both events exist
    let durationMinutes: number | null = null;
    if (clockIn && clockOut) {
      durationMinutes = Math.round(
        (new Date(clockOut.serverTime).getTime() - new Date(clockIn.serverTime).getTime()) / 60000,
      );
    }

    return {
      date:            startOfDay.toISOString().slice(0, 10), // YYYY-MM-DD
      status,
      clockedInToday:  clockIn !== null,
      clockedOutToday: clockOut !== null,
      clockIn:  clockIn  ? {
        id:         clockIn.id,
        time:       clockIn.serverTime,
        deviceTime: clockIn.deviceTime,
        address:    clockIn.address,
        photoUrl:   clockIn.photoUrl,
        flag:       clockIn.flag,
        latitude:   clockIn.latitude,
        longitude:  clockIn.longitude,
      } : null,
      clockOut: clockOut ? {
        id:         clockOut.id,
        time:       clockOut.serverTime,
        deviceTime: clockOut.deviceTime,
        address:    clockOut.address,
        photoUrl:   clockOut.photoUrl,
        flag:       clockOut.flag,
        latitude:   clockOut.latitude,
        longitude:  clockOut.longitude,
      } : null,
      durationMinutes,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async uploadAttendancePhoto(
    photo: Express.Multer.File,
    folder: 'attendance/clock-in' | 'attendance/clock-out' | 'attendance/kd-visits',
    userId: string,
    deviceTime: Date,
    lat: number,
    lng: number,
  ): Promise<string> {
    if (!photo || !photo.buffer) {
      throw new BadRequestException(
        'A photo is required for attendance. ' +
        'Send the image as multipart/form-data with field name "photo".',
      );
    }
    const watermark = `${deviceTime.toISOString().replace('T', ' ').slice(0, 16)} | ${lat.toFixed(4)},${lng.toFixed(4)}`;
    const result = await this.cloudinary.uploadBuffer(
      photo.buffer,
      folder,
      {
        publicId: `${userId}-${deviceTime.getTime()}`,
        watermarkText: watermark,
      },
    );
    return result.secure_url;
  }

  private dayBounds(date: Date): { gte: Date; lte: Date } {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { gte: start, lte: end };
  }

  private async checkDuplicateEvent(
    userId: string,
    type: AttendanceType,
    deviceTime: Date,
  ): Promise<boolean> {
    const { gte, lte } = this.dayBounds(deviceTime);
    const existing = await this.prisma.attendanceEvent.findFirst({
      where: { userId, type, deviceTime: { gte, lte } },
      select: { id: true },
    });
    return existing !== null;
  }

  private async assertNoDuplicateEvent(
    userId: string,
    type: AttendanceType,
    deviceTime: Date,
  ): Promise<void> {
    const isDuplicate = await this.checkDuplicateEvent(
      userId,
      type,
      deviceTime,
    );
    if (isDuplicate) {
      const label = type === AttendanceType.CLOCK_IN ? 'clock-in' : 'clock-out';
      throw new BadRequestException(
        `You have already submitted a ${label} for today`,
      );
    }
  }

  private async assertClockInExists(
    userId: string,
    date: Date,
  ): Promise<void> {
    const hasClockIn = await this.checkDuplicateEvent(
      userId,
      AttendanceType.CLOCK_IN,
      date,
    );
    if (!hasClockIn) {
      throw new BadRequestException(
        'You must clock in before you can clock out',
      );
    }
  }
}