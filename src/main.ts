
import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from '@common/filters/http-exception.filter';
import { TransformInterceptor } from '@common/interceptors/transform.interceptor';
import type { AppConfig } from '@common/config/app.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error', 'debug'],
  });

  const config = app.get(ConfigService<AppConfig>);
  const port = config.get<number>('port') ?? 3000;
  const prefix = config.get<string>('apiPrefix') ?? 'api/v1';
  const isProduction = config.get<boolean>('isProduction');

  app.setGlobalPrefix(prefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)),
    new TransformInterceptor(),
  );

  app.enableCors({
    origin: isProduction
      ? ['https://app.darvinks.com', 'https://admin.darvinks.com']
      : '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('TB DARVINKS API')
      .setDescription(
        `Field Sales & Distribution Management Platform\n\n` +
        `## Authentication\nAll protected endpoints require a Bearer token.\n` +
        `Get your token from \`POST /auth/login\`.\n\n` +
        `## User Tiers\n` +
        `| Tier | Roles | Account Type |\n` +
        `|------|-------|----------|\n` +
        `| Tier 1 | Merchandiser, Promoter, DBSR, VSR | Self-registered |\n` +
        `| Tier 2 | Sales Representative, SSR | Self-registered |\n` +
        `| Tier 3 | ATSM, TSM | Self-registered |\n` +
        `| Tier 4 | Zonal Sales Manager | Self-registered |\n` +
        `| Tier 5 | Sales Head, System Admin, Warehouse Admin | Provisioned |\n` +
        `| Tier 6 | General Manager | Provisioned |`,
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .addTag('Authentication', 'Registration, login, token refresh, logout')
      .addTag('Admin', 'System Admin — account provisioning, user management')
      .addTag('Users', 'User profiles and visibility')
      .addTag('Attendance', 'Clock-in, clock-out, KD visits, offline sync')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${prefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
      customSiteTitle: 'TB DARVINKS API Docs',
    });
  }

  await app.listen(port);
  console.log(`TB DARVINKS API → http://localhost:${port}/${prefix}`);
  if (!isProduction) {
    console.log(`Swagger docs    → http://localhost:${port}/${prefix}/docs`);
  }
}

bootstrap();