// src/modules/dashboard/dashboard.module.ts
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AttendanceModule } from '@modules/attendance/attendance.module';
import { TargetAssignmentModule } from '@modules/target-assignment/target-assignment.module';
import { SecondarySaleModule } from '@modules/seconday-sales/seconday-sales.module';
import { CompetitorReportModule } from '@modules/competitor-report/competitor-report.module';
import { PurchaseOrderModule } from '@modules/purchase/purchase.module';
import { CollectionModule } from '@modules/collections/collections.module';
import { CustomerModule } from '@modules/customer/customer.module';
import { WarehouseModule } from '@modules/warehouse/warehouse.module';
import { UsersModule } from '@modules/user/user.module';

// Imports every module whose service DashboardService consumes — this
// module owns no Prisma models of its own and produces no new data; it
// only composes answers that already-existing services correctly know
// how to give. Each imported module must `export` its service (all of
// them already do, following the established Phase 1-3 convention).
@Module({
  imports: [
    AttendanceModule,
    TargetAssignmentModule,
    SecondarySaleModule,
    CompetitorReportModule,
    PurchaseOrderModule,
    CollectionModule,
    CustomerModule,
    WarehouseModule,
    UsersModule,
  ],
  controllers: [DashboardController],
  providers:   [DashboardService],
})
export class DashboardModule {}