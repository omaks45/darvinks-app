// BullMQ processor for the 'notifications' queue.
// Phase 1 jobs: attendance flags, ID card generation (stub).
// Phase 4 jobs (FCM, email, Puppeteer PDF) will replace the stubs below.

import { Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';

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

  // UsersService is NOT injected here in Phase 1 — the ID card stub
  // only logs. It will be injected in Phase 4 when Puppeteer PDF
  // generation calls saveIdCardUrl() to persist the Cloudinary URL.

  @Process('attendance-flag')
  async handleAttendanceFlag(job: Job<AttendanceFlagJob>): Promise<void> {
    const { userId, type, flag, message } = job.data;
    // Phase 4: replace with FCM push notification to System Admin
    this.logger.warn(
      `Attendance flag → user=${userId} | type=${type} | flag=${flag}${message ? ` | ${message}` : ''}`,
    );
  }

  @Process('generate-id-card')
  async handleGenerateIdCard(job: Job<IdCardJob>): Promise<void> {
    const { userId, roleLabel } = job.data;
    // Phase 4: Puppeteer will render the HTML template to PDF here,
    // upload to Cloudinary, and call usersService.saveIdCardUrl(userId, url)
    this.logger.log(
      `ID card generation queued → userId=${userId} | role=${roleLabel}`,
    );
  }

  @Process('send-provisioning-email')
  async handleProvisioningEmail(job: Job<ProvisioningEmailJob>): Promise<void> {
    const { email, fullName, roleLabel, temporaryPassword, employeeRef } =
      job.data;
    // Phase 4: replace with Resend/Nodemailer email send
    this.logger.log(
      `Provisioning email queued → ${email} (${fullName}) | role=${roleLabel} | ref=${employeeRef} | tempPwd=${temporaryPassword}`,
    );
  }

  @Process('send-password-reset-email')
  async handlePasswordResetEmail(
    job: Job<PasswordResetEmailJob>,
  ): Promise<void> {
    const { email, fullName, temporaryPassword } = job.data;
    // Phase 4: replace with Resend/Nodemailer email send
    this.logger.log(
      `Password reset email queued → ${email} (${fullName}) | tempPwd=${temporaryPassword}`,
    );
  }
}