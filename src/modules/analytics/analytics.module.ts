
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ReportGeneratorService } from './report-generator.service';
import { AnalyticsProcessor } from './jobs/analytics.processor';
import { AnalyticsScheduler } from './jobs/analytics.scheduler';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';

@Module({
  imports: [
    CloudinaryModule,
    BullModule.registerQueue({ name: 'analytics' }),
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    ReportGeneratorService,
    AnalyticsProcessor,
    AnalyticsScheduler,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}