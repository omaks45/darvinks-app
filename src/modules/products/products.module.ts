
import { Module } from '@nestjs/common';
import { ProductController } from './products.controller';
import { ProductService } from './products.service';

@Module({
  controllers: [ProductController],
  providers:   [ProductService],
  exports:     [ProductService], // exported for use in PurchaseOrder, Warehouse, Analytics
})
export class ProductModule {}