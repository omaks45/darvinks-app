// src/modules/attendance/attendance.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceFlag, AttendanceType, Prisma } from '@prisma/client';
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

// ─── Shared pagination type ───────────────────────────────────────────────────

export interface PaginatedResult<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ─── Field tiers constant ─────────────────────────────────────────────────────

const FIELD_TIERS = ['TIER1', 'TIER2', 'TIER3', 'TIER4'] as const;

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
    // KD visits are for all field tiers (Tier 1–4)
    if (!FIELD_TIERS.includes(requester.tier as any)) {
      throw new ForbiddenException('KD visits are recorded by field agents (Tier 1–4) only');
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

  // ── End KD Visit ───────────────────────────────────────────────────────────

  /**
   * Logs that the agent has left a KD. The client pairs this event with the
   * preceding KD_VISIT row by matching kdAccountId + date on the frontend to
   * calculate visit duration. The server records the departure GPS and time.
   */
  async endKdVisit(
    requester: JwtPayload,
    dto: KdVisitDto,
    photo: Express.Multer.File,
  ) {
    if (!FIELD_TIERS.includes(requester.tier as any)) {
      throw new ForbiddenException('KD visits are recorded by field agents (Tier 1–4) only');
    }

    // Verify there is an open KD_VISIT for this KD today
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const openVisit = await this.prisma.attendanceEvent.findFirst({
      where: {
        userId:      requester.sub,
        type:        AttendanceType.KD_VISIT,
        kdAccountId: dto.kdAccountId,
        serverTime:  { gte: today },
      },
      orderBy: { serverTime: 'desc' },
    });

    if (!openVisit) {
      throw new BadRequestException(
        'No open KD visit found for this customer today. Log a KD Visit arrival first.',
      );
    }

    // Check this KD has not already been ended today
    const alreadyEnded = await this.prisma.attendanceEvent.findFirst({
      where: {
        userId:      requester.sub,
        type:        AttendanceType.KD_VISIT_END as any,
        kdAccountId: dto.kdAccountId,
        serverTime:  { gte: today },
      },
    });

    if (alreadyEnded) {
      throw new BadRequestException(
        'A KD visit end has already been logged for this customer today.',
      );
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
        type:        'KD_VISIT_END' as any,
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

  // ─── findAll — referenced by GET /attendance ──────────────────────────────

  /**
   * Paginated attendance events (CLOCK_IN + CLOCK_OUT by default).
   *
   * Scoping:
   *  - TIER1–TIER4 (field agents)  → own events only; ?userId is ignored
   *  - Oversight tiers              → all events; optionally filter by ?userId
   */
  async findAll(
    query: AttendanceQueryDto & { page?: number; limit?: number },
    requester: JwtPayload,
  ): Promise<PaginatedResult<any>> {
    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip  = (page - 1) * limit;

    const isFieldAgent = FIELD_TIERS.includes(requester.tier as any);
    const resolvedUserId = isFieldAgent
      ? requester.sub
      : (query.userId ?? undefined);

    const where: Prisma.AttendanceEventWhereInput = {
      ...(resolvedUserId ? { userId: resolvedUserId } : {}),
      ...(query.type ? { type: query.type as AttendanceType } : {}),
      ...(query.from || query.to
        ? {
            serverTime: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to   ? { lte: new Date(query.to)   } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.attendanceEvent.findMany({
        where,
        orderBy: { serverTime: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true, fullName: true, employeeRef: true,
              role: true, tier: true, team: true, region: true,
            },
          },
          kdAccount: { select: { id: true, businessName: true } },
        },
      }),
      this.prisma.attendanceEvent.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  // ─── findKdVisits — referenced by GET /attendance/kd-visits ──────────────

  /**
   * Paginated KD visit pairs (arrival + departure).
   * visitEnd is null when the agent has not yet ended the visit.
   *
   * Scoping: field agents see own; oversight roles see all.
   */
  async findKdVisits(
    query: AttendanceQueryDto & { page?: number; limit?: number },
    requester: JwtPayload,
  ): Promise<PaginatedResult<any>> {
    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip  = (page - 1) * limit;

    const isFieldAgent = FIELD_TIERS.includes(requester.tier as any);
    const resolvedUserId = isFieldAgent
      ? requester.sub
      : (query.userId ?? undefined);

    const where: Prisma.AttendanceEventWhereInput = {
      type: AttendanceType.KD_VISIT,
      ...(resolvedUserId ? { userId: resolvedUserId } : {}),
      ...(query.from || query.to
        ? {
            serverTime: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to   ? { lte: new Date(query.to)   } : {}),
            },
          }
        : {}),
    };

    const [arrivals, total] = await Promise.all([
      this.prisma.attendanceEvent.findMany({
        where,
        orderBy: { serverTime: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true, fullName: true, employeeRef: true,
              role: true, tier: true, team: true, region: true,
            },
          },
          kdAccount: { select: { id: true, businessName: true } },
        },
      }),
      this.prisma.attendanceEvent.count({ where }),
    ]);

    const data = await Promise.all(
      arrivals.map((arrival) => this.pairKdVisitWithEnd(arrival)),
    );

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  // ─── findByUser — referenced by GET /attendance/user/:userId ─────────────

  /**
   * Full attendance history for a specific user.
   *
   * - Field agents: only their own userId is accepted (403 otherwise).
   * - Oversight roles: any userId.
   */
  async findByUser(
    targetUserId: string,
    query: AttendanceQueryDto & { page?: number; limit?: number },
    requester: JwtPayload,
  ): Promise<PaginatedResult<any>> {
    const isFieldAgent = FIELD_TIERS.includes(requester.tier as any);
    if (isFieldAgent && requester.sub !== targetUserId) {
      throw new ForbiddenException('Field agents can only view their own attendance history');
    }

    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip  = (page - 1) * limit;

    const where: Prisma.AttendanceEventWhereInput = {
      userId: targetUserId,
      ...(query.type ? { type: query.type as AttendanceType } : {}),
      ...(query.from || query.to
        ? {
            serverTime: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to   ? { lte: new Date(query.to)   } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.attendanceEvent.findMany({
        where,
        orderBy: { serverTime: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true, fullName: true, employeeRef: true,
              role: true, tier: true, team: true, region: true,
            },
          },
          kdAccount: { select: { id: true, businessName: true } },
        },
      }),
      this.prisma.attendanceEvent.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  // ─── TIER5_FIELD_SUPPORT: All Attendance (platform-wide) ──────────────────

  /**
   * GET /attendance/support/all
   *
   * Platform-wide visibility for TIER5_FIELD_SUPPORT.
   * Filters: team, tier, region, userId, type, from, to.
   */
  async findAllForSupport(
    query: {
      team?: string; tier?: string; region?: string; userId?: string;
      type?: string; from?: string; to?: string;
      page?: number; limit?: number;
    },
    _requester: JwtPayload,
  ): Promise<PaginatedResult<any>> {
    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip  = (page - 1) * limit;

    const where: Prisma.AttendanceEventWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.type   ? { type: query.type as AttendanceType } : {}),
      ...(query.from || query.to
        ? {
            serverTime: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to   ? { lte: new Date(query.to)   } : {}),
            },
          }
        : {}),
      user: {
        ...(query.team   ? { team:   query.team   as any } : {}),
        ...(query.tier   ? { tier:   query.tier   as any } : {}),
        ...(query.region ? { region: query.region as any } : {}),
      },
    };

    const [data, total] = await Promise.all([
      this.prisma.attendanceEvent.findMany({
        where,
        orderBy: { serverTime: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true, fullName: true, employeeRef: true,
              role: true, tier: true, team: true, region: true,
            },
          },
          kdAccount: { select: { id: true, businessName: true } },
        },
      }),
      this.prisma.attendanceEvent.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  // ─── TIER5_FIELD_SUPPORT: Attendance by User ──────────────────────────────

  /**
   * GET /attendance/support/user/:userId
   *
   * Full attendance history for any user — TIER5_FIELD_SUPPORT only.
   */
  async findAttendanceByUserForSupport(
    targetUserId: string,
    query: { type?: string; from?: string; to?: string; page?: number; limit?: number },
    _requester: JwtPayload,
  ): Promise<PaginatedResult<any>> {
    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip  = (page - 1) * limit;

    const where: Prisma.AttendanceEventWhereInput = {
      userId: targetUserId,
      ...(query.type ? { type: query.type as AttendanceType } : {}),
      ...(query.from || query.to
        ? {
            serverTime: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to   ? { lte: new Date(query.to)   } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.attendanceEvent.findMany({
        where,
        orderBy: { serverTime: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true, fullName: true, employeeRef: true,
              role: true, tier: true, team: true, region: true,
            },
          },
          kdAccount: { select: { id: true, businessName: true } },
        },
      }),
      this.prisma.attendanceEvent.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  // ─── TIER5_FIELD_SUPPORT: All KD Visits (platform-wide, with timeSpent) ───

  /**
   * GET /attendance/support/kd-visits
   *
   * Returns KD_VISIT events paired with their KD_VISIT_END counterpart.
   * Adds computed timeSpentSeconds and timeSpentMinutes per visit pair.
   * Filters: team, tier, region, userId, from, to.
   */
  async findAllKdVisitsForSupport(
    query: {
      team?: string; tier?: string; region?: string; userId?: string;
      from?: string; to?: string; page?: number; limit?: number;
    },
  ): Promise<PaginatedResult<any>> {
    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip  = (page - 1) * limit;

    const where: Prisma.AttendanceEventWhereInput = {
      type: AttendanceType.KD_VISIT,
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to
        ? {
            serverTime: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to   ? { lte: new Date(query.to)   } : {}),
            },
          }
        : {}),
      user: {
        ...(query.team   ? { team:   query.team   as any } : {}),
        ...(query.tier   ? { tier:   query.tier   as any } : {}),
        ...(query.region ? { region: query.region as any } : {}),
      },
    };

    const [arrivals, total] = await Promise.all([
      this.prisma.attendanceEvent.findMany({
        where,
        orderBy: { serverTime: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true, fullName: true, employeeRef: true,
              role: true, tier: true, team: true, region: true,
            },
          },
          kdAccount: { select: { id: true, businessName: true } },
        },
      }),
      this.prisma.attendanceEvent.count({ where }),
    ]);

    const data = await Promise.all(
      arrivals.map((arrival) => this.pairKdVisitWithEnd(arrival)),
    );

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  // ─── TIER5_FIELD_SUPPORT: Single KD Visit (by event ID, with timeSpent) ───

  /**
   * GET /attendance/support/kd-visits/:eventId
   *
   * Returns a single KD_VISIT event with its matched departure and computed
   * timeSpentSeconds / timeSpentMinutes. Throws 404 if not found.
   */
  async findKdVisitByIdForSupport(eventId: string): Promise<any> {
    const arrival = await this.prisma.attendanceEvent.findFirst({
      where: { id: eventId, type: AttendanceType.KD_VISIT },
      include: {
        user: {
          select: {
            id: true, fullName: true, employeeRef: true,
            role: true, tier: true, team: true, region: true,
          },
        },
        kdAccount: { select: { id: true, businessName: true } },
      },
    });

    if (!arrival) {
      throw new NotFoundException(`KD visit event '${eventId}' not found`);
    }

    return this.pairKdVisitWithEnd(arrival);
  }

  // ─── Non-throwing clock-in status check ──────────────────────────────────

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
    const { gte } = this.dayBoundsUTC(new Date());

    const event = await this.prisma.attendanceEvent.findFirst({
      where: {
        userId,
        type:       AttendanceType.CLOCK_IN,
        serverTime: { gte },
      },
      select: { id: true, serverTime: true },
    });

    return event !== null;
  }

  // ── Today's clock-in/out status ───────────────────────────────────────────

  async getTodayStatus(userId: string) {
    const { gte: startOfDay, lte: endOfDay } = this.dayBoundsUTC(new Date());

    const todayEvents = await this.prisma.attendanceEvent.findMany({
      where: {
        userId,
        serverTime: { gte: startOfDay, lte: endOfDay },
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
      date:            new Date().toISOString().slice(0, 10), // YYYY-MM-DD UTC
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

  /**
   * Pairs a KD_VISIT arrival event with its KD_VISIT_END departure on the
   * same UTC calendar day, then computes the time spent at the customer site.
   */
  private async pairKdVisitWithEnd(arrival: any): Promise<any> {
    const dayStart = new Date(arrival.serverTime);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const visitEnd = await this.prisma.attendanceEvent.findFirst({
      where: {
        userId:      arrival.userId,
        type:        'KD_VISIT_END' as any,
        kdAccountId: arrival.kdAccountId,
        serverTime:  { gte: dayStart, lt: dayEnd },
      },
      orderBy: { serverTime: 'asc' },
      select: {
        id: true, type: true, photoUrl: true,
        latitude: true, longitude: true, address: true,
        deviceTime: true, serverTime: true, note: true,
      },
    });

    let timeSpentSeconds: number | null = null;
    let timeSpentMinutes: number | null = null;
    if (visitEnd) {
      timeSpentSeconds = Math.round(
        (new Date(visitEnd.serverTime).getTime() - new Date(arrival.serverTime).getTime()) / 1000,
      );
      timeSpentMinutes = Math.round(timeSpentSeconds / 60);
    }

    return { ...arrival, visitEnd, timeSpentSeconds, timeSpentMinutes };
  }

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

  private dayBoundsUTC(date: Date): { gte: Date; lte: Date } {
    // Use UTC day boundaries so the check is consistent regardless of where
    // the server runs. Nigeria is UTC+1 — using local time causes off-by-one
    // errors at midnight WAT where the server's UTC calendar day differs.
    const start = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0, 0, 0, 0,
    ));
    const end = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      23, 59, 59, 999,
    ));
    return { gte: start, lte: end };
  }

  private async checkDuplicateEvent(
    userId: string,
    type: AttendanceType,
    deviceTime: Date,
  ): Promise<boolean> {
    // Check against serverTime (what the server recorded) rather than
    // deviceTime (what the phone claims) — serverTime is the authoritative
    // signal and cannot be manipulated by the client.
    const { gte, lte } = this.dayBoundsUTC(new Date());
    const existing = await this.prisma.attendanceEvent.findFirst({
      where: { userId, type, serverTime: { gte, lte } },
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