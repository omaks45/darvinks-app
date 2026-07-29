
// Scheduled weekly analytics report job.
// Runs every Monday at 06:00 WAT (05:00 UTC) — before the business day
// starts so reports are ready when field staff open the app.
//
// The job:
//  1. Determines the previous week's period month
//  2. Builds the full analytics dataset via AnalyticsService
//  3. Generates PPT (org-wide) and Excel files
//  4. Uploads both to Cloudinary for permanent downloadable URLs
//  5. Stores the URLs in a AnalyticsReport record so the download
//     endpoint can serve them without re-generating on every request

import { Logger } from '@nestjs/common';
import { Processor, Process, InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService, CloudinaryFolder } from '@modules/cloudinary/cloudinary.service';
import { AnalyticsService } from '../analytics.service';
import { ReportGeneratorService } from '../report-generator.service';

export interface AnalyticsReportJob {
    periodMonth: string;   // period string e.g. "2026-07", "2026-Q2", "2026-W30", "2026"
    periodType:  'weekly' | 'monthly' | 'quarterly' | 'annual';
    triggeredBy: 'schedule' | 'manual';
}

@Processor('analytics')
export class AnalyticsProcessor {
    private readonly logger = new Logger(AnalyticsProcessor.name);

    constructor(
        private readonly analytics:  AnalyticsService,
        private readonly generator:  ReportGeneratorService,
        private readonly cloudinary: CloudinaryService,
        private readonly prisma:     PrismaService,
    ) {}

    @Process('generate-weekly-report')
    async handleWeeklyReport(job: Job<AnalyticsReportJob>): Promise<void> {
        const { periodMonth, periodType = 'monthly', triggeredBy } = job.data;
        this.logger.log(
        `Analytics report job started — ${periodType}: ${periodMonth}, trigger: ${triggeredBy}`,
        );

        try {
        await job.progress(10);
        const data = await this.analytics.buildReportData(periodMonth, periodType);
        this.logger.log(
            `Data built — ${data.locationPerformance.length} location rows, ` +
            `${data.userPerformance.length} user rows`,
        );

        // ── 2. Generate files ──────────────────────────────────────────────────
        await job.progress(30);
        const [pptBuffer, xlsxBuffer] = await Promise.all([
            this.generator.generatePpt(data, 'org'),
            this.generator.generateExcel(data),
        ]);
        this.logger.log(
            `Files generated — PPT: ${pptBuffer.length} bytes, XLSX: ${xlsxBuffer.length} bytes`,
        );

        // ── 3. Upload to Cloudinary ────────────────────────────────────────────
        await job.progress(60);
        const folder    = `analytics/${periodMonth}` as CloudinaryFolder;
        const timestamp = Date.now();

        const [pptUpload, xlsxUpload] = await Promise.all([
            this.cloudinary.uploadBuffer(
            pptBuffer,
            folder,
            {
                publicId:     `report-${timestamp}-ppt`,
                resourceType: 'raw',
            },
            ),
            this.cloudinary.uploadBuffer(
            xlsxBuffer,
            folder,
            {
                publicId:     `report-${timestamp}-xlsx`,
                resourceType: 'raw',
            },
            ),
        ]);
        this.logger.log('Uploaded to Cloudinary');

        // ── 4. Persist URLs so download endpoint can serve them ───────────────
        await job.progress(90);
        await this.prisma.analyticsReport.upsert({
            where:  { periodMonth },
            create: {
            periodMonth,
            pptUrl:      pptUpload.secure_url,
            xlsxUrl:     xlsxUpload.secure_url,
            generatedAt: data.generatedAt,
            },
            update: {
            pptUrl:      pptUpload.secure_url,
            xlsxUrl:     xlsxUpload.secure_url,
            generatedAt: data.generatedAt,
            },
        });

        await job.progress(100);
        this.logger.log(`Analytics report for ${periodMonth} complete`);

        } catch (err) {
        this.logger.error(
            `Analytics report job failed for ${periodMonth}: ${(err as Error).message}`,
            (err as Error).stack,
        );
        throw err; // Re-throw so BullMQ marks the job as failed and can retry
        }
    }
}