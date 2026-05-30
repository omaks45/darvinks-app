
// Resolves the correct Redis connection for BullMQ queues.
// Dev: REDIS_URL (Redis Cloud) or localhost fallback
// Production: REDIS_URL (Redis Cloud TLS — rediss://...)

import { ConfigService } from '@nestjs/config';
import type { AppConfig, RedisConfig } from './app.config';

/**
 * Returns a Bull/BullMQ-compatible Redis connection options object.
 * - If REDIS_URL is set: connects via URL (works for both dev Redis Cloud and prod)
 * - If no REDIS_URL: falls back to host + port (local Redis)
 */
export function buildRedisConnection(cfg: ConfigService<AppConfig>): object {
    const redis = cfg.get<RedisConfig>('redis')!;

    if (redis.url) {
        // Redis Cloud or any URL-based connection (dev or prod)
        // rediss:// = TLS (Redis Cloud), redis:// = no TLS (local URL)
        const isTls = redis.url.startsWith('rediss://');
        return {
        url: redis.url,
        ...(isTls ? { tls: {} } : {}),
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        };
    }

    // Local Redis fallback (host + port)
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
 * outside of BullMQ (e.g. token store, cache).
 */
export function buildIoRedisConnection(cfg: ConfigService<AppConfig>): object {
    const redis = cfg.get<RedisConfig>('redis')!;

    if (redis.url) {
        const isTls = redis.url.startsWith('rediss://');
        return {
        url: redis.url,
        ...(isTls ? { tls: {} } : {}),
        };
    }

    return {
        host: redis.host,
        port: redis.port,
        ...(redis.password ? { password: redis.password } : {}),
    };
}