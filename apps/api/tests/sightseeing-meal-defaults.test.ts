import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';

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

async function owner(email = 'owner@mealdefaults.test', companyName = 'Meal Defaults Travel') {
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
  return { city, destination };
}

const sightseeingPayload = (destinationId: string, cityId: string, overrides: Record<string, unknown> = {}) => ({
  destinationId,
  cityId,
  title: 'Gardens by the Bay',
  sequence: 1,
  status: 'ACTIVE',
  ...overrides,
});

const mealDefaults = {
  meals: { breakfast: true, lunch: false, dinner: true },
  mealModes: { breakfast: 'WITH_TRANSFER', lunch: null, dinner: 'INCLUDE_AT_HOTEL' },
  mealTransferDetails: { breakfast: 'Lobby pickup at 8 AM', lunch: null, dinner: null },
  transfer: 'PRIVATE',
};

describe('Sightseeing meal and transfer defaults', () => {
  it('creates and reads back meal and transfer defaults', async () => {
    const client = await owner();
    const { city, destination } = await cityAndDestination(client);
    const created = await client.post(
      '/api/masters/sightseeing',
      sightseeingPayload(destination.id, city.id, { mealDefaults }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.mealDefaults).toMatchObject(mealDefaults);

    const stored = await db.sightseeing.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(stored.mealDefaults).toMatchObject(mealDefaults);

    const details = await client.get(`/api/masters/sightseeing/${created.body.data.id}`);
    expect(details.status).toBe(200);
    expect(details.body.data.mealDefaults).toMatchObject(mealDefaults);
  });

  it('creates without defaults and exposes nulls for legacy rows', async () => {
    const client = await owner();
    const { city, destination } = await cityAndDestination(client);
    const created = await client.post(
      '/api/masters/sightseeing',
      sightseeingPayload(destination.id, city.id),
    );
    expect(created.status).toBe(201);
    expect(created.body.data.mealDefaults).toBeNull();

    const details = await client.get(`/api/masters/sightseeing/${created.body.data.id}`);
    expect(details.body.data.mealDefaults).toBeNull();
  });

  it('edits defaults and clears them back to null', async () => {
    const client = await owner();
    const { city, destination } = await cityAndDestination(client);
    const created = await client.post(
      '/api/masters/sightseeing',
      sightseeingPayload(destination.id, city.id, { mealDefaults }),
    );
    const id = created.body.data.id as string;

    const updated = await client.patch(`/api/masters/sightseeing/${id}`, {
      mealDefaults: {
        meals: { breakfast: false, lunch: true, dinner: false },
        mealModes: { lunch: 'NO_TRANSFER' },
        transfer: 'SHARED',
      },
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data.mealDefaults).toMatchObject({
      meals: { breakfast: false, lunch: true, dinner: false },
      transfer: 'SHARED',
    });

    const cleared = await client.patch(`/api/masters/sightseeing/${id}`, { mealDefaults: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.mealDefaults).toBeNull();
    expect(
      (await db.sightseeing.findUniqueOrThrow({ where: { id } })).mealDefaults,
    ).toBeNull();
  });

  it('rejects unknown meal modes and transfer values', async () => {
    const client = await owner();
    const { city, destination } = await cityAndDestination(client);
    const base = sightseeingPayload(destination.id, city.id);
    expect(
      (
        await client.post('/api/masters/sightseeing', {
          ...base,
          mealDefaults: { ...mealDefaults, mealModes: { breakfast: 'HELICOPTER' } },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post('/api/masters/sightseeing', {
          ...base,
          title: 'Verbose Tour',
          mealDefaults: { ...mealDefaults, mealTransferDetails: { breakfast: 'x'.repeat(301) } },
        })
      ).status,
    ).toBe(400);
  });

  it('round-trips per-meal transfer details and tolerates legacy blobs without them', async () => {
    const client = await owner();
    const { city, destination } = await cityAndDestination(client);
    const created = await client.post(
      '/api/masters/sightseeing',
      sightseeingPayload(destination.id, city.id, { mealDefaults }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.mealDefaults).toMatchObject({
      mealTransferDetails: { breakfast: 'Lobby pickup at 8 AM', lunch: null, dinner: null },
    });

    // Legacy blob without the new key stays valid and readable.
    const legacy = await client.post(
      '/api/masters/sightseeing',
      sightseeingPayload(destination.id, city.id, {
        title: 'Legacy Tour',
        mealDefaults: {
          meals: { breakfast: false, lunch: true, dinner: false },
          mealModes: { lunch: 'NO_TRANSFER' },
          transfer: 'SHARED',
        },
      }),
    );
    expect(legacy.status, JSON.stringify(legacy.body)).toBe(201);
    const details = await client.get(`/api/masters/sightseeing/${legacy.body.data.id}`);
    expect(details.status).toBe(200);
    expect(details.body.data.mealDefaults.meals.lunch).toBe(true);

    const feed = await client.get('/api/masters/sightseeing/activities?destination=Singapore');
    const rows = feed.body.data.activities as Array<{ title: string; mealDefaults: any }>;
    expect(
      rows.find((row) => row.title === 'Gardens by the Bay')?.mealDefaults.mealTransferDetails,
    ).toMatchObject({ breakfast: 'Lobby pickup at 8 AM' });
  });

  it('exposes meal defaults through the builder activities feed', async () => {
    const client = await owner();
    const { city, destination } = await cityAndDestination(client);
    await client.post(
      '/api/masters/sightseeing',
      sightseeingPayload(destination.id, city.id, { mealDefaults }),
    );
    await client.post(
      '/api/masters/sightseeing',
      sightseeingPayload(destination.id, city.id, { title: 'Plain Tour' }),
    );

    const feed = await client.get('/api/masters/sightseeing/activities?destination=Singapore');
    expect(feed.status).toBe(200);
    const rows = feed.body.data.activities as Array<{ title: string; mealDefaults: unknown }>;
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.title === 'Gardens by the Bay')?.mealDefaults).toMatchObject(
      mealDefaults,
    );
    expect(rows.find((row) => row.title === 'Plain Tour')?.mealDefaults).toBeNull();
  });

  it('keeps other companies from seeing the defaults', async () => {
    const alpha = await owner('alpha@mealdefaults.test', 'Alpha Meals');
    const { city, destination } = await cityAndDestination(alpha);
    const created = await alpha.post(
      '/api/masters/sightseeing',
      sightseeingPayload(destination.id, city.id, { mealDefaults }),
    );
    const beta = await owner('beta@mealdefaults.test', 'Beta Meals');
    expect((await beta.get(`/api/masters/sightseeing/${created.body.data.id}`)).status).toBe(404);
    const feed = await beta.get('/api/masters/sightseeing/activities?destination=Singapore');
    expect(feed.body.data.activities).toEqual([]);
  });
});
