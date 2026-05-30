// test/attendance.e2e-spec.ts
// Integration tests for clock-in, clock-out, KD visits, offline sync, and queries.

import { default as request } from 'supertest';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import {
  buildTestApp,
  cleanDatabase,
  makeFakeImageBuffer,
} from './helpers/app.helper';

const API = '/api/v1';

const TIER1_USER = {
  fullName: 'Field Agent One',
  email: 'tier1-att@darvinks.com',
  phone: '+2348033000001',
  password: 'AgentPass123!',
  role: 'MERCHANDISER',
  team: 'BRIGHT',
  state: 'enugu',
  dateOfBirth: '1998-05-20',
};

const TIER2_USER = {
  fullName: 'Sales Rep One',
  email: 'tier2-att@darvinks.com',
  phone: '+2348044000001',
  password: 'RepPass123!',
  role: 'SALES_REPRESENTATIVE',
  team: 'BRIGHT',
  state: 'enugu',
  dateOfBirth: '1990-11-11',
};

// Time helpers — build ISO timestamps within valid windows
function clockInTime(): string {
  const d = new Date();
  d.setHours(8, 45, 0, 0);
  return d.toISOString();
}

function clockOutTime(): string {
  const d = new Date();
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
}

function kdVisitTime(): string {
  return new Date().toISOString();
}

