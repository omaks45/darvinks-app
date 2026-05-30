// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';

// ── Config — import from wherever YOUR files actually live ───────────────────
// These paths use @common/config alias which maps to src/common/config/
import appConfig from '@common/config/app.config';
import { validateEnv } from '@common/config/env.validation';
import { buildRedisConnection } from '@common/config/redis.config';
import type { AppConfig } from '@common/config/app.config';

// Infrastructure
import { PrismaModule } from '@common/prisma/prisma.module';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';
import { TokensModule } from '@modules/tokens/tokens.module';
//import { NotificationsModule } from '@modules/notifications/notifications.module';

// Feature modules
import { AuthModule } from '@modules/auths/auths.module';
import { AdminModule } from '@modules/admin/admin.module';
//import { UsersModule } from '@modules/users/users.module';
//import { AttendanceModule } from '@modules/attendance/attendance.module';

@Module({
  imports: [
    // ── Config — must be first ───────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      validate: validateEnv,
      cache: true,
      // Explicitly tell NestJS where to find the .env file
      // This resolves to the project root regardless of where ts-node runs from
      envFilePath: ['.env', '.env.development', '.env.local'],
    }),

    // ── BullMQ — Redis connection (dev: localhost, prod: Redis Cloud) ─────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<AppConfig>) => ({
        redis: buildRedisConnection(cfg),
      }),
    }),

    // ── Infrastructure (global) ───────────────────────────────────────────────
    PrismaModule,
    CloudinaryModule,
    TokensModule,

    // ── Feature modules ───────────────────────────────────────────────────────
    AuthModule,
    AdminModule,
    //UsersModule,
    //AttendanceModule,
    //NotificationsModule,
  ],
})
export class AppModule {}