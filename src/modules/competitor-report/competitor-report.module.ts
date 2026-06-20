
import { Module } from '@nestjs/common';
import { CompetitorReportController } from './competitor-report.controller';
import { CompetitorReportService } from './competitor-report.service';

@Module({
  controllers: [CompetitorReportController],
  providers:   [CompetitorReportService],
  exports:     [CompetitorReportService],
})
export class CompetitorReportModule {}