// src/modules/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';
import { PushNotificationService } from './push-notification.service';
import { IdCardWorker } from './workers/id-card.worker';
import { MailModule } from '@modules/email/email.module';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';
import { PrismaModule } from '@common/prisma/prisma.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    PrismaModule,
    CloudinaryModule,
    MailModule,
  ],
  providers: [
    NotificationsProcessor,
    NotificationsService,
    PushNotificationService,
    IdCardWorker,
  ],
  exports: [
    NotificationsService,
    PushNotificationService,  // exported so PO, target, customer modules can inject it
    IdCardWorker,
  ],
})
export class NotificationsModule {}