    // src/config/app.config.ts
// Central configuration factory — all env vars validated here once at startup.
// Modules consume typed config via ConfigService<AppConfig>.

export interface RedisConfig {
    host: string;
    port: number;
    password: string | undefined;
    url: string | undefined; // Redis Cloud TLS URL (production)
}

export interface JwtConfig {
    accessSecret: string;
    refreshSecret: string;
    accessExpiry: string;
    refreshExpiry: string;
}

export interface CloudinaryConfig {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
}

/**
 * Mail transport configuration.
 *
 * Current provider  : Gmail SMTP (development)
 * Planned provider  : Zepto Mail SMTP (production — switch when domain is ready)
 *
 * Switching to Zepto later requires only .env changes — no code changes:
 *   MAIL_HOST=smtp.zeptomail.com
 *   MAIL_PORT=587
 *   MAIL_USER=emailapikey          ← Zepto uses "emailapikey" as the username
 *   MAIL_PASSWORD=<zepto-api-key>
 *   MAIL_FROM=no-reply@yourdomain.com
 *   MAIL_SECURE=false              ← Zepto STARTTLS on 587, same as Gmail
 */
export interface MailConfig {
  host: string;       // SMTP host
  port: number;       // SMTP port (587 = STARTTLS, 465 = SSL)
  secure: boolean;    // true = SSL/TLS (port 465), false = STARTTLS (port 587)
  user: string;       // SMTP auth username
  password: string;   // SMTP auth password / app password
  from: string;       // "From" address shown to recipients
  fromName: string;   // Display name shown alongside the from address
}

export interface AppConfig {
    nodeEnv: string;
    port: number;
    apiPrefix: string;
    isProduction: boolean;
    database: { url: string };
    jwt: JwtConfig;
    redis: RedisConfig;
    cloudinary: CloudinaryConfig;
    googleMapsApiKey: string;
    firebase: { serviceAccount: string };
    mail: MailConfig;
    bcryptRounds: number;
}

export default (): AppConfig => {
    const mailPort = parseInt(process.env.MAIL_PORT ?? '587', 10);

    return {
        nodeEnv: process.env.NODE_ENV ?? 'development',
        port: parseInt(process.env.PORT ?? '3000', 10),
        apiPrefix: process.env.API_PREFIX ?? 'api/v1',
        isProduction: process.env.NODE_ENV === 'production',

        database: {
        url: process.env.DATABASE_URL!,
        },

        jwt: {
        accessSecret: process.env.JWT_ACCESS_SECRET!,
        refreshSecret: process.env.JWT_REFRESH_SECRET!,
        accessExpiry: process.env.JWT_ACCESS_EXPIRY ?? '12h',
        refreshExpiry: process.env.JWT_REFRESH_EXPIRY ?? '30d',
        },

        redis: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        // REDIS_URL takes precedence in production (Redis Cloud TLS URL)
        url: process.env.REDIS_URL || undefined,
        },

        cloudinary: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
        apiKey: process.env.CLOUDINARY_API_KEY!,
        apiSecret: process.env.CLOUDINARY_API_SECRET!,
        },

        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY!,

        firebase: {
        serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT!,
        },

        mail: {
        host: process.env.MAIL_HOST ?? 'smtp.gmail.com',
        port: mailPort,
        // Port 465 = implicit SSL; anything else (587, 25) = STARTTLS
        secure: mailPort === 465,
        user: process.env.MAIL_USER!,
        password: process.env.MAIL_PASSWORD!,
        from: process.env.MAIL_FROM ?? process.env.MAIL_USER!,
        fromName: process.env.MAIL_FROM_NAME ?? 'Darvinks Healthcare',
        },

        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
    };
};