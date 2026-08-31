// src/modules/location-targets/location-target.service.ts
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type {
  SetLocationTargetDto,
  LocationTargetQueryDto,
} from './dto/location-target.dto';

const WRITE_TIERS = ['TIER5_SALES_SUPPORT', 'TIER5_SALES_HEAD'];

const TARGET_SELECT = {
  id:          true,
  locationId:  true,
  location:    { select: { name: true, state: true, region: true } },
  category:    true,
  periodMonth: true,
  targetValue: true,
  createdById: true,
  createdBy:   { select: { fullName: true, employeeRef: true } },
  createdAt:   true,
  updatedAt:   true,
} as const;

@Injectable()
export class LocationTargetService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Set (upsert) ──────────────────────────────────────────────────────────
  // Uses upsert on the unique constraint (locationId, category, periodMonth)
  // so that setting a target twice updates rather than duplicating the row.
  // "Setting a target" and "re-adjusting a target" are the same operation
  // from the user's perspective — one clear action, one clear result.

  async set(dto: SetLocationTargetDto, requester: JwtPayload) {
    this.assertWriteAccess(requester);

    const locationExists = await this.prisma.location.findUnique({
      where: { id: dto.locationId }, select: { id: true },
    });
    if (!locationExists) {
      throw new NotFoundException(`Location ${dto.locationId} not found`);
    }

    return this.prisma.locationTarget.upsert({
      where: {
        locationId_category_periodMonth: {
          locationId:  dto.locationId,
          category:    dto.category,
          periodMonth: dto.periodMonth,
        },
      },
      create: {
        locationId:  dto.locationId,
        category:    dto.category,
        periodMonth: dto.periodMonth,
        targetValue: dto.targetValue,
        createdById: requester.sub,
      },
      update: {
        targetValue: dto.targetValue,
      },
      select: TARGET_SELECT,
    });
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findAll(query: LocationTargetQueryDto) {
    return this.prisma.locationTarget.findMany({
      where: {
        ...(query.locationId  ? { locationId:  query.locationId }  : {}),
        ...(query.category    ? { category:    query.category }    : {}),
        ...(query.periodMonth ? { periodMonth: query.periodMonth } : {}),
      },
      select:  TARGET_SELECT,
      orderBy: [{ periodMonth: 'desc' }, { location: { name: 'asc' } }],
    });
  }

  async findById(id: string) {
    const target = await this.prisma.locationTarget.findUnique({
      where: { id }, select: TARGET_SELECT,
    });
    if (!target) throw new NotFoundException(`Location target ${id} not found`);
    return target;
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async remove(id: string, requester: JwtPayload) {
    this.assertWriteAccess(requester);
    const target = await this.prisma.locationTarget.findUnique({
      where: { id }, select: { id: true },
    });
    if (!target) throw new NotFoundException(`Location target ${id} not found`);

    await this.prisma.locationTarget.delete({ where: { id } });
    return { message: 'Location target deleted' };
  }

  // ── Helper ─────────────────────────────────────────────────────────────────

  private assertWriteAccess(requester: JwtPayload): void {
    if (!WRITE_TIERS.includes(requester.tier as string)) {
      throw new ForbiddenException(
        'Only System Admin and Sales Head can manage location targets',
      );
    }
  }
}