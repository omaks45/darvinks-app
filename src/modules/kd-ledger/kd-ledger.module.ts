
import { Module } from '@nestjs/common';
import { KdLedgerController } from './kd-ledger.controller';
import { KdLedgerService } from './kd-ledger.service';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';
import { GoogleModule } from '@common/google/google.module';

@Module({
  imports:     [CloudinaryModule, GoogleModule],
  controllers: [KdLedgerController],
  providers:   [KdLedgerService],
  exports:     [KdLedgerService],
})
export class KdLedgerModule {}