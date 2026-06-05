
// Basic smoke test — verifies the app boots and the health endpoint responds.
import request from 'supertest';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { buildTestApp, cleanDatabase } from './helpers/app.helper';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('App (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await buildTestApp());
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('GET /api/v1/auth/roles — app is running and responds', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/roles')
      .expect(HttpStatus.OK);
  });

  it('responds 401 on a protected route without a token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .expect(HttpStatus.UNAUTHORIZED);
  });
});