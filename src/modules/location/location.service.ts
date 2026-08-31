import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type {
  CreateLocationDto,
  LocationQueryDto,
} from './dto/location.dto';
import type { UpdateLocationDto } from './dto/update-location.dto';

// Write access: System Admin + Sales Head can create/edit locations
// Read access: all authenticated users (needed when assigning customers
// to a location, and when the analytics deck is built per-location)
const WRITE_TIERS = ['TIER5_SALES_SUPPORT', 'TIER5_SALES_HEAD'];

const LOCATION_SELECT = {
  id:        true,
  name:      true,
  state:     true,
  region:    true,
  createdAt: true,
  _count:    { select: { customers: true } },
} as const;

@Injectable()
export class LocationService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(dto: CreateLocationDto, requester: JwtPayload) {
    this.assertWriteAccess(requester);

    const normalizedState = dto.state.trim().toLowerCase();

    const existing = await this.prisma.location.findUnique({
      where: { name_state: { name: dto.name, state: normalizedState } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        `A location named "${dto.name}" already exists in ${dto.state}`,
      );
    }

    return this.prisma.location.create({
      data: {
        name:   dto.name,
        state:  normalizedState,
        region: dto.region,
      },
      select: LOCATION_SELECT,
    });
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findAll(query: LocationQueryDto) {
    return this.prisma.location.findMany({
      where: {
        ...(query.region ? { region: query.region } : {}),
        ...(query.state  ? { state: query.state.trim().toLowerCase() } : {}),
      },
      select:  LOCATION_SELECT,
      orderBy: [{ region: 'asc' }, { state: 'asc' }, { name: 'asc' }],
    });
  }

  async findById(id: string) {
    const location = await this.prisma.location.findUnique({
      where:  { id },
      select: {
        ...LOCATION_SELECT,
        customers: {
          where:   { isActive: true },
          select:  { id: true, businessName: true },
          orderBy: { businessName: 'asc' },
          take:    50,
        },
      },
    });
    if (!location) throw new NotFoundException(`Location ${id} not found`);
    return location;
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateLocationDto, requester: JwtPayload) {
    this.assertWriteAccess(requester);
    await this.assertExists(id);

    return this.prisma.location.update({
      where:  { id },
      data:   {
        ...(dto.name   ? { name: dto.name }     : {}),
        ...(dto.region ? { region: dto.region } : {}),
      },
      select: LOCATION_SELECT,
    });
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  // Hard delete is acceptable here: Location is reference data (like a Product),
  // not a transactional record. But guard against deleting a location that
  // still has active customers or existing targets — orphaning those would
  // break the analytics rollup.

  async remove(id: string, requester: JwtPayload) {
    this.assertWriteAccess(requester);

    const location = await this.prisma.location.findUnique({
      where:  { id },
      select: {
        id: true,
        _count: { select: { customers: true, targets: true } },
      },
    });
    if (!location) throw new NotFoundException(`Location ${id} not found`);

    if (location._count.customers > 0) {
      throw new ConflictException(
        `Cannot delete a location that has ${location._count.customers} linked customer(s). ` +
        'Reassign or unlink the customers first.',
      );
    }
    if (location._count.targets > 0) {
      throw new ConflictException(
        `Cannot delete a location that has ${location._count.targets} target(s). ` +
        'Remove the targets first.',
      );
    }

    await this.prisma.location.delete({ where: { id } });
    return { message: 'Location deleted successfully' };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private assertWriteAccess(requester: JwtPayload): void {
    if (!WRITE_TIERS.includes(requester.tier as string)) {
      throw new ForbiddenException(
        'Only System Admin and Sales Head can manage locations',
      );
    }
  }

  private async assertExists(id: string): Promise<void> {
    const exists = await this.prisma.location.findUnique({
      where: { id }, select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Location ${id} not found`);
  }
}