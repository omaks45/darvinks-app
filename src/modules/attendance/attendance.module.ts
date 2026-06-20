// src/modules/attendance/attendance.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { GoogleModule } from '@common/google/google.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    GoogleModule,
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}