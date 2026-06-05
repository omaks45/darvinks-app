// src/modules/notifications/notifications.processor.ts
import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { IdCardWorker } from './workers/id-card.worker';
import { PrismaService } from '@common/prisma/prisma.service';

interface AttendanceFlagJob {
  userId: string;
  eventId: string;
  type: string;
  flag: string;
  message?: string;
}

interface IdCardJob {
  userId: string;
  roleLabel: string;
}

interface ProvisioningEmailJob {
  userId: string;
  email: string;
  fullName: string;
  roleLabel: string;
  temporaryPassword: string;
  employeeRef: string;
}

interface PasswordResetEmailJob {
  userId: string;
  email: string;
  fullName: string;
  temporaryPassword: string;
}

@Processor('notifications')
export class NotificationsProcessor implements OnModuleInit {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly idCardWorker: IdCardWorker,
    private readonly prisma: PrismaService,
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
    const { userId, type, flag, message } = job.data;
    this.logger.warn(
      `Attendance flag → user=${userId} | type=${type} | flag=${flag}${message ? ` | ${message}` : ''}`,
    );
  }

  @Process('generate-id-card')
  async handleGenerateIdCard(job: Job<IdCardJob>): Promise<void> {
    const { userId, roleLabel } = job.data;
    this.logger.log(`Processing generate-id-card for userId=${userId}`);

    try {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          fullName: true,
          tier: true,
          team: true,
          region: true,
          employeeRef: true,
          profilePictureUrl: true,
        },
      });

      this.logger.log(`Found user ${user.employeeRef}, generating card...`);

      await this.idCardWorker.generate({
        userId: user.id,
        fullName: user.fullName,
        roleLabel,
        tierLabel: user.tier,
        team: user.team
          ? user.team.charAt(0) + user.team.slice(1).toLowerCase()
          : null,
        region: user.region ?? null,
        employeeRef: user.employeeRef,
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
    this.logger.log(
      `Provisioning email → ${email} (${fullName}) | ${roleLabel} | ref=${employeeRef} | pwd=${temporaryPassword}`,
    );
  }

  @Process('send-password-reset-email')
  async handlePasswordResetEmail(job: Job<PasswordResetEmailJob>): Promise<void> {
    const { email, fullName, temporaryPassword } = job.data;
    this.logger.log(
      `Password reset email → ${email} (${fullName}) | pwd=${temporaryPassword}`,
    );
  }
}