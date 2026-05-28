import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { BullModule } from '@nestjs/bull';
import { AuthController } from './auths.controller';
import { AuthService } from './auths.service';
import { JwtStrategy } from './strategies/jwt.strategies';
import { TokensModule } from '../../modules/tokens/tokens.module';
import { CloudinaryModule } from '../../modules/cloudinary/cloudinary.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TokensModule,
    CloudinaryModule,
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}