// Validates all required environment variables at application startup.
// Any missing or malformed variable throws immediately — fail fast.

import { plainToInstance, Transform } from 'class-transformer';
import {
    IsEnum,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Max,
    Min,
    validateSync,
} from 'class-validator';

enum Environment {
    Development = 'development',
    Production = 'production',
    Test = 'test',
}

// Explicit string→number coercion decorator.
// Required because class-transformer v0.5.x's enableImplicitConversion
// does not reliably coerce strings to numbers when the class property
// already has a numeric default value.
const ToInt = () => Transform(({ value }) => parseInt(value, 10));

class EnvironmentVariables {
    // ── Application ────────────────────────────────────────────────────────────

    @IsEnum(Environment)
    NODE_ENV: Environment = Environment.Development;

    @ToInt()
    @IsInt()
    @Min(1)
    @Max(65535)
    PORT = 3000;

    @IsString()
    @IsOptional()
    API_PREFIX = 'api/v1';

    // ── Database ───────────────────────────────────────────────────────────────

    @IsString()
    @IsNotEmpty()
    DATABASE_URL!: string;

    // ── JWT ────────────────────────────────────────────────────────────────────

    @IsString()
    @IsNotEmpty()
    JWT_ACCESS_SECRET!: string;

    @IsString()
    @IsNotEmpty()
    JWT_REFRESH_SECRET!: string;

    @IsString()
    @IsNotEmpty()
    JWT_ACCESS_EXPIRY = '12h';

    @IsString()
    @IsNotEmpty()
    JWT_REFRESH_EXPIRY = '30d';

    // ── Redis ──────────────────────────────────────────────────────────────────
    // Dev  → host + port (local Redis)
    // Prod → REDIS_URL (Redis Cloud TLS — validated separately below)

    @IsString()
    @IsNotEmpty()
    REDIS_HOST = 'localhost';

    @ToInt()
    @IsInt()
    @Min(1)
    @Max(65535)
    REDIS_PORT = 6379;

    @IsString()
    @IsOptional()
    REDIS_PASSWORD?: string;

    @IsString()
    @IsOptional()
    REDIS_URL?: string;

    // ── Cloudinary ─────────────────────────────────────────────────────────────

    @IsString()
    @IsNotEmpty()
    CLOUDINARY_CLOUD_NAME!: string;

    @IsString()
    @IsNotEmpty()
    CLOUDINARY_API_KEY!: string;

    @IsString()
    @IsNotEmpty()
    CLOUDINARY_API_SECRET!: string;

    // ── Google ─────────────────────────────────────────────────────────────────

    @IsString()
    @IsNotEmpty()
    GOOGLE_MAPS_API_KEY!: string;

    // ── Firebase ───────────────────────────────────────────────────────────────

    @IsString()
    @IsNotEmpty()
    FIREBASE_SERVICE_ACCOUNT!: string;

    // ── Mail (SMTP) ────────────────────────────────────────────────────────────
    //
    // Currently: Gmail SMTP
    //   MAIL_HOST=smtp.gmail.com
    //   MAIL_PORT=587
    //   MAIL_USER=omaks1914@gmail.com
    //   MAIL_PASSWORD=<gmail-app-password>   ← generate at myaccount.google.com/apppasswords
    //
    // Later (Zepto — when domain is ready):
    //   MAIL_HOST=smtp.zeptomail.com
    //   MAIL_PORT=587
    //   MAIL_USER=emailapikey
    //   MAIL_PASSWORD=<zepto-api-key>
    //   MAIL_FROM=no-reply@yourdomain.com
    //   MAIL_FROM_NAME=Darvinks Healthcare
    //
    // No code changes needed when switching — only .env changes.

    @IsString()
    @IsNotEmpty()
    MAIL_HOST!: string;

    @ToInt()
    @IsInt()
    @Min(1)
    @Max(65535)
    MAIL_PORT = 587;

    @IsString()
    @IsNotEmpty()
    MAIL_USER!: string;

    @IsString()
    @IsNotEmpty()
    MAIL_PASSWORD!: string;

    // MAIL_FROM defaults to MAIL_USER if not set (fine for Gmail dev)
    @IsString()
    @IsOptional()
    MAIL_FROM?: string;

    @IsString()
    @IsOptional()
    MAIL_FROM_NAME?: string;

    // ── Security ───────────────────────────────────────────────────────────────

    @ToInt()
    @IsInt()
    @Min(10)
    @Max(14)
    BCRYPT_ROUNDS = 12;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
    const validatedConfig = plainToInstance(EnvironmentVariables, config, {
        enableImplicitConversion: true,
    });

    const errors = validateSync(validatedConfig, {
        skipMissingProperties: false,
    });

    if (errors.length > 0) {
        const messages = errors
            .map((e) => Object.values(e.constraints ?? {}).join(', '))
            .join('\n');
        throw new Error(`Environment validation failed:\n${messages}`);
    }

    // ── Cross-field rules (can't be expressed with class-validator decorators) ─

    // Rule 1: REDIS_URL is required in production
    if (config['NODE_ENV'] === 'production' && !config['REDIS_URL']) {
        throw new Error(
            'Environment validation failed: REDIS_URL is required in production (Redis Cloud)',
        );
    }

    // Rule 2: Gmail app password warning — catches accidental use of real password
    if (
        config['NODE_ENV'] !== 'production' &&
        config['MAIL_HOST'] === 'smtp.gmail.com' &&
        typeof config['MAIL_PASSWORD'] === 'string' &&
        (config['MAIL_PASSWORD'] as string).includes(' ')
    ) {
        // Gmail App Passwords are 16 chars with spaces (e.g. "abcd efgh ijkl mnop")
        // Real passwords usually don't have spaces — warn but don't block
        console.warn(
            '[Mail] MAIL_PASSWORD looks like a Gmail App Password with spaces — ' +
            "make sure you're using an App Password from myaccount.google.com/apppasswords",
        );
    }

    // Rule 3: MAIL_FROM must be set in production (can't send from gmail in prod)
    if (config['NODE_ENV'] === 'production' && !config['MAIL_FROM']) {
        throw new Error(
            'Environment validation failed: MAIL_FROM is required in production ' +
            '(set to your domain address, e.g. no-reply@darvinks.com)',
        );
    }

    return validatedConfig;
}