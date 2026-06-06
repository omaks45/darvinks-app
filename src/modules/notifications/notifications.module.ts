
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsProcessor } from './notifications.processor';
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
  providers: [NotificationsProcessor, IdCardWorker],
  exports: [IdCardWorker],
})
export class NotificationsModule {}