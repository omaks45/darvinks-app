// Resolves the correct Redis connection for BullMQ queues.
// Dev: localhost Redis (host + port)
// Production: Redis Cloud via TLS URL (rediss://...)

import { ConfigService } from '@nestjs/config';
import type { AppConfig, RedisConfig } from './app.config';

/**
 * Returns a Bull/BullMQ-compatible Redis connection options object.
 * - In development: connects to localhost using host + port.
 * - In production: connects to Redis Cloud via the TLS URL.
 *
 * Consumed by BullModule.forRootAsync() in AppModule.
 */
export function buildRedisConnection(
    cfg: ConfigService<AppConfig>,
    ): object {
    const redis = cfg.get<RedisConfig>('redis')!;
    const isProduction = cfg.get<boolean>('isProduction');

    if (isProduction && redis.url) {
        // Redis Cloud — TLS connection via URL (rediss://...)
        return {
        url: redis.url,
        tls: {},              // Enable TLS for Redis Cloud
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        };
    }

    // Development / local Redis
    return {
        host: redis.host,
        port: redis.port,
        ...(redis.password ? { password: redis.password } : {}),
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    };
}

/**
 * Returns an ioredis-compatible connection config for standalone use
 * (e.g. token store, cache — outside of BullMQ).
 */
export function buildIoRedisConnection(
    cfg: ConfigService<AppConfig>,
    ): object {
    const redis = cfg.get<RedisConfig>('redis')!;
    const isProduction = cfg.get<boolean>('isProduction');

    if (isProduction && redis.url) {
        return { url: redis.url, tls: {} };
    }

    return {
        host: redis.host,
        port: redis.port,
        ...(redis.password ? { password: redis.password } : {}),
    };
}