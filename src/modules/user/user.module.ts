// src/modules/user/user.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { UsersController } from './user.controller';
import { UsersService } from './user.service';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';

@Module({
  imports: [
    CloudinaryModule,
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}