
// Thin service layer for reading Notification records stored in the DB.
// The heavy lifting (sending FCM, email, in-app) is done by
// NotificationsProcessor (BullMQ) — this service just exposes read
// access so controllers/dashboards can surface notification history.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

const NOTIFICATION_SELECT = {
  id:         true,
  channel:    true,
  status:     true,
  title:      true,
  body:       true,
  payload:    true,
  sentAt:     true,
  failReason: true,
  createdAt:  true,
} as const;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the most recent notifications for a given user. */
  async findForUser(userId: string, limit = 50) {
    return this.prisma.notification.findMany({
      where:   { userId },
      select:  NOTIFICATION_SELECT,
      orderBy: { createdAt: 'desc' },
      take:    limit,
    });
  }

  /** Count of unread (PENDING) notifications for a user — for badge counts. */
  async countPending(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, status: 'PENDING' },
    });
  }
}