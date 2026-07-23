
import { Module } from '@nestjs/common';
import { SecondarySaleController } from './seconday-sales.controller';
import { SecondarySaleService } from './seconday-sales.service';

@Module({
  controllers: [SecondarySaleController],
  providers:   [SecondarySaleService],
  exports:     [SecondarySaleService],
})
export class SecondarySaleModule {}