// src/modules/customers/customer.module.ts
import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

@Module({
  controllers: [CustomerController],
  providers:   [CustomerService],
  exports:     [CustomerService], // exported for PurchaseOrder, Collections modules
})
export class CustomerModule {}