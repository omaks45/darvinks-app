// src/modules/users/users.service.ts
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserTier } from '@prisma/client';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import type { UpdateProfileDto } from './dto/update-profile.dto';

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

@Injectable()
export class UsersService {
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

  private getLowerTiers(tier: UserTier): UserTier[] {
    const hierarchy: UserTier[] = [
      UserTier.TIER1,
      UserTier.TIER2,
      UserTier.TIER3,
      UserTier.TIER4,
      UserTier.TIER5_SALES_HEAD,
      UserTier.TIER5_SYSTEM_ADMIN,
      UserTier.TIER6_GM,
    ];
    const idx = hierarchy.indexOf(tier);
    return idx <= 0 ? [] : hierarchy.slice(0, idx);
  }
}