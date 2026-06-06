// src/modules/auth/auth.service.ts
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
import { MailService } from '@modules/email/email.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import { TokenService } from '@modules/tokens/tokens.service';
import { resolveRegion, generateEmployeeRef } from '@common/utils/region.util';
import { tierFromRole, labelFromRole } from '@common/utils/role.utils';
import type { AppConfig } from '@common/config/app.config';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto, AuthTokensResponse, RegisterResponse } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly tokenService: TokenService,
    private readonly cloudinary: CloudinaryService,
    private readonly config: ConfigService<AppConfig>,
    @InjectQueue('notifications') private readonly notifyQueue: Queue,
  ) {}

  // ─── Register ─────────────────────────────────────────────────────────────

  async register(
    dto: RegisterDto,
    profilePicture?: Express.Multer.File,
  ): Promise<RegisterResponse> {
    // 1. Uniqueness — single query for both email and phone
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { phone: dto.phone }] },
      select: { email: true, phone: true },
    });

    if (existing) {
      const field = existing.email === dto.email ? 'email' : 'phone number';
      throw new ConflictException(`A user with this ${field} already exists`);
    }

    // 2. Derive tier and display label from the selected role
    //    User picks a role → system assigns tier automatically (never trust client tier)
    const tier = tierFromRole(dto.role);
    const roleLabel = labelFromRole(dto.role);

    // 3. Hash password
    const rounds = this.config.get<number>('bcryptRounds') ?? 12;
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    // 4. Auto-assign region from state + team
    const region = resolveRegion(dto.state, dto.team);

    // 5. Generate employee ref — Dar-{8-digit sequence}
    const userCount = await this.prisma.user.count();
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

    // 7. Persist user — role and roleLabel stored for ID card generation
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
        team: dto.team,
        region,
        state: dto.state,
        dateOfBirth: new Date(dto.dateOfBirth),
        profilePictureUrl,
        annualTargets: dto.annualTargets ?? {},
      },
      select: { id: true, employeeRef: true },
    });

    // 8. Queue ID card generation — fire and forget (non-blocking)
    // Do NOT await — the job runs in the background after the response is sent
    void this.notifyQueue.add(
      'generate-id-card',
      { userId: user.id, roleLabel },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    return {
      userId: user.id,
      employeeRef: user.employeeRef,
      message: 'Registration successful. Your digital ID card will be ready shortly.',
    };
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  async login(dto: LoginDto): Promise<AuthTokensResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        tier: true,
        team: true,
        isActive: true,
      },
    });

    // Constant-time comparison even when user not found (prevents timing attacks)
    const dummyHash = '$2a$12$placeholderhashabcdefghijklmnopqrstuvwxyz012345678901';
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
      sub: user.id,
      email: user.email,
      tier: user.tier,
      team: user.team,
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
      where: { id: userId },
      select: { passwordHash: true },
    });

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must differ from current password');
    }

    const rounds = this.config.get<number>('bcryptRounds') ?? 12;
    const newHash = await bcrypt.hash(newPassword, rounds);

    await Promise.all([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newHash },
      }),
      this.tokenService.revokeAllForUser(userId),
    ]);
  }

  // ─── Roles list (for registration dropdown) ───────────────────────────────

  getRoles() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getAllRoles } = require('@common/utils/role.util');
    return getAllRoles();
  }
  // ── Forgot password ────────────────────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, fullName: true, isActive: true },
    });

    // Always return success — never reveal whether email exists (security)
    if (!user || !user.isActive) return;

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);

    // Invalidate any existing unused OTPs for this user
    await this.prisma.passwordResetOtp.updateMany({
      where: { userId: user.id, isUsed: false },
      data: { isUsed: true },
    });

    // Save new OTP — expires in 15 minutes
    await this.prisma.passwordResetOtp.create({
      data: {
        userId:    user.id,
        otpHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    // Send OTP email — fire and forget to keep response fast
    void this.mail.sendForgotPasswordEmail({
      to:       email,
      fullName: user.fullName,
      otp,
    });
  }

  async verifyOtp(email: string, otp: string): Promise<{ valid: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) return { valid: false };

    const record = await this.prisma.passwordResetOtp.findFirst({
      where: {
        userId:   user.id,
        isUsed:   false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) return { valid: false };

    const matches = await bcrypt.compare(otp, record.otpHash);
    return { valid: matches };
  }

  async resetPassword(
    email:       string,
    otp:         string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) throw new BadRequestException('Invalid or expired OTP');

    const record = await this.prisma.passwordResetOtp.findFirst({
      where: {
        userId:   user.id,
        isUsed:   false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) throw new BadRequestException('Invalid or expired OTP');

    const matches = await bcrypt.compare(otp, record.otpHash);
    if (!matches) throw new BadRequestException('Invalid or expired OTP');

    const rounds = this.config.get<number>('bcryptRounds') ?? 12;
    const passwordHash = await bcrypt.hash(newPassword, rounds);

    // Mark OTP as used and update password atomically
    await this.prisma.$transaction([
      this.prisma.passwordResetOtp.update({
        where: { id: record.id },
        data:  { isUsed: true },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
        },
      }),
      // Revoke all refresh tokens — force re-login
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, isRevoked: false },
        data:  { isRevoked: true },
      }),
    ]);
  }

}