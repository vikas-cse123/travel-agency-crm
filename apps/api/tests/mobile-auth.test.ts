import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import {
  createAuthClient,
  registrationPayload,
} from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';

/**
 * Native mobile authentication (`/api/mobile/*`).
 *
 * Contract under test:
 * - Mobile login carries no Origin/Referer (OkHttp never sends them) and no
 *   session cookie. It must REACH the route: the origin exemption is
 *   path-based, and `verifyCsrfToken` passes through when no session exists.
 * - Controller throws (e.g. invalid credentials) must travel through the
 *   project's `asyncHandler()` into the Express error middleware as a
 *   structured JSON error — never hang, never an unhandled rejection
 *   (which crashes the Node process under Express 4).
 * - Browser session endpoints keep their Origin protection.
 */

let app: Express;
let db: PrismaClient;

const PASSWORD = 'Interscale@2026';

const rejections: unknown[] = [];
function onUnhandledRejection(reason: unknown): void {
  rejections.push(reason);
}

beforeAll(async () => {
  db = createTestPrismaClient();
  const { createApp } = await import('../src/app.js');
  app = createApp();
  process.on('unhandledRejection', onUnhandledRejection);
});

afterAll(async () => {
  process.off('unhandledRejection', onUnhandledRejection);
  await db.$disconnect();
});

beforeEach(async () => {
  await truncateAll(db);
  rejections.length = 0;
  getMemoryEmailProvider()?.clear();
});

async function registerVerifiedUser(email = 'field@travel.test'): Promise<void> {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email }));
  const otp = getMemoryEmailProvider()?.lastOtp(email) ?? '';
  await client.post('/api/auth/verify-email', { otp });
}

describe('mobile login without browser headers', () => {
  it('invalid credentials → 401 JSON (no hang, no unhandled rejection)', async () => {
    const res = await request(app)
      .post('/api/mobile/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'nobody@travel.test', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body?.success).toBe(false);
    expect(res.body?.error?.code).toBe('UNAUTHORIZED');
    // Give any stray rejection a chance to surface, then assert none occurred.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(rejections).toEqual([]);
  });

  it('malformed body reaches the service → 401 (route is exercised, not blocked)', async () => {
    // NOTE: the mobile loginSchema wraps `body` in a way validateRequest does
    // not enforce (pre-existing quirk, left unchanged); the request still
    // reaches the service, which rejects unknown users with 401 JSON.
    const res = await request(app)
      .post('/api/mobile/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'not-an-email', password: 'x' });

    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe('UNAUTHORIZED');
  });

  it('valid credentials → 200 with token payload', async () => {
    const email = 'agent@travel.test';
    await registerVerifiedUser(email);

    const res = await request(app)
      .post('/api/mobile/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(typeof res.body?.data?.token).toBe('string');
    expect(typeof res.body?.data?.userId).toBe('string');
    expect(typeof res.body?.data?.companyId).toBe('string');
    expect(typeof res.body?.data?.expiresAt).toBe('string');
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(rejections).toEqual([]);
  });

  it('authenticated mobile route rejects bad token → 401 (no hang)', async () => {
    const res = await request(app)
      .post('/api/mobile/calls')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer invalid-token')
      .send({
        androidCallSessionId: 'test-session',
        phone: '+911234567890',
        startedAt: new Date().toISOString(),
      });

    expect(res.status).toBe(401);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(rejections).toEqual([]);
  });
});

describe('browser protections intact', () => {
  it('web login without Origin is still rejected with 403', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'nobody@travel.test', password: 'wrong-password' });

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('FORBIDDEN');
  });
});
