// src/modules/notifications/notifications.processor.ts
import { Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
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
export class NotificationsProcessor {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly idCardWorker: IdCardWorker,
    private readonly prisma: PrismaService,
  ) {}

  @Process('attendance-flag')
  async handleAttendanceFlag(job: Job<AttendanceFlagJob>): Promise<void> {
    const { userId, type, flag, message } = job.data;
    // Phase 4: replace with FCM push to System Admin
    this.logger.warn(
      `Attendance flag → user=${userId} | type=${type} | flag=${flag}${message ? ` | ${message}` : ''}`,
    );
  }

  @Process('generate-id-card')
  async handleGenerateIdCard(job: Job<IdCardJob>): Promise<void> {
    const { userId, roleLabel } = job.data;

    try {
      // Fetch user data needed for the card
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

      await this.idCardWorker.generate({
        userId: user.id,
        fullName: user.fullName,
        roleLabel,
        tierLabel: user.tier,
        // Format team: "BRIGHT" → "Bright"
        team: user.team
          ? user.team.charAt(0) + user.team.slice(1).toLowerCase()
          : null,
        // Region stays as PRD name: "SS1", "North Bright", etc.
        region: user.region ?? null,
        employeeRef: user.employeeRef,
        profilePictureUrl: user.profilePictureUrl ?? null,
      });
    } catch (error) {
      this.logger.error(
        `ID card generation failed for user ${userId}`,
        error,
      );
      throw error; // Re-throw so BullMQ retries the job
    }
  }

  @Process('send-provisioning-email')
  async handleProvisioningEmail(job: Job<ProvisioningEmailJob>): Promise<void> {
    const { email, fullName, roleLabel, temporaryPassword, employeeRef } =
      job.data;
    // Phase 4: replace with Resend/Nodemailer
    this.logger.log(
      `Provisioning email queued → ${email} (${fullName}) | role=${roleLabel} | ref=${employeeRef} | pwd=${temporaryPassword}`,
    );
  }

  @Process('send-password-reset-email')
  async handlePasswordResetEmail(
    job: Job<PasswordResetEmailJob>,
  ): Promise<void> {
    const { email, fullName, temporaryPassword } = job.data;
    // Phase 4: replace with Resend/Nodemailer
    this.logger.log(
      `Password reset email queued → ${email} (${fullName}) | pwd=${temporaryPassword}`,
    );
  }
}