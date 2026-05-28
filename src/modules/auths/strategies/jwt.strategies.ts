
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Team, UserTier } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AppConfig, JwtConfig } from '../../../common/config/app.config';

export interface JwtPayload {
    sub: string;    // userId
    email: string;
    tier: UserTier;
    team: Team;
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
        select: { id: true, isActive: true },
        });

        if (!user || !user.isActive) {
        throw new UnauthorizedException('User account not found or deactivated');
        }

        return payload;
    }
}