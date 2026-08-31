// src/modules/competitor-reports/competitor-report.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Region } from '@prisma/client';
import { CompetitorReportService } from './competitor-report.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  competitorReport: {
    create:     jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
  },
};

const mockCloudinary = {
  uploadBuffer: jest.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REPORT_STUB = {
  id:            'report-id',
  submittedById: 'agent-id',
  submittedBy:   { fullName: 'Kenny Solape', employeeRef: 'Dar-00000003', tier: 'TIER2' },
  region:        Region.SOUTH_WEST,
  state:         null,
  mediaType:     'TEXT',
  mediaUrl:      null,
  textContent:   'Competitor X launched a new lotion at a lower price in Mushin',
  tags:          ['pricing', 'new-product'],
  createdAt:     new Date(),
};

const TEXT_DTO = {
  mediaType:   'TEXT',
  textContent: 'Competitor X launched a new lotion at a lower price in Mushin',
  tags:        ['pricing'],
};

const IMAGE_DTO = {
  mediaType: 'IMAGE',
  tags:      ['promo'],
};

const VIDEO_DTO = { mediaType: 'VIDEO', tags: [] };
const PDF_DTO   = { mediaType: 'PDF',   tags: [] };

const MOCK_IMAGE_FILE: Express.Multer.File = {
  fieldname:    'file',
  originalname: 'promo.jpg',
  encoding:     '7bit',
  mimetype:     'image/jpeg',
  buffer:       Buffer.from('fake-image'),
  size:         2048,
  stream:       null as any,
  destination:  '',
  filename:     '',
  path:         '',
};

const MOCK_VIDEO_FILE: Express.Multer.File = {
  ...MOCK_IMAGE_FILE,
  originalname: 'promo.mp4',
  mimetype:     'video/mp4',
};

const MOCK_PDF_FILE: Express.Multer.File = {
  ...MOCK_IMAGE_FILE,
  originalname: 'promo.pdf',
  mimetype:     'application/pdf',
};

function makeFieldAgent(tier = 'TIER2'): JwtPayload {
  return {
    sub:    'agent-id',
    email:  'agent@darvinks.com',
    tier,
    team:   'RADIANT',
    region: Region.SOUTH_WEST as string,
  } as JwtPayload;
}

function makeSalesHead(): JwtPayload {
  return {
    sub:    'sh-id',
    email:  'sh@darvinks.com',
    tier:   'TIER5_SALES_HEAD',
    team:   'RADIANT',
    region: undefined,
  } as JwtPayload;
}

function makeAdmin(): JwtPayload {
  return {
    sub:    'admin-id',
    email:  'admin@darvinks.com',
    tier:   'TIER5_SALES_SUPPORT',
    team:   'RADIANT',
    region: undefined,
  } as JwtPayload;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CompetitorReportService', () => {
  let service: CompetitorReportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitorReportService,
        { provide: PrismaService,     useValue: mockPrisma },
        { provide: CloudinaryService, useValue: mockCloudinary },
      ],
    }).compile();

    service = module.get<CompetitorReportService>(CompetitorReportService);
    jest.resetAllMocks();

    // Safe defaults
    mockPrisma.competitorReport.create.mockResolvedValue(REPORT_STUB);
    mockPrisma.competitorReport.findMany.mockResolvedValue([REPORT_STUB]);
    mockPrisma.competitorReport.findUnique.mockResolvedValue(REPORT_STUB);
    mockCloudinary.uploadBuffer.mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/test/competitor-reports/agent-id-123.jpg',
    });
  });

  // ── create() ───────────────────────────────────────────────────────────────

  describe('create()', () => {

    describe('TEXT reports', () => {
      it('creates a TEXT report without calling Cloudinary', async () => {
        const result = await service.create(TEXT_DTO as any, undefined, makeFieldAgent());
        expect(result).toEqual(REPORT_STUB);
        expect(mockCloudinary.uploadBuffer).not.toHaveBeenCalled();
        expect(mockPrisma.competitorReport.create).toHaveBeenCalledTimes(1);
      });

      it('stores textContent and tags on the report', async () => {
        await service.create(TEXT_DTO as any, undefined, makeFieldAgent());
        const data = mockPrisma.competitorReport.create.mock.calls[0][0].data;
        expect(data.textContent).toBe(TEXT_DTO.textContent);
        expect(data.tags).toEqual(TEXT_DTO.tags);
        expect(data.mediaUrl).toBeNull();
      });

      it('stores mediaUrl as null for TEXT reports', async () => {
        await service.create(TEXT_DTO as any, undefined, makeFieldAgent());
        const data = mockPrisma.competitorReport.create.mock.calls[0][0].data;
        expect(data.mediaUrl).toBeNull();
      });

      it('defaults tags to empty array when not provided', async () => {
        const dto = { mediaType: 'TEXT', textContent: 'Some observation' };
        await service.create(dto as any, undefined, makeFieldAgent());
        const data = mockPrisma.competitorReport.create.mock.calls[0][0].data;
        expect(data.tags).toEqual([]);
      });
    });

    describe('IMAGE reports with file upload', () => {
      it('uploads image to Cloudinary and stores the returned URL', async () => {
        const result = await service.create(IMAGE_DTO as any, MOCK_IMAGE_FILE, makeFieldAgent());
        expect(mockCloudinary.uploadBuffer).toHaveBeenCalledTimes(1);
        const [buffer, folder, options] = mockCloudinary.uploadBuffer.mock.calls[0];
        expect(buffer).toEqual(MOCK_IMAGE_FILE.buffer);
        expect(folder).toBe('competitor-reports');
        expect(options.resourceType).toBe('image');
      });

      it('stores the Cloudinary secure_url as mediaUrl', async () => {
        mockCloudinary.uploadBuffer.mockResolvedValue({
          secure_url: 'https://res.cloudinary.com/test/image.jpg',
        });
        await service.create(IMAGE_DTO as any, MOCK_IMAGE_FILE, makeFieldAgent());
        const data = mockPrisma.competitorReport.create.mock.calls[0][0].data;
        expect(data.mediaUrl).toBe('https://res.cloudinary.com/test/image.jpg');
      });
    });

    describe('VIDEO reports with file upload', () => {
      it('uploads video with video resourceType', async () => {
        await service.create(VIDEO_DTO as any, MOCK_VIDEO_FILE, makeFieldAgent());
        const [, , options] = mockCloudinary.uploadBuffer.mock.calls[0];
        expect(options.resourceType).toBe('video');
      });
    });

    describe('PDF reports with file upload', () => {
      it('uploads PDF with raw resourceType', async () => {
        await service.create(PDF_DTO as any, MOCK_PDF_FILE, makeFieldAgent());
        const [, , options] = mockCloudinary.uploadBuffer.mock.calls[0];
        expect(options.resourceType).toBe('raw');
      });
    });

    describe('all tiers', () => {
      it('Tier 1 can submit a report', async () => {
        await expect(
          service.create(TEXT_DTO as any, undefined, makeFieldAgent('TIER1')),
        ).resolves.not.toThrow();
      });

      it('Tier 3 can submit a report', async () => {
        await expect(
          service.create(TEXT_DTO as any, undefined, makeFieldAgent('TIER3')),
        ).resolves.not.toThrow();
      });

      it('Tier 4 can submit a report', async () => {
        await expect(
          service.create(TEXT_DTO as any, undefined, makeFieldAgent('TIER4')),
        ).resolves.not.toThrow();
      });
    });

    describe('access control', () => {
      it('throws ForbiddenException for Sales Head', async () => {
        await expect(
          service.create(TEXT_DTO as any, undefined, makeSalesHead()),
        ).rejects.toThrow(ForbiddenException);
        expect(mockPrisma.competitorReport.create).not.toHaveBeenCalled();
      });

      it('throws ForbiddenException for System Admin', async () => {
        await expect(
          service.create(TEXT_DTO as any, undefined, makeAdmin()),
        ).rejects.toThrow(ForbiddenException);
      });

      it('throws BadRequestException when region is missing from token', async () => {
        const noRegionAgent = { ...makeFieldAgent(), region: undefined } as any;
        await expect(
          service.create(TEXT_DTO as any, undefined, noRegionAgent),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('stored fields', () => {
      it('stores submittedById from requester sub', async () => {
        await service.create(TEXT_DTO as any, undefined, makeFieldAgent());
        const data = mockPrisma.competitorReport.create.mock.calls[0][0].data;
        expect(data.submittedById).toBe('agent-id');
      });

      it('stores region from requester token', async () => {
        await service.create(TEXT_DTO as any, undefined, makeFieldAgent());
        const data = mockPrisma.competitorReport.create.mock.calls[0][0].data;
        expect(data.region).toBe(Region.SOUTH_WEST);
      });

      it('stores state as null (no state source at submission time)', async () => {
        await service.create(TEXT_DTO as any, undefined, makeFieldAgent());
        const data = mockPrisma.competitorReport.create.mock.calls[0][0].data;
        expect(data.state).toBeNull();
      });
    });
  });

  // ── findAll() ──────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('field staff see only their own reports', async () => {
      await service.findAll({}, makeFieldAgent());
      const where = mockPrisma.competitorReport.findMany.mock.calls[0][0].where;
      expect(where.submittedById).toBe('agent-id');
    });

    it('Sales Head sees all reports — no submittedById filter', async () => {
      await service.findAll({}, makeSalesHead());
      const where = mockPrisma.competitorReport.findMany.mock.calls[0][0].where;
      expect(where.submittedById).toBeUndefined();
    });

    it('System Admin sees all reports', async () => {
      await service.findAll({}, makeAdmin());
      const where = mockPrisma.competitorReport.findMany.mock.calls[0][0].where;
      expect(where.submittedById).toBeUndefined();
    });

    it('applies region filter when provided', async () => {
      await service.findAll({ region: Region.NORTH_WEST }, makeSalesHead());
      const where = mockPrisma.competitorReport.findMany.mock.calls[0][0].where;
      expect(where.region).toBe(Region.NORTH_WEST);
    });

    it('applies tag filter when provided', async () => {
      await service.findAll({ tag: 'pricing' }, makeSalesHead());
      const where = mockPrisma.competitorReport.findMany.mock.calls[0][0].where;
      expect(where.tags).toEqual({ has: 'pricing' });
    });

    it('applies date from filter when provided', async () => {
      await service.findAll({ from: '2026-07-01' }, makeSalesHead());
      const where = mockPrisma.competitorReport.findMany.mock.calls[0][0].where;
      expect(where.createdAt?.gte).toBeInstanceOf(Date);
    });

    it('applies date to filter when provided', async () => {
      await service.findAll({ to: '2026-07-31' }, makeSalesHead());
      const where = mockPrisma.competitorReport.findMany.mock.calls[0][0].where;
      expect(where.createdAt?.lte).toBeInstanceOf(Date);
    });

    it('applies no date filter when neither from nor to is provided', async () => {
      await service.findAll({}, makeSalesHead());
      const where = mockPrisma.competitorReport.findMany.mock.calls[0][0].where;
      expect(where.createdAt).toBeUndefined();
    });

    it('orders by createdAt descending', async () => {
      await service.findAll({}, makeSalesHead());
      const orderBy = mockPrisma.competitorReport.findMany.mock.calls[0][0].orderBy;
      expect(orderBy).toEqual({ createdAt: 'desc' });
    });

    it('caps results at 200', async () => {
      await service.findAll({}, makeSalesHead());
      const take = mockPrisma.competitorReport.findMany.mock.calls[0][0].take;
      expect(take).toBe(200);
    });
  });

  // ── findById() ─────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns the report when requester is the submitter', async () => {
      const result = await service.findById('report-id', makeFieldAgent());
      expect(result).toEqual(REPORT_STUB);
    });

    it('Sales Head can view any report regardless of submitter', async () => {
      mockPrisma.competitorReport.findUnique.mockResolvedValue({
        ...REPORT_STUB, submittedById: 'someone-else',
      });
      await expect(service.findById('report-id', makeSalesHead())).resolves.not.toThrow();
    });

    it('System Admin can view any report', async () => {
      mockPrisma.competitorReport.findUnique.mockResolvedValue({
        ...REPORT_STUB, submittedById: 'someone-else',
      });
      await expect(service.findById('report-id', makeAdmin())).resolves.not.toThrow();
    });

    it('throws ForbiddenException when field agent views another agent\'s report', async () => {
      mockPrisma.competitorReport.findUnique.mockResolvedValue({
        ...REPORT_STUB, submittedById: 'other-agent',
      });
      await expect(service.findById('report-id', makeFieldAgent()))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.competitorReport.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id', makeAdmin()))
        .rejects.toThrow(NotFoundException);
    });
  });
});