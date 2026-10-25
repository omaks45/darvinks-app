
import { Module } from '@nestjs/common';
import { SecondaySalesController } from './seconday-sales.controller';
import { SecondaySalesService } from './seconday-sales.service';
import { GoogleModule } from '@common/google/google.module';

@Module({
  imports: [GoogleModule],
  controllers: [SecondaySalesController],
  providers:   [SecondaySalesService],
  exports:     [SecondaySalesService],
})
export class SecondaySalesModule {}