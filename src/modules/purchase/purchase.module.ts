// src/modules/purchase-orders/purchase-order.module.ts
import { Module } from '@nestjs/common';
import { PurchaseOrderController } from './purchase.controller';
import { PurchaseOrderService } from './purchase.service';
import { ProductModule } from '@modules/products/products.module';
import { GoogleModule } from '@common/google/google.module';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';

@Module({
  imports:     [ProductModule, GoogleModule,  CloudinaryModule,  NotificationsModule],
  controllers: [PurchaseOrderController],
  providers:   [PurchaseOrderService],
  exports:     [PurchaseOrderService],
})
export class PurchaseOrderModule {}