describe('Attendance — Integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tier1Token: string;
  let tier1UserId: string;
  let tier2Token: string;

  beforeAll(async () => {
    ({ app, prisma } = await buildTestApp());

    // Register + login TIER1
    const reg1 = await request(app.getHttpServer())
      .post(`${API}/auth/register`)
      .field('fullName', TIER1_USER.fullName)
      .field('email', TIER1_USER.email)
      .field('phone', TIER1_USER.phone)
      .field('password', TIER1_USER.password)
      .field('role', TIER1_USER.role)
      .field('team', TIER1_USER.team)
      .field('state', TIER1_USER.state)
      .field('dateOfBirth', TIER1_USER.dateOfBirth);

    tier1UserId = reg1.body.data.userId;

    const login1 = await request(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: TIER1_USER.email, password: TIER1_USER.password });

    tier1Token = login1.body.data.accessToken;

    // Register + login TIER2
    await request(app.getHttpServer())
      .post(`${API}/auth/register`)
      .field('fullName', TIER2_USER.fullName)
      .field('email', TIER2_USER.email)
      .field('phone', TIER2_USER.phone)
      .field('password', TIER2_USER.password)
      .field('role', TIER2_USER.role)
      .field('team', TIER2_USER.team)
      .field('state', TIER2_USER.state)
      .field('dateOfBirth', TIER2_USER.dateOfBirth);

    const login2 = await request(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: TIER2_USER.email, password: TIER2_USER.password });

    tier2Token = login2.body.data.accessToken;
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  // Clear attendance events between tests to avoid duplicate-day conflicts
  beforeEach(async () => {
    await prisma.attendanceEvent.deleteMany();
  });

  // ── POST /attendance/clock-in ──────────────────────────────────────────────

  describe('POST /attendance/clock-in', () => {
    it('201: records a clock-in with valid photo and GPS', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/attendance/clock-in`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockInTime())
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.CREATED);

      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('CLOCK_IN');
      expect(res.body.data.userId).toBe(tier1UserId);
      expect(res.body.data.photoUrl).toBeDefined();
      expect(res.body.data.latitude).toBe(6.5244);
      expect(res.body.data.longitude).toBe(3.3792);
    });

    it('stores the flag field on the event', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/attendance/clock-in`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockInTime())
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.CREATED);

      expect(['ON_TIME', 'LATE', 'OUTSIDE_WINDOW']).toContain(
        res.body.data.flag,
      );
    });

    it('400: rejects duplicate clock-in on the same day', async () => {
      // First clock-in
      await request(app.getHttpServer())
        .post(`${API}/attendance/clock-in`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockInTime())
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.CREATED);

      // Second clock-in same day — must be rejected
      const res = await request(app.getHttpServer())
        .post(`${API}/attendance/clock-in`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockInTime())
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain('clock-in');
    });

    it('400: rejects request with no photo', async () => {
      await request(app.getHttpServer())
        .post(`${API}/attendance/clock-in`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockInTime())
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('400: rejects request with missing GPS coordinates', async () => {
      await request(app.getHttpServer())
        .post(`${API}/attendance/clock-in`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('deviceTime', clockInTime())
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('400: rejects non-image file upload', async () => {
      await request(app.getHttpServer())
        .post(`${API}/attendance/clock-in`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockInTime())
        .attach('photo', Buffer.from('fake-pdf'), {
          filename: 'doc.pdf',
          contentType: 'application/pdf',
        })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('401: rejects unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(`${API}/attendance/clock-in`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockInTime())
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.UNAUTHORIZED);
    });
  });

  // ── POST /attendance/clock-out ─────────────────────────────────────────────

  describe('POST /attendance/clock-out', () => {
    beforeEach(async () => {
      // Every clock-out test needs a preceding clock-in
      await request(app.getHttpServer())
        .post(`${API}/attendance/clock-in`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockInTime())
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        });
    });

    it('201: records a clock-out after a valid clock-in', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/attendance/clock-out`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockOutTime())
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.CREATED);

      expect(res.body.data.type).toBe('CLOCK_OUT');
      expect(res.body.data.userId).toBe(tier1UserId);
    });

    it('400: rejects duplicate clock-out on the same day', async () => {
      // First clock-out
      await request(app.getHttpServer())
        .post(`${API}/attendance/clock-out`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockOutTime())
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.CREATED);

      // Second clock-out — must fail
      await request(app.getHttpServer())
        .post(`${API}/attendance/clock-out`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockOutTime())
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('401: rejects unauthenticated clock-out', async () => {
      await request(app.getHttpServer())
        .post(`${API}/attendance/clock-out`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockOutTime())
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.UNAUTHORIZED);
    });
  });

  describe('POST /attendance/clock-out (no prior clock-in)', () => {
    it('400: rejects clock-out when no clock-in exists for the day', async () => {
      // No clock-in — attendance events cleared in beforeEach
      const res = await request(app.getHttpServer())
        .post(`${API}/attendance/clock-out`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockOutTime())
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.statusCode).toBe(400);
    });
  });

  // ── POST /attendance/kd-visit ──────────────────────────────────────────────

  describe('POST /attendance/kd-visit', () => {
    it('201: TIER1 can record a KD visit', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/attendance/kd-visit`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.45')
        .field('longitude', '3.45')
        .field('deviceTime', kdVisitTime())
        .field('kdAccountId', 'kd-test-123')
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'visit.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.CREATED);

      expect(res.body.data.type).toBe('KD_VISIT');
      expect(res.body.data.kdAccountId).toBe('kd-test-123');
      expect(res.body.data.flag).toBe('ON_TIME'); // KD visits are always ON_TIME
    });

    it('403: TIER2 cannot record a KD visit', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/attendance/kd-visit`)
        .set('Authorization', `Bearer ${tier2Token}`)
        .field('latitude', '6.45')
        .field('longitude', '3.45')
        .field('deviceTime', kdVisitTime())
        .field('kdAccountId', 'kd-test-123')
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'visit.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.FORBIDDEN);

      expect(res.body.statusCode).toBe(403);
    });

    it('TIER1 can record multiple KD visits on the same day', async () => {
      // First KD visit
      await request(app.getHttpServer())
        .post(`${API}/attendance/kd-visit`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.45')
        .field('longitude', '3.45')
        .field('deviceTime', kdVisitTime())
        .field('kdAccountId', 'kd-001')
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'visit1.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.CREATED);

      // Second KD visit same day — should succeed (no uniqueness constraint)
      await request(app.getHttpServer())
        .post(`${API}/attendance/kd-visit`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.50')
        .field('longitude', '3.50')
        .field('deviceTime', kdVisitTime())
        .field('kdAccountId', 'kd-002')
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'visit2.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.CREATED);
    });

    it('401: rejects unauthenticated KD visit', async () => {
      await request(app.getHttpServer())
        .post(`${API}/attendance/kd-visit`)
        .field('latitude', '6.45')
        .field('longitude', '3.45')
        .field('deviceTime', kdVisitTime())
        .field('kdAccountId', 'kd-test-123')
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'visit.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.UNAUTHORIZED);
    });
  });

  // ── GET /attendance ────────────────────────────────────────────────────────

  describe('GET /attendance', () => {
    beforeEach(async () => {
      // Create a clock-in event to query
      await request(app.getHttpServer())
        .post(`${API}/attendance/clock-in`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockInTime())
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        });
    });

    it('200: TIER1 can query their own events', async () => {
      const res = await request(app.getHttpServer())
        .get(`${API}/attendance`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .expect(HttpStatus.OK);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      // All events must belong to TIER1 user
      for (const event of res.body.data) {
        expect(event.userId).toBe(tier1UserId);
      }
    });

    it('TIER1 cannot query another user events — forced to own ID', async () => {
      const res = await request(app.getHttpServer())
        .get(`${API}/attendance?userId=some-other-user-id`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .expect(HttpStatus.OK);

      for (const event of res.body.data) {
        expect(event.userId).toBe(tier1UserId);
      }
    });

    it('TIER2 can filter events by type', async () => {
      const res = await request(app.getHttpServer())
        .get(`${API}/attendance?type=CLOCK_IN&userId=${tier1UserId}`)
        .set('Authorization', `Bearer ${tier2Token}`)
        .expect(HttpStatus.OK);

      for (const event of res.body.data) {
        expect(event.type).toBe('CLOCK_IN');
      }
    });

    it('results are ordered by deviceTime descending', async () => {
      const res = await request(app.getHttpServer())
        .get(`${API}/attendance`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .expect(HttpStatus.OK);

      const times = res.body.data.map((e: { deviceTime: string }) =>
        new Date(e.deviceTime).getTime(),
      );

      for (let i = 1; i < times.length; i++) {
        expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
      }
    });

    it('401: rejects unauthenticated query', async () => {
      await request(app.getHttpServer())
        .get(`${API}/attendance`)
        .expect(HttpStatus.UNAUTHORIZED);
    });
  });

  // ── POST /attendance/sync (offline batch) ──────────────────────────────────

  describe('POST /attendance/sync', () => {
    it('200: processes a valid batch of offline events', async () => {
      const events = JSON.stringify([
        {
          type: 'CLOCK_IN',
          latitude: 6.5244,
          longitude: 3.3792,
          deviceTime: clockInTime(),
          note: 'offline sync test',
        },
      ]);

      const res = await request(app.getHttpServer())
        .post(`${API}/attendance/sync`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('events', events)
        .attach('photos', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.OK);

      expect(res.body.data.processed).toBe(1);
      expect(res.body.data.skipped).toBe(0);
    });

    it('200: skips duplicate events in offline batch', async () => {
      // Create a clock-in event directly first
      await request(app.getHttpServer())
        .post(`${API}/attendance/clock-in`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('latitude', '6.5244')
        .field('longitude', '3.3792')
        .field('deviceTime', clockInTime())
        .attach('photo', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        });

      // Now sync the same event — should be skipped as duplicate
      const events = JSON.stringify([
        {
          type: 'CLOCK_IN',
          latitude: 6.5244,
          longitude: 3.3792,
          deviceTime: clockInTime(),
        },
      ]);

      const res = await request(app.getHttpServer())
        .post(`${API}/attendance/sync`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('events', events)
        .attach('photos', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.OK);

      expect(res.body.data.processed).toBe(0);
      expect(res.body.data.skipped).toBe(1);
    });

    it('200: skips events with no corresponding photo', async () => {
      const events = JSON.stringify([
        {
          type: 'CLOCK_IN',
          latitude: 6.5244,
          longitude: 3.3792,
          deviceTime: clockInTime(),
        },
        {
          type: 'CLOCK_OUT',
          latitude: 6.5244,
          longitude: 3.3792,
          deviceTime: clockOutTime(),
        },
      ]);

      // Only one photo for two events
      const res = await request(app.getHttpServer())
        .post(`${API}/attendance/sync`)
        .set('Authorization', `Bearer ${tier1Token}`)
        .field('events', events)
        .attach('photos', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.OK);

      expect(res.body.data.processed).toBe(1);
      expect(res.body.data.skipped).toBe(1);
    });

    it('401: rejects unauthenticated sync', async () => {
      const events = JSON.stringify([
        {
          type: 'CLOCK_IN',
          latitude: 6.5244,
          longitude: 3.3792,
          deviceTime: clockInTime(),
        },
      ]);

      await request(app.getHttpServer())
        .post(`${API}/attendance/sync`)
        .field('events', events)
        .attach('photos', makeFakeImageBuffer(), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(HttpStatus.UNAUTHORIZED);
    });
  });
});