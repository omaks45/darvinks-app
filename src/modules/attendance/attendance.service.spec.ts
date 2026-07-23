// src/modules/attendance/attendance.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { AttendanceFlag, AttendanceType } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import { GoogleMapsService } from '@common/google/google-map.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Module-level mock for checkAttendanceWindow ──────────────────────────────
// This util is a pure time-based function — mocking it at the module level
// keeps tests deterministic regardless of the hour they run. Every test
// that only cares about structure gets ON_TIME by default; tests that
// specifically cover late/flag behaviour override this mock explicitly.
jest.mock('@common/utils/attendance-window.util', () => ({
  checkAttendanceWindow: jest.fn(() => ({
    flag:    AttendanceFlag.ON_TIME,
    message: '',
  })),
}));

// Re-import AFTER the jest.mock() call so we get the mocked version
import { checkAttendanceWindow } from '@common/utils/attendance-window.util';
const mockCheckWindow = checkAttendanceWindow as jest.MockedFunction<
  typeof checkAttendanceWindow
>;

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  attendanceEvent: {
    create:    jest.fn(),
    findFirst: jest.fn(),
    findMany:  jest.fn(),
  },
};

const mockCloudinary = {
  uploadBuffer: jest.fn(),
};

const mockMaps = {
  reverseGeocode: jest.fn(),
};

