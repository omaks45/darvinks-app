
import { Module } from '@nestjs/common';
import { SecondarySaleController } from './seconday-sales.controller';
import { SecondarySaleService } from './seconday-sales.service';
import { GoogleModule } from '@common/google/google.module';

@Module({
  imports: [GoogleModule],
  controllers: [SecondarySaleController],
  providers:   [SecondarySaleService],
  exports:     [SecondarySaleService],
})
export class SecondarySaleModule {}