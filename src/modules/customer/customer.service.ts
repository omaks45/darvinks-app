
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Region } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { resolveRegion } from '@common/utils/region.util';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type {
  CreateCustomerDto,
  UpdateCustomerDto,
  CustomerQueryDto,
  OutOfRegionRequestDto,
} from './dto/customer.dto';

const CUSTOMER_SELECT = {
  id:              true,
  businessName:    true,
  address:         true,
  mobilePhone:     true,
  whatsApp:        true,
  email:           true,
  cacNumber:       true,
  contactPerson:   true,
  contactPhone:    true,
  contactPosition: true,
  region:          true,
  state:           true,
  isActive:        true,
  balanceKobo:     true,
  ownerId:         true,
  createdAt:       true,
  updatedAt:       true,
} as const;

// Tiers allowed to register customers (field staff Tiers 1–4)
const FIELD_TIERS = ['TIER1', 'TIER2', 'TIER3', 'TIER4'];

// Tiers with full admin access across all customers
const ADMIN_TIERS = [
  'TIER5_SYSTEM_ADMIN',
  'TIER5_SALES_HEAD',
  'TIER6_GM',
  'WAREHOUSE_ADMIN',
];

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(dto: CreateCustomerDto, requester: JwtPayload) {
    const region = resolveRegion(dto.state, requester.team);

    // Check no duplicate phone for this customer
    const duplicate = await this.prisma.customer.findFirst({
      where: { mobilePhone: dto.mobilePhone },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        `A customer with phone ${dto.mobilePhone} already exists`,
      );
    }

    // Field staff can only create customers in their own region
    if (
      FIELD_TIERS.includes(requester.tier as string) &&
      region !== requester.region
    ) {
      throw new ForbiddenException(
        'You can only register customers in your own region. ' +
        'Submit an out-of-region request for customers outside your region.',
      );
    }

    const customer = await this.prisma.customer.create({
      data: {
        businessName:    dto.businessName,
        address:         dto.address,
        mobilePhone:     dto.mobilePhone,
        whatsApp:        dto.whatsApp  ?? null,
        email:           dto.email     ?? null,
        cacNumber:       dto.cacNumber ?? null,
        contactPerson:   dto.contactPerson,
        contactPhone:    dto.contactPhone,
        contactPosition: dto.contactPosition ?? null,
        region,
        state:           dto.state.toLowerCase().trim(),
        ownerId:         requester.sub,
      },
      select: CUSTOMER_SELECT,
    });

    this.logger.log(
      `Customer created: ${customer.businessName} (${customer.region}) by ${requester.sub}`,
    );
    return customer;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findAll(query: CustomerQueryDto, requester: JwtPayload) {
    const { region, state, isActive } = query;

    // Admin tiers see all customers; field staff see only their region
    const regionFilter = ADMIN_TIERS.includes(requester.tier as string)
      ? (region ?? undefined)
      : requester.region ?? undefined;

    return this.prisma.customer.findMany({
      where: {
        ...(regionFilter !== undefined ? { region: regionFilter as Region } : {}),
        ...(state      ? { state: state.toLowerCase().trim() } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
      select:  CUSTOMER_SELECT,
      orderBy: { businessName: 'asc' },
    });
  }

  async findById(id: string, requester: JwtPayload) {
    const customer = await this.prisma.customer.findUnique({
      where:  { id },
      select: CUSTOMER_SELECT,
    });
    if (!customer) throw new NotFoundException(`Customer ${id} not found`);

    this.assertCanAccess(customer, requester);
    return customer;
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateCustomerDto, requester: JwtPayload) {
    const customer = await this.assertExists(id);
    this.assertCanModify(customer, requester);

    // If phone is changing, check uniqueness
    if (dto.mobilePhone && dto.mobilePhone !== customer.mobilePhone) {
      const dup = await this.prisma.customer.findFirst({
        where:  { mobilePhone: dto.mobilePhone },
        select: { id: true },
      });
      if (dup) {
        throw new ConflictException(
          `A customer with phone ${dto.mobilePhone} already exists`,
        );
      }
    }

    // Recalculate region if state changes
    let region: Region | undefined;
    if (dto.state) {
      region = resolveRegion(dto.state, requester.team);
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.businessName    !== undefined ? { businessName:    dto.businessName }              : {}),
        ...(dto.address         !== undefined ? { address:         dto.address }                   : {}),
        ...(dto.mobilePhone     !== undefined ? { mobilePhone:     dto.mobilePhone }               : {}),
        ...(dto.whatsApp        !== undefined ? { whatsApp:        dto.whatsApp }                  : {}),
        ...(dto.email           !== undefined ? { email:           dto.email }                     : {}),
        ...(dto.cacNumber       !== undefined ? { cacNumber:       dto.cacNumber }                 : {}),
        ...(dto.contactPerson   !== undefined ? { contactPerson:   dto.contactPerson }             : {}),
        ...(dto.contactPhone    !== undefined ? { contactPhone:    dto.contactPhone }               : {}),
        ...(dto.contactPosition !== undefined ? { contactPosition: dto.contactPosition }           : {}),
        ...(dto.state           !== undefined ? { state: dto.state.toLowerCase().trim(), region }  : {}),
      },
      select: CUSTOMER_SELECT,
    });

    this.logger.log(`Customer updated: ${updated.businessName} by ${requester.sub}`);
    return updated;
  }

  // ── Deactivate / Reactivate ────────────────────────────────────────────────

  async deactivate(id: string, requester: JwtPayload) {
    const customer = await this.assertExists(id);
    this.assertCanModify(customer, requester);

    if (!customer.isActive) {
      throw new ConflictException('Customer is already deactivated');
    }

    return this.prisma.customer.update({
      where:  { id },
      data:   { isActive: false },
      select: CUSTOMER_SELECT,
    });
  }

  async reactivate(id: string, requester: JwtPayload) {
    const customer = await this.assertExists(id);
    this.assertCanModify(customer, requester);

    if (customer.isActive) {
      throw new ConflictException('Customer is already active');
    }

    return this.prisma.customer.update({
      where:  { id },
      data:   { isActive: true },
      select: CUSTOMER_SELECT,
    });
  }

  // ── Out-of-region requests ─────────────────────────────────────────────────

  async requestOutOfRegion(
    customerId: string,
    dto: OutOfRegionRequestDto,
    requester: JwtPayload,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where:  { id: customerId },
      select: { id: true, region: true, businessName: true },
    });
    if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);

    // Only meaningful for field staff in a different region
    if (customer.region === requester.region) {
      throw new BadRequestException(
        'Customer is already in your region — no request needed',
      );
    }

    // Check for existing pending request
    const existing = await this.prisma.outOfRegionRequest.findFirst({
      where:  { customerId, requestedBy: requester.sub, status: 'PENDING' },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'You already have a pending out-of-region request for this customer',
      );
    }

    const oor = await this.prisma.outOfRegionRequest.create({
      data: {
        customerId,
        requestedBy: requester.sub,
        note:        dto.note ?? null,
        status:      'PENDING',
      },
      select: {
        id:         true,
        customerId: true,
        status:     true,
        note:       true,
        createdAt:  true,
      },
    });

    this.logger.log(
      `OOR request created for customer ${customerId} by ${requester.sub}`,
    );
    return oor;
  }

  async approveOutOfRegion(requestId: string, requester: JwtPayload) {
    // Only admins and sales heads can approve
    if (
      !ADMIN_TIERS.includes(requester.tier as string) &&
      requester.tier !== 'TIER4'
    ) {
      throw new ForbiddenException(
        'Only Sales Head, ZSM, or System Admin can approve out-of-region requests',
      );
    }

    const oor = await this.prisma.outOfRegionRequest.findUnique({
      where:  { id: requestId },
      select: { id: true, status: true },
    });
    if (!oor) throw new NotFoundException(`Request ${requestId} not found`);
    if (oor.status !== 'PENDING') {
      throw new ConflictException(`Request is already ${oor.status.toLowerCase()}`);
    }

    return this.prisma.outOfRegionRequest.update({
      where: { id: requestId },
      data:  { approvedBy: requester.sub, status: 'APPROVED' },
      select: {
        id:         true,
        customerId: true,
        status:     true,
        approvedBy: true,
        updatedAt:  true,
      },
    });
  }

  /**
   * Returns the open approval queue for Out-of-Region requests — feeds the
   * dashboard's "things awaiting your action" widget. Mirrors the exact
   * same access rule as approveOutOfRegion() (ADMIN_TIERS + TIER4): anyone
   * who CAN approve a request should also be able to SEE the queue of
   * requests waiting on them, and nobody should see a queue they have no
   * power to act on.
   */
  async findPendingOutOfRegionRequests(requester: JwtPayload) {
    if (
      !ADMIN_TIERS.includes(requester.tier as string) &&
      requester.tier !== 'TIER4'
    ) {
      throw new ForbiddenException(
        'Only Sales Head, ZSM, or System Admin can view the approval queue',
      );
    }

    return this.prisma.outOfRegionRequest.findMany({
      where:  { status: 'PENDING' },
      select: {
        id:          true,
        customerId:  true,
        customer:    { select: { businessName: true, region: true } },
        requestedBy: true,
        requester:   { select: { fullName: true, employeeRef: true } },
        note:        true,
        createdAt:   true,
      },
      orderBy: { createdAt: 'asc' }, // oldest pending first — first in, first reviewed
      take:    100,
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async assertExists(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where:  { id },
      select: { id: true, ownerId: true, region: true,
                isActive: true, mobilePhone: true, businessName: true },
    });
    if (!customer) throw new NotFoundException(`Customer ${id} not found`);
    return customer;
  }

  private assertCanAccess(
    customer: { ownerId: string; region: Region },
    requester: JwtPayload,
  ) {
    if (ADMIN_TIERS.includes(requester.tier as string)) return;
    if (customer.region === requester.region) return;
    throw new ForbiddenException('You do not have access to this customer');
  }

  private assertCanModify(
    customer: { ownerId: string },
    requester: JwtPayload,
  ) {
    if (ADMIN_TIERS.includes(requester.tier as string)) return;
    if (customer.ownerId === requester.sub) return;
    throw new ForbiddenException(
      'You can only modify customers you registered',
    );
  }
}