
import { Module } from '@nestjs/common';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';

@Module({
  controllers: [WarehouseController],
  providers:   [WarehouseService],
  exports:     [WarehouseService], // exported for PurchaseOrders module (OUTBOUND_PO movements)
})
export class WarehouseModule {}