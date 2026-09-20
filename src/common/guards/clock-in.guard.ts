
// Enforces the "clock-in first" rule for field-tier users (TIER1–TIER4).
//
// How it works
// ────────────
// After JwtAuthGuard has validated the token, this guard checks whether a
// TIER1–TIER4 user has a CLOCK_IN event recorded for today (UTC day).
// If they haven't, every protected endpoint returns 403 until they clock in.
//
// Exemptions (mark an endpoint handler with @SkipClockInCheck()):
//   • POST /attendance/clock-in      ← must be allowed before clock-in exists
//   • POST /attendance/clock-out     ← allowed any time after clock-in
//   • POST /attendance/sync          ← offline sync bypasses the guard
//   • GET  /attendance/today         ← status check must work before clock-in
//   • GET  /users/me                 ← profile fetch must always work
//   • Any other endpoint you decorate with @SkipClockInCheck()
//
// Oversight tiers (TIER5_*, TIER6_GM, WAREHOUSE_ADMIN) are always allowed
// through — they are not field agents and have no clock-in requirement.

import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '@common/prisma/prisma.service';
import { AttendanceType } from '@prisma/client';

// ── Decorator ─────────────────────────────────────────────────────────────────

export const SKIP_CLOCK_IN_KEY = 'skipClockInCheck';

/**
 * Place on any controller method to bypass the ClockInGuard.
 * Required on clock-in, clock-out, offline-sync, today-status, and profile
 * endpoints — anything that must be reachable before the user has clocked in.
 */
export function SkipClockInCheck(): MethodDecorator {
    return (target, key, descriptor) => {
        Reflect.defineMetadata(SKIP_CLOCK_IN_KEY, true, descriptor.value as object);
        return descriptor;
    };
}

// ── Tiers subject to the clock-in requirement ─────────────────────────────────

const FIELD_TIERS = new Set(['TIER1', 'TIER2', 'TIER3', 'TIER4']);

// ── Guard ─────────────────────────────────────────────────────────────────────

@Injectable()
export class ClockInGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly prisma:    PrismaService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // 1. Allow if the handler or its controller is decorated with @SkipClockInCheck()
        const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CLOCK_IN_KEY, [
        context.getHandler(),
        context.getClass(),
        ]);
        if (skip) return true;

        const request = context.switchToHttp().getRequest();
        const user    = request.user as { sub: string; tier: string } | undefined;

        // 2. No user in request → JWT guard didn't run (public route) — pass through
        if (!user) return true;

        // 3. Oversight tiers are never blocked
        if (!FIELD_TIERS.has(user.tier)) return true;

        // 4. Check today's clock-in (UTC day boundary — matches attendance.service.ts)
        const todayUTC = new Date();
        const startOfDayUTC = new Date(Date.UTC(
        todayUTC.getUTCFullYear(),
        todayUTC.getUTCMonth(),
        todayUTC.getUTCDate(),
        0, 0, 0, 0,
        ));

        const clockIn = await this.prisma.attendanceEvent.findFirst({
        where: {
            userId:     user.sub,
            type:       AttendanceType.CLOCK_IN,
            serverTime: { gte: startOfDayUTC },
        },
        select: { id: true },
        });

        if (clockIn) return true;

        throw new ForbiddenException(
        'You must clock in before using the app. ' +
        'Go to Attendance → Clock In to start your day.',
        );
    }
}