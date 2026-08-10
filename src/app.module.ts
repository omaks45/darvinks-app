// src/app.module.ts
import * as dotenv from 'dotenv';
dotenv.config(); // Load .env BEFORE anything else runs

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';

import appConfig from '@common/config/app.config';
import { validateEnv } from '@common/config/env.validation';
//import type { AppConfig } from '@common/config/app.config';

import { PrismaModule } from '@common/prisma/prisma.module';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';
import { TokensModule } from '@modules/tokens/tokens.module';

import { AuthModule } from '@modules/auths/auths.module';
import { AdminModule } from '@modules/admin/admin.module';
import { UsersModule } from '@modules/user/user.module';
import { AttendanceModule } from '@modules/attendance/attendance.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { ProductModule } from '@modules/products/products.module';
import { CustomerModule } from '@modules/customer/customer.module';
import { WarehouseModule } from '@modules/warehouse/warehouse.module';
import { PurchaseOrderModule } from '@modules/purchase/purchase.module';
import { CollectionModule } from '@modules/collections/collections.module';
import { SecondarySaleModule } from '@modules/seconday-sales/seconday-sales.module';
import { TargetAssignmentModule } from '@modules/target-assignment/target-assignment.module';
import { CompetitorReportModule } from '@modules/competitor-report/competitor-report.module';
import { DashboardModule } from '@modules/dashboard/dashboard.module';
import { AnalyticsModule } from '@modules/analytics/analytics.module';
import { LocationTargetModule } from '@modules/location-target/location-target.module';
import { LocationModule } from '@modules/location/location.module';
import { KdLedgerModule } from '@modules/kd-ledger/kd-ledger.module';
import { SecondarySaleInvoiceModule } from '@modules/secondary-sale-invoice/secondary-sale-invoice.module';
import { StockCollectionModule } from '@modules/stock-collection/stock-collection.module';

// Read REDIS_URL directly from process.env AFTER dotenv.config() has run
const REDIS_URL = process.env.REDIS_URL;
console.log('>>> BullMQ REDIS_URL:', REDIS_URL ? REDIS_URL.substring(0, 40) + '...' : 'NOT FOUND');

function parsedRedisUrl() {
  if (!REDIS_URL) {
    console.warn('>>> REDIS_URL not found — falling back to localhost:6379');
    return { host: 'localhost', port: 6379 };
  }
  // Parse the URL manually into host/port/password that Bull understands
  try {
    const url = new URL(REDIS_URL);
    const config: any = {
      host: url.hostname,
      port: parseInt(url.port, 10),
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
    if (url.password) config.password = decodeURIComponent(url.password);
    if (url.username && url.username !== 'default') config.username = url.username;
    if (url.protocol === 'rediss:') config.tls = {};
    console.log(`>>> Bull connecting to: ${url.hostname}:${url.port}`);
    return config;
  } catch (e) {
    console.error('>>> Failed to parse REDIS_URL:', e);
    return { host: 'localhost', port: 6379 };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      validate: validateEnv,
      cache: true,
      envFilePath: ['.env', '.env.development', '.env.local'],
    }),

    // Parse REDIS_URL into host/port/password — Bull ignores the url: option
    BullModule.forRoot({
      redis: parsedRedisUrl(),
    }),

    PrismaModule,
    CloudinaryModule,
    TokensModule,

    AuthModule,
    AdminModule,
    UsersModule,
    AttendanceModule,
    NotificationsModule,
    ProductModule,
    CustomerModule,
    WarehouseModule,
    PurchaseOrderModule,
    CollectionModule,
    SecondarySaleModule,
    StockCollectionModule,
    SecondarySaleInvoiceModule,
    KdLedgerModule,
    TargetAssignmentModule,
    CompetitorReportModule,
    DashboardModule,
    LocationModule,
    LocationTargetModule,
    AnalyticsModule,
  ],
})
export class AppModule {}