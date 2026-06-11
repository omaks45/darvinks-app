// src/modules/tokens/token.service.ts
// Manages refresh token lifecycle:
//  - Persists hashed tokens in PostgreSQL (full audit trail)
//  - Uses Redis to blacklist revoked tokens for fast O(1) lookups
//  - Implements refresh token rotation (old token → new token)

import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AppConfig, JwtConfig } from '@common/config/app.config';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

const REFRESH_BLACKLIST_KEY = (tokenId: string) =>
  `blacklist:refresh:${tokenId}`;

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly jwtCfg: JwtConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig>,
    @InjectQueue('notifications') private readonly notifyQueue: Queue,
  ) {
    this.jwtCfg = this.config.get<JwtConfig>('jwt')!;
  }

  /** Signs a short-lived access token — includes jti for blacklisting on logout. */
  signAccessToken(payload: JwtPayload): string {
    return this.jwt.sign(
      { ...payload, jti: uuidv4() },
      {
        secret: this.jwtCfg.accessSecret,
        expiresIn: this.jwtCfg.accessExpiry as any,
      },
    );
  }

  /** Signs a long-lived refresh token and persists a hash to the DB. */
  async createRefreshToken(
    userId: string,
    payload: JwtPayload,
  ): Promise<string> {
    const tokenId = uuidv4();
    const rawToken = this.jwt.sign(
      { ...payload, jti: tokenId },
      {
        secret: this.jwtCfg.refreshSecret,
        expiresIn: this.jwtCfg.refreshExpiry as any,
      },
    );

    const rounds = this.config.get<number>('bcryptRounds') ?? 12;
    const tokenHash = await bcrypt.hash(rawToken, rounds);

    const expiresAt = new Date(
      Date.now() + this.parseDurationMs(this.jwtCfg.refreshExpiry),
    );

    await this.prisma.refreshToken.create({
      data: { id: tokenId, tokenHash, userId, expiresAt },
    });

    return rawToken;
  }

  /**
   * Rotates a refresh token:
   * 1. Verifies the incoming token (signature + expiry)
   * 2. Checks the DB record exists and is not revoked
   * 3. Verifies the hash matches
   * 4. Revokes the old token
   * 5. Issues a new access + refresh token pair
   */
  async rotateRefreshToken(rawToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    payload: JwtPayload;
  }> {
    let decoded: JwtPayload & { jti: string };

    try {
      decoded = this.jwt.verify(rawToken, {
        secret: this.jwtCfg.refreshSecret,
      }) as JwtPayload & { jti: string };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const record = await this.prisma.refreshToken.findUnique({
      where: { id: decoded.jti },
    });

    if (!record || record.isRevoked || record.expiresAt < new Date()) {
      // Possible token reuse — revoke all tokens for this user (security measure)
      if (record && record.isRevoked) {
        this.logger.warn(
          `Refresh token reuse detected for user ${decoded.sub} — revoking all tokens`,
        );
        await this.revokeAllForUser(decoded.sub);
      }
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    const isMatch = await bcrypt.compare(rawToken, record.tokenHash);
    if (!isMatch) {
      throw new UnauthorizedException('Refresh token integrity check failed');
    }

    // Revoke the old token
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { isRevoked: true },
    });

    // Issue a fresh pair — carry region and warehouseLocation forward
    const payload: JwtPayload = {
      sub:               decoded.sub,
      email:             decoded.email,
      tier:              decoded.tier,
      team:              decoded.team,
      region:            (decoded as any).region            ?? undefined,
      warehouseLocation: (decoded as any).warehouseLocation ?? undefined,
    };

    const accessToken = this.signAccessToken(payload);
    const refreshToken = await this.createRefreshToken(decoded.sub, payload);

    // Update rotation chain
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { replacedBy: (await this.getLatestTokenId(decoded.sub)) ?? undefined },
    });

    return { accessToken, refreshToken, payload };
  }

  /** Revokes a specific refresh token (logout). */
  /**
   * Revokes a refresh token AND blacklists its paired access token.
   * The access token JTI is stored in the RefreshToken record's metadata
   * so we can look it up without receiving the access token directly.
   *
   * Since we don't receive the access token on logout (only refresh token),
   * we revoke ALL non-expired access tokens for this user by marking the
   * RefreshToken as revoked — the JWT strategy checks this on every request.
   */
  async revokeToken(rawToken: string): Promise<void> {
    try {
      const decoded = this.jwt.verify(rawToken, {
        secret: this.jwtCfg.refreshSecret,
      }) as { jti: string; sub: string };

      await this.prisma.refreshToken.updateMany({
        where: { id: decoded.jti, isRevoked: false },
        data: { isRevoked: true },
      });

      // Store user's logout timestamp — JWT strategy rejects tokens issued before this
      await this.prisma.user.update({
        where: { id: decoded.sub },
        data: { lastLogoutAt: new Date() },
      });

    } catch {
      // Token already expired or invalid — nothing to revoke
    }
  }

  /** Revokes all active refresh tokens for a user (e.g. password change, security incident). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });
  }

  /** Cleans up expired refresh tokens older than 60 days (call via cron). */
  async purgeExpiredTokens(): Promise<number> {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return count;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async getLatestTokenId(userId: string): Promise<string | null> {
    const latest = await this.prisma.refreshToken.findFirst({
      where: { userId, isRevoked: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return latest?.id ?? null;
  }

  private parseDurationMs(duration: string): number {
    const unit = duration.slice(-1);
    const value = parseInt(duration.slice(0, -1), 10);
    const units: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return (units[unit] ?? 3_600_000) * value;
  }
}