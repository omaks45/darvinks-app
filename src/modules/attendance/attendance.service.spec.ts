// src/modules/attendance/attendance.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { AttendanceService } from './attendance.service';
import { PrismaService }     from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import { GoogleMapsService } from '@common/google/google-map.service';
import type { JwtPayload }   from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  attendanceEvent: {
    create:    jest.fn(),
    findFirst: jest.fn(),
    findMany:  jest.fn(),
    count:     jest.fn(),
  },
  purchaseOrder: {
    findMany: jest.fn(),
  },
  collection: {
    findMany: jest.fn(),
  },
  secondarySale: {
    findMany: jest.fn(),
  },
  stockCollection: {
    findMany: jest.fn(),
  },
  secondarySaleInvoice: {
    findMany: jest.fn(),
  },
};

const mockCloudinary = { uploadBuffer: jest.fn() };
const mockMaps       = { reverseGeocode: jest.fn() };
const mockQueue      = { add: jest.fn() };

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_FILE = {
  buffer:       Buffer.from('photo'),
  mimetype:     'image/jpeg',
  originalname: 'photo.jpg',
} as Express.Multer.File;

const EVENT_STUB = {
  id:         'event-id',
  type:       'CLOCK_IN',
  flag:       'ON_TIME',
  serverTime: new Date('2026-08-02T08:45:02.000Z'),
  address:    '12 Kolade St, Ilupeju, Lagos',
  latitude:   6.5244,
  longitude:  3.3792,
  photoUrl:   'https://cloudinary.com/photo.jpg',
};

const KD_VISIT_STUB = {
  ...EVENT_STUB,
  id:          'visit-start-id',
  type:        'KD_VISIT',
  kdAccountId: 'kd-id',
  serverTime:  new Date('2026-08-02T09:10:02.000Z'),
  kdAccount: {
    id:           'kd-id',
    businessName: 'Ore Ofe Distributors',
    customerType: 'PRIMARY',
  },
  user: {
    id:          'agent-id',
    fullName:    'Emeka Obi',
    employeeRef: 'Dar-00000003',
    role:        'MERCHANDISER',
    tier:        'TIER2',
    team:        'RADIANT',
    region:      'SOUTH_WEST',
  },
};

const KD_VISIT_END_STUB = {
  ...KD_VISIT_STUB,
  id:            'visit-end-id',
  type:          'KD_VISIT_END',
  serverTime:    new Date('2026-08-02T10:30:02.000Z'),
  parentEventId: 'visit-start-id',
};

const BASE_DTO = {
  latitude:   6.5244,
  longitude:  3.3792,
  deviceTime: new Date().toISOString(),
  note:       null,
};

const KD_DTO = { ...BASE_DTO, kdAccountId: 'kd-id' };

