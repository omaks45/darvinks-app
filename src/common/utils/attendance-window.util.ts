
// Validates whether a given time falls within the permitted clock-in/out windows.
// Keeps time-window logic in one place — used by AttendanceService.

import { AttendanceFlag, AttendanceType } from '@prisma/client';

export interface WindowCheck {
    allowed: boolean;
    flag: AttendanceFlag;
    message?: string;
}

const WINDOWS = {
    [AttendanceType.CLOCK_IN]: { openHour: 8, openMin: 30, closeHour: 10, closeMin: 30 },
    [AttendanceType.CLOCK_OUT]: { openHour: 17, openMin: 30, closeHour: 21, closeMin: 0 },
    [AttendanceType.KD_VISIT]: null, // No time restriction on KD visits
} as const;

/**
 * Checks if `time` falls within the permitted window for `eventType`.
 * Returns a flag indicating ON_TIME, LATE, or OUTSIDE_WINDOW.
 */
export function checkAttendanceWindow(
    eventType: AttendanceType,
    time: Date,
    ): WindowCheck {
    if (eventType === AttendanceType.KD_VISIT) {
        return { allowed: true, flag: AttendanceFlag.ON_TIME };
    }

    const window = WINDOWS[eventType];
    const h = time.getHours();
    const m = time.getMinutes();
    const totalMinutes = h * 60 + m;

    const openMinutes = window.openHour * 60 + window.openMin;
    const closeMinutes = window.closeHour * 60 + window.closeMin;

    if (totalMinutes < openMinutes) {
        // Too early — allow but flag
        return {
        allowed: true,
        flag: AttendanceFlag.OUTSIDE_WINDOW,
        message: `${eventType} submitted before permitted window`,
        };
    }

    if (totalMinutes > closeMinutes) {
        // Too late — still record but flag as outside window
        return {
        allowed: true,
        flag: AttendanceFlag.OUTSIDE_WINDOW,
        message: `${eventType} submitted after permitted window`,
        };
    }

    // Clock-in: on-time = 08:30–09:00, late = 09:01–10:30
    if (eventType === AttendanceType.CLOCK_IN) {
        const lateThreshold = 9 * 60; // 09:00
        const flag =
        totalMinutes <= lateThreshold
            ? AttendanceFlag.ON_TIME
            : AttendanceFlag.LATE;
        return { allowed: true, flag };
    }

    return { allowed: true, flag: AttendanceFlag.ON_TIME };
}