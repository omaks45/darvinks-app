// src/modules/customers/customer.service.ts
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
import { GoogleMapsService } from '@common/google/google-map.service';
import { resolveRegion, resolveActualRegionForState } from '@common/utils/region.util';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type {
  CreateCustomerDto,
  UpdateCustomerDto,
  CustomerQueryDto,
  OutOfRegionRequestDto,
} from './dto/customer.dto';

const CUSTOMER_SELECT = {
  id:                    true,
  businessName:          true,
  address:               true,
  mobilePhone:           true,
  whatsApp:              true,
  email:                 true,
  cacNumber:             true,
  contactPerson:         true,
  contactPhone:          true,
  contactPosition:       true,
  region:                true,
  state:                 true,
  locationId:            true,
  location:              { select: { name: true, state: true } },
  customerType:          true,
  secondaryCustomerType: true,
  isActive:              true,
  balanceKobo:           true,
  ownerId:               true,
  createdAt:             true,
  updatedAt:             true,
} as const;

// Tiers allowed to register customers (field staff Tiers 1–4)
const FIELD_TIERS = ['TIER1', 'TIER2', 'TIER3', 'TIER4'];

// Tiers with full admin access across all customers
const ADMIN_TIERS = [
  'TIER5_SALES_SUPPORT',
  'TIER5_FIELD_SUPPORT',
  'TIER5_SALES_HEAD',
  'TIER6_GM',
  'WAREHOUSE_ADMIN',
];

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly maps:   GoogleMapsService,
  ) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(dto: CreateCustomerDto, requester: JwtPayload) {
    // ── Step 1: Resolve address and state ────────────────────────────────────
    // Field tiers (1–4) must be physically present at the KD's location —
    // they provide GPS coordinates from their device and the server geocodes
    // them to a human-readable address. The mobile app handles GPS capture
    // transparently; the agent never sees or types the lat/lng numbers.
    //
    // Admin tiers (Sales Head, System Admin, GM, Warehouse Admin) are working
    // from an office and type the address manually — they are not expected
    // to be physically present at the customer's location when registering.

    let resolvedAddress: string;
    let resolvedState: string;

    const isFieldTier = FIELD_TIERS.includes(requester.tier as string);

    if (isFieldTier) {
      if (dto.latitude === undefined || dto.longitude === undefined) {
        throw new BadRequestException(
          'Field staff must provide GPS coordinates (latitude and longitude) ' +
          'to register a customer. You must be physically present at the ' +
          'KD\'s location so the address can be confirmed by GPS.',
        );
      }

      // Reverse-geocode the GPS position — never throws, falls back to
      // coordinate string if Maps is unavailable (same principle as
      // AttendanceService — never block a field operation due to Maps outage)
      const geo = await this.maps.reverseGeocode(dto.latitude, dto.longitude);
      resolvedAddress = geo.address;

      // Use geocoded state if available; fall back to dto.state if the Maps
      // API returned no state component (edge case: very rural coordinates)
      if (geo.state) {
        resolvedState = geo.state.toLowerCase().trim();
      } else if (dto.state) {
        resolvedState = dto.state.toLowerCase().trim();
      } else {
        throw new BadRequestException(
          'Could not determine the state from your GPS location. ' +
          'Please also provide the state field as a fallback.',
        );
      }

      // ── GPS region validation ─────────────────────────────────────────────
      // Validate that the GPS coordinates actually place the agent in their
      // own region. We must use resolveActualRegionForState() here — NOT
      // resolveRegion(state, agent.team) — because the latter would silently
      // fall back to the agent's team default for any unrecognised state,
      // making it possible for a NORTH_BRIGHT agent to register a Lagos KD
      // (Lagos is SOUTH_WEST under RADIANT, but resolveRegion('lagos', BRIGHT)
      // would return NORTH_BRIGHT, making the region check pass incorrectly).
      const trueRegionForState = resolveActualRegionForState(resolvedState);
      if (trueRegionForState && trueRegionForState !== requester.region) {
        throw new ForbiddenException(
          `Your GPS location is in ${resolvedState} (${trueRegionForState}), ` +
          `but your account is assigned to ${requester.region}. ` +
          `You must be physically present in your own region to register a customer. ` +
          `If this KD is outside your region, submit an out-of-region request instead.`,
        );
      }
    } else {
      // Admin tiers — address and state are required text fields
      if (!dto.address) {
        throw new BadRequestException('address is required');
      }
      if (!dto.state) {
        throw new BadRequestException('state is required');
      }
      resolvedAddress = dto.address;
      resolvedState   = dto.state.toLowerCase().trim();
    }

    // ── Step 2: Derive region from state ─────────────────────────────────────
    const region = resolveRegion(resolvedState, requester.team as any);

    // ── Step 3: Duplicate phone check ────────────────────────────────────────
    const duplicate = await this.prisma.customer.findFirst({
      where:  { mobilePhone: dto.mobilePhone },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        `A customer with phone ${dto.mobilePhone} already exists`,
      );
    }

    // ── Step 4: Region scope check ───────────────────────────────────────────
    // GPS path (field tiers): region was already validated above via
    // resolveActualRegionForState() — the GPS check is stricter and fires
    // before we reach this point, so no duplicate check is needed here.
    //
    // Manual address path (admin tiers): admins can create customers in any
    // region — they are not field-scoped. No check needed here either.
    // This step is intentionally left as a no-op; kept for documentation clarity.

    // ── Step 5: Validate locationId if provided ──────────────────────────────
    // Location must exist AND be in the same state as the customer —
    // an agent should not assign a Lagos customer to an Ondo location.
    if (dto.locationId) {
      const location = await this.prisma.location.findUnique({
        where:  { id: dto.locationId },
        select: { id: true, state: true, name: true },
      });
      if (!location) {
        throw new NotFoundException(`Location ${dto.locationId} not found`);
      }
      if (location.state !== resolvedState) {
        throw new BadRequestException(
          `Location "${location.name}" is in ${location.state}, but this ` +
          `customer's state is ${resolvedState}. ` +
          `The location must be in the same state as the customer.`,
        );
      }
    }

    // ── Step 6: Create ────────────────────────────────────────────────────────
    // Validate secondaryCustomerType when creating a SECONDARY customer
    if (dto.customerType === 'SECONDARY' && !dto.secondaryCustomerType) {
      throw new BadRequestException(
        'secondaryCustomerType is required when customerType is SECONDARY. ' +
        'Must be one of: SUB_DISTRIBUTOR, WHOLESALER, RETAILER',
      );
    }

    const customer = await this.prisma.customer.create({
      data: {
        businessName:         dto.businessName,
        address:              resolvedAddress,
        mobilePhone:          dto.mobilePhone,
        whatsApp:             dto.whatsApp           ?? null,
        email:                dto.email              ?? null,
        cacNumber:            dto.cacNumber          ?? null,
        contactPerson:        dto.contactPerson,
        contactPhone:         dto.contactPhone,
        contactPosition:      dto.contactPosition    ?? null,
        region,
        state:                resolvedState,
        locationId:           dto.locationId         ?? null,
        ownerId:              requester.sub,
        customerType:         dto.customerType       ?? 'PRIMARY',
        secondaryCustomerType: dto.secondaryCustomerType ?? null,
      },
      select: CUSTOMER_SELECT,
    });

    this.logger.log(
      `Customer created: ${customer.businessName} (${customer.region}) by ${requester.sub}` +
      (isFieldTier ? ` [GPS address]` : ` [manual address]`),
    );
    return customer;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findAll(query: CustomerQueryDto, requester: JwtPayload) {
    const { region, state, isActive, customerType, secondaryCustomerType } = query as any;

    const isAdmin = ADMIN_TIERS.includes(requester.tier as string);

    return this.prisma.customer.findMany({
      where: {
        // Tier 1–4: only see customers THEY created (ownerId = their own userId)
        // Admin tiers: see all customers, with optional region filter
        ...(!isAdmin ? { ownerId: requester.sub } : {}),
        ...(isAdmin && region ? { region: region as Region } : {}),
        ...(state                 ? { state: state.toLowerCase().trim() } : {}),
        ...(isActive !== undefined ? { isActive }                          : {}),
        ...(customerType          ? { customerType }                       : {}),
        ...(secondaryCustomerType ? { secondaryCustomerType }              : {}),
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
    if (customer.ownerId === requester.sub) return;
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