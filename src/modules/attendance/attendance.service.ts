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

// ─── Scored attendance day type ───────────────────────────────────────────────

/**
 * One calendar day's attendance score for payment calculation.
 *
 * clockIn  = 1 if the agent clocked in ON_TIME, else 0
 * clockOut = 1 if the agent clocked out ON_TIME, else 0
 * totalPoints = sum (max 2 per day)
 *
 * LATE and OUTSIDE_WINDOW events are excluded from the score per
 * product-owner spec — only ON_TIME events count for payment.
 */
export interface DailyAttendanceScore {
  date:            string;       // YYYY-MM-DD (UTC)
  clockIn:         0 | 1;
  clockInFlag:     AttendanceFlag | null;
  clockInTime:     string | null; // ISO serverTime
  clockOut:        0 | 1;
  clockOutFlag:    AttendanceFlag | null;
  clockOutTime:    string | null;
  totalPoints:     number;
}

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

  // ─── KD Visit Start ───────────────────────────────────────────────────────

  async recordKdVisit(
    requester: JwtPayload,
    dto: KdVisitDto,
    photo: Express.Multer.File,
  ) {
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
   * Logs that the agent has left a KD. Stores `parentEventId` pointing at the
   * opening KD_VISIT row so the pair is always unambiguously linked — even if
   * the same customer is visited twice in a day.
   */
  async endKdVisit(
    requester: JwtPayload,
    dto: KdVisitDto,
    photo: Express.Multer.File,
  ) {
    if (!FIELD_TIERS.includes(requester.tier as any)) {
      throw new ForbiddenException('KD visits are recorded by field agents (Tier 1–4) only');
    }

    // Verify there is an open KD_VISIT for this KD today (no existing end)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const openVisit = await this.prisma.attendanceEvent.findFirst({
      where: {
        userId:      requester.sub,
        type:        AttendanceType.KD_VISIT,
        kdAccountId: dto.kdAccountId,
        serverTime:  { gte: today },
        // Ensure no KD_VISIT_END already references this visit
        children:    { none: {} },
      },
      orderBy: { serverTime: 'desc' },
    });

    if (!openVisit) {
      throw new BadRequestException(
        'No open KD visit found for this customer today. Log a KD Visit arrival first.',
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
        userId:        requester.sub,
        type:          'KD_VISIT_END' as any,
        flag:          AttendanceFlag.ON_TIME,
        photoUrl,
        latitude:      dto.latitude,
        longitude:     dto.longitude,
        address:       kdAddress ?? null,
        kdAccountId:   dto.kdAccountId,
        deviceTime,
        note:          dto.note,
        parentEventId: openVisit.id,  // ← links back to the KD_VISIT arrival
      },
    });
  }

  // ─── Offline Batch Sync ───────────────────────────────────────────────────

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

  // ─── findAll ──────────────────────────────────────────────────────────────

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

  // ─── findKdVisits ─────────────────────────────────────────────────────────

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

  // ─── findByUser ───────────────────────────────────────────────────────────

  /**
   * Attendance history for a specific user, returned as daily scored rows.
   *
   * Each row shows clockIn and clockOut scores (0 or 1) based on flag:
   * only ON_TIME events earn a point — LATE and OUTSIDE_WINDOW score 0.
   * This is the format used for payment calculation.
   */
  async findByUser(
    targetUserId: string,
    query: AttendanceQueryDto & { page?: number; limit?: number },
    requester: JwtPayload,
  ): Promise<PaginatedResult<DailyAttendanceScore>> {
    const isFieldAgent = FIELD_TIERS.includes(requester.tier as any);
    if (isFieldAgent && requester.sub !== targetUserId) {
      throw new ForbiddenException('Field agents can only view their own attendance history');
    }

    return this.getScoredAttendanceHistory(targetUserId, query);
  }

  // ─── TIER5_FIELD_SUPPORT: All Attendance (platform-wide) ──────────────────

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

  // ─── TIER5_FIELD_SUPPORT: Attendance by User (scored daily format) ─────────

  /**
   * GET /attendance/support/user/:userId
   *
   * Returns the same daily-scored format as findByUser — clock-in and
   * clock-out points per day, ON_TIME only. Used by TIER5_FIELD_SUPPORT
   * for payment calculation review.
   */
  async findAttendanceByUserForSupport(
    targetUserId: string,
    query: { type?: string; from?: string; to?: string; page?: number; limit?: number },
    _requester: JwtPayload,
  ): Promise<PaginatedResult<DailyAttendanceScore>> {
    return this.getScoredAttendanceHistory(targetUserId, query);
  }

  // ─── TIER5_FIELD_SUPPORT: All KD Visits (platform-wide, with timeSpent) ───

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

  // ─── TIER5_FIELD_SUPPORT: Single KD Visit detail with activities ───────────

  /**
   * GET /attendance/support/kd-visits/:eventId
   *
   * Returns the KD_VISIT + its paired KD_VISIT_END (via parentEventId),
   * computed timeSpent, and all activities the agent performed at that
   * customer during the visit window:
   *
   *  - purchaseOrders   — POs raised for this customer by this agent
   *  - collections      — cash/transfer collections recorded for this customer
   *  - secondarySales   — secondary sales logged at this KD account
   *  - stockCollections — stock pick-ups from this KD
   *  - invoices         — secondary sale invoices raised against this customer
   *
   * The visit window is [KD_VISIT.serverTime, KD_VISIT_END.serverTime].
   * If the visit has not ended yet, activities are fetched up to now().
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
        kdAccount: { select: { id: true, businessName: true, customerType: true } },
      },
    });

    if (!arrival) {
      throw new NotFoundException(`KD visit event '${eventId}' not found`);
    }

    const paired = await this.pairKdVisitWithEnd(arrival);

    // Visit window: start → end (or now if still open)
    const windowStart = new Date(arrival.serverTime);
    const windowEnd   = paired.visitEnd
      ? new Date(paired.visitEnd.serverTime)
      : new Date();

    const customerId = arrival.kdAccountId!;
    const agentId    = arrival.userId;

    // Fetch all activities in parallel — scoped to this agent + this customer
    // + within the visit time window
    const [
      purchaseOrders,
      collections,
      secondarySales,
      stockCollections,
      invoices,
    ] = await Promise.all([
      // Primary-side: POs raised by the agent for this KD customer
      this.prisma.purchaseOrder.findMany({
        where: {
          customerId,
          createdById: agentId,
          createdAt:   { gte: windowStart, lte: windowEnd },
        },
        select: {
          id: true, orderRef: true, status: true,
          totalKobo: true, createdAt: true,
          items: {
            select: {
              product: { select: { id: true, name: true, category: true } },
              quantityCartons: true, lineTotalKobo: true,
            },
          },
        },
      }),

      // Cash / transfer collections recorded against this customer
      this.prisma.collection.findMany({
        where: {
          customerId,
          recordedById: agentId,
          createdAt:    { gte: windowStart, lte: windowEnd },
        },
        select: {
          id: true, amountKobo: true, paymentMode: true,
          depositorName: true, collectedAt: true, note: true,
        },
      }),

      // Secondary sales made at this KD account
      this.prisma.secondarySale.findMany({
        where: {
          kdAccountId: customerId,
          userId:      agentId,
          createdAt:   { gte: windowStart, lte: windowEnd },
        },
        select: {
          id: true, deviceTime: true, note: true,
          items: {
            select: {
              buyerType: true, quantityCartons: true,
              quantityRows: true, quantityPieces: true,
              product: { select: { id: true, name: true, category: true } },
            },
          },
        },
      }),

      // Stock collections (pick-up from this KD's physical stock)
      this.prisma.stockCollection.findMany({
        where: {
          sourceId:  customerId,
          userId:    agentId,
          createdAt: { gte: windowStart, lte: windowEnd },
        },
        select: {
          id: true, collectionRef: true, status: true,
          subtotalKobo: true, createdAt: true,
          items: {
            select: {
              product: { select: { id: true, name: true, category: true } },
              quantityCartons: true, lineTotalKobo: true,
            },
          },
        },
      }),

      // Secondary sale invoices raised against this customer
      this.prisma.secondarySaleInvoice.findMany({
        where: {
          customerId,
          soldById:  agentId,
          createdAt: { gte: windowStart, lte: windowEnd },
        },
        select: {
          id: true, invoiceRef: true, status: true,
          totalKobo: true, paidKobo: true, balanceKobo: true,
          createdAt: true,
          items: {
            select: {
              product: { select: { id: true, name: true, category: true } },
              quantityCartons: true, lineTotalKobo: true,
            },
          },
        },
      }),
    ]);

    // Build a summary of what happened during the visit
    const activitySummary = {
      hasPurchaseOrders:   purchaseOrders.length   > 0,
      hasCollections:      collections.length       > 0,
      hasSecondarySales:   secondarySales.length    > 0,
      hasStockCollections: stockCollections.length  > 0,
      hasInvoices:         invoices.length          > 0,
      totalActivities:
        purchaseOrders.length + collections.length +
        secondarySales.length + stockCollections.length + invoices.length,
    };

    return {
      ...paired,
      activities: {
        summary:         activitySummary,
        purchaseOrders,
        collections,
        secondarySales,
        stockCollections,
        invoices,
      },
    };
  }

  // ─── Non-throwing clock-in status check ──────────────────────────────────

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

    let status: 'NOT_CLOCKED_IN' | 'CLOCKED_IN' | 'CLOCKED_OUT';
    if (!clockIn) {
      status = 'NOT_CLOCKED_IN';
    } else if (!clockOut) {
      status = 'CLOCKED_IN';
    } else {
      status = 'CLOCKED_OUT';
    }

    let durationMinutes: number | null = null;
    if (clockIn && clockOut) {
      durationMinutes = Math.round(
        (new Date(clockOut.serverTime).getTime() - new Date(clockIn.serverTime).getTime()) / 60000,
      );
    }

    return {
      date:            new Date().toISOString().slice(0, 10),
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
   * Core payment-score logic.
   *
   * Fetches all CLOCK_IN and CLOCK_OUT events for the target user in the
   * requested date range, groups them by UTC calendar day, and returns one
   * scored row per day.
   *
   * Scoring rule (per product owner spec):
   *   ON_TIME clock-in  → clockIn  = 1
   *   ON_TIME clock-out → clockOut = 1
   *   LATE / OUTSIDE_WINDOW / MISSED → score = 0 for that event
   *
   * Pagination is applied AFTER grouping — "page" refers to days, not raw
   * events. A day with no ON_TIME events still appears so the viewer can
   * see LATE / absent records.
   */
  private async getScoredAttendanceHistory(
    userId: string,
    query: { from?: string; to?: string; page?: number; limit?: number },
  ): Promise<PaginatedResult<DailyAttendanceScore>> {
    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 31));

    // Pull all CLOCK_IN + CLOCK_OUT events for this user in the range.
    // No Prisma pagination here — we group by day first, then paginate days.
    const events = await this.prisma.attendanceEvent.findMany({
      where: {
        userId,
        type: { in: [AttendanceType.CLOCK_IN, AttendanceType.CLOCK_OUT] },
        ...(query.from || query.to
          ? {
              serverTime: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to   ? { lte: new Date(query.to)   } : {}),
              },
            }
          : {}),
      },
      orderBy: { serverTime: 'asc' },
      select: {
        type: true, flag: true, serverTime: true,
      },
    });

    // Group by UTC date string (YYYY-MM-DD)
    const dayMap = new Map<string, { clockIn?: typeof events[0]; clockOut?: typeof events[0] }>();

    for (const ev of events) {
      const date = ev.serverTime.toISOString().slice(0, 10);
      if (!dayMap.has(date)) dayMap.set(date, {});
      const day = dayMap.get(date)!;
      if (ev.type === AttendanceType.CLOCK_IN  && !day.clockIn)  day.clockIn  = ev;
      if (ev.type === AttendanceType.CLOCK_OUT && !day.clockOut) day.clockOut = ev;
    }

    // Sort days descending (most recent first), then paginate
    const sortedDates = [...dayMap.keys()].sort((a, b) => b.localeCompare(a));
    const total       = sortedDates.length;
    const pageDates   = sortedDates.slice((page - 1) * limit, page * limit);

    const data: DailyAttendanceScore[] = pageDates.map((date) => {
      const day      = dayMap.get(date)!;
      const ciFlag   = day.clockIn?.flag  ?? null;
      const coFlag   = day.clockOut?.flag ?? null;

      // Only ON_TIME earns the point
      const ciScore  = ciFlag === AttendanceFlag.ON_TIME ? 1 : 0;
      const coScore  = coFlag === AttendanceFlag.ON_TIME ? 1 : 0;

      return {
        date,
        clockIn:      ciScore as 0 | 1,
        clockInFlag:  ciFlag,
        clockInTime:  day.clockIn?.serverTime.toISOString()  ?? null,
        clockOut:     coScore as 0 | 1,
        clockOutFlag: coFlag,
        clockOutTime: day.clockOut?.serverTime.toISOString() ?? null,
        totalPoints:  ciScore + coScore,
      };
    });

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Pairs a KD_VISIT arrival with its KD_VISIT_END departure.
   *
   * Now uses `parentEventId` (the end event stores the start event's ID)
   * for an exact, unambiguous lookup — no day-range matching needed.
   * Falls back to null if the visit has not been ended yet.
   */
  private async pairKdVisitWithEnd(arrival: any): Promise<any> {
    const visitEnd = await this.prisma.attendanceEvent.findFirst({
      where: {
        parentEventId: arrival.id,
        type:          'KD_VISIT_END' as any,
      },
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
    const isDuplicate = await this.checkDuplicateEvent(userId, type, deviceTime);
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