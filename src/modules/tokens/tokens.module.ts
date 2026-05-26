
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bull';
import { TokenService } from './tokens.service';

@Module({
  imports: [
    JwtModule.register({}), // secrets injected per-call in TokenService
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  providers: [TokenService],
  exports: [TokenService],
})
export class TokensModule {}