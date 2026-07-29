
// Schedules the weekly analytics report job using BullMQ's built-in
// repeat/cron support. Fires every Monday at 06:00 WAT (05:00 UTC).
//
// Why 06:00 WAT? Reports are ready before the business day starts so
// field staff can open the app and see current-week data immediately.
//
// The job computes the CURRENT period month (not the previous week)
// so the report always reflects the live month-to-date picture rather
// than a fully-closed historical period. For a closed-period report
// the job can be triggered manually via POST /analytics/trigger.

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import type { AnalyticsReportJob } from './analytics.processor';

@Injectable()
export class AnalyticsScheduler implements OnModuleInit {
    private readonly logger = new Logger(AnalyticsScheduler.name);

    constructor(
        @InjectQueue('analytics') private readonly analyticsQueue: Queue,
    ) {}

    async onModuleInit() {
        // Remove any stale repeatable jobs from previous deployments before
        // registering the current schedule — prevents duplicate job runs if
        // the cron expression changes across deployments.
        const repeatableJobs = await this.analyticsQueue.getRepeatableJobs();
        for (const job of repeatableJobs) {
        await this.analyticsQueue.removeRepeatableByKey(job.key);
        this.logger.log(`Removed stale repeatable job: ${job.key}`);
        }

        // Register the weekly schedule
        await this.analyticsQueue.add(
        'generate-weekly-report',
        this.buildJobData(),
        {
            repeat: {
            cron:     '0 5 * * 1',  // Every Monday at 05:00 UTC = 06:00 WAT
            tz:       'Africa/Lagos',
            },
            attempts:  3,
            backoff:   { type: 'exponential', delay: 60_000 }, // retry after 1min, 2min, 4min
            removeOnComplete: 10,   // keep last 10 completed jobs for audit
            removeOnFail:      5,   // keep last 5 failures for debugging
        },
        );

        this.logger.log(
        'Analytics weekly job scheduled — runs every Monday at 06:00 WAT (05:00 UTC)',
        );
    }

    /** Manually trigger a report generation for a specific period.
     *  Called from POST /analytics/trigger (Admin only).
     */
    async triggerManually(
        period: string,
        periodType: 'weekly' | 'monthly' | 'quarterly' | 'annual' = 'monthly',
    ): Promise<void> {
        await this.analyticsQueue.add(
        'generate-weekly-report',
        {
            periodMonth: period,
            periodType,
            triggeredBy: 'manual',
        } satisfies AnalyticsReportJob,
        {
            attempts: 2,
            backoff:  { type: 'fixed', delay: 30_000 },
        },
        );
        this.logger.log(
        `Manual analytics report triggered — ${periodType}: ${period}`,
        );
    }

    private buildJobData(): AnalyticsReportJob {
        const now = new Date();
        const y   = now.getFullYear();
        const m   = String(now.getMonth() + 1).padStart(2, '0');
        return {
        periodMonth: `${y}-${m}`,
        periodType:  'monthly',   // scheduled job always covers the current month
        triggeredBy: 'schedule',
        };
    }
}