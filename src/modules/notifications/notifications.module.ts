// src/modules/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsProcessor } from './notifications.processor';
import { IdCardWorker } from './workers/id-card.worker';
import { UsersModule } from '@modules/user/user.module';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    UsersModule,
    CloudinaryModule,
  ],
  providers: [NotificationsProcessor, IdCardWorker],
})
export class NotificationsModule {}