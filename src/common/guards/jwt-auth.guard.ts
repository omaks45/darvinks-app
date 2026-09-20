
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector }                    from '@nestjs/core';
import { AuthGuard }                    from '@nestjs/passport';

// ── Public decorator ──────────────────────────────────────────────────────────
// Place @Public() on any route that must be reachable without a JWT token
// (login, register, refresh, forgot-password, verify-otp, reset-password, etc.)

export const IS_PUBLIC_KEY = 'isPublic';

export function Public(): MethodDecorator & ClassDecorator {
    return (target: any, key?: string | symbol, descriptor?: any) => {
        if (descriptor) {
        // method decorator
        Reflect.defineMetadata(IS_PUBLIC_KEY, true, descriptor.value as object);
        return descriptor;
        }
        // class decorator
        Reflect.defineMetadata(IS_PUBLIC_KEY, true, target);
        return target;
    };
}

// ── Guard ─────────────────────────────────────────────────────────────────────

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    constructor(private readonly reflector: Reflector) {
        super();
    }

    canActivate(context: ExecutionContext) {
        // If the handler or its controller is marked @Public(), skip JWT validation
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
        ]);
        if (isPublic) return true;

        return super.canActivate(context);
    }
}