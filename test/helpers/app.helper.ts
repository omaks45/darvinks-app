// test/helpers/app.helper.ts
// Creates a fully wired NestJS app for integration tests.
// Mocks external I/O (Cloudinary, BullMQ) but uses real Prisma + DB.

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { CloudinaryService } from '../../src/modules/cloudinary/cloudinary.service';

// ─── Shared external service mocks ───────────────────────────────────────────

export const mockCloudinary = {
  uploadBuffer: jest.fn().mockResolvedValue({
    secure_url: 'https://res.cloudinary.com/darvinks/test-photo.jpg',
    public_id: 'test/photo',
  }),
  deleteFile: jest.fn().mockResolvedValue(undefined),
};

export const mockQueue = {
  add:     jest.fn().mockResolvedValue({ id: 'job-id' }),
  process: jest.fn(),
  // Required by NotificationsProcessor.onModuleInit() which attaches event listeners
  on:      jest.fn(),
  emit:    jest.fn(),
};

// ─── App builder ─────────────────────────────────────────────────────────────

export async function buildTestApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(CloudinaryService)
    .useValue(mockCloudinary)
    .overrideProvider(getQueueToken('notifications'))
    .useValue(mockQueue)
    .compile();

  const app = moduleFixture.createNestApplication();

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  await app.init();

  const prisma = moduleFixture.get<PrismaService>(PrismaService);

  return { app, prisma };
}

// ─── DB cleanup ───────────────────────────────────────────────────────────────

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  // Delete in FK-safe order: children first, parents last.
  // Tables are grouped by phase — add new ones here as phases are built.

  // Phase 3
  await prisma.competitorReport.deleteMany();
  await prisma.secondarySaleItem.deleteMany();
  await prisma.secondarySale.deleteMany();

  // Phase 2
  await prisma.paymentRecord.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.collection.deleteMany();
  await prisma.outOfRegionRequest.deleteMany();
  await prisma.stockEntry.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.product.deleteMany();

  // Phase 1
  await prisma.notification.deleteMany();
  await prisma.passwordResetOtp.deleteMany();
  await prisma.inviteToken.deleteMany();
  await prisma.attendanceEvent.deleteMany();
  await prisma.targetAssignment.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

// ─── Fake image buffer ────────────────────────────────────────────────────────

export function makeFakeImageBuffer(): Buffer {
  // Minimal JPEG header — passes multer JPEG filter
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]);
}