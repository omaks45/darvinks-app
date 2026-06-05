// src/modules/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsProcessor } from './notifications.processor';
import { IdCardWorker } from './workers/id-card.worker';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';
import { PrismaModule } from '@common/prisma/prisma.module';

// UsersModule intentionally NOT imported here — IdCardWorker uses
// PrismaService directly to avoid module path inconsistencies

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    PrismaModule,
    CloudinaryModule,
  ],
  providers: [NotificationsProcessor, IdCardWorker],
  exports: [IdCardWorker],
})
export class NotificationsModule {}