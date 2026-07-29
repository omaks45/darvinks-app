
import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import { PrismaService } from '@common/prisma/prisma.service';

interface IdCardData {
  userId: string;
  fullName: string;
  roleLabel: string;
  tierLabel: string;
  team: string | null;
  region: string | null;
  employeeRef: string;
  profilePictureUrl: string | null;
}

@Injectable()
export class IdCardWorker {
  private readonly logger = new Logger(IdCardWorker.name);
  private readonly templateHtml: string;
  private readonly logoBase64: string;

  constructor(
    private readonly cloudinary: CloudinaryService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.log('IdCardWorker initializing...');

    // ── Resolve template path ──────────────────────────────────────────────
    // Try multiple locations in order
    const candidates = [
      path.join(process.cwd(), 'src', 'modules', 'notifications', 'template', 'id-card.template.html'),
      path.join(process.cwd(), 'src', 'modules', 'notifications', 'templates', 'id-card.template.html'),
      path.join(__dirname, '..', 'template', 'id-card.template.html'),
      path.join(__dirname, '..', 'templates', 'id-card.template.html'),
      path.join(__dirname, 'template', 'id-card.template.html'),
    ];

    this.logger.log(`cwd: ${process.cwd()}`);
    this.logger.log(`__dirname: ${__dirname}`);

    let templatePath: string | null = null;
    for (const c of candidates) {
      this.logger.log(`Checking: ${c} → ${fs.existsSync(c) ? 'FOUND' : 'not found'}`);
      if (fs.existsSync(c)) {
        templatePath = c;
        break;
      }
    }

    if (!templatePath) {
      this.logger.error('id-card.template.html NOT FOUND in any candidate path');
      this.templateHtml = '<html><body>{{FULL_NAME}}</body></html>';
    } else {
      this.logger.log(`Template loaded from: ${templatePath}`);
      this.templateHtml = fs.readFileSync(templatePath, 'utf8');
    }

    // ── Logo (already base64 encoded) ──────────────────────────────────────
    // The LOGO_BASE64 placeholder in the template is already replaced with
    // the real base64 data URL — no file read needed here.
    this.logoBase64 = '';

    this.logger.log('IdCardWorker ready');
  }

  async generate(data: IdCardData): Promise<void> {
    this.logger.log(`Generating ID card for ${data.employeeRef}`);

    // 1. Build tier label
    const tierLabel = this.buildTierLabel(data.tierLabel);

    // 2. Build profile photo HTML
    const profilePhotoHtml = data.profilePictureUrl
      ? `<img src="${data.profilePictureUrl}" alt="${this.escapeHtml(data.fullName)}" />`
      : `<div class="front-photo-placeholder">👤</div>`;

    // 3. Build team and region blocks
    const teamBlock = data.team
      ? `<div class="front-meta-item"><label>Team</label><span>${this.escapeHtml(data.team)}</span></div>`
      : '';
    const regionBlock = data.region
      ? `<div class="front-meta-item"><label>Region</label><span>${this.escapeHtml(data.region)}</span></div>`
      : '';

    // 4. Substitute all placeholders
    const html = this.templateHtml
      .replace(/\{\{FULL_NAME\}\}/g, this.escapeHtml(data.fullName))
      .replace(/\{\{ROLE_LABEL\}\}/g, this.escapeHtml(data.roleLabel))
      .replace(/\{\{TIER_LABEL\}\}/g, tierLabel)
      .replace(/\{\{EMPLOYEE_REF\}\}/g, data.employeeRef)
      .replace(/\{\{PROFILE_PHOTO_HTML\}\}/g, profilePhotoHtml)
      .replace(/\{\{TEAM_BLOCK\}\}/g, teamBlock)
      .replace(/\{\{REGION_BLOCK\}\}/g, regionBlock);

    // 5. Render with Puppeteer
    let pdfBuffer: Buffer;
    try {
      const puppeteer = await import('puppeteer');
      const browser = await puppeteer.default.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });

      const pdf = await page.pdf({
        width: '361px',
        height: '480px',   // 240px front + 240px back
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });

      await browser.close();
      pdfBuffer = Buffer.from(pdf);
      this.logger.log(`PDF rendered for ${data.employeeRef}`);
    } catch (puppeteerErr) {
      this.logger.error(`Puppeteer failed for ${data.employeeRef}`, puppeteerErr);
      throw puppeteerErr;
    }

    // 6. Upload to Cloudinary
    let secure_url: string;
    try {
      const result = await this.cloudinary.uploadBuffer(
        pdfBuffer,
        'id-cards',
        {
          publicId:     `${data.employeeRef}`,
          resourceType: 'image',   // 'image' handles PDFs correctly — 'raw' serves as binary download causing blank page
        },
      );
      secure_url = result.secure_url;
      this.logger.log(`Uploaded to Cloudinary: ${secure_url}`);
    } catch (cloudErr) {
      this.logger.error(`Cloudinary upload failed for ${data.employeeRef}`, cloudErr);
      throw cloudErr;
    }

    // 7. Save URL to database
    await this.prisma.user.update({
      where: { id: data.userId },
      data: { idCardUrl: secure_url },
    });

    this.logger.log(`ID card complete for ${data.employeeRef}: ${secure_url}`);
  }

  private buildTierLabel(tier: string): string {
    const map: Record<string, string> = {
      TIER1: 'Tier 1', TIER2: 'Tier 2', TIER3: 'Tier 3', TIER4: 'Tier 4',
      TIER5_SALES_HEAD: 'Tier 5', TIER5_SYSTEM_ADMIN: 'Tier 5',
      TIER5_WAREHOUSE: 'Tier 5', TIER6_GM: 'Tier 6',
    };
    return map[tier] ?? tier;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private resolveConditionals(html: string, conditions: Record<string, boolean>): string {
    for (const [key, value] of Object.entries(conditions)) {
      const regex = new RegExp(`\\{\\{#if ${key}\\}\\}([\\s\\S]*?)\\{\\{\\/if\\}\\}`, 'g');
      html = html.replace(regex, value ? '$1' : '');
    }
    return html;
  }
}