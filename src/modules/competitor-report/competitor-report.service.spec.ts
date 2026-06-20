// src/modules/competitor-reports/competitor-report.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CompetitorReportMediaType, Region, UserTier } from '@prisma/client';
import { CompetitorReportService } from './competitor-report.service';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  competitorReport: {
    create:     jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
  },
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REPORT_DETAIL = {
  id:            'report-id',
  submittedById: 'user-id',
  submittedBy:   { fullName: 'Kenny Solape', employeeRef: 'Dar-00000001', tier: UserTier.TIER2 },
  region:        'LAGOS_2',
  state:         'lagos',
  mediaType:     CompetitorReportMediaType.TEXT,
  mediaUrl:      null,
  textContent:   'Competitor X launched a new lotion at a lower price point',
  tags:          ['pricing', 'new-product'],
  createdAt:     new Date(),
};

const TEXT_DTO = {
  mediaType:   CompetitorReportMediaType.TEXT,
  textContent: 'Competitor X launched a new lotion at a lower price point',
  tags:        ['pricing', 'new-product'],
};

function makeRequester(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub:    'user-id',
    email:  'agent@darvinks.com',
    tier:   UserTier.TIER2,
    team:   'RADIANT',
    region: 'LAGOS_2',
    // NOTE: JwtPayload has no `state` field — only `region`. Earlier drafts
    // of this fixture incorrectly included one; removed rather than cast
    // away, since CompetitorReportService.create() also no longer reads
    // requester.state for the same reason (see service comment).
    ...overrides,
  } as JwtPayload;
}

function makeAdmin(): JwtPayload {
  return {
    sub: 'admin-id', email: 'admin@darvinks.com',
    tier: UserTier.TIER5_SYSTEM_ADMIN, team: 'RADIANT',
  } as JwtPayload;
}

function makeSalesHead(): JwtPayload {
  return {
    sub: 'sh-id', email: 'sh@darvinks.com',
    tier: UserTier.TIER5_SALES_HEAD, team: 'RADIANT',
  } as JwtPayload;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CompetitorReportService', () => {
  let service: CompetitorReportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitorReportService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CompetitorReportService>(CompetitorReportService);
    jest.resetAllMocks();
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create()', () => {
    beforeEach(() => {
      mockPrisma.competitorReport.create.mockResolvedValue(REPORT_DETAIL);
    });

    it('creates a TEXT report for a Tier2 field agent', async () => {
      const result = await service.create(TEXT_DTO, makeRequester());
      expect(result).toEqual(REPORT_DETAIL);
    });

    it('creates a report for every field tier (1-4)', async () => {
      for (const tier of [
        UserTier.TIER1, UserTier.TIER2, UserTier.TIER3, UserTier.TIER4,
      ]) {
        await service.create(TEXT_DTO, makeRequester({ tier }));
      }
      expect(mockPrisma.competitorReport.create).toHaveBeenCalledTimes(4);
    });

    it('throws ForbiddenException for TIER5_SALES_HEAD', async () => {
      await expect(
        service.create(TEXT_DTO, makeSalesHead()),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.competitorReport.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for TIER5_SYSTEM_ADMIN', async () => {
      await expect(
        service.create(TEXT_DTO, makeAdmin()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('uses the requester\'s own region — never accepts region as input', async () => {
      await service.create(TEXT_DTO, makeRequester({ region: 'NORTH_WEST' }));
      const data = mockPrisma.competitorReport.create.mock.calls[0][0].data;
      expect(data.region).toBe('NORTH_WEST');
    });

    it('defaults tags to an empty array when omitted', async () => {
      const dto = { mediaType: CompetitorReportMediaType.TEXT, textContent: 'note' };
      await service.create(dto, makeRequester());
      const data = mockPrisma.competitorReport.create.mock.calls[0][0].data;
      expect(data.tags).toEqual([]);
    });

    it('throws BadRequestException when the requester has no region (defensive check)', async () => {
      await expect(
        service.create(TEXT_DTO, makeRequester({ region: undefined })),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('field staff see only their own reports', async () => {
      mockPrisma.competitorReport.findMany.mockResolvedValue([]);
      await service.findAll({}, makeRequester());

      const where = mockPrisma.competitorReport.findMany.mock.calls[0][0].where;
      expect(where.submittedById).toBe('user-id');
    });

    it('Sales Head sees the full feed — no submittedById filter', async () => {
      mockPrisma.competitorReport.findMany.mockResolvedValue([]);
      await service.findAll({}, makeSalesHead());

      const where = mockPrisma.competitorReport.findMany.mock.calls[0][0].where;
      expect(where.submittedById).toBeUndefined();
    });

    it('System Admin sees the full feed', async () => {
      mockPrisma.competitorReport.findMany.mockResolvedValue([]);
      await service.findAll({}, makeAdmin());

      const where = mockPrisma.competitorReport.findMany.mock.calls[0][0].where;
      expect(where.submittedById).toBeUndefined();
    });

    it('applies region filter when provided', async () => {
      mockPrisma.competitorReport.findMany.mockResolvedValue([]);
      await service.findAll({ region: Region.NORTH_WEST }, makeSalesHead());

      const where = mockPrisma.competitorReport.findMany.mock.calls[0][0].where;
      expect(where.region).toBe('NORTH_WEST');
    });

    it('applies tag filter using the "has" array operator', async () => {
      mockPrisma.competitorReport.findMany.mockResolvedValue([]);
      await service.findAll({ tag: 'pricing' }, makeSalesHead());

      const where = mockPrisma.competitorReport.findMany.mock.calls[0][0].where;
      expect(where.tags.has).toBe('pricing');
    });

    it('applies from/to date range on createdAt', async () => {
      mockPrisma.competitorReport.findMany.mockResolvedValue([]);
      await service.findAll(
        { from: '2026-06-01', to: '2026-06-30' },
        makeSalesHead(),
      );

      const where = mockPrisma.competitorReport.findMany.mock.calls[0][0].where;
      expect(where.createdAt.gte).toBeInstanceOf(Date);
      expect(where.createdAt.lte).toBeInstanceOf(Date);
    });

    it('caps results at 200', async () => {
      mockPrisma.competitorReport.findMany.mockResolvedValue([]);
      await service.findAll({}, makeSalesHead());

      const call = mockPrisma.competitorReport.findMany.mock.calls[0][0];
      expect(call.take).toBe(200);
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns the report for the submitter', async () => {
      mockPrisma.competitorReport.findUnique.mockResolvedValue(REPORT_DETAIL);
      const result = await service.findById('report-id', makeRequester());
      expect(result).toEqual(REPORT_DETAIL);
    });

    it('Sales Head can view any report', async () => {
      mockPrisma.competitorReport.findUnique.mockResolvedValue({
        ...REPORT_DETAIL, submittedById: 'someone-else',
      });
      await expect(
        service.findById('report-id', makeSalesHead()),
      ).resolves.not.toThrow();
    });

    it('throws ForbiddenException when a field agent views another agent\'s report', async () => {
      mockPrisma.competitorReport.findUnique.mockResolvedValue({
        ...REPORT_DETAIL, submittedById: 'someone-else',
      });
      await expect(
        service.findById('report-id', makeRequester()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for an unknown ID', async () => {
      mockPrisma.competitorReport.findUnique.mockResolvedValue(null);
      await expect(
        service.findById('bad-id', makeSalesHead()),
      ).rejects.toThrow(NotFoundException);
    });
  });
});