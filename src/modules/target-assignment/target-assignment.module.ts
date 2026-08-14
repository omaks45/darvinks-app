
import { Module } from '@nestjs/common';
import { TargetAssignmentController } from './target-assignment.controller';
import { TargetAssignmentService } from './target-assignment.service';
import { NotificationsModule } from '@modules/notifications/notifications.module';

@Module({
  imports:     [NotificationsModule],
  controllers: [TargetAssignmentController],
  providers:   [TargetAssignmentService],
  exports:     [TargetAssignmentService],
})
export class TargetAssignmentModule {}