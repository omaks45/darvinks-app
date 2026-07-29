
import { Module } from '@nestjs/common';
import { CompetitorReportController } from './competitor-report.controller';
import { CompetitorReportService } from './competitor-report.service';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';

@Module({
  imports:     [CloudinaryModule],
  controllers: [CompetitorReportController],
  providers:   [CompetitorReportService],
  exports:     [CompetitorReportService],
})
export class CompetitorReportModule {}