
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsProcessor } from './notifications.processor';
import { IdCardWorker } from './workers/id-card.worker';
import { MailModule } from '@modules/email/email.module';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';
import { PrismaModule } from '@common/prisma/prisma.module';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    PrismaModule,
    CloudinaryModule,
    MailModule,
  ],
  providers: [NotificationsProcessor,  NotificationsService, IdCardWorker],
  exports: [  NotificationsService, IdCardWorker],
})
export class NotificationsModule {}