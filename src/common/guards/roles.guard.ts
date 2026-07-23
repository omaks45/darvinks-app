
import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserTier } from '@prisma/client';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { JwtPayload } from '../../modules/auths/strategies/jwt.strategies';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<UserTier[]>(
        ROLES_KEY,
        [context.getHandler(), context.getClass()],
        );

        // No @Roles() decorator — route is open to any authenticated user
        if (!requiredRoles || requiredRoles.length === 0) return true;

        const { user } = context
        .switchToHttp()
        .getRequest<Request & { user: JwtPayload }>();

        if (!user || !requiredRoles.includes(user.tier)) {
        throw new ForbiddenException(
            'You do not have permission to access this resource',
        );
        }

        return true;
    }
}