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
    console.log('>>> ID card job queued for', user.id); 

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
}