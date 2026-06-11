
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Team, UserTier } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AppConfig, JwtConfig } from '@common/config/app.config';

export interface JwtPayload {
    sub:               string;             // userId
    email:             string;
    tier:              UserTier;
    team:              Team;
    region?:           string;             // null for back-office roles
    warehouseLocation?: string;            // only populated for WAREHOUSE_ADMIN
    jti?:              string;             // JWT ID — used for blacklisting on logout
    iat?:              number;             // Issued at — used to check against lastLogoutAt
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
    constructor(
        config: ConfigService<AppConfig>,
        private readonly prisma: PrismaService,
    ) {
        const jwtCfg = config.get<JwtConfig>('jwt')!;
        super({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: false,
        secretOrKey: jwtCfg.accessSecret,
        });
    }

    async validate(payload: JwtPayload): Promise<JwtPayload> {
        const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, isActive: true, lastLogoutAt: true },
        });

        if (!user || !user.isActive) {
        throw new UnauthorizedException('User account not found or deactivated');
        }

        // ── Logout invalidation check ──────────────────────────────────────────
        // If the user has logged out, reject any access token issued BEFORE
        // the logout timestamp. Tokens issued AFTER a new login are still valid.
        if (user.lastLogoutAt && payload.iat) {
        const tokenIssuedAt = new Date(payload.iat * 1000); // iat is in seconds
        if (tokenIssuedAt <= user.lastLogoutAt) {
            throw new UnauthorizedException(
            'Token has been invalidated. Please log in again.',
            );
        }
        }

        return payload;
    }
}