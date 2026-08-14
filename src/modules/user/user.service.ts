// src/modules/user/user.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserTier } from '@prisma/client';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { FindUserToLinkDto } from './dto/add-direct-report.dto';

// Fields safe to expose — never include passwordHash
const USER_SAFE_SELECT = {
  id: true,
  employeeRef: true,
  fullName: true,
  email: true,
  phone: true,
  role: true,
  roleLabel: true,
  tier: true,
  team: true,
  region: true,
  state: true,
  reportsToId: true,
  dateOfBirth: true,
  profilePictureUrl: true,
  idCardUrl: true,
  annualTargets: true,
  isActive: true,
  accountOrigin: true,
  warehouseLocation: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Full org-tier hierarchy, low to high — this is the PRE-EXISTING constant
// (was an inline array inside getLowerTiers). Hoisted to module scope so
// the new one-level-down helper below can reuse it instead of declaring a
// second, slightly different hierarchy list. One ordered list, two
// derived views of it (getLowerTiers = "everyone beneath me",
// directReportTier = "exactly one step beneath me").
const TIER_HIERARCHY: UserTier[] = [
  UserTier.TIER1,
  UserTier.TIER2,
  UserTier.TIER3,
  UserTier.TIER4,
  UserTier.TIER5_SALES_HEAD,
  UserTier.TIER5_SYSTEM_ADMIN,
  UserTier.TIER6_GM,
];

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    @InjectQueue('notifications') private readonly notifyQueue: Queue,
  ) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SAFE_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findProfile(requesterId: string) {
    return this.findById(requesterId);
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    profilePicture?: Express.Multer.File,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, employeeRef: true, roleLabel: true },
    });
    if (!user) throw new NotFoundException('User not found');

    let profilePictureUrl: string | undefined;
    if (profilePicture) {
      const result = await this.cloudinary.uploadBuffer(
        profilePicture.buffer,
        'profiles',
        { publicId: `${user.employeeRef}-${Date.now()}` },
      );
      profilePictureUrl = result.secure_url;
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.phone ? { phone: dto.phone } : {}),
        ...(profilePictureUrl ? { profilePictureUrl } : {}),
      },
      select: USER_SAFE_SELECT,
    });

    // ── Regenerate ID card whenever profile picture is updated ────────────────
    // This ensures the card always reflects the user's latest photo.
    if (profilePictureUrl) {
      void this.notifyQueue.add(
        'generate-id-card',
        { userId, roleLabel: user.roleLabel },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    }

    return updated;
  }

  /** Stores the generated ID card URL (called by the ID card job worker). */
  async saveIdCardUrl(userId: string, idCardUrl: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { idCardUrl },
    });
  }

  async findVisible(requester: JwtPayload) {
    const adminTiers: UserTier[] = [
      UserTier.TIER5_SALES_HEAD,
      UserTier.TIER5_SYSTEM_ADMIN,
      UserTier.TIER6_GM,
    ];

    if (adminTiers.includes(requester.tier)) {
      return this.prisma.user.findMany({
        select: USER_SAFE_SELECT,
        orderBy: { createdAt: 'desc' },
      });
    }

    const visibleTiers = this.getLowerTiers(requester.tier);
    return this.prisma.user.findMany({
      where: {
        team: requester.team,
        tier: { in: [...visibleTiers, requester.tier] },
      },
      select: USER_SAFE_SELECT,
      orderBy: { fullName: 'asc' },
    });
  }

  // ── Direct-report linking ───────────────────────────────────────────────
  // Added for Phase 3 target cascading: TargetAssignmentService needs to
  // know "who reports to whom" via User.reportsToId, and that field must
  // be set deliberately by the MANAGER (not self-selected at registration
  // — letting an open self-registration form claim an arbitrary manager
  // would let anyone attach themselves to anyone's team).

  /**
   * Searches for a user by employeeRef, phone, or email — the lookup step
   * a manager performs before linking someone as a direct report. Returns
   * minimal identifying fields only; this is "find the right person",
   * not a profile view.
   */
  async findUserToLink(query: FindUserToLinkDto) {
    if (!query.employeeRef && !query.phone && !query.email) {
      throw new BadRequestException(
        'Provide at least one of employeeRef, phone, or email to search',
      );
    }

    const orConditions = [
      query.employeeRef ? { employeeRef: query.employeeRef } : null,
      query.phone ? { phone: query.phone } : null,
      query.email ? { email: query.email.toLowerCase().trim() } : null,
    ].filter((c): c is NonNullable<typeof c> => c !== null);

    const user = await this.prisma.user.findFirst({
      where: { OR: orConditions },
      select: {
        id: true,
        employeeRef: true,
        fullName: true,
        tier: true,
        reportsToId: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new NotFoundException('No user found matching that identifier');
    }
    return user;
  }

  /**
   * Links `userId` as a direct report of the requester.
   *
   * Validates:
   *  - requester's tier actually has a tier beneath it (TIER1 has none)
   *  - the target is EXACTLY one tier below the requester — not "any
   *    lower tier" — the cascade only ever moves one step at a time, so
   *    a Tier4 can claim a Tier3 but not a Tier1 directly
   *  - the target isn't already linked to a different manager (silent
   *    re-parenting is not allowed; that needs an explicit transfer)
   */
  async addDirectReport(userId: string, requester: JwtPayload) {
    const expectedTier = this.getDirectReportTier(requester.tier);
    if (!expectedTier) {
      throw new ForbiddenException(
        `${requester.tier} has no direct-report tier beneath it`,
      );
    }

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        tier: true,
        team: true,
        isActive: true,
        reportsToId: true,
      },
    });
    if (!target) throw new NotFoundException(`User ${userId} not found`);
    if (!target.isActive) {
      throw new BadRequestException(`User "${target.fullName}" is deactivated`);
    }
    if (target.tier !== expectedTier) {
      throw new BadRequestException(
        `Expected a ${expectedTier} user but ${target.fullName} is ${target.tier}`,
      );
    }

    // Team must match — a RADIANT Sales Head cannot manage a BRIGHT agent
    // and vice versa. Each team operates as an independent org unit.
    if (target.team !== requester.team) {
      throw new BadRequestException(
        `Team mismatch: you are on team ${requester.team} but ` +
        `${target.fullName} is on team ${target.team}. ` +
        `A manager can only link agents within their own team.`,
      );
    }

    if (target.reportsToId && target.reportsToId !== requester.sub) {
      throw new BadRequestException(
        `${target.fullName} already reports to someone else. ` +
          `Remove that link before assigning a new manager.`,
      );
    }
    if (target.reportsToId === requester.sub) {
      throw new BadRequestException(`${target.fullName} already reports to you`);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { reportsToId: requester.sub },
      select: USER_SAFE_SELECT,
    });

    this.logger.log(`${target.fullName} (${target.id}) now reports to ${requester.sub}`);
    return updated;
  }

  /** Removes the reporting link — used before re-assigning to a new manager. */
  async removeDirectReport(userId: string, requester: JwtPayload) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, reportsToId: true },
    });
    if (!target) throw new NotFoundException(`User ${userId} not found`);

    if (target.reportsToId !== requester.sub) {
      throw new ForbiddenException(
        `${target.fullName} does not report to you`,
      );
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { reportsToId: null },
      select: USER_SAFE_SELECT,
    });
  }

  /** Returns the requester's direct reports — feeds "my team" views. */
  async getMyDirectReports(requester: JwtPayload) {
    return this.prisma.user.findMany({
      where: { reportsToId: requester.sub },
      select: USER_SAFE_SELECT,
      orderBy: { fullName: 'asc' },
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private getLowerTiers(tier: UserTier): UserTier[] {
    const idx = TIER_HIERARCHY.indexOf(tier);
    return idx <= 0 ? [] : TIER_HIERARCHY.slice(0, idx);
  }

  /**
   * Returns the tier exactly one step below `tier` in the field-staff
   * cascade (TIER5_SALES_HEAD -> TIER4 -> TIER3 -> TIER2 -> TIER1), or
   * null if there is no tier below (TIER1) or `tier` sits outside the
   * cascade entirely (SYSTEM_ADMIN, WAREHOUSE_ADMIN, GM have no direct
   * reports in this hierarchy — they don't participate in target cascading).
   *
   * Deliberately a NARROWER list than TIER_HIERARCHY: that array answers
   * "who can this tier see," this answers "who can this tier claim as a
   * direct report for target-cascading purposes" — System Admin can SEE
   * everyone but doesn't sit in the Sales-Head-down reporting chain.
   */
  private getDirectReportTier(tier: UserTier): UserTier | null {
    const cascade: UserTier[] = [
      UserTier.TIER5_SALES_HEAD,
      UserTier.TIER4,
      UserTier.TIER3,
      UserTier.TIER2,
      UserTier.TIER1,
    ];
    const idx = cascade.indexOf(tier);
    if (idx === -1 || idx === cascade.length - 1) return null;
    return cascade[idx + 1];
  }

  // ── FCM token registration ────────────────────────────────────────────────────

  /**
   * Called by the mobile app after every login to register the device's
   * FCM push token. Without this, push notifications cannot reach the user.
   * The token changes when the app is reinstalled, so always call this on login.
   */
  async registerFcmToken(userId: string, fcmToken: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data:  { fcmToken },
    });
    this.logger.log(`FCM token registered for user ${userId}`);
  }

  /**
   * Called when the user logs out — removes the token so push notifications
   * stop reaching this device after logout.
   */
  async unregisterFcmToken(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data:  { fcmToken: null },
    });
    this.logger.log(`FCM token cleared for user ${userId}`);
  }
}