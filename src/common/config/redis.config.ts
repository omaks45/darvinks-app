
import { ConfigService } from '@nestjs/config';
import type { AppConfig, RedisConfig } from '@common/config/app.config';

/**
 * Returns a Bull-compatible Redis connection.
 * If REDIS_URL is set in .env, it is ALWAYS used (dev or prod).
 * Falls back to host+port only when REDIS_URL is not set.
 */
export function buildRedisConnection(cfg: ConfigService<AppConfig>): object {
    const redis = cfg.get<RedisConfig>('redis')!;

    if (redis.url) {
        const isTls = redis.url.startsWith('rediss://');
        return {
        url: redis.url,
        ...(isTls ? { tls: {} } : {}),
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        };
    }

    // Local Redis fallback (only when REDIS_URL not set)
    return {
        host: redis.host ?? 'localhost',
        port: redis.port ?? 6379,
        ...(redis.password ? { password: redis.password } : {}),
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    };
}

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
        host: redis.host ?? 'localhost',
        port: redis.port ?? 6379,
        ...(redis.password ? { password: redis.password } : {}),
    };
}