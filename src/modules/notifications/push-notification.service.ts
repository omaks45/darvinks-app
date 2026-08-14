// src/modules/notifications/push-notification.service.ts
// Central service for all Firebase Cloud Messaging (FCM) push notifications.
// All modules inject this service — never call firebase-admin directly from a service.

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@common/prisma/prisma.service';

export interface PushPayload {
    title:  string;
    body:   string;
    data?:  Record<string, string>; // all values must be strings for FCM
    badge?: number;
}

@Injectable()
export class PushNotificationService implements OnModuleInit {
    private readonly logger = new Logger(PushNotificationService.name);
    private messaging: any = null;

    constructor(
        private readonly prisma:  PrismaService,
        private readonly config:  ConfigService,
    ) {}

    onModuleInit() {
        try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const admin = require('firebase-admin');

        // Only initialise once — guard against hot-reload re-initialisation
        if (!admin.apps.length) {
            const serviceAccount = this.config.get<string>('firebase.serviceAccount');
            if (!serviceAccount) {
            this.logger.warn('FIREBASE_SERVICE_ACCOUNT not configured — push notifications disabled');
            return;
            }

            let credential: any;
            try {
            // Value is either inline JSON or a file path
            if (serviceAccount.trim().startsWith('{')) {
                credential = JSON.parse(serviceAccount);
            } else {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const fs   = require('fs');
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const path = require('path');
                const resolved = path.isAbsolute(serviceAccount)
                ? serviceAccount
                : path.join(process.cwd(), serviceAccount);
                credential = JSON.parse(fs.readFileSync(resolved, 'utf8'));
            }
            } catch (err: any) {
            this.logger.error(`Failed to load Firebase credentials: ${err.message}`);
            return;
            }

            admin.initializeApp({
            credential: admin.credential.cert(credential),
            });
        }

        this.messaging = admin.messaging();
        this.logger.log('Firebase Admin SDK initialised — push notifications ready');
        } catch (err: any) {
        this.logger.error(`Firebase initialisation failed: ${err.message}`);
        }
    }

    // ── Send to a single user by userId ──────────────────────────────────────────

    async sendToUser(userId: string, payload: PushPayload): Promise<boolean> {
        if (!this.messaging) {
        this.logger.warn('Push notifications not available — Firebase not initialised');
        return false;
        }

        try {
        const user = await this.prisma.user.findUnique({
            where:  { id: userId },
            select: { fcmToken: true, fullName: true },
        });

        if (!user?.fcmToken) {
            this.logger.debug(`No FCM token for user ${userId} — push skipped`);
            return false;
        }

        await this.messaging.send({
            token:        user.fcmToken,
            notification: { title: payload.title, body: payload.body },
            data:         payload.data ?? {},
            android: {
            priority: 'high',
            notification: { sound: 'default', channelId: 'darvinks_main' },
            },
            apns: {
            payload: {
                aps: {
                sound: 'default',
                badge: payload.badge ?? 1,
                },
            },
            },
        });

        this.logger.log(`Push sent to ${user.fullName}: "${payload.title}"`);
        return true;
        } catch (err: any) {
        // Handle invalid/expired tokens gracefully — clear them from DB
        if (
            err.code === 'messaging/registration-token-not-registered' ||
            err.code === 'messaging/invalid-registration-token'
        ) {
            this.logger.warn(`Invalid FCM token for user ${userId} — clearing from DB`);
            await this.prisma.user.update({
            where: { id: userId },
            data:  { fcmToken: null },
            }).catch(() => {}); // best-effort
        } else {
            this.logger.error(`Push failed for user ${userId}: ${err.message}`);
        }
        return false;
        }
    }

    // ── Send to multiple users at once ────────────────────────────────────────────

    async sendToMany(userIds: string[], payload: PushPayload): Promise<void> {
        if (!this.messaging || userIds.length === 0) return;

        const users = await this.prisma.user.findMany({
        where:  { id: { in: userIds }, fcmToken: { not: null } },
        select: { id: true, fcmToken: true, fullName: true },
        });

        if (users.length === 0) {
        this.logger.debug('sendToMany: no users have FCM tokens');
        return;
        }

        const messages = users.map((u) => ({
        token:        u.fcmToken!,
        notification: { title: payload.title, body: payload.body },
        data:         payload.data ?? {},
        android:      { priority: 'high' as const },
        apns:         { payload: { aps: { sound: 'default', badge: payload.badge ?? 1 } } },
        }));

        try {
        const response = await this.messaging.sendEach(messages);
        this.logger.log(
            `Batch push: ${response.successCount} sent, ${response.failureCount} failed`,
        );

        // Clear invalid tokens
        for (let i = 0; i < response.responses.length; i++) {
            const r = response.responses[i];
            if (!r.success) {
            const code = r.error?.code;
            if (
                code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token'
            ) {
                await this.prisma.user.update({
                where: { id: users[i].id },
                data:  { fcmToken: null },
                }).catch(() => {});
            }
            }
        }
        } catch (err: any) {
        this.logger.error(`Batch push failed: ${err.message}`);
        }
    }

    // ── Pre-built notification templates ─────────────────────────────────────────
    // Use these methods from other services — never construct raw payloads outside.

    async notifyPoApproved(params: {
        createdById:    string;
        orderRef:       string;
        purchaseOrderId: string;
        hasReceipt:     boolean;
    }): Promise<void> {
        const body = params.hasReceipt
        ? `Your ${params.orderRef} has been approved ✓ — receipt attached. Tap to update your KD ledger.`
        : `Your ${params.orderRef} has been approved ✓. Open the app to view the updated status.`;

        await this.sendToUser(params.createdById, {
        title: `PO Approved — ${params.orderRef}`,
        body,
        data: {
            type:            'PO_APPROVED',
            purchaseOrderId: params.purchaseOrderId,
            orderRef:        params.orderRef,
            hasReceipt:      params.hasReceipt ? 'true' : 'false',
            screen:          'PurchaseOrderDetail',
        },
        });
    }

    async notifyPoRejected(params: {
        createdById:    string;
        orderRef:       string;
        purchaseOrderId: string;
        reason?:        string;
    }): Promise<void> {
        await this.sendToUser(params.createdById, {
        title: `PO Cancelled — ${params.orderRef}`,
        body:  params.reason
            ? `Your ${params.orderRef} has been cancelled. Reason: ${params.reason}`
            : `Your ${params.orderRef} has been cancelled. Contact your manager for details.`,
        data: {
            type:            'PO_CANCELLED',
            purchaseOrderId: params.purchaseOrderId,
            orderRef:        params.orderRef,
            screen:          'PurchaseOrderDetail',
        },
        });
    }

    async notifyTargetAssigned(params: {
        assignedToId:   string;
        assignedByName: string;
        period:         string;
        categories:     string[];
    }): Promise<void> {
        const catList = params.categories.join(', ');
        await this.sendToUser(params.assignedToId, {
        title: 'New Target Assigned',
        body:  `${params.assignedByName} assigned you ${params.period} targets for: ${catList}. Open the app to split them to your team.`,
        data: {
            type:   'TARGET_ASSIGNED',
            period: params.period,
            screen: 'TargetAssignments',
        },
        });
    }

    async notifyTargetStale(params: {
        assignedToId: string;
        category:     string;
        period:       string;
    }): Promise<void> {
        await this.sendToUser(params.assignedToId, {
        title: 'Target Updated',
        body:  `Your ${params.category} target for ${params.period} has been updated. Please re-split your targets.`,
        data: {
            type:     'TARGET_STALE',
            category: params.category,
            screen:   'TargetAssignments',
        },
        });
    }

    async notifyOorRequestReceived(params: {
        approverId:    string;
        agentName:     string;
        customerName:  string;
        requestId:     string;
    }): Promise<void> {
        await this.sendToUser(params.approverId, {
        title: 'Out-of-Region Request',
        body:  `${params.agentName} is requesting access to ${params.customerName} outside their region.`,
        data: {
            type:      'OOR_REQUEST',
            requestId: params.requestId,
            screen:    'OutOfRegionRequests',
        },
        });
    }

    async notifyOorApproved(params: {
        agentId:      string;
        customerName: string;
        requestId:    string;
    }): Promise<void> {
        await this.sendToUser(params.agentId, {
        title: 'Access Approved',
        body:  `Your request to access ${params.customerName} has been approved ✓`,
        data: {
            type:      'OOR_APPROVED',
            requestId: params.requestId,
            screen:    'Customers',
        },
        });
    }

    async notifyReceiptUploaded(params: {
        createdById:    string;
        orderRef:       string;
        purchaseOrderId: string;
    }): Promise<void> {
        await this.sendToUser(params.createdById, {
        title: 'Receipt Ready',
        body:  `The approval receipt for ${params.orderRef} has been uploaded. Open the app to update the KD ledger.`,
        data: {
            type:            'RECEIPT_UPLOADED',
            purchaseOrderId: params.purchaseOrderId,
            orderRef:        params.orderRef,
            screen:          'KdLedger',
        },
        });
    }

    async notifyLowStock(params: {
        adminIds:          string[];
        productName:       string;
        warehouseLocation: string;
        quantityCartons:   number;
    }): Promise<void> {
        await this.sendToMany(params.adminIds, {
        title: '⚠️ Low Stock Alert',
        body:  `${params.productName} at ${params.warehouseLocation} is low: only ${params.quantityCartons} carton(s) remaining.`,
        data: {
            type:              'LOW_STOCK',
            productName:       params.productName,
            warehouseLocation: params.warehouseLocation,
            screen:            'Warehouse',
        },
        });
    }

    async notifyAttendanceFlag(params: {
        userId: string;
        type:   string;
        flag:   string;
    }): Promise<void> {
        if (params.flag === 'ON_TIME') return; // no notification needed for on-time

        const messages: Record<string, string> = {
        LATE:            `Your ${params.type.replace('_', ' ').toLowerCase()} was recorded as LATE.`,
        OUTSIDE_WINDOW:  `Your ${params.type.replace('_', ' ').toLowerCase()} was recorded outside the allowed time window.`,
        };

        await this.sendToUser(params.userId, {
        title: 'Attendance Notice',
        body:  messages[params.flag] ?? `Attendance flag: ${params.flag}`,
        data: {
            type:   'ATTENDANCE_FLAG',
            flag:   params.flag,
            screen: 'Attendance',
        },
        });
    }
}