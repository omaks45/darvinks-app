
import { Module } from '@nestjs/common';
import { GoogleModule } from '@common/google/google.module';
import { BullModule } from '@nestjs/bull';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [
    GoogleModule,
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService], // needed by DashboardModule (Phase 4) for hasClockedInToday()
})
export class AttendanceModule {}