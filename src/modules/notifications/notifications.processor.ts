// src/modules/notifications/notifications.processor.ts
import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { IdCardWorker } from './workers/id-card.worker';
import { MailService } from '@modules/email/email.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { PushNotificationService } from './push-notification.service';

interface AttendanceFlagJob {
  userId:   string;
  eventId:  string;
  type:     string;
  flag:     string;
  message?: string;
}

interface IdCardJob {
  userId:    string;
  roleLabel: string;
}

interface ProvisioningEmailJob {
  userId:            string;
  email:             string;
  fullName:          string;
  roleLabel:         string;
  temporaryPassword: string;
  employeeRef:       string;
}

interface PasswordResetEmailJob {
  userId:            string;
  email:             string;
  fullName:          string;
  temporaryPassword: string;
}

@Processor('notifications')
export class NotificationsProcessor implements OnModuleInit {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly idCardWorker: IdCardWorker,
    private readonly mailService:  MailService,
    private readonly prisma:       PrismaService,
    private readonly push:         PushNotificationService,
    @InjectQueue('notifications') private readonly queue: Queue,
  ) {
    this.logger.log('NotificationsProcessor ready');
  }

  onModuleInit() {
    this.queue.on('failed', (job: Job, err: Error) => {
      this.logger.error(
        `Job FAILED: name=${job.name} id=${job.id} | ${err.message}`,
        err.stack,
      );
    });

    this.queue.on('completed', (job: Job) => {
      this.logger.log(`Job COMPLETED: name=${job.name} id=${job.id}`);
    });

    this.queue.on('error', (err: Error) => {
      this.logger.error(`Queue ERROR: ${err.message}`, err.stack);
    });

    this.queue.on('active', (job: Job) => {
      this.logger.log(`Job ACTIVE: name=${job.name} id=${job.id}`);
    });

    this.logger.log('Queue event listeners attached');
  }

  @Process('attendance-flag')
  async handleAttendanceFlag(job: Job<AttendanceFlagJob>): Promise<void> {
    const { userId, type, flag } = job.data;
    this.logger.warn(
      `Attendance flag → user=${userId} | type=${type} | flag=${flag}`,
    );
    // Send push notification to the agent if they clocked in late or outside window
    await this.push.notifyAttendanceFlag({ userId, type, flag });
  }

  @Process('generate-id-card')
  async handleGenerateIdCard(job: Job<IdCardJob>): Promise<void> {
    const { userId, roleLabel } = job.data;
    this.logger.log(`Processing generate-id-card for userId=${userId}`);

    try {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id:                true,
          fullName:          true,
          tier:              true,
          team:              true,
          region:            true,
          employeeRef:       true,
          profilePictureUrl: true,
        },
      });

      this.logger.log(`Found user ${user.employeeRef}, generating card...`);

      await this.idCardWorker.generate({
        userId:            user.id,
        fullName:          user.fullName,
        roleLabel,
        tierLabel:         user.tier,
        team:              user.team
          ? user.team.charAt(0) + user.team.slice(1).toLowerCase()
          : null,
        region:            user.region ?? null,
        employeeRef:       user.employeeRef,
        profilePictureUrl: user.profilePictureUrl ?? null,
      });

      this.logger.log(`generate-id-card complete for ${user.employeeRef}`);
    } catch (error) {
      this.logger.error(
        `generate-id-card FAILED for userId=${userId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  @Process('send-provisioning-email')
  async handleProvisioningEmail(job: Job<ProvisioningEmailJob>): Promise<void> {
    const { email, fullName, roleLabel, temporaryPassword, employeeRef } = job.data;
    this.logger.log(`Sending provisioning email → ${email} (${employeeRef})`);

    try {
      await this.mailService.sendProvisioningEmail({
        to: email,
        fullName,
        roleLabel,
        employeeRef,
        temporaryPassword,
      });
    } catch (error) {
      this.logger.error(`Provisioning email FAILED for ${email}`, error);
      throw error;
    }
  }

  @Process('send-password-reset-email')
  async handlePasswordResetEmail(job: Job<PasswordResetEmailJob>): Promise<void> {
    const { email, fullName, temporaryPassword } = job.data;
    this.logger.log(`Sending password reset email → ${email}`);

    try {
      await this.mailService.sendPasswordResetEmail({
        to: email,
        fullName,
        temporaryPassword,
      });
    } catch (error) {
      this.logger.error(`Password reset email FAILED for ${email}`, error);
      throw error;
    }
  }
}