function makeAgent(tier = 'TIER2'): JwtPayload {
  return { sub: 'agent-id', email: 'agent@t.com', tier, team: 'RADIANT', region: 'SOUTH_WEST' } as JwtPayload;
}
function makeSupport(): JwtPayload {
  return { sub: 'support-id', email: 'support@t.com', tier: 'TIER5_FIELD_SUPPORT', team: 'RADIANT', region: 'SOUTH_WEST' } as JwtPayload;
}
function makeAdmin(): JwtPayload {
  return { sub: 'admin-id', email: 'admin@t.com', tier: 'TIER5_SALES_SUPPORT', team: 'RADIANT' } as JwtPayload;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AttendanceService', () => {
  let service: AttendanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService,                 useValue: mockPrisma },
        { provide: CloudinaryService,             useValue: mockCloudinary },
        { provide: GoogleMapsService,             useValue: mockMaps },
        { provide: getQueueToken('notifications'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
    jest.resetAllMocks();

    // Sensible defaults
    mockPrisma.attendanceEvent.create.mockResolvedValue(EVENT_STUB);
    mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
    mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);
    mockPrisma.attendanceEvent.count.mockResolvedValue(0);
    mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
    mockPrisma.collection.findMany.mockResolvedValue([]);
    mockPrisma.secondarySale.findMany.mockResolvedValue([]);
    mockPrisma.stockCollection.findMany.mockResolvedValue([]);
    mockPrisma.secondarySaleInvoice.findMany.mockResolvedValue([]);

    mockCloudinary.uploadBuffer.mockResolvedValue({ secure_url: 'https://cloudinary.com/photo.jpg' });
    mockMaps.reverseGeocode.mockResolvedValue({ address: '12 Kolade St, Lagos', state: 'lagos' });
    mockQueue.add.mockResolvedValue(undefined);
  });

  // ── clockIn() ──────────────────────────────────────────────────────────────

  describe('clockIn()', () => {
    it('creates a CLOCK_IN event', async () => {
      const result = await service.clockIn(makeAgent(), BASE_DTO as any, MOCK_FILE) as any;
      expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });

    it('geocodes the GPS coordinates', async () => {
      await service.clockIn(makeAgent(), BASE_DTO as any, MOCK_FILE);
      expect(mockMaps.reverseGeocode).toHaveBeenCalledWith(BASE_DTO.latitude, BASE_DTO.longitude);
    });

    it('uploads photo to Cloudinary', async () => {
      await service.clockIn(makeAgent(), BASE_DTO as any, MOCK_FILE);
      expect(mockCloudinary.uploadBuffer).toHaveBeenCalledTimes(1);
    });

    it('queues an attendance-flag notification when agent is LATE or OUTSIDE_WINDOW', async () => {
      await service.clockIn(makeAgent(), BASE_DTO as any, MOCK_FILE);
      if (mockQueue.add.mock.calls.length > 0) {
        expect(mockQueue.add).toHaveBeenCalledWith(
          'attendance-flag',
          expect.any(Object),
        );
      }
    });

    it('works for all field tiers', async () => {
      for (const tier of ['TIER1', 'TIER2', 'TIER3', 'TIER4']) {
        jest.clearAllMocks();
        mockPrisma.attendanceEvent.create.mockResolvedValue(EVENT_STUB);
        mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
        mockCloudinary.uploadBuffer.mockResolvedValue({ secure_url: 'https://cloudinary.com/photo.jpg' });
        mockMaps.reverseGeocode.mockResolvedValue({ address: '12 Kolade St, Lagos', state: 'lagos' });
        await expect(service.clockIn(makeAgent(tier), BASE_DTO as any, MOCK_FILE))
          .resolves.not.toThrow();
      }
    });
  });

  // ── clockOut() ─────────────────────────────────────────────────────────────

  describe('clockOut()', () => {
    beforeEach(() => {
      mockPrisma.attendanceEvent.findFirst
        .mockResolvedValueOnce(EVENT_STUB) // clock-in exists ✓
        .mockResolvedValueOnce(null);      // no duplicate clock-out ✓
    });

    it('creates a CLOCK_OUT event', async () => {
      await service.clockOut(makeAgent(), BASE_DTO as any, MOCK_FILE);
      expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException when agent has not clocked in today', async () => {
      mockPrisma.attendanceEvent.findFirst.mockReset();
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
      await expect(service.clockOut(makeAgent(), BASE_DTO as any, MOCK_FILE))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when agent already clocked out today', async () => {
      mockPrisma.attendanceEvent.findFirst.mockReset();
      mockPrisma.attendanceEvent.findFirst
        .mockResolvedValueOnce(EVENT_STUB)  // clock-in exists
        .mockResolvedValueOnce(EVENT_STUB); // duplicate clock-out exists
      await expect(service.clockOut(makeAgent(), BASE_DTO as any, MOCK_FILE))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ── recordKdVisit() ────────────────────────────────────────────────────────

  describe('recordKdVisit()', () => {
    it('creates a KD_VISIT event', async () => {
      mockPrisma.attendanceEvent.create.mockResolvedValue(KD_VISIT_STUB);
      await service.recordKdVisit(makeAgent('TIER1'), KD_DTO as any, MOCK_FILE);
      expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledTimes(1);
    });

    it('works for Tier 1', async () => {
      await expect(service.recordKdVisit(makeAgent('TIER1'), KD_DTO as any, MOCK_FILE))
        .resolves.not.toThrow();
    });

    it('works for Tier 2', async () => {
      await expect(service.recordKdVisit(makeAgent('TIER2'), KD_DTO as any, MOCK_FILE))
        .resolves.not.toThrow();
    });

    it('works for Tier 3', async () => {
      await expect(service.recordKdVisit(makeAgent('TIER3'), KD_DTO as any, MOCK_FILE))
        .resolves.not.toThrow();
    });

    it('works for Tier 4', async () => {
      await expect(service.recordKdVisit(makeAgent('TIER4'), KD_DTO as any, MOCK_FILE))
        .resolves.not.toThrow();
    });

    it('throws ForbiddenException for Sales Support Agent', async () => {
      await expect(service.recordKdVisit(makeAdmin(), KD_DTO as any, MOCK_FILE))
        .rejects.toThrow(ForbiddenException);
    });

    it('stores kdAccountId on the event', async () => {
      await service.recordKdVisit(makeAgent('TIER2'), KD_DTO as any, MOCK_FILE);
      const data = mockPrisma.attendanceEvent.create.mock.calls[0][0].data;
      expect(data.kdAccountId).toBe('kd-id');
    });
  });

  // ── endKdVisit() ───────────────────────────────────────────────────────────

  describe('endKdVisit()', () => {
    describe('access control', () => {
      it('works for Tier 1', async () => {
        mockPrisma.attendanceEvent.findFirst
          .mockResolvedValueOnce(KD_VISIT_STUB)
          .mockResolvedValueOnce(null);
        await expect(service.endKdVisit(makeAgent('TIER1'), KD_DTO as any, MOCK_FILE))
          .resolves.not.toThrow();
      });

      it('works for Tier 2', async () => {
        mockPrisma.attendanceEvent.findFirst
          .mockResolvedValueOnce(KD_VISIT_STUB)
          .mockResolvedValueOnce(null);
        await expect(service.endKdVisit(makeAgent('TIER2'), KD_DTO as any, MOCK_FILE))
          .resolves.not.toThrow();
      });

      it('works for Tier 4', async () => {
        mockPrisma.attendanceEvent.findFirst
          .mockResolvedValueOnce(KD_VISIT_STUB)
          .mockResolvedValueOnce(null);
        await expect(service.endKdVisit(makeAgent('TIER4'), KD_DTO as any, MOCK_FILE))
          .resolves.not.toThrow();
      });

      it('throws ForbiddenException for admin tier', async () => {
        await expect(service.endKdVisit(makeAdmin(), KD_DTO as any, MOCK_FILE))
          .rejects.toThrow(ForbiddenException);
        expect(mockPrisma.attendanceEvent.findFirst).not.toHaveBeenCalled();
      });
    });

    describe('open visit validation', () => {
      it('throws BadRequestException when no KD_VISIT exists for this KD today', async () => {
        mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
        await expect(service.endKdVisit(makeAgent(), KD_DTO as any, MOCK_FILE))
          .rejects.toThrow(BadRequestException);
        expect(mockPrisma.attendanceEvent.create).not.toHaveBeenCalled();
      });

      it('throws BadRequestException when KD visit already ended today', async () => {
        // The service uses `children: { none: {} }` in the findFirst query so it only
        // returns an open visit that has NO KD_VISIT_END child yet. When a visit is
        // already ended the query returns null (no unclosed visit found), which triggers
        // the same BadRequestException — there is no separate second findFirst call.
        mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
        await expect(service.endKdVisit(makeAgent(), KD_DTO as any, MOCK_FILE))
          .rejects.toThrow(BadRequestException);
        expect(mockPrisma.attendanceEvent.create).not.toHaveBeenCalled();
      });
    });

    describe('success path', () => {
      beforeEach(() => {
        mockPrisma.attendanceEvent.findFirst
          .mockResolvedValueOnce(KD_VISIT_STUB)
          .mockResolvedValueOnce(null);
      });

      it('creates a KD_VISIT_END event', async () => {
        await service.endKdVisit(makeAgent(), KD_DTO as any, MOCK_FILE);
        const data = mockPrisma.attendanceEvent.create.mock.calls[0][0].data;
        expect(data.type).toBe('KD_VISIT_END');
      });

      it('stores kdAccountId on the departure event', async () => {
        await service.endKdVisit(makeAgent(), KD_DTO as any, MOCK_FILE);
        const data = mockPrisma.attendanceEvent.create.mock.calls[0][0].data;
        expect(data.kdAccountId).toBe('kd-id');
      });

      it('stores parentEventId linking departure back to the opening KD_VISIT', async () => {
        await service.endKdVisit(makeAgent(), KD_DTO as any, MOCK_FILE);
        const data = mockPrisma.attendanceEvent.create.mock.calls[0][0].data;
        // parentEventId must equal the id of the found open visit
        expect(data.parentEventId).toBe(KD_VISIT_STUB.id);
      });

      it('uploads departure photo to Cloudinary', async () => {
        await service.endKdVisit(makeAgent(), KD_DTO as any, MOCK_FILE);
        expect(mockCloudinary.uploadBuffer).toHaveBeenCalledTimes(1);
      });

      it('geocodes departure GPS coordinates', async () => {
        await service.endKdVisit(makeAgent(), KD_DTO as any, MOCK_FILE);
        expect(mockMaps.reverseGeocode).toHaveBeenCalledWith(KD_DTO.latitude, KD_DTO.longitude);
      });

      it('stores the resolved departure address', async () => {
        await service.endKdVisit(makeAgent(), KD_DTO as any, MOCK_FILE);
        const data = mockPrisma.attendanceEvent.create.mock.calls[0][0].data;
        expect(data.address).toBe('12 Kolade St, Lagos');
      });
    });
  });

  // ── hasClockedInToday() ────────────────────────────────────────────────────

  describe('hasClockedInToday()', () => {
    it('returns true when a CLOCK_IN event exists today', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(EVENT_STUB);
      const result = await service.hasClockedInToday('agent-id');
      expect(result).toBe(true);
    });

    it('returns false when no CLOCK_IN event exists today', async () => {
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
      const result = await service.hasClockedInToday('agent-id');
      expect(result).toBe(false);
    });
  });

  // ── getScoredAttendanceHistory() (via findAttendanceByUserForSupport) ──────

  describe('findAttendanceByUserForSupport() — daily scored format', () => {
    it('groups events by date and returns a DailyAttendanceScore per day', async () => {
      const clockIn = {
        ...EVENT_STUB,
        id:         'ci-1',
        type:       'CLOCK_IN',
        flag:       'ON_TIME',
        serverTime: new Date('2026-08-02T08:45:02.000Z'),
      };
      const clockOut = {
        ...EVENT_STUB,
        id:         'co-1',
        type:       'CLOCK_OUT',
        flag:       'ON_TIME',
        serverTime: new Date('2026-08-02T17:00:02.000Z'),
      };

      mockPrisma.attendanceEvent.findMany.mockResolvedValue([clockIn, clockOut]);
      mockPrisma.attendanceEvent.count.mockResolvedValue(1); // 1 unique day

      const result: any = await service.findAttendanceByUserForSupport(
        'agent-id',
        { page: 1, limit: 31 },
        makeSupport(),
      );

      expect(result.data).toBeDefined();
      const day = result.data[0];
      expect(day).toMatchObject({
        date:         '2026-08-02',
        clockIn:      1,
        clockInFlag:  'ON_TIME',
        clockOut:     1,
        clockOutFlag: 'ON_TIME',
        totalPoints:  2,
      });
    });

    it('scores LATE clock-in as 0', async () => {
      const lateClockIn = {
        ...EVENT_STUB,
        id:         'ci-late',
        type:       'CLOCK_IN',
        flag:       'LATE',
        serverTime: new Date('2026-08-02T09:30:00.000Z'),
      };

      mockPrisma.attendanceEvent.findMany.mockResolvedValue([lateClockIn]);
      mockPrisma.attendanceEvent.count.mockResolvedValue(1);

      const result: any = await service.findAttendanceByUserForSupport(
        'agent-id',
        { page: 1, limit: 31 },
        makeSupport(),
      );

      const day = result.data[0];
      expect(day.clockIn).toBe(0);
      expect(day.clockInFlag).toBe('LATE');
      expect(day.totalPoints).toBeLessThanOrEqual(1);
    });

    it('scores OUTSIDE_WINDOW clock-in as 0', async () => {
      const outsideClockIn = {
        ...EVENT_STUB,
        id:         'ci-outside',
        type:       'CLOCK_IN',
        flag:       'OUTSIDE_WINDOW',
        serverTime: new Date('2026-08-02T11:00:00.000Z'),
      };

      mockPrisma.attendanceEvent.findMany.mockResolvedValue([outsideClockIn]);
      mockPrisma.attendanceEvent.count.mockResolvedValue(1);

      const result: any = await service.findAttendanceByUserForSupport(
        'agent-id',
        { page: 1, limit: 31 },
        makeSupport(),
      );

      const day = result.data[0];
      expect(day.clockIn).toBe(0);
      expect(day.clockInFlag).toBe('OUTSIDE_WINDOW');
    });

    it('scores ON_TIME clock-in as 1', async () => {
      const onTimeClockIn = {
        ...EVENT_STUB,
        id:         'ci-ontime',
        type:       'CLOCK_IN',
        flag:       'ON_TIME',
        serverTime: new Date('2026-08-02T08:45:00.000Z'),
      };

      mockPrisma.attendanceEvent.findMany.mockResolvedValue([onTimeClockIn]);
      mockPrisma.attendanceEvent.count.mockResolvedValue(1);

      const result: any = await service.findAttendanceByUserForSupport(
        'agent-id',
        { page: 1, limit: 31 },
        makeSupport(),
      );

      const day = result.data[0];
      expect(day.clockIn).toBe(1);
    });

    it('returns clockOut score 0 and null clockOut time/flag fields when no clock-out event exists for that day', async () => {
      const clockInOnly = {
        ...EVENT_STUB,
        id:         'ci-only',
        type:       'CLOCK_IN',
        flag:       'ON_TIME',
        serverTime: new Date('2026-08-02T08:45:00.000Z'),
      };

      mockPrisma.attendanceEvent.findMany.mockResolvedValue([clockInOnly]);
      mockPrisma.attendanceEvent.count.mockResolvedValue(1);

      const result: any = await service.findAttendanceByUserForSupport(
        'agent-id',
        { page: 1, limit: 31 },
        makeSupport(),
      );

      const day = result.data[0];
      // clockOut is always 0 or 1 (never null) — absence of an event means score 0
      expect(day.clockOut).toBe(0);
      // time and flag are null when no clock-out event exists
      expect(day.clockOutFlag).toBeNull();
      expect(day.clockOutTime).toBeNull();
    });

    it('totalPoints is 0 when both clock-in and clock-out are LATE/OUTSIDE_WINDOW', async () => {
      const lateIn = {
        ...EVENT_STUB, id: 'ci-l', type: 'CLOCK_IN',  flag: 'LATE',
        serverTime: new Date('2026-08-03T09:30:00.000Z'),
      };
      const lateOut = {
        ...EVENT_STUB, id: 'co-l', type: 'CLOCK_OUT', flag: 'OUTSIDE_WINDOW',
        serverTime: new Date('2026-08-03T18:30:00.000Z'),
      };

      mockPrisma.attendanceEvent.findMany.mockResolvedValue([lateIn, lateOut]);
      mockPrisma.attendanceEvent.count.mockResolvedValue(1);

      const result: any = await service.findAttendanceByUserForSupport(
        'agent-id', { page: 1, limit: 31 }, makeSupport(),
      );

      expect(result.data[0].totalPoints).toBe(0);
    });

    it('returns correct pagination meta', async () => {
      mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);
      mockPrisma.attendanceEvent.count.mockResolvedValue(0);

      const result: any = await service.findAttendanceByUserForSupport(
        'agent-id', { page: 1, limit: 31 }, makeSupport(),
      );

      expect(result.meta).toMatchObject({
        page:  1,
        limit: 31,
      });
    });
  });

  // ── findByUser() — same scored format ─────────────────────────────────────

  describe('findByUser() — daily scored format', () => {
    it('returns DailyAttendanceScore entries (same shape as support endpoint)', async () => {
      const clockIn = {
        ...EVENT_STUB,
        id:         'ci-own',
        type:       'CLOCK_IN',
        flag:       'ON_TIME',
        serverTime: new Date('2026-08-02T08:45:02.000Z'),
      };

      mockPrisma.attendanceEvent.findMany.mockResolvedValue([clockIn]);
      mockPrisma.attendanceEvent.count.mockResolvedValue(1);

      const result: any = await service.findByUser(
        'agent-id', { page: 1, limit: 31 }, makeAgent(),
      );

      expect(result.data).toBeDefined();
      const day = result.data[0];
      expect(day).toHaveProperty('date');
      expect(day).toHaveProperty('clockIn');
      expect(day).toHaveProperty('clockOut');
      expect(day).toHaveProperty('totalPoints');
    });

    it('throws ForbiddenException when field agent requests another user\'s history', async () => {
      await expect(
        service.findByUser('other-user-id', { page: 1, limit: 31 }, makeAgent()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── findKdVisitByIdForSupport() ────────────────────────────────────────────

  describe('findKdVisitByIdForSupport()', () => {
    const VISIT_WITH_END = {
      ...KD_VISIT_STUB,
      children: [KD_VISIT_END_STUB],
    };

    // findKdVisitByIdForSupport makes TWO sequential findFirst calls:
    //   call 1 → finds the KD_VISIT arrival by id
    //   call 2 → pairKdVisitWithEnd finds KD_VISIT_END by parentEventId = arrival.id
    // Each test must mock both calls in order.

    it('throws NotFoundException when event does not exist', async () => {
      // call 1 returns null → NotFoundException before call 2 is ever made
      mockPrisma.attendanceEvent.findFirst.mockResolvedValueOnce(null);
      const { NotFoundException } = await import('@nestjs/common');
      await expect(service.findKdVisitByIdForSupport('nonexistent-id'))
        .rejects.toThrow(NotFoundException);
    });

    it('returns the visit with paired departure in visitEnd', async () => {
      mockPrisma.attendanceEvent.findFirst
        .mockResolvedValueOnce(KD_VISIT_STUB)       // call 1: arrival
        .mockResolvedValueOnce(KD_VISIT_END_STUB);  // call 2: pairKdVisitWithEnd

      const result: any = await service.findKdVisitByIdForSupport('visit-start-id');

      expect(result.id).toBe('visit-start-id');
      expect(result.visitEnd).toBeDefined();
      expect(result.visitEnd.id).toBe('visit-end-id');
    });

    it('computes timeSpentSeconds when visitEnd exists', async () => {
      mockPrisma.attendanceEvent.findFirst
        .mockResolvedValueOnce(KD_VISIT_STUB)
        .mockResolvedValueOnce(KD_VISIT_END_STUB);

      const result: any = await service.findKdVisitByIdForSupport('visit-start-id');

      expect(typeof result.timeSpentSeconds).toBe('number');
      expect(result.timeSpentSeconds).toBeGreaterThan(0);
    });

    it('computes timeSpentMinutes when visitEnd exists', async () => {
      mockPrisma.attendanceEvent.findFirst
        .mockResolvedValueOnce(KD_VISIT_STUB)
        .mockResolvedValueOnce(KD_VISIT_END_STUB);

      const result: any = await service.findKdVisitByIdForSupport('visit-start-id');

      expect(typeof result.timeSpentMinutes).toBe('number');
    });

    it('includes activities block with all five activity types', async () => {
      mockPrisma.attendanceEvent.findFirst
        .mockResolvedValueOnce(KD_VISIT_STUB)
        .mockResolvedValueOnce(KD_VISIT_END_STUB);
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([{ id: 'po-1' }]);
      mockPrisma.collection.findMany.mockResolvedValue([]);
      mockPrisma.secondarySale.findMany.mockResolvedValue([{ id: 'ss-1' }]);
      mockPrisma.stockCollection.findMany.mockResolvedValue([]);
      mockPrisma.secondarySaleInvoice.findMany.mockResolvedValue([]);

      const result: any = await service.findKdVisitByIdForSupport('visit-start-id');

      expect(result.activities).toBeDefined();
      expect(result.activities).toHaveProperty('purchaseOrders');
      expect(result.activities).toHaveProperty('collections');
      expect(result.activities).toHaveProperty('secondarySales');
      expect(result.activities).toHaveProperty('stockCollections');
      expect(result.activities).toHaveProperty('invoices');
    });

    it('includes activities.summary with boolean flags and totalActivities count', async () => {
      mockPrisma.attendanceEvent.findFirst
        .mockResolvedValueOnce(KD_VISIT_STUB)
        .mockResolvedValueOnce(KD_VISIT_END_STUB);
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([{ id: 'po-1' }]);
      mockPrisma.collection.findMany.mockResolvedValue([]);
      mockPrisma.secondarySale.findMany.mockResolvedValue([{ id: 'ss-1' }]);
      mockPrisma.stockCollection.findMany.mockResolvedValue([]);
      mockPrisma.secondarySaleInvoice.findMany.mockResolvedValue([]);

      const result: any = await service.findKdVisitByIdForSupport('visit-start-id');

      expect(result.activities.summary).toMatchObject({
        hasPurchaseOrders:   true,
        hasCollections:      false,
        hasSecondarySales:   true,
        hasStockCollections: false,
        hasInvoices:         false,
        totalActivities:     2,
      });
    });

    it('returns all activity arrays empty when agent did nothing during the visit', async () => {
      mockPrisma.attendanceEvent.findFirst
        .mockResolvedValueOnce(KD_VISIT_STUB)
        .mockResolvedValueOnce(KD_VISIT_END_STUB);
      // all activity mocks already return [] from beforeEach

      const result: any = await service.findKdVisitByIdForSupport('visit-start-id');

      expect(result.activities.purchaseOrders).toHaveLength(0);
      expect(result.activities.collections).toHaveLength(0);
      expect(result.activities.secondarySales).toHaveLength(0);
      expect(result.activities.stockCollections).toHaveLength(0);
      expect(result.activities.invoices).toHaveLength(0);
      expect(result.activities.summary.totalActivities).toBe(0);
    });

    it('fetches all 5 activity tables in parallel (Promise.all)', async () => {
      const calls: string[] = [];
      mockPrisma.attendanceEvent.findFirst
        .mockResolvedValueOnce(KD_VISIT_STUB)
        .mockResolvedValueOnce(KD_VISIT_END_STUB);
      mockPrisma.purchaseOrder.findMany.mockImplementation(async () => { calls.push('po'); return []; });
      mockPrisma.collection.findMany.mockImplementation(async () => { calls.push('col'); return []; });
      mockPrisma.secondarySale.findMany.mockImplementation(async () => { calls.push('ss'); return []; });
      mockPrisma.stockCollection.findMany.mockImplementation(async () => { calls.push('sc'); return []; });
      mockPrisma.secondarySaleInvoice.findMany.mockImplementation(async () => { calls.push('inv'); return []; });

      await service.findKdVisitByIdForSupport('visit-start-id');

      // All 5 must be called (order can vary because Promise.all runs them concurrently)
      expect(calls).toHaveLength(5);
      expect(calls).toEqual(expect.arrayContaining(['po', 'col', 'ss', 'sc', 'inv']));
    });

    it('returns null visitEnd and null timeSpent when visit has not been ended yet', async () => {
      mockPrisma.attendanceEvent.findFirst
        .mockResolvedValueOnce(KD_VISIT_STUB)  // call 1: arrival found
        .mockResolvedValueOnce(null);           // call 2: no KD_VISIT_END found

      const result: any = await service.findKdVisitByIdForSupport('visit-start-id');

      expect(result.visitEnd).toBeNull();
      expect(result.timeSpentSeconds).toBeNull();
      expect(result.timeSpentMinutes).toBeNull();
    });
  });
});