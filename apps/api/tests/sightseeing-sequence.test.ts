import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { normalizeCustomerName } from '../src/utils/normalize.js';

let app: Express;
let db: PrismaClient;

beforeAll(async () => {
  db = createTestPrismaClient();
  app = (await import('../src/app.js')).createApp();
});
afterAll(async () => db.$disconnect());
beforeEach(async () => {
  await truncateAll(db);
  getMemoryEmailProvider()?.clear();
});

async function owner(email = 'owner@seq.test', companyName = 'Sequence Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

type Client = Awaited<ReturnType<typeof owner>>;

async function cityAndDestination(client: Client) {
  const city = (
    await client.post('/api/masters/cities', {
      countryCode: 'SG',
      name: 'Singapore',
      status: 'ACTIVE',
    })
  ).body.data as { id: string };
  const destination = (
    await client.post('/api/masters/destinations', {
      countryCode: 'SG',
      name: 'Singapore',
      destinationType: 'INTERNATIONAL',
      cityIds: [city.id],
      status: 'ACTIVE',
    })
  ).body.data as { id: string };
  const company = await db.company.findFirstOrThrow();
  const user = await db.user.findFirstOrThrow({ where: { normalizedEmail: 'owner@seq.test' } });
  return { city, destination, companyId: company.id, userId: user.id };
}

const createPayload = (destinationId: string, cityId: string, overrides: Record<string, unknown> = {}) => ({
  destinationId,
  cityId,
  title: 'New Attraction',
  sequence: 1,
  status: 'ACTIVE',
  ...overrides,
});

/**
 * Regression: the create workflow must respect an explicitly entered
 * sequence — including 1 — instead of replacing it with MAX(sequence)+1.
 *
 * Root cause was `if (sequence === 1) { sequence = MAX + 1; }` in
 * `sightseeingService.create`, combined with a `.default(1)` in the shared
 * schema that made "omitted" and "entered 1" indistinguishable.
 */
describe('Sightseeing create respects explicit sequence', () => {
  it('saves sequence 1 when 20 attractions already exist', async () => {
    const client = await owner();
    const { city, destination, companyId, userId } = await cityAndDestination(client);
    await db.sightseeing.createMany({
      data: Array.from({ length: 20 }, (_, index) => {
        const title = `Existing Attraction ${index + 1}`;
        return {
          companyId,
          destinationId: destination.id,
          cityId: city.id,
          title,
          normalizedTitle: normalizeCustomerName(title),
          sequence: index + 1,
          status: 'ACTIVE' as const,
          createdById: userId,
        };
      }),
    });

    const created = await client.post(
      '/api/masters/sightseeing',
      createPayload(destination.id, city.id, { title: 'Explicit First', sequence: 1 }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // Returned record carries the saved value, not MAX+1 (21).
    expect(created.body.data.sequence).toBe(1);

    const stored = await db.sightseeing.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(stored.sequence).toBe(1);

    // Reloading the detail page and the list shows the same value.
    const details = await client.get(`/api/masters/sightseeing/${created.body.data.id}`);
    expect(details.status).toBe(200);
    expect(details.body.data.sequence).toBe(1);
    const list = await client.get(
      `/api/masters/sightseeing?destinationId=${destination.id}&cityId=${city.id}&pageSize=100`,
    );
    expect(list.status).toBe(200);
    const listed = (list.body.data.data as Array<{ id: string; sequence: number }>).find(
      (row) => row.id === created.body.data.id,
    );
    expect(listed?.sequence).toBe(1);
  });

  it('saves another explicit sequence value exactly', async () => {
    const client = await owner();
    const { city, destination } = await cityAndDestination(client);
    const first = await client.post(
      '/api/masters/sightseeing',
      createPayload(destination.id, city.id, { title: 'Seventh Spot', sequence: 7 }),
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data.sequence).toBe(7);
    const stored = await db.sightseeing.findUniqueOrThrow({ where: { id: first.body.data.id } });
    expect(stored.sequence).toBe(7);
  });

  it('auto-assigns MAX(sequence)+1 only when the sequence is genuinely omitted', async () => {
    const client = await owner();
    const { city, destination, companyId, userId } = await cityAndDestination(client);
    await db.sightseeing.createMany({
      data: Array.from({ length: 20 }, (_, index) => {
        const title = `Seeded Attraction ${index + 1}`;
        return {
          companyId,
          destinationId: destination.id,
          cityId: city.id,
          title,
          normalizedTitle: normalizeCustomerName(title),
          sequence: index + 1,
          status: 'ACTIVE' as const,
          createdById: userId,
        };
      }),
    });

    const { sequence: _omitted, ...withoutSequence } = createPayload(destination.id, city.id, {
      title: 'Auto Sequenced',
    });
    void _omitted;
    const created = await client.post('/api/masters/sightseeing', withoutSequence);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.sequence).toBe(21);
  });

  it('editing an existing attraction sequence continues to work', async () => {
    const client = await owner();
    const { city, destination } = await cityAndDestination(client);
    const created = await client.post(
      '/api/masters/sightseeing',
      createPayload(destination.id, city.id, { title: 'Movable Spot', sequence: 1 }),
    );
    expect(created.status).toBe(201);

    const updated = await client.patch(`/api/masters/sightseeing/${created.body.data.id}`, {
      sequence: 3,
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data.sequence).toBe(3);
    const stored = await db.sightseeing.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(stored.sequence).toBe(3);
  });
});
