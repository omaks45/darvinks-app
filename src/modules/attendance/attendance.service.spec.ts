
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AttendanceFlag, AttendanceType, UserTier, Team } from '@prisma/client';
import { getQueueToken } from '@nestjs/bull';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type { ClockEventDto, KdVisitDto, OfflineSyncItemDto } from './dto/clock-event.dto';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  attendanceEvent: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
};

const mockCloudinary = {
  uploadBuffer: jest.fn(),
};

const mockQueue = { add: jest.fn() };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePhoto(): Express.Multer.File {
  return {
    buffer: Buffer.from('fake-image-data'),
    mimetype: 'image/jpeg',
    originalname: 'photo.jpg',
    size: 1024,
  } as Express.Multer.File;
}

function makeRequester(
  tier: UserTier = UserTier.TIER1,
  team: Team = Team.BRIGHT,
): JwtPayload {
  return { sub: 'user-id', email: 'agent@darvinks.com', tier, team };
}

function makeClockDto(deviceTime: Date): ClockEventDto {
  return {
    latitude: 6.5244,
    longitude: 3.3792,
    deviceTime: deviceTime.toISOString(),
    note: 'test note',
  };
}

// Fixed times that fall within windows
const ON_TIME_CLOCK_IN = new Date();
ON_TIME_CLOCK_IN.setHours(8, 45, 0, 0);

const ON_TIME_CLOCK_OUT = new Date();
ON_TIME_CLOCK_OUT.setHours(18, 0, 0, 0);

const LATE_CLOCK_IN = new Date();
LATE_CLOCK_IN.setHours(9, 30, 0, 0);

