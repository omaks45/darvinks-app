
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';
import { MailModule } from '@modules/email/email.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    CloudinaryModule,
    MailModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],   // ← exported so AuthModule can use getInvite
})
export class AdminModule {}