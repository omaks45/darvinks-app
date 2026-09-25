// src/modules/auths/auths.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as bcrypt from 'bcryptjs';

import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import { TokenService } from '@modules/tokens/tokens.service';
import { resolveRegion, generateEmployeeRef } from '@common/utils/region.util';
import { tierFromRole, labelFromRole } from '@common/utils/role.utils';
import type { AppConfig } from '@common/config/app.config';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto, AuthTokensResponse, RegisterResponse } from './dto/auth.dto';
import type { FieldRegisterWithInviteDto } from './dto/register-invite.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly cloudinary: CloudinaryService,
    private readonly config: ConfigService<AppConfig>,
    @InjectQueue('notifications') private readonly notifyQueue: Queue,
  ) {}

  // ─── Register (self-registration for field staff Tiers 1–4) ──────────────

  async register(
    dto: RegisterDto,
    profilePicture?: Express.Multer.File,
  ): Promise<RegisterResponse> {
    // 1. Uniqueness checks — single query for both email and phone
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { phone: dto.phone }] },
      select: { email: true, phone: true },
    });

    if (existing) {
      const field = existing.email === dto.email ? 'email' : 'phone number';
      throw new ConflictException(`A user with this ${field} already exists`);
    }

    // 2. Derive tier and display label from selected role (client never sends tier)
    const tier      = tierFromRole(dto.role);
    const roleLabel = labelFromRole(dto.role);

    // 3. Hash password
    const rounds = this.config.get<number>('bcryptRounds') ?? 12;
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    // 4. Auto-assign region from state + team
    const region = resolveRegion(dto.state, dto.team);

    // 5. Generate employee reference (sequence from user count)
    const userCount   = await this.prisma.user.count();
    const employeeRef = generateEmployeeRef(userCount + 1);

    // 6. Upload profile picture if provided
    let profilePictureUrl: string | undefined;
    if (profilePicture) {
      const result = await this.cloudinary.uploadBuffer(
        profilePicture.buffer,
        'profiles',
        { publicId: employeeRef },
      );
      profilePictureUrl = result.secure_url;
    }

    // 7. Persist user
    const user = await this.prisma.user.create({
      data: {
        employeeRef,
        fullName:      dto.fullName,
        email:         dto.email,
        phone:         dto.phone,
        passwordHash,
        role:          dto.role,
        roleLabel,
        tier,
        team:          dto.team,
        region,
        state:         dto.state,
        dateOfBirth:   new Date(dto.dateOfBirth),
        profilePictureUrl,
        annualTargets: dto.annualTargets ?? {},
      },
      select: { id: true, employeeRef: true },
    });

    // 8. Queue ID card generation (non-blocking)
    await this.notifyQueue.add(
      'generate-id-card',
      { userId: user.id, roleLabel },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    return {
      userId:      user.id,
      employeeRef: user.employeeRef,
      message:     'Registration successful. Your digital ID card will be ready shortly.',
    };
  }

  // ─── Register via invite ──────────────────────────────────────────────────
  //
  // Field agents invited by a superior in the tier directly above them.
  // The invite encodes:
  //   - email       (locked — must match)
  //   - role        (locked — cannot be changed by the registrant)
  //   - team        (locked — inherited from the inviter)
  //   - createdById — the inviter; stored as reportsToId to establish the
  //                   hierarchy chain for analytics rollups and TIER1
  //                   customer-visibility scoping.

  async registerWithInvite(
    dto: FieldRegisterWithInviteDto,
    profilePicture?: Express.Multer.File,
  ): Promise<RegisterResponse> {
    // 1. Validate the invite token
    const invite = await this.prisma.inviteToken.findUnique({
      where:  { token: dto.inviteToken },
      select: {
        id:                true,
        email:             true,
        role:              true,
        team:              true,
        warehouseLocation: true,
        isUsed:            true,
        expiresAt:         true,
        createdById:       true,  // the inviter — becomes reportsToId
      },
    });

    if (!invite)                        throw new BadRequestException('Invalid invite token');
    if (invite.isUsed)                  throw new BadRequestException('This invite has already been used');
    if (invite.expiresAt < new Date())  throw new BadRequestException('This invite has expired');

    // 2. Email must match the invite (prevents token sharing)
    if (invite.email !== dto.email) {
      throw new BadRequestException(
        'The email you provided does not match the invite. ' +
        'Please use the email address the invite was sent to.',
      );
    }

    // 3. Uniqueness check (email + phone)
    const existing = await this.prisma.user.findFirst({
      where:  { OR: [{ email: dto.email }, { phone: dto.phone }] },
      select: { email: true, phone: true },
    });
    if (existing) {
      const field = existing.email === dto.email ? 'email' : 'phone number';
      throw new ConflictException(`A user with this ${field} already exists`);
    }

    // 4. Derive role metadata from the invite (locked — registrant cannot change)
    const role      = invite.role;
    const tier      = tierFromRole(role as any);
    const roleLabel = labelFromRole(role as any);

    // 5. Team is locked to the invite (inherited from the inviter)
    const team = invite.team;

    // 6. Resolve region from state + team
    const region = team ? resolveRegion(dto.state, team as any) : null;

    // 7. Hash password
    const rounds      = this.config.get<number>('bcryptRounds') ?? 12;
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    // 8. Generate employee reference
    const userCount   = await this.prisma.user.count();
    const employeeRef = generateEmployeeRef(userCount + 1);

    // 9. Upload profile picture if provided
    let profilePictureUrl: string | undefined;
    if (profilePicture) {
      const result = await this.cloudinary.uploadBuffer(
        profilePicture.buffer,
        'profiles',
        { publicId: employeeRef },
      );
      profilePictureUrl = result.secure_url;
    }

    // 10. Atomic: create user + mark invite consumed
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          employeeRef,
          fullName:          dto.fullName,
          email:             dto.email,
          phone:             dto.phone,
          passwordHash,
          role,
          roleLabel,
          tier,
          team:              team      ?? null,
          region:            region    ?? null,
          state:             dto.state ?? null,
          dateOfBirth:       dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          warehouseLocation: invite.warehouseLocation ?? null,
          profilePictureUrl,
          accountOrigin:     'SELF_REGISTERED',
          // Link to the inviter — enables analytics rollups and TIER1
          // customer scoping without extra DB columns.
          reportsToId:       invite.createdById,
        },
        select: { id: true, employeeRef: true },
      });

      await tx.inviteToken.update({
        where: { id: invite.id },
        data:  { isUsed: true, usedAt: new Date() },
      });

      return created;
    });

    // 11. Queue ID card generation (non-blocking)
    void this.notifyQueue.add(
      'generate-id-card',
      { userId: user.id, roleLabel },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    return {
      userId:      user.id,
      employeeRef: user.employeeRef,
      message:     'Registration successful. Your digital ID card will be ready shortly.',
    };
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  async login(dto: LoginDto): Promise<AuthTokensResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id:           true,
        email:        true,
        passwordHash: true,
        tier:         true,
        team:         true,
        region:       true,
        isActive:     true,
      },
    });

    // Constant-time comparison even when user not found (prevents timing attacks)
    const dummyHash    = '$2a$12$placeholderhashabcdefghijklmnopqrstuvwxyz012345678901';
    const hashToCompare = user?.passwordHash ?? dummyHash;
    const isPasswordValid = await bcrypt.compare(dto.password, hashToCompare);

    if (!user || !isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Your account has been deactivated. Contact your administrator.',
      );
    }

    const payload = {
      sub:    user.id,
      email:  user.email,
      tier:   user.tier,
      team:   user.team,
      region: user.region,
    };

    const jwtCfg = this.config.get('jwt') as { accessExpiry: string };

    const [accessToken, refreshToken] = await Promise.all([
      this.tokenService.signAccessToken(payload),
      this.tokenService.createRefreshToken(user.id, payload),
    ]);

    return { accessToken, refreshToken, expiresIn: jwtCfg.accessExpiry };
  }

  // ─── Refresh ──────────────────────────────────────────────────────────────

  async refresh(rawRefreshToken: string): Promise<AuthTokensResponse> {
    const { accessToken, refreshToken } =
      await this.tokenService.rotateRefreshToken(rawRefreshToken);

    const jwtCfg = this.config.get('jwt') as { accessExpiry: string };
    return { accessToken, refreshToken, expiresIn: jwtCfg.accessExpiry };
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokenService.revokeToken(rawRefreshToken);
  }

  // ─── Change password ──────────────────────────────────────────────────────

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where:  { id: userId },
      select: { passwordHash: true },
    });

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must differ from current password');
    }

    const rounds  = this.config.get<number>('bcryptRounds') ?? 12;
    const newHash = await bcrypt.hash(newPassword, rounds);

    await Promise.all([
      this.prisma.user.update({
        where: { id: userId },
        data:  { passwordHash: newHash },
      }),
      // Revoke all refresh tokens — force re-login on all devices
      this.tokenService.revokeAllForUser(userId),
    ]);
  }

  // ─── Forgot password ──────────────────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    // Always respond 200 — never reveal whether an email is registered
    const user = await this.prisma.user.findUnique({
      where:  { email },
      select: { id: true, fullName: true },
    });
    if (!user) return;

    // Invalidate any previous unused OTP for this user
    await this.prisma.passwordResetOtp.updateMany({
      where: { userId: user.id, isUsed: false },
      data:  { isUsed: true },
    });

    // Generate 6-digit OTP
    const otp      = String(Math.floor(100000 + Math.random() * 900000));
    const rounds   = this.config.get<number>('bcryptRounds') ?? 12;
    const otpHash  = await bcrypt.hash(otp, rounds);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.prisma.passwordResetOtp.create({
      data: { userId: user.id, otpHash, expiresAt },
    });

    // Deliver OTP via the notifications queue (fire-and-forget)
    void this.notifyQueue.add(
      'send-otp-email',
      { to: email, fullName: user.fullName, otp },
      { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
    );
  }

  // ─── Verify OTP ───────────────────────────────────────────────────────────

  async verifyOtp(email: string, otp: string): Promise<{ valid: boolean }> {
    const user = await this.prisma.user.findUnique({
      where:  { email },
      select: { id: true },
    });
    if (!user) return { valid: false };

    const record = await this.prisma.passwordResetOtp.findFirst({
      where:   { userId: user.id, isUsed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select:  { otpHash: true },
    });
    if (!record) return { valid: false };

    const isMatch = await bcrypt.compare(otp, record.otpHash);
    return { valid: isMatch };
  }

  // ─── Reset password ───────────────────────────────────────────────────────

  async resetPassword(
    email: string,
    otp: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where:  { email },
      select: { id: true },
    });
    if (!user) throw new BadRequestException('Invalid or expired OTP');

    const record = await this.prisma.passwordResetOtp.findFirst({
      where:   { userId: user.id, isUsed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select:  { id: true, otpHash: true },
    });
    if (!record) throw new BadRequestException('Invalid or expired OTP');

    const isMatch = await bcrypt.compare(otp, record.otpHash);
    if (!isMatch)  throw new BadRequestException('Invalid or expired OTP');

    const rounds  = this.config.get<number>('bcryptRounds') ?? 12;
    const newHash = await bcrypt.hash(newPassword, rounds);

    await Promise.all([
      this.prisma.user.update({
        where: { id: user.id },
        data:  { passwordHash: newHash },
      }),
      this.prisma.passwordResetOtp.update({
        where: { id: record.id },
        data:  { isUsed: true },
      }),
      this.tokenService.revokeAllForUser(user.id),
    ]);
  }

  // ─── Roles list (for registration dropdown) ───────────────────────────────

  getAllRoles() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getAllRoles } = require('@common/utils/role.util');
    return getAllRoles();
  }
}