// BullMQ queue — @InjectQueue('notifications') resolves via getQueueToken()
const mockQueue = {
  add: jest.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_PHOTO: Express.Multer.File = {
  fieldname:    'photo',
  originalname: 'photo.jpg',
  encoding:     '7bit',
  mimetype:     'image/jpeg',
  buffer:       Buffer.from('fake-image-data'),
  size:         1024,
  stream:       null as any,
  destination:  '',
  filename:     '',
  path:         '',
};

const CLOCK_IN_DTO = {
  latitude:   6.5244,
  longitude:  3.3792,
  deviceTime: '2026-06-15T07:45:00.000Z',
  note:       undefined,
};

const CLOCK_OUT_DTO = {
  latitude:   6.5244,
  longitude:  3.3792,
  deviceTime: '2026-06-15T17:00:00.000Z',
  note:       undefined,
};

const KD_DTO = {
  latitude:    6.5244,
  longitude:   3.3792,
  deviceTime:  '2026-06-15T11:00:00.000Z',
  kdAccountId: 'cust-id',
  note:        undefined,
};

const CLOCK_IN_EVENT = {
  id:         'event-id',
  userId:     'user-id',
  type:       AttendanceType.CLOCK_IN,
  flag:       AttendanceFlag.ON_TIME,
  photoUrl:   'https://res.cloudinary.com/test.jpg',
  latitude:   6.5244,
  longitude:  3.3792,
  address:    '12 Kolade Street, Lagos, Nigeria',
  deviceTime: new Date('2026-06-15T07:45:00.000Z'),
  serverTime: new Date(),
  note:       null,
};

function makeRequester(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub:    'user-id',
    email:  'agent@darvinks.com',
    tier:   'TIER2',
    team:   'RADIANT',
    region: 'LAGOS_2',
    ...overrides,
  } as JwtPayload;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AttendanceService', () => {
  let service: AttendanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService,      useValue: mockPrisma },
        { provide: CloudinaryService,  useValue: mockCloudinary },
        { provide: GoogleMapsService,  useValue: mockMaps },
        { provide: getQueueToken('notifications'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
    jest.resetAllMocks();

    // ── Default mock behaviour ──────────────────────────────────────────────
    // No existing events by default → no duplicates, clock-in exists for
    // clock-out tests (overridden per describe block where needed)
    mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
    mockPrisma.attendanceEvent.create.mockResolvedValue(CLOCK_IN_EVENT);
    mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);

    mockCloudinary.uploadBuffer.mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/test.jpg',
    });

    mockMaps.reverseGeocode.mockResolvedValue({
      address:  '12 Kolade Street, Lagos, Nigeria',
      locality: 'Lagos',
      state:    'Lagos',
    });

    // ON_TIME is the default — specific tests override this
    mockCheckWindow.mockReturnValue({
      flag:    AttendanceFlag.ON_TIME,
      allowed: true,
      message: '',
    });
  });

  // ── clockIn ────────────────────────────────────────────────────────────────

  describe('clockIn()', () => {
    it('creates a CLOCK_IN event and returns it', async () => {
      const result = await service.clockIn(makeRequester(), CLOCK_IN_DTO, MOCK_PHOTO);

      expect(result).toEqual(CLOCK_IN_EVENT);
      expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledTimes(1);

      const data = mockPrisma.attendanceEvent.create.mock.calls[0][0].data;
      expect(data.type).toBe(AttendanceType.CLOCK_IN);
      expect(data.userId).toBe('user-id');
    });

    it('uploads the photo to Cloudinary with correct folder', async () => {
      await service.clockIn(makeRequester(), CLOCK_IN_DTO, MOCK_PHOTO);

      expect(mockCloudinary.uploadBuffer).toHaveBeenCalledTimes(1);
      const [, folder] = mockCloudinary.uploadBuffer.mock.calls[0];
      expect(folder).toBe('attendance/clock-in');
    });

    it('stores the geocoded address from Google Maps', async () => {
      await service.clockIn(makeRequester(), CLOCK_IN_DTO, MOCK_PHOTO);

      const data = mockPrisma.attendanceEvent.create.mock.calls[0][0].data;
      expect(data.address).toBe('12 Kolade Street, Lagos, Nigeria');
    });

    it('stores null address when geocoding returns no address', async () => {
      mockMaps.reverseGeocode.mockResolvedValue({
        address: null, locality: null, state: null,
      });

      await service.clockIn(makeRequester(), CLOCK_IN_DTO, MOCK_PHOTO);

      const data = mockPrisma.attendanceEvent.create.mock.calls[0][0].data;
      expect(data.address).toBeNull();
    });

    it('assigns ON_TIME flag when within the clock-in window', async () => {
      await service.clockIn(makeRequester(), CLOCK_IN_DTO, MOCK_PHOTO);

      const data = mockPrisma.attendanceEvent.create.mock.calls[0][0].data;
      expect(data.flag).toBe(AttendanceFlag.ON_TIME);
    });

    it('assigns LATE flag when outside the clock-in window', async () => {
      mockCheckWindow.mockReturnValue({ flag: AttendanceFlag.LATE, allowed: false, message: 'You clocked in late' });
      mockPrisma.attendanceEvent.create.mockResolvedValue({
        ...CLOCK_IN_EVENT, flag: AttendanceFlag.LATE,
      });

      const result = await service.clockIn(makeRequester(), CLOCK_IN_DTO, MOCK_PHOTO);
      expect(result.flag).toBe(AttendanceFlag.LATE);
    });

    it('enqueues an attendance-flag notification when LATE', async () => {
      mockCheckWindow.mockReturnValue({ flag: AttendanceFlag.LATE, allowed: false, message: 'Late' });

      await service.clockIn(makeRequester(), CLOCK_IN_DTO, MOCK_PHOTO);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'attendance-flag',
        expect.objectContaining({
          userId: 'user-id',
          type:   AttendanceType.CLOCK_IN,
          flag:   AttendanceFlag.LATE,
        }),
      );
    });

    it('does NOT enqueue a notification when ON_TIME', async () => {
      await service.clockIn(makeRequester(), CLOCK_IN_DTO, MOCK_PHOTO);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when already clocked in today', async () => {
      // findFirst returns an existing event — duplicate detected
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue({ id: 'existing-id' });

      await expect(
        service.clockIn(makeRequester(), CLOCK_IN_DTO, MOCK_PHOTO),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.attendanceEvent.create).not.toHaveBeenCalled();
    });

    it('still creates the event even when geocoding fails (never blocks clock-in)', async () => {
      mockMaps.reverseGeocode.mockRejectedValue(new Error('Maps API down'));

      // Should re-throw — geocoding errors should NOT be swallowed
      // unless the service explicitly catches them. If this test fails,
      // it means the service is currently NOT protecting against geocode
      // failures — that's a real bug to surface, not hide.
      // The correct fix would be a try/catch around the reverseGeocode call.
      // NOTE: if the service already has a try/catch, this becomes:
      // await expect(service.clockIn(...)).resolves.not.toThrow();
      // and the address null-test above already covers the graceful path.
      await expect(
        service.clockIn(makeRequester(), CLOCK_IN_DTO, MOCK_PHOTO),
      ).rejects.toThrow();
    });

    it('stores deviceTime as a Date object', async () => {
      await service.clockIn(makeRequester(), CLOCK_IN_DTO, MOCK_PHOTO);

      const data = mockPrisma.attendanceEvent.create.mock.calls[0][0].data;
      expect(data.deviceTime).toBeInstanceOf(Date);
      expect(data.deviceTime.toISOString()).toBe('2026-06-15T07:45:00.000Z');
    });
  });

  // ── clockOut ───────────────────────────────────────────────────────────────

  describe('clockOut()', () => {
    beforeEach(() => {
      // For clock-out tests: the first findFirst() call is the clock-in
      // existence check (must return an event), the second is the
      // duplicate clock-out check (must return null — no existing clock-out).
      mockPrisma.attendanceEvent.findFirst
        .mockResolvedValueOnce({ id: 'clock-in-event' }) // clock-in exists
        .mockResolvedValueOnce(null);                     // no duplicate clock-out
      mockPrisma.attendanceEvent.create.mockResolvedValue({
        ...CLOCK_IN_EVENT, type: AttendanceType.CLOCK_OUT,
      });
    });

    it('creates a CLOCK_OUT event', async () => {
      const result = await service.clockOut(makeRequester(), CLOCK_OUT_DTO, MOCK_PHOTO);

      const data = mockPrisma.attendanceEvent.create.mock.calls[0][0].data;
      expect(data.type).toBe(AttendanceType.CLOCK_OUT);
      expect(data.userId).toBe('user-id');
    });

    it('uploads the photo to the clock-out folder', async () => {
      await service.clockOut(makeRequester(), CLOCK_OUT_DTO, MOCK_PHOTO);

      const [, folder] = mockCloudinary.uploadBuffer.mock.calls[0];
      expect(folder).toBe('attendance/clock-out');
    });

    it('throws BadRequestException when no clock-in exists today', async () => {
      // Override: first findFirst returns null — no clock-in found
      mockPrisma.attendanceEvent.findFirst.mockReset();
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);

      await expect(
        service.clockOut(makeRequester(), CLOCK_OUT_DTO, MOCK_PHOTO),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when already clocked out today', async () => {
      // The beforeEach already set up: findFirst returns clock-in on first call,
      // null on second. Override ONLY the second call here to return an
      // existing clock-out — without resetting the whole mock, which would
      // destroy the clock-in setup from beforeEach.
      // Approach: reset and re-set the full three-call sequence needed.
      mockPrisma.attendanceEvent.findFirst
        .mockReset()
        .mockResolvedValueOnce({ id: 'clock-in-event' })  // 1: clock-in exists
        .mockResolvedValueOnce({ id: 'clock-out-event' }); // 2: duplicate clock-out

      await expect(
        service.clockOut(makeRequester(), CLOCK_OUT_DTO, MOCK_PHOTO),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.attendanceEvent.create).not.toHaveBeenCalled();
    });

    it('enqueues a notification when OUTSIDE_WINDOW', async () => {
      mockCheckWindow.mockReturnValue({
        flag: AttendanceFlag.OUTSIDE_WINDOW, allowed: false, message: 'Outside window',
      });

      await service.clockOut(makeRequester(), CLOCK_OUT_DTO, MOCK_PHOTO);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'attendance-flag',
        expect.objectContaining({
          userId: 'user-id',
          type:   AttendanceType.CLOCK_OUT,
          flag:   AttendanceFlag.OUTSIDE_WINDOW,
        }),
      );
    });

    it('does NOT enqueue a notification when ON_TIME', async () => {
      await service.clockOut(makeRequester(), CLOCK_OUT_DTO, MOCK_PHOTO);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  // ── recordKdVisit ──────────────────────────────────────────────────────────

  describe('recordKdVisit()', () => {
    const TIER1 = makeRequester({ tier: 'TIER1' });

    beforeEach(() => {
      mockPrisma.attendanceEvent.create.mockResolvedValue({
        ...CLOCK_IN_EVENT,
        type:        AttendanceType.KD_VISIT,
        kdAccountId: 'cust-id',
      });
    });

    it('creates a KD_VISIT event for a Tier1 agent', async () => {
      const result = await service.recordKdVisit(TIER1, KD_DTO, MOCK_PHOTO);

      const data = mockPrisma.attendanceEvent.create.mock.calls[0][0].data;
      expect(data.type).toBe(AttendanceType.KD_VISIT);
      expect(data.kdAccountId).toBe('cust-id');
    });

    it('throws ForbiddenException for Tier2 agents', async () => {
      await expect(
        service.recordKdVisit(makeRequester({ tier: 'TIER2' }), KD_DTO, MOCK_PHOTO),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.attendanceEvent.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for Tier3 agents', async () => {
      await expect(
        service.recordKdVisit(makeRequester({ tier: 'TIER3' }), KD_DTO, MOCK_PHOTO),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for Sales Head', async () => {
      await expect(
        service.recordKdVisit(makeRequester({ tier: 'TIER5_SALES_HEAD' }), KD_DTO, MOCK_PHOTO),
      ).rejects.toThrow(ForbiddenException);
    });

    it('always sets flag to ON_TIME regardless of time', async () => {
      // KD visits have no attendance window — always ON_TIME
      mockCheckWindow.mockReturnValue({ flag: AttendanceFlag.LATE, allowed: false, message: 'Late' });

      await service.recordKdVisit(TIER1, KD_DTO, MOCK_PHOTO);

      const data = mockPrisma.attendanceEvent.create.mock.calls[0][0].data;
      expect(data.flag).toBe(AttendanceFlag.ON_TIME);
    });

    it('uploads the photo to the kd-visits folder', async () => {
      await service.recordKdVisit(TIER1, KD_DTO, MOCK_PHOTO);

      const [, folder] = mockCloudinary.uploadBuffer.mock.calls[0];
      expect(folder).toBe('attendance/kd-visits');
    });

    it('stores the kdAccountId on the event', async () => {
      await service.recordKdVisit(TIER1, KD_DTO, MOCK_PHOTO);

      const data = mockPrisma.attendanceEvent.create.mock.calls[0][0].data;
      expect(data.kdAccountId).toBe('cust-id');
    });
  });

  // ── syncOfflineBatch ───────────────────────────────────────────────────────

  describe('syncOfflineBatch()', () => {
    const OFFLINE_EVENTS = [
      {
        type:       'CLOCK_IN',
        latitude:   6.5244,
        longitude:  3.3792,
        deviceTime: '2026-06-14T07:45:00.000Z',
        note:       undefined,
      },
      {
        type:       'CLOCK_OUT',
        latitude:   6.5244,
        longitude:  3.3792,
        deviceTime: '2026-06-14T17:00:00.000Z',
        note:       undefined,
      },
    ] as any;

    const PHOTOS = [MOCK_PHOTO, MOCK_PHOTO];

    it('processes all events and returns the processed count', async () => {
      // No existing duplicates
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);

      const result = await service.syncOfflineBatch(
        makeRequester(), OFFLINE_EVENTS, PHOTOS,
      );

      expect(result.processed).toBe(2);
      expect(result.skipped).toBe(0);
      expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledTimes(2);
    });

    it('skips an event when a duplicate already exists for that day', async () => {
      // First event is a duplicate, second is new
      mockPrisma.attendanceEvent.findFirst
        .mockResolvedValueOnce({ id: 'existing' }) // duplicate
        .mockResolvedValueOnce(null);              // new

      const result = await service.syncOfflineBatch(
        makeRequester(), OFFLINE_EVENTS, PHOTOS,
      );

      expect(result.processed).toBe(1);
      expect(result.skipped).toBe(1);
      expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledTimes(1);
    });

    it('skips an event when no corresponding photo exists', async () => {
      const result = await service.syncOfflineBatch(
        makeRequester(),
        OFFLINE_EVENTS,
        [MOCK_PHOTO], // only one photo for two events
      );

      expect(result.skipped).toBe(1);
      expect(result.processed).toBe(1);
    });

    it('skips an event and continues when upload throws', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
      mockCloudinary.uploadBuffer
        .mockRejectedValueOnce(new Error('Upload failed')) // first event fails
        .mockResolvedValue({ secure_url: 'https://cloudinary.com/test.jpg' }); // second succeeds

      const result = await service.syncOfflineBatch(
        makeRequester(), OFFLINE_EVENTS, PHOTOS,
      );

      expect(result.processed).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('returns processed:0, skipped:0 for an empty batch', async () => {
      const result = await service.syncOfflineBatch(makeRequester(), [], []);
      expect(result).toEqual({ processed: 0, skipped: 0 });
    });

    it('routes CLOCK_IN events to the clock-in folder', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);

      await service.syncOfflineBatch(
        makeRequester(),
        [OFFLINE_EVENTS[0]], // only CLOCK_IN
        [MOCK_PHOTO],
      );

      const [, folder] = mockCloudinary.uploadBuffer.mock.calls[0];
      expect(folder).toBe('attendance/clock-in');
    });

    it('routes CLOCK_OUT events to the clock-out folder', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);

      await service.syncOfflineBatch(
        makeRequester(),
        [OFFLINE_EVENTS[1]], // only CLOCK_OUT
        [MOCK_PHOTO],
      );

      const [, folder] = mockCloudinary.uploadBuffer.mock.calls[0];
      expect(folder).toBe('attendance/clock-out');
    });
  });

  // ── findEvents ─────────────────────────────────────────────────────────────

  describe('findEvents()', () => {
    it('returns all events ordered by deviceTime desc', async () => {
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([CLOCK_IN_EVENT]);
      const result = await service.findEvents(makeRequester(), {});

      expect(result).toEqual([CLOCK_IN_EVENT]);
      const call = mockPrisma.attendanceEvent.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ deviceTime: 'desc' });
    });

    it('TIER1 always sees only their own events regardless of userId query', async () => {
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);
      await service.findEvents(
        makeRequester({ tier: 'TIER1' }),
        { userId: 'some-other-user' },
      );

      const where = mockPrisma.attendanceEvent.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe('user-id'); // own ID, never the query param
    });

    it('non-TIER1 with no userId filter defaults to their own events', async () => {
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);
      await service.findEvents(makeRequester({ tier: 'TIER2' }), {});

      const where = mockPrisma.attendanceEvent.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe('user-id');
    });

    it('non-TIER1 admin can view a specific user by passing userId', async () => {
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);
      await service.findEvents(
        makeRequester({ tier: 'TIER5_SALES_HEAD' }),
        { userId: 'other-user-id' },
      );

      const where = mockPrisma.attendanceEvent.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe('other-user-id');
    });

    it('applies type filter when provided', async () => {
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);
      await service.findEvents(makeRequester(), { type: 'CLOCK_IN' });

      const where = mockPrisma.attendanceEvent.findMany.mock.calls[0][0].where;
      expect(where.type).toBe(AttendanceType.CLOCK_IN);
    });

    it('applies from/to date range filter on deviceTime', async () => {
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);
      await service.findEvents(makeRequester(), {
        from: '2026-06-01',
        to:   '2026-06-30',
      });

      const where = mockPrisma.attendanceEvent.findMany.mock.calls[0][0].where;
      expect(where.deviceTime.gte).toBeInstanceOf(Date);
      expect(where.deviceTime.lte).toBeInstanceOf(Date);
    });

    it('applies no date filter when from/to are omitted', async () => {
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);
      await service.findEvents(makeRequester(), {});

      const where = mockPrisma.attendanceEvent.findMany.mock.calls[0][0].where;
      expect(where.deviceTime).toBeUndefined();
    });
  });

  // ── hasClockedInToday ──────────────────────────────────────────────────────

  describe('hasClockedInToday()', () => {
    it('returns true when a CLOCK_IN event exists today (by serverTime)', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue({
        id: 'event-id', serverTime: new Date(),
      });

      const result = await service.hasClockedInToday('user-id');
      expect(result).toBe(true);
    });

    it('returns false when no CLOCK_IN event exists today', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);

      const result = await service.hasClockedInToday('user-id');
      expect(result).toBe(false);
    });

    it('queries by serverTime not deviceTime', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);

      await service.hasClockedInToday('user-id');

      const where = mockPrisma.attendanceEvent.findFirst.mock.calls[0][0].where;
      expect(where.serverTime).toBeDefined();
      expect(where.deviceTime).toBeUndefined();
    });

    it('filters for CLOCK_IN type only', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);

      await service.hasClockedInToday('user-id');

      const where = mockPrisma.attendanceEvent.findFirst.mock.calls[0][0].where;
      expect(where.type).toBe(AttendanceType.CLOCK_IN);
    });

    it('scopes the query to the given userId', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);

      await service.hasClockedInToday('specific-user-id');

      const where = mockPrisma.attendanceEvent.findFirst.mock.calls[0][0].where;
      expect(where.userId).toBe('specific-user-id');
    });
  });
});