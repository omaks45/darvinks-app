
import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { GoogleModule } from '@common/google/google.module';

@Module({
  imports:     [GoogleModule],
  controllers: [CustomerController],
  providers:   [CustomerService],
  exports:     [CustomerService],
})
export class CustomerModule {}