// src/modules/admin/admin.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { Prisma, Region, Team, UserRole as PrismaUserRole, UserTier } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { MailService } from '@modules/email/email.service';
import { labelFromRole, tierFromRole, UserRole } from '@common/utils/role.utils';
import { generateEmployeeRef } from '@common/utils/region.util';
import type { AppConfig } from '@common/config/app.config';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type { ProvisionUserDto, ProvisionUserResponse } from '../auths/dto/provision-user.dto';
import { PROVISIONABLE_ROLES } from '../auths/dto/provision-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import { CreateInviteDto } from './dto/invite.dto';

// Fields safe to return — passwordHash is never included
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
  warehouseLocation: true,
  accountOrigin: true,
  mustChangePassword: true,
  isActive: true,
  profilePictureUrl: true,
  idCardUrl: true,
  fcmToken: true,
  provisionedById: true,
  dateOfBirth: true,
  annualTargets: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ── Invite chain: maps inviter tier → roles they are allowed to invite ────────
//
// TIER5_SALES_HEAD → TIER4 (Zonal Sales Manager)
// TIER4            → TIER3 (ATSM, TSM)
// TIER3            → TIER2 (Sales Representative, SSR)
// TIER2            → TIER1 (Merchandiser, Promoter, DBSR, VSR)
// TIER5_SALES_SUPPORT → everything (Tier 5+, warehouse) via provisionUser()
//
// Roles listed here must match the UserRole enum values in Prisma.
const FIELD_TIER_INVITE_MAP: Record<string, UserRole[]> = {
  TIER5_SALES_HEAD: [UserRole.ZONAL_SALES_MANAGER],
  TIER4:            [UserRole.ATSM, UserRole.TSM],
  TIER3:            [UserRole.SALES_REPRESENTATIVE, UserRole.SSR],
  TIER2:            [UserRole.MERCHANDISER, UserRole.PROMOTER, UserRole.DBSR, UserRole.VSR],
};

