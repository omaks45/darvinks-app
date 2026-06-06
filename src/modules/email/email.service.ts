
// Handles all transactional emails for TB DARVINKS.
// Uses nodemailer directly — no third-party NestJS mailer wrapper needed.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { AppConfig, MailConfig } from '@common/config/app.config';

// Darvinks logo — embedded as base64 so emails render offline and in all clients
const LOGO_BASE64 = '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';
const LOGO_CID    = 'darvinks-logo@tb-darvinks';

@Injectable()
export class MailService {
  private readonly logger     = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly mailCfg:     MailConfig;

  constructor(private readonly config: ConfigService<AppConfig>) {
    this.mailCfg = this.config.get<MailConfig>('mail')!;

    this.transporter = nodemailer.createTransport({
      host:   this.mailCfg.host,
      port:   this.mailCfg.port,
      secure: this.mailCfg.secure,
      auth: {
        user: this.mailCfg.user,
        pass: this.mailCfg.password,
      },
    });

    this.logger.log(`Mail transport ready → ${this.mailCfg.host}:${this.mailCfg.port}`);
  }

  // ── Provisioning email ─────────────────────────────────────────────────────

  async sendProvisioningEmail(payload: {
    to:                string;
    fullName:          string;
    roleLabel:         string;
    employeeRef:       string;
    temporaryPassword: string;
  }): Promise<void> {
    const { to, fullName, roleLabel, employeeRef, temporaryPassword } = payload;

    const subject = 'Your TB DARVINKS Account Has Been Created';
    const html    = this.buildProvisioningHtml({ fullName, roleLabel, employeeRef, temporaryPassword });

    await this.send({ to, subject, html });
    this.logger.log(`Provisioning email sent → ${to} (${employeeRef})`);
  }

  // Password reset email

  async sendPasswordResetEmail(payload: {
    to:                string;
    fullName:          string;
    temporaryPassword: string;
  }): Promise<void> {
    const { to, fullName, temporaryPassword } = payload;

    const subject = 'TB DARVINKS — Your Password Has Been Reset';
    const html    = this.buildPasswordResetHtml({ fullName, temporaryPassword });

    await this.send({ to, subject, html });
    this.logger.log(`Password reset email sent → ${to}`);
  }

  //  Core send

  private async send(opts: { to: string; subject: string; html: string }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `"${this.mailCfg.fromName}" <${this.mailCfg.from}>`,
        to:      opts.to,
        subject: opts.subject,
        html:    opts.html,
        attachments: [
          {
            filename:    'darvinks-logo.png',
            content:     Buffer.from(LOGO_BASE64, 'base64'),
            contentType: 'image/png',
            cid:         LOGO_CID,
          },
        ],
      });
    } catch (err) {
      this.logger.error(`Failed to send email to ${opts.to}`, err);
      throw err;
    }
  }

  // ── HTML templates ─────────────────────────────────────────────────────────

  private buildProvisioningHtml(data: {
    fullName:          string;
    roleLabel:         string;
    employeeRef:       string;
    temporaryPassword: string;
  }): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to TB DARVINKS</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Arial,sans-serif;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
                style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#5C0F18 0%,#8B1520 100%);padding:36px 40px;text-align:center;">
              <img src="cid:${LOGO_CID}" alt="DarVinks" width="60" height="60"
                    style="display:block;margin:0 auto 12px;" />
              <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.2em;
                        color:rgba(255,255,255,0.7);text-transform:uppercase;">
                DARVINKS HEALTHCARE
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px;">
              <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a1a;">
                Welcome, ${data.fullName}!
              </h2>
              <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
                Your <strong>TB DARVINKS</strong> back-office account has been created.
                You have been assigned the role of <strong>${data.roleLabel}</strong>.
              </p>

              <!-- Credentials box -->
              <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#fdf6f7;border:1px solid #f0d0d4;border-radius:8px;
                            margin-bottom:24px;">
                <tr>
                  <td style="padding:24px;">
                    <p style="margin:0 0 4px;font-size:11px;font-weight:700;
                              letter-spacing:0.15em;color:#8B1520;text-transform:uppercase;">
                      Your Login Credentials
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #f0d0d4;
                                    font-size:13px;color:#888;width:140px;">Employee Ref</td>
                        <td style="padding:8px 0;border-bottom:1px solid #f0d0d4;
                                    font-size:14px;font-weight:700;color:#1a1a1a;">
                          ${data.employeeRef}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;font-size:13px;color:#888;">
                          Temporary Password
                        </td>
                        <td style="padding:8px 0;font-size:14px;font-weight:700;
                                    color:#1a1a1a;font-family:monospace;letter-spacing:0.05em;">
                          ${data.temporaryPassword}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Warning -->
              <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;
                            margin-bottom:24px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6;">
                        <strong>You must change your password on first login.</strong>
                      This temporary password will expire after your first session.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.6;">
                Download the <strong>TB DARVINKS</strong> mobile app and log in with
                your employee reference number and the temporary password above.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8f8f8;padding:24px 40px;border-top:1px solid #eee;
                        text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;color:#888;">
                Darvinks Healthcare Ltd &nbsp;·&nbsp;
                1 African Church Close, Off Coker Road, Ilupeju Lagos, Nigeria
              </p>
              <p style="margin:0;font-size:11px;color:#aaa;">
                This email was sent to ${data.employeeRef}. Do not share your credentials.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
  }

  private buildPasswordResetHtml(data: {
    fullName:          string;
    temporaryPassword: string;
  }): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset — TB DARVINKS</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
                style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#5C0F18 0%,#8B1520 100%);padding:36px 40px;text-align:center;">
              <img src="cid:${LOGO_CID}" alt="DarVinks" width="60" height="60"
                    style="display:block;margin:0 auto 12px;" />
              <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.2em;
                        color:rgba(255,255,255,0.7);text-transform:uppercase;">
                DARVINKS HEALTHCARE
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px;">
              <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a1a;">
                Password Reset
              </h2>
              <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
                Hi ${data.fullName}, your TB DARVINKS account password has been reset
                by a system administrator.
              </p>

              <!-- Credentials box -->
              <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#fdf6f7;border:1px solid #f0d0d4;border-radius:8px;
                            margin-bottom:24px;">
                <tr>
                  <td style="padding:24px;">
                    <p style="margin:0 0 12px;font-size:11px;font-weight:700;
                              letter-spacing:0.15em;color:#8B1520;text-transform:uppercase;">
                      New Temporary Password
                    </p>
                    <p style="margin:0;font-size:22px;font-weight:700;
                              color:#1a1a1a;font-family:monospace;letter-spacing:0.1em;">
                      ${data.temporaryPassword}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Warning -->
              <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;
                            margin-bottom:24px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6;">
                        <strong>Log in immediately and change this password.</strong>
                      If you did not request this reset, contact your system administrator.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8f8f8;padding:24px 40px;border-top:1px solid #eee;
                        text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;color:#888;">
                Darvinks Healthcare Ltd &nbsp;·&nbsp;
                1 African Church Close, Off Coker Road, Ilupeju Lagos, Nigeria
              </p>
              <p style="margin:0;font-size:11px;color:#aaa;">
                If you did not expect this email, please contact support immediately.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
  }
}