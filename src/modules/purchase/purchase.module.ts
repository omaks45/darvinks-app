// src/modules/purchase-orders/purchase-order.module.ts
import { Module } from '@nestjs/common';
import { PurchaseOrderController } from './purchase.controller';
import { PurchaseOrderService } from './purchase.service';
import { ProductModule } from '@modules/products/products.module';

@Module({
  imports:     [ProductModule],
  controllers: [PurchaseOrderController],
  providers:   [PurchaseOrderService],
  exports:     [PurchaseOrderService],
})
export class PurchaseOrderModule {}