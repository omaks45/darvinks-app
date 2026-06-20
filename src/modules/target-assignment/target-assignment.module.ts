
import { Module } from '@nestjs/common';
import { TargetAssignmentController } from './target-assignment.controller';
import { TargetAssignmentService } from './target-assignment.service';

@Module({
  controllers: [TargetAssignmentController],
  providers:   [TargetAssignmentService],
  exports:     [TargetAssignmentService],
})
export class TargetAssignmentModule {}