// ── Query DTO (inline — avoids creating a separate file if you prefer) ─────────
export interface FindAllUsersQuery {
  /** Filter by team */
  team?: Team;
  /** Filter by region */
  region?: Region;
  /** Filter by role */
  role?: PrismaUserRole;
  /** Filter by tier */
  tier?: UserTier;
  /** Search by full name, email, or employee ref (case-insensitive) */
  search?: string;
  /** true = active only, false = inactive only, omit = both */
  isActive?: boolean | string;
  /** Page number (default 1) */
  page?: number | string;
  /** Results per page, max 100 (default 20) */
  limit?: number | string;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig>,
    @InjectQueue('notifications') private readonly notifyQueue: Queue,
    private readonly mail: MailService,
  ) {}

  // ─── Provision account ────────────────────────────────────────────────────

  async provisionUser(
    requester: JwtPayload,
    dto: ProvisionUserDto,
  ): Promise<ProvisionUserResponse> {
    // 1. Only System Admin can provision
    if (requester.tier !== 'TIER5_SALES_SUPPORT') {
      throw new ForbiddenException(
        'Only the System Administrator can provision back-office accounts',
      );
    }

    // 2. Validate the role is provisionable (not a field staff role)
    if (!PROVISIONABLE_ROLES.includes(dto.role as any)) {
      throw new BadRequestException(
        `Role ${dto.role} cannot be provisioned. ` +
        `Field staff (Tiers 1–4) must self-register via the mobile app.`,
      );
    }

    // 3. Role-specific field validation
    if (dto.role === UserRole.SALES_HEAD && !dto.team) {
      throw new BadRequestException(
        'A Sales Head must be assigned to a team (BRIGHT or RADIANT)',
      );
    }

    if (dto.role === UserRole.WAREHOUSE_ADMIN && !dto.warehouseLocation) {
      throw new BadRequestException(
        'A Warehouse Administrator must be assigned to a warehouse location',
      );
    }

    // 4. Enforce one Sales Head per team
    if (dto.role === UserRole.SALES_HEAD && dto.team) {
      const existingSH = await this.prisma.user.findFirst({
        where: { role: UserRole.SALES_HEAD, team: dto.team, isActive: true },
        select: { id: true, fullName: true },
      });
      if (existingSH) {
        throw new ConflictException(
          `Team ${dto.team} already has an active Sales Head (${existingSH.fullName}). ` +
          `Deactivate the existing account first if you need to replace them.`,
        );
      }
    }

    // 5. Enforce one Warehouse Admin per location
    if (dto.role === UserRole.WAREHOUSE_ADMIN && dto.warehouseLocation) {
      const existingWA = await this.prisma.user.findFirst({
        where: {
          role: UserRole.WAREHOUSE_ADMIN,
          warehouseLocation: dto.warehouseLocation,
          isActive: true,
        },
        select: { id: true, fullName: true },
      });
      if (existingWA) {
        throw new ConflictException(
          `Warehouse ${dto.warehouseLocation} already has an active admin ` +
          `(${existingWA.fullName}). Deactivate the existing account first.`,
        );
      }
    }

    // 6. Email and phone uniqueness
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { phone: dto.phone }] },
      select: { email: true, phone: true },
    });
    if (existing) {
      const field = existing.email === dto.email ? 'email' : 'phone number';
      throw new ConflictException(`A user with this ${field} already exists`);
    }

    // 7. Generate temporary password + hash
    const temporaryPassword = this.generateTemporaryPassword();
    const rounds = this.config.get<number>('bcryptRounds') ?? 12;
    const passwordHash = await bcrypt.hash(temporaryPassword, rounds);

    // 8. Derive tier and label from role
    const tier = tierFromRole(dto.role);
    const roleLabel = labelFromRole(dto.role);

    // 9. Generate employee reference
    const userCount = await this.prisma.user.count();
    const employeeRef = generateEmployeeRef(userCount + 1);

    // 10. Create the user record
    const user = await this.prisma.user.create({
      data: {
        employeeRef,
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: dto.role,
        roleLabel,
        tier,
        accountOrigin: 'PROVISIONED',
        mustChangePassword: true,
        team: dto.team ?? null,
        region: null,
        state: null,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        warehouseLocation: dto.warehouseLocation ?? null,
        provisionedById: requester.sub,
      },
      select: { id: true, employeeRef: true },
    });

    // 11. Queue welcome email with temporary password
    // fire-and-forget — do not await
    void this.notifyQueue.add(
      'send-provisioning-email',
      {
        userId: user.id,
        email: dto.email,
        fullName: dto.fullName,
        roleLabel,
        temporaryPassword,
        employeeRef,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    // 12. Queue ID card generation — same as self-registration flow
    void this.notifyQueue.add(
      'generate-id-card',
      { userId: user.id, roleLabel },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    this.logger.log(
      `Account provisioned: ${employeeRef} (${roleLabel}) by admin ${requester.sub}`,
    );

    return {
      userId: user.id,
      employeeRef,
      temporaryPassword,
      message:
        `Account created for ${dto.fullName}. ` +
        `A welcome email with login instructions has been sent to ${dto.email}.`,
    };
  }

  // ─── Find all users (with optional filters) ───────────────────────────────

  /**
   * List all users with optional filters.
   *
   * Supported query params:
   *  ?team=BRIGHT|RADIANT
   *  ?region=<Region enum value>
   *  ?role=<UserRole enum value>
   *  ?tier=<UserTier enum value>
   *  ?search=<string>          — matches fullName, email, employeeRef (case-insensitive)
   *  ?isActive=true|false      — omit to return both active and inactive
   *  ?page=1 ?limit=20
   */
  async findAllUsers(query: FindAllUsersQuery = {}) {
    const {
      team,
      region,
      role,
      tier,
      search,
    } = query;

    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const where: Prisma.UserWhereInput = {};

    if (team)   where.team   = team;
    if (region) where.region = region;
    if (role)   where.role   = role;
    if (tier)   where.tier   = tier;

    // Coerce string "true"/"false" that come in via query params
    if (query.isActive !== undefined && query.isActive !== null && query.isActive !== '') {
      where.isActive =
        query.isActive === true || query.isActive === 'true';
    }

    if (search && search.trim()) {
      where.OR = [
        { fullName:    { contains: search.trim(), mode: 'insensitive' } },
        { email:       { contains: search.trim(), mode: 'insensitive' } },
        { employeeRef: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: USER_SAFE_SELECT,
      }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── Find one user ────────────────────────────────────────────────────────

  async findUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SAFE_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ─── Find provisioned accounts ────────────────────────────────────────────

  async findProvisionedUsers() {
    return this.prisma.user.findMany({
      where: { accountOrigin: 'PROVISIONED' },
      select: USER_SAFE_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Update user ──────────────────────────────────────────────────────────

  async updateUser(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.team !== undefined && { team: dto.team }),
        ...(dto.warehouseLocation !== undefined && {
          warehouseLocation: dto.warehouseLocation,
        }),
        ...(dto.annualTargets !== undefined && {
          annualTargets: dto.annualTargets,
        }),
        ...(dto.fcmToken !== undefined && { fcmToken: dto.fcmToken }),
      },
      select: USER_SAFE_SELECT,
    });
  }

  // ─── Deactivate ───────────────────────────────────────────────────────────

  async deactivateUser(id: string, requester: JwtPayload) {
    if (id === requester.sub) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, isActive: true, fullName: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (!user.isActive) {
      throw new BadRequestException(
        `${user.fullName}'s account is already deactivated`,
      );
    }

    // Revoke all active sessions immediately
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, isRevoked: false },
      data: { isRevoked: true },
    });

    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: USER_SAFE_SELECT,
    });
  }

  // ─── Reactivate ───────────────────────────────────────────────────────────

  async reactivateUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, isActive: true, fullName: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.isActive) {
      throw new BadRequestException(
        `${user.fullName}'s account is already active`,
      );
    }

    return this.prisma.user.update({
      where: { id },
      data: { isActive: true },
      select: USER_SAFE_SELECT,
    });
  }

  // ─── Reset password ───────────────────────────────────────────────────────

  async resetUserPassword(id: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { email: true, fullName: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const temporaryPassword = this.generateTemporaryPassword();
    const rounds = this.config.get<number>('bcryptRounds') ?? 12;
    const passwordHash = await bcrypt.hash(temporaryPassword, rounds);

    await Promise.all([
      this.prisma.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, isRevoked: false },
        data: { isRevoked: true },
      }),
    ]);

    void this.notifyQueue.add(
      'send-password-reset-email',
      {
        userId: id,
        email: user.email,
        fullName: user.fullName,
        temporaryPassword,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    return {
      message: `Password reset email sent to ${user.email}. All active sessions have been revoked.`,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private generateTemporaryPassword(): string {
    const chars =
      'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars[Math.floor(Math.random() * chars.length)];
    }
    return password;
  }

  // ── Invite management ──────────────────────────────────────────────────────

  /**
   * Creates an invite for a new field-tier user.
   *
   * Who can invite whom:
   *   TIER5_SALES_SUPPORT → anything (handled separately via provisionUser)
   *   TIER5_SALES_HEAD    → TIER4 (Zonal Sales Manager) only
   *   TIER4               → TIER3 (ATSM, TSM)
   *   TIER3               → TIER2 (Sales Representative, SSR)
   *   TIER2               → TIER1 (Merchandiser, Promoter, DBSR, VSR)
   *   TIER1               → cannot invite anyone
   *
   * Team is automatically inherited from the inviter for all field-tier
   * inviters — the invitee cannot choose a different team.
   */
  async createInvite(
    requester: JwtPayload,
    dto: CreateInviteDto,
  ) {
    const inviterTier = requester.tier as string;

    // ── 1. Determine allowed roles for this inviter ──────────────────────────
    const allowedRoles = FIELD_TIER_INVITE_MAP[inviterTier];

    if (!allowedRoles) {
      // TIER1 and oversight tiers that are not SALES_HEAD fall here
      throw new ForbiddenException(
        'You do not have permission to send invites. ' +
        'Only Sales Head (Tier 5), ZSMs (Tier 4), TSMs/ATSMs (Tier 3), and ' +
        'Sales Representatives/SSRs (Tier 2) can invite the tier directly below them.',
      );
    }

    // ── 2. Validate that the requested role is in this inviter's allowed set ─
    if (!allowedRoles.includes(dto.role as any)) {
      throw new ForbiddenException(
        `As a ${inviterTier} you can only invite: ` +
        allowedRoles.join(', ') +
        `. Requested role "${dto.role}" is not permitted.`,
      );
    }

    // ── 3. Auto-lock team from the inviter (field-tier inviters always have a team) ─
    //    TIER5_SALES_HEAD also has a team — it was set when the account was provisioned.
    if (!requester.team) {
      throw new ForbiddenException(
        'Your account does not have a team assigned. Contact the System Admin.',
      );
    }
    const lockedTeam: Team = requester.team as Team;

    // ── 4. Email uniqueness ──────────────────────────────────────────────────
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        `An account with email ${dto.email} already exists`,
      );
    }

    // ── 5. Invalidate any previous unused invite for this email ─────────────
    await this.prisma.inviteToken.updateMany({
      where: { email: dto.email, isUsed: false },
      data:  { isUsed: true },
    });

    // ── 6. Persist the new invite token ─────────────────────────────────────
    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    await this.prisma.inviteToken.create({
      data: {
        token,
        email:       dto.email,
        role:        dto.role as any,
        team:        lockedTeam,
        createdById: requester.sub,
        expiresAt,
      },
    });

    const roleLabel = labelFromRole(dto.role as any);
    const inviteUrl = `${process.env.APP_INVITE_BASE_URL ?? 'https://app.darvinks.com/register'}?token=${token}`;

    // fire-and-forget
    void this.mail.sendInviteEmail({
      to:           dto.email,
      roleLabel,
      inviteUrl,
      expiresHours: 48,
    });

    this.logger.log(
      `Invite created for ${dto.email} (${roleLabel}, team: ${lockedTeam}) by ${requester.sub} [${inviterTier}]`,
    );

    return {
      message:     `Invite sent to ${dto.email}`,
      expiresAt,
      inviteToken: token,
    };
  }

  async getInvite(token: string) {
    const invite = await this.prisma.inviteToken.findUnique({
      where: { token },
      select: {
        email:             true,
        role:              true,
        team:              true,
        warehouseLocation: true,
        isUsed:            true,
        expiresAt:         true,
      },
    });

    if (!invite)                          throw new BadRequestException('Invalid invite token');
    if (invite.isUsed)                    throw new BadRequestException('This invite has already been used');
    if (invite.expiresAt < new Date())    throw new BadRequestException('This invite has expired');

    return {
      email:             invite.email,
      role:              invite.role,
      team:              invite.team,
      warehouseLocation: invite.warehouseLocation,
      roleLabel:         labelFromRole(invite.role as any),
    };
  }
}