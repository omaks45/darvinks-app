// src/modules/tokens/token.service.ts
// Manages refresh token lifecycle:
//  - Persists hashed tokens in PostgreSQL (full audit trail)
//  - Implements refresh token rotation (old token invalidated on every use)
//  - Token reuse detection: if a revoked token is reused, all user tokens revoked

import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import type { SignOptions } from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AppConfig, JwtConfig } from '../../common/config/app.config';
import type { JwtPayload } from '../../modules/auths/strategies/jwt.strategies';

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

  //Access Token

  /**
   * Signs a short-lived access token.
   *
   * Fix: @nestjs/jwt v11 uses the `ms` library's branded `StringValue` type
   * for expiresIn. Casting through `SignOptions` from `jsonwebtoken` (which
   * types expiresIn as `string | number`) resolves the overload mismatch
   * without losing type safety elsewhere.
   */
  signAccessToken(payload: JwtPayload): string {
    const options: SignOptions = {
      secret: this.jwtCfg.accessSecret,
      expiresIn: this.jwtCfg.accessExpiry,
    } as SignOptions;

    return this.jwt.sign(payload as object, options as any);
  }

  // Refresh Token

  /**
   * Signs a long-lived refresh token and persists a bcrypt hash to the DB.
   * The raw token is returned once and never stored in plain form.
   */
  async createRefreshToken(
    userId: string,
    payload: JwtPayload,
  ): Promise<string> {
    const tokenId = uuidv4();

    const options: SignOptions = {
      expiresIn: this.jwtCfg.refreshExpiry,
    } as SignOptions;

    const rawToken = this.jwt.sign(
      { ...(payload as object), jti: tokenId } as object,
      {
        ...options,
        secret: this.jwtCfg.refreshSecret,
      } as any,
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

  // Rotation

  /**
   * Rotates a refresh token:
   * 1. Verifies JWT signature + expiry
   * 2. Looks up the DB record — must exist and not be revoked
   * 3. Verifies bcrypt hash matches (tamper detection)
   * 4. Revokes the old token
   * 5. Issues a fresh access + refresh pair
   *
   * Token reuse detection: if a revoked token is presented again,
   * ALL tokens for that user are revoked (possible account compromise).
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

    if (!record || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    if (record.isRevoked) {
      // Token reuse — revoke all tokens for this user (security measure)
      this.logger.warn(
        `Refresh token reuse detected for user ${decoded.sub} — revoking all sessions`,
      );
      await this.revokeAllForUser(decoded.sub);
      throw new UnauthorizedException(
        'Session invalidated due to suspicious activity. Please log in again.',
      );
    }

    const isMatch = await bcrypt.compare(rawToken, record.tokenHash);
    if (!isMatch) {
      throw new UnauthorizedException('Refresh token integrity check failed');
    }

    // Revoke the consumed token
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { isRevoked: true },
    });

    // Issue fresh pair
    const payload: JwtPayload = {
      sub: decoded.sub,
      email: decoded.email,
      tier: decoded.tier,
      team: decoded.team,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(payload),
      this.createRefreshToken(decoded.sub, payload),
    ]);

    return { accessToken, refreshToken, payload };
  }

  // Revocation

  /** Revokes a specific refresh token (single-device logout). */
  async revokeToken(rawToken: string): Promise<void> {
    try {
      const decoded = this.jwt.verify(rawToken, {
        secret: this.jwtCfg.refreshSecret,
      }) as { jti: string };

      await this.prisma.refreshToken.updateMany({
        where: { id: decoded.jti, isRevoked: false },
        data: { isRevoked: true },
      });
    } catch {
      // Token already expired or invalid — nothing to revoke, not an error
    }
  }

  /**
   * Revokes all active refresh tokens for a user.
   * Called on: password change, security incident, token reuse detection.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });
  }

  /** Purges expired tokens older than 60 days. Call via a scheduled cron job. */
  async purgeExpiredTokens(): Promise<number> {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return count;
  }

  //  Private helpers

  /**
   * Parses a duration string like '30d', '12h', '60m' into milliseconds.
   * Only used internally to calculate refresh token expiresAt.
   */
  private parseDurationMs(duration: string): number {
    const unit = duration.slice(-1).toLowerCase();
    const value = parseInt(duration.slice(0, -1), 10);

    const unitMap: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };

    if (isNaN(value) || !(unit in unitMap)) {
      this.logger.warn(
        `Unrecognised duration format "${duration}" — defaulting to 30 days`,
      );
      return 30 * 86_400_000;
    }

    return unitMap[unit] * value;
  }
}