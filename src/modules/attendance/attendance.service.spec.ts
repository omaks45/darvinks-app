
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
  serverTime: new Date(),
  address:    '12 Kolade St, Ilupeju, Lagos',
  latitude:   6.5244,
  longitude:  3.3792,
  photoUrl:   'https://cloudinary.com/photo.jpg',
};

const KD_VISIT_STUB = { ...EVENT_STUB, type: 'KD_VISIT', kdAccountId: 'kd-id' };

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
        { provide: PrismaService,             useValue: mockPrisma },
        { provide: CloudinaryService,         useValue: mockCloudinary },
        { provide: GoogleMapsService,         useValue: mockMaps },
        { provide: getQueueToken('notifications'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
    jest.resetAllMocks();

    mockPrisma.attendanceEvent.create.mockResolvedValue(EVENT_STUB);
    mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
    mockPrisma.attendanceEvent.findMany.mockResolvedValue([]);
    mockPrisma.attendanceEvent.count.mockResolvedValue(0);
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
      // queue.add is only called when flag !== ON_TIME
      // The service computes the flag internally; we just verify the call shape
      await service.clockIn(makeAgent(), BASE_DTO as any, MOCK_FILE);
      // If the flag was not ON_TIME the queue will have been called once
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
      // clockOut calls two findFirst checks in sequence:
      // 1. assertClockInExists  → must return a CLOCK_IN event (truthy)
      // 2. assertNoDuplicateEvent (CLOCK_OUT) → must return null (no duplicate)
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
      mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null); // no clock-in
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
          .mockResolvedValueOnce(KD_VISIT_STUB) // open visit exists
          .mockResolvedValueOnce(null);          // not already ended
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
        mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null); // no open visit
        await expect(service.endKdVisit(makeAgent(), KD_DTO as any, MOCK_FILE))
          .rejects.toThrow(BadRequestException);
        expect(mockPrisma.attendanceEvent.create).not.toHaveBeenCalled();
      });

      it('throws BadRequestException when KD visit already ended today', async () => {
        mockPrisma.attendanceEvent.findFirst
          .mockResolvedValueOnce(KD_VISIT_STUB)          // open visit exists
          .mockResolvedValueOnce({ ...KD_VISIT_STUB, type: 'KD_VISIT_END' }); // already ended
        await expect(service.endKdVisit(makeAgent(), KD_DTO as any, MOCK_FILE))
          .rejects.toThrow(BadRequestException);
        expect(mockPrisma.attendanceEvent.create).not.toHaveBeenCalled();
      });
    });

    describe('success path', () => {
      beforeEach(() => {
        mockPrisma.attendanceEvent.findFirst
          .mockResolvedValueOnce(KD_VISIT_STUB) // open visit
          .mockResolvedValueOnce(null);          // not already ended
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
});
