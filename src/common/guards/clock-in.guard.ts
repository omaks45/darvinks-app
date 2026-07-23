// src/common/guards/clock-in.guard.ts
//
// Enforces: "if you haven't clocked in today, you're treated as absent and
// cannot perform field activities" — applies to Tiers 1-4 only.
//
// Tier 5 Sales Head: clock-in optional, login alone is sufficient.
// Tier 5 System Admin, Tier 6 GM, Warehouse Admin: never clock in at all,
// this guard is a pure pass-through for them.
//
// This is a single centralised check rather than duplicating an
// "hasClockedInToday" query inside every Phase 2/3 service — DRY: one
// source of truth for what "absent" means, reused via @UseGuards(ClockInGuard)
// on every write endpoint that requires field presence.

import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

// Tiers that never need to clock in — login is sufficient
const CLOCK_IN_EXEMPT_TIERS = [
    'TIER5_SYSTEM_ADMIN',
    'TIER6_GM',
    'WAREHOUSE_ADMIN',
];

// Sales Head clock-in is optional — exempt from the block, but still allowed
// to clock in if they want to (handled by the attendance module itself).
const CLOCK_IN_OPTIONAL_TIERS = ['TIER5_SALES_HEAD'];

@Injectable()
export class ClockInGuard implements CanActivate {
    constructor(private readonly prisma: PrismaService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user as JwtPayload;

        if (!user) return true; // JwtAuthGuard runs first and would have already rejected

        if (
        CLOCK_IN_EXEMPT_TIERS.includes(user.tier as string) ||
        CLOCK_IN_OPTIONAL_TIERS.includes(user.tier as string)
        ) {
        return true;
        }

        // Tiers 1–4: must have a CLOCK_IN event today (server's local calendar day)
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const clockInToday = await this.prisma.attendanceEvent.findFirst({
        where: {
            userId: user.sub,
            type: 'CLOCK_IN',
            serverTime: { gte: startOfDay },
        },
        select: { id: true },
        });

        if (!clockInToday) {
        throw new ForbiddenException(
            'You must clock in before performing this action. ' +
            'You are currently marked absent for today.',
        );
        }

        return true;
    }
}