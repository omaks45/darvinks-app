import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsProcessor } from './notifications.processor';
import { UsersModule } from '@modules/user/user.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    UsersModule,
  ],
  providers: [NotificationsProcessor],
})
export class NotificationsModule {}