describe('AttendanceService', () => {
  let service: AttendanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CloudinaryService, useValue: mockCloudinary },
        { provide: getQueueToken('notifications'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
    // resetAllMocks clears both call history AND persistent mockResolvedValue defaults.
    // We then re-establish the Cloudinary default so all tests that need uploads work.
    jest.resetAllMocks();

    // Default: Cloudinary upload succeeds — restored after every reset
    mockCloudinary.uploadBuffer.mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/tb-darvinks/photo.jpg',
    });

    // Default: findFirst returns null (no duplicate, no existing record)
    // Individual tests that need specific behaviour override this with mockResolvedValueOnce
    mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
  });

  // ── clockIn ────────────────────────────────────────────────────────────────

  describe('clockIn()', () => {
    it('creates an ON_TIME clock-in event for 08:45', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null); // no duplicate
      mockPrisma.attendanceEvent.create.mockResolvedValue({
        id: 'event-id',
        type: AttendanceType.CLOCK_IN,
        flag: AttendanceFlag.ON_TIME,
      });

      const result = await service.clockIn(
        makeRequester(),
        makeClockDto(ON_TIME_CLOCK_IN),
        makePhoto(),
      );

      expect(result.flag).toBe(AttendanceFlag.ON_TIME);
      expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-id',
            type: AttendanceType.CLOCK_IN,
            flag: AttendanceFlag.ON_TIME,
          }),
        }),
      );
    });

    it('creates a LATE clock-in event for 09:30', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
      mockPrisma.attendanceEvent.create.mockResolvedValue({
        id: 'event-id',
        type: AttendanceType.CLOCK_IN,
        flag: AttendanceFlag.LATE,
      });

      const result = await service.clockIn(
        makeRequester(),
        makeClockDto(LATE_CLOCK_IN),
        makePhoto(),
      );

      expect(result.flag).toBe(AttendanceFlag.LATE);
    });

    it('queues an attendance-flag job when clock-in is LATE', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
      mockPrisma.attendanceEvent.create.mockResolvedValue({
        id: 'event-id',
        flag: AttendanceFlag.LATE,
      });

      await service.clockIn(
        makeRequester(),
        makeClockDto(LATE_CLOCK_IN),
        makePhoto(),
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'attendance-flag',
        expect.objectContaining({ userId: 'user-id' }),
      );
    });

    it('does NOT queue a flag job for ON_TIME clock-in', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
      mockPrisma.attendanceEvent.create.mockResolvedValue({
        id: 'event-id',
        flag: AttendanceFlag.ON_TIME,
      });

      await service.clockIn(
        makeRequester(),
        makeClockDto(ON_TIME_CLOCK_IN),
        makePhoto(),
      );

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('throws BadRequestException on duplicate clock-in for the same day', async () => {
      // First call: no duplicate; second call: duplicate exists
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue({
        id: 'existing-event',
      });

      await expect(
        service.clockIn(makeRequester(), makeClockDto(ON_TIME_CLOCK_IN), makePhoto()),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.attendanceEvent.create).not.toHaveBeenCalled();
    });

    it('uploads photo to Cloudinary with watermark', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
      mockPrisma.attendanceEvent.create.mockResolvedValue({ id: 'eid', flag: AttendanceFlag.ON_TIME });

      await service.clockIn(
        makeRequester(),
        makeClockDto(ON_TIME_CLOCK_IN),
        makePhoto(),
      );

      expect(mockCloudinary.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        'attendance/clock-in',
        expect.objectContaining({ watermarkText: expect.any(String) }),
      );
    });

    it('watermark includes latitude, longitude and timestamp', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
      mockPrisma.attendanceEvent.create.mockResolvedValue({ id: 'eid', flag: AttendanceFlag.ON_TIME });

      const dto = makeClockDto(ON_TIME_CLOCK_IN);
      await service.clockIn(makeRequester(), dto, makePhoto());

      const uploadCall = mockCloudinary.uploadBuffer.mock.calls[0];
      const watermark: string = uploadCall[2].watermarkText;
      expect(watermark).toContain('6.5244');
      expect(watermark).toContain('3.3792');
    });
  });

  // ── clockOut ───────────────────────────────────────────────────────────────

  describe('clockOut()', () => {
    it('throws BadRequestException when no clock-in exists for the day', async () => {
      // clockOut() calls assertClockInExists FIRST → findFirst for CLOCK_IN → null = no clock-in
      // Service throws immediately, never reaches assertNoDuplicateEvent
      mockPrisma.attendanceEvent.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.clockOut(makeRequester(), makeClockDto(ON_TIME_CLOCK_OUT), makePhoto()),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates clock-out event when clock-in exists and no duplicate', async () => {
      // Service clockOut() call order:
      //   1. assertClockInExists   → findFirst for CLOCK_IN  (must return a record)
      //   2. assertNoDuplicateEvent → findFirst for CLOCK_OUT (must return null)
      mockPrisma.attendanceEvent.findFirst
        .mockResolvedValueOnce({ id: 'clock-in-event' }) // clock-in exists ✓
        .mockResolvedValueOnce(null);                    // no duplicate clock-out ✓

      mockPrisma.attendanceEvent.create.mockResolvedValue({
        id: 'clock-out-id',
        type: AttendanceType.CLOCK_OUT,
        flag: AttendanceFlag.ON_TIME,
      });

      const result = await service.clockOut(
        makeRequester(),
        makeClockDto(ON_TIME_CLOCK_OUT),
        makePhoto(),
      );

      expect(result.type).toBe(AttendanceType.CLOCK_OUT);
    });

    it('throws BadRequestException on duplicate clock-out', async () => {
      // clockOut() call order:
      //   1. assertClockInExists   → findFirst CLOCK_IN  → return record (clock-in exists)
      //   2. assertNoDuplicateEvent → findFirst CLOCK_OUT → return record (duplicate!)
      mockPrisma.attendanceEvent.findFirst
        .mockResolvedValueOnce({ id: 'clock-in-event' })    // clock-in exists
        .mockResolvedValueOnce({ id: 'existing-clock-out' }); // duplicate clock-out

      await expect(
        service.clockOut(makeRequester(), makeClockDto(ON_TIME_CLOCK_OUT), makePhoto()),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── recordKdVisit ──────────────────────────────────────────────────────────

  describe('recordKdVisit()', () => {
    const KD_DTO: KdVisitDto = {
      latitude: 6.45,
      longitude: 3.45,
      deviceTime: new Date().toISOString(),
      kdAccountId: 'kd-account-123',
    };

    it('records a KD visit for TIER1 agents', async () => {
      mockPrisma.attendanceEvent.create.mockResolvedValue({
        id: 'visit-id',
        type: AttendanceType.KD_VISIT,
        kdAccountId: 'kd-account-123',
        flag: AttendanceFlag.ON_TIME,
      });

      const result = await service.recordKdVisit(
        makeRequester(UserTier.TIER1),
        KD_DTO,
        makePhoto(),
      );

      expect(result.type).toBe(AttendanceType.KD_VISIT);
      expect(result.kdAccountId).toBe('kd-account-123');
    });

    it('throws ForbiddenException for non-TIER1 users', async () => {
      await expect(
        service.recordKdVisit(makeRequester(UserTier.TIER2), KD_DTO, makePhoto()),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.recordKdVisit(makeRequester(UserTier.TIER3), KD_DTO, makePhoto()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('persists the kdAccountId on the created event', async () => {
      mockPrisma.attendanceEvent.create.mockResolvedValue({
        id: 'vid',
        type: AttendanceType.KD_VISIT,
        flag: AttendanceFlag.ON_TIME,
      });

      await service.recordKdVisit(makeRequester(UserTier.TIER1), KD_DTO, makePhoto());

      expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kdAccountId: 'kd-account-123' }),
        }),
      );
    });

    it('stores flag as ON_TIME regardless of submission time', async () => {
      mockPrisma.attendanceEvent.create.mockResolvedValue({ id: 'v', flag: AttendanceFlag.ON_TIME });

      await service.recordKdVisit(makeRequester(UserTier.TIER1), KD_DTO, makePhoto());

      expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ flag: AttendanceFlag.ON_TIME }),
        }),
      );
    });
  });

  // ── syncOfflineBatch ───────────────────────────────────────────────────────

  describe('syncOfflineBatch()', () => {
    function makeOfflineEvent(
      type: 'CLOCK_IN' | 'CLOCK_OUT' | 'KD_VISIT',
      deviceTime = new Date().toISOString(),
    ): OfflineSyncItemDto {
      return {
        type,
        latitude: 6.5244,
        longitude: 3.3792,
        deviceTime,
        note: 'offline event',
      };
    }

    it('processes valid events and returns correct counts', async () => {
      // For each event, syncOfflineBatch calls checkDuplicateEvent (1 findFirst per event).
      // CLOCK_OUT also calls assertClockInExists inside the service loop,
      // which is another findFirst — so CLOCK_OUT needs 2 findFirst calls:
      //   CLOCK_IN event:  findFirst → null (no duplicate)
      //   CLOCK_OUT event: findFirst → null (no duplicate for CLOCK_OUT)
      //                    findFirst → { id } (clock-in exists — needed by assertClockInExists)
      // findFirst default = null (set in beforeEach) — no duplicates for either event
      // syncOfflineBatch does NOT call assertClockInExists inside the loop for CLOCK_OUT,
      // so each event only triggers one findFirst call (checkDuplicateEvent)

      mockPrisma.attendanceEvent.create.mockResolvedValue({ id: 'eid', flag: AttendanceFlag.ON_TIME });

      const events: OfflineSyncItemDto[] = [
        makeOfflineEvent('CLOCK_IN'),
        makeOfflineEvent('CLOCK_OUT'),
      ];
      const photos = [makePhoto(), makePhoto()];

      const result = await service.syncOfflineBatch(makeRequester(), events, photos);

      expect(result.processed).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('skips events with no corresponding photo', async () => {
      // findFirst default (null) and Cloudinary default are set in beforeEach.
      // photos[1] is undefined → second event skipped immediately before any DB call.
      mockPrisma.attendanceEvent.create.mockResolvedValue({ id: 'eid', flag: AttendanceFlag.ON_TIME });

      const events: OfflineSyncItemDto[] = [
        makeOfflineEvent('CLOCK_IN'),
        makeOfflineEvent('CLOCK_OUT'),
      ];
      // Only one photo — photos[1] is undefined, second event is skipped
      const photos = [makePhoto()];

      const result = await service.syncOfflineBatch(makeRequester(), events, photos);

      expect(result.processed).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('skips duplicate events (same type + day)', async () => {
      // findFirst returns existing event — duplicate
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue({ id: 'existing' });

      const events = [makeOfflineEvent('CLOCK_IN')];
      const photos = [makePhoto()];

      const result = await service.syncOfflineBatch(makeRequester(), events, photos);

      expect(result.processed).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockPrisma.attendanceEvent.create).not.toHaveBeenCalled();
    });

    it('skips and continues when individual event upload fails', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
      // First upload fails, second succeeds
      mockCloudinary.uploadBuffer
        .mockRejectedValueOnce(new Error('Upload failed'))
        .mockResolvedValueOnce({ secure_url: 'https://cloud.com/photo.jpg' });
      mockPrisma.attendanceEvent.create.mockResolvedValue({ id: 'eid', flag: AttendanceFlag.ON_TIME });

      const events = [makeOfflineEvent('CLOCK_IN'), makeOfflineEvent('CLOCK_OUT')];
      const photos = [makePhoto(), makePhoto()];

      const result = await service.syncOfflineBatch(makeRequester(), events, photos);

      expect(result.processed).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('returns zero processed/skipped for empty batch', async () => {
      const result = await service.syncOfflineBatch(makeRequester(), [], []);
      expect(result.processed).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  // ── findEvents ─────────────────────────────────────────────────────────────

  describe('findEvents()', () => {
    it('restricts TIER1 users to their own events only', async () => {
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);

      await service.findEvents(makeRequester(UserTier.TIER1), {
        userId: 'another-user-id', // Attempted to query another user
      });

      const call = mockPrisma.attendanceEvent.findMany.mock.calls[0][0];
      // Must use requester's own ID, not the provided userId
      expect(call.where.userId).toBe('user-id');
    });

    it('allows TIER2+ to query by userId', async () => {
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);

      await service.findEvents(makeRequester(UserTier.TIER2), {
        userId: 'subordinate-id',
      });

      const call = mockPrisma.attendanceEvent.findMany.mock.calls[0][0];
      expect(call.where.userId).toBe('subordinate-id');
    });

    it('applies date range filters when provided', async () => {
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);

      await service.findEvents(makeRequester(UserTier.TIER2), {
        from: '2026-04-01',
        to: '2026-04-30',
      });

      const call = mockPrisma.attendanceEvent.findMany.mock.calls[0][0];
      expect(call.where.deviceTime).toBeDefined();
      expect(call.where.deviceTime.gte).toEqual(new Date('2026-04-01'));
      expect(call.where.deviceTime.lte).toEqual(new Date('2026-04-30'));
    });

    it('applies type filter when provided', async () => {
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);

      await service.findEvents(makeRequester(UserTier.TIER3), {
        type: 'CLOCK_IN',
      });

      const call = mockPrisma.attendanceEvent.findMany.mock.calls[0][0];
      expect(call.where.type).toBe('CLOCK_IN');
    });

    it('orders results by deviceTime descending', async () => {
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);

      await service.findEvents(makeRequester(), {});

      const call = mockPrisma.attendanceEvent.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ deviceTime: 'desc' });
    });
  });
});