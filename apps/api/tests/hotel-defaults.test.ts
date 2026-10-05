import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';

/**
 * Multi-default hotels per destination (max 10).
 *
 * The `isDefaultForCity` flag is destination-scoped: any number of hotels in
 * one destination may share it (up to 10), enforced server-side on create and
 * update. Existing single defaults keep working untouched.
 */
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

type Client = ReturnType<typeof createAuthClient>;

async function owner() {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email: 'owner@defaults.test' }));
  await client.post('/api/auth/verify-email', {
    otp: getMemoryEmailProvider()?.lastOtp('owner@defaults.test'),
  });
  return client;
}

async function setupDestination(client: Client, cityName: string, destName: string) {
  const city = await client.post('/api/masters/cities', {
    countryCode: 'SG',
    name: cityName,
    status: 'ACTIVE',
  });
  expect(city.status).toBe(201);
  const destination = await client.post('/api/masters/destinations', {
    countryCode: 'SG',
    name: destName,
    destinationType: 'INTERNATIONAL',
    cityIds: [city.body.data.id],
    status: 'ACTIVE',
  });
  expect(destination.status).toBe(201);
  return {
    cityId: city.body.data.id as string,
    destinationId: destination.body.data.id as string,
  };
}

async function createHotel(
  client: Client,
  ids: { cityId: string; destinationId: string },
  name: string,
  isDefaultForCity = false,
) {
  const response = await client.post('/api/masters/hotels', {
    destinationId: ids.destinationId,
    cityId: ids.cityId,
    name,
    status: 'ACTIVE',
    isDefaultForCity,
  });
  return response;
}

async function defaultCount(
  client: Client,
  destinationId: string,
): Promise<{ status: number; total: number }> {
  const response = await client.get(
    `/api/masters/hotels?destinationId=${destinationId}&isDefaultForCity=true&pageSize=1`,
  );
  expect(response.status).toBe(200);
  return { status: response.status, total: response.body.data.pagination.total as number };
}

describe('Multi-default hotels per destination', () => {
  it('1. a destination can have 0 default hotels', async () => {
    const client = await owner();
    const ids = await setupDestination(client, 'Singapore City', 'Singapore');
    await createHotel(client, ids, 'Hotel A');
    await createHotel(client, ids, 'Hotel B');
    expect((await defaultCount(client, ids.destinationId)).total).toBe(0);
  });

  it('2. a destination can have 1 default hotel', async () => {
    const client = await owner();
    const ids = await setupDestination(client, 'Singapore City', 'Singapore');
    const created = await createHotel(client, ids, 'Hotel A', true);
    expect(created.status).toBe(201);
    expect(created.body.data.isDefaultForCity).toBe(true);
    expect((await defaultCount(client, ids.destinationId)).total).toBe(1);
  });

  it('3. a destination can have multiple default hotels without unmarking each other', async () => {
    const client = await owner();
    const ids = await setupDestination(client, 'Singapore City', 'Singapore');
    for (const name of ['Hotel A', 'Hotel B', 'Hotel C']) {
      const created = await createHotel(client, ids, name, true);
      expect(created.status).toBe(201);
    }
    expect((await defaultCount(client, ids.destinationId)).total).toBe(3);
    // The first hotel is still marked — no silent unmarking.
    const list = await client.get(
      `/api/masters/hotels?destinationId=${ids.destinationId}&isDefaultForCity=true&pageSize=20`,
    );
    const names = (list.body.data.data as Array<{ name: string }>).map((h) => h.name).sort();
    expect(names).toEqual(['Hotel A', 'Hotel B', 'Hotel C']);
  });

  it('4. a destination can have exactly 10 default hotels', async () => {
    const client = await owner();
    const ids = await setupDestination(client, 'Singapore City', 'Singapore');
    for (let i = 1; i <= 10; i++) {
      const created = await createHotel(client, ids, `Hotel ${i}`, true);
      expect(created.status).toBe(201);
    }
    expect((await defaultCount(client, ids.destinationId)).total).toBe(10);
  });

  it('5. the 11th default hotel is rejected and existing defaults are unchanged', async () => {
    const client = await owner();
    const ids = await setupDestination(client, 'Singapore City', 'Singapore');
    for (let i = 1; i <= 10; i++) {
      expect((await createHotel(client, ids, `Hotel ${i}`, true)).status).toBe(201);
    }
    // create path
    const rejected = await createHotel(client, ids, 'Hotel 11', true);
    expect(rejected.status).toBe(400);
    expect(String(rejected.body.error.message)).toContain('10');
    // plain (non-default) creation still works at the cap
    expect((await createHotel(client, ids, 'Hotel Plain')).status).toBe(201);
    // update path: promoting an existing hotel is also rejected
    const plain = await client.get(`/api/masters/hotels?destinationId=${ids.destinationId}`);
    const plainHotel = (plain.body.data.data as Array<{ id: string; name: string }>).find(
      (h) => h.name === 'Hotel Plain',
    )!;
    const promoted = await client.patch(`/api/masters/hotels/${plainHotel.id}`, {
      isDefaultForCity: true,
    });
    expect(promoted.status).toBe(400);
    expect(String(promoted.body.error.message)).toContain('10');
    // Existing defaults are unchanged.
    expect((await defaultCount(client, ids.destinationId)).total).toBe(10);
  });

  it('6. defaults are independent between destinations', async () => {
    const client = await owner();
    const singapore = await setupDestination(client, 'Singapore City', 'Singapore');
    const dubai = await setupDestination(client, 'Dubai City', 'Dubai');
    for (let i = 1; i <= 10; i++) {
      expect((await createHotel(client, singapore, `SG Hotel ${i}`, true)).status).toBe(201);
    }
    // A full Singapore does not block Dubai defaults.
    for (let i = 1; i <= 3; i++) {
      expect((await createHotel(client, dubai, `DXB Hotel ${i}`, true)).status).toBe(201);
    }
    expect((await defaultCount(client, singapore.destinationId)).total).toBe(10);
    expect((await defaultCount(client, dubai.destinationId)).total).toBe(3);
  });

  it('7. a legacy single-default hotel stays compatible and coexists with new defaults', async () => {
    const client = await owner();
    const ids = await setupDestination(client, 'Singapore City', 'Singapore');
    const legacy = await createHotel(client, ids, 'Legacy Grand', true);
    expect(legacy.status).toBe(201);
    const another = await createHotel(client, ids, 'Newcomer Inn', true);
    expect(another.status).toBe(201);
    // Legacy hotel is still marked.
    const detail = await client.get(`/api/masters/hotels/${legacy.body.data.id}`);
    expect(detail.body.data.isDefaultForCity).toBe(true);
    expect((await defaultCount(client, ids.destinationId)).total).toBe(2);
  });

  it('unmarking a default frees a slot for a new one', async () => {
    const client = await owner();
    const ids = await setupDestination(client, 'Singapore City', 'Singapore');
    const first = await createHotel(client, ids, 'Hotel 1', true);
    for (let i = 2; i <= 10; i++) {
      expect((await createHotel(client, ids, `Hotel ${i}`, true)).status).toBe(201);
    }
    const unmarked = await client.patch(`/api/masters/hotels/${first.body.data.id}`, {
      isDefaultForCity: false,
    });
    expect(unmarked.status).toBe(200);
    expect(unmarked.body.data.isDefaultForCity).toBe(false);
    expect((await createHotel(client, ids, 'Hotel 11', true)).status).toBe(201);
    expect((await defaultCount(client, ids.destinationId)).total).toBe(10);
  });

  it('deleting a default hotel frees its slot', async () => {
    const client = await owner();
    const ids = await setupDestination(client, 'Singapore City', 'Singapore');
    const first = await createHotel(client, ids, 'Hotel 1', true);
    for (let i = 2; i <= 10; i++) {
      expect((await createHotel(client, ids, `Hotel ${i}`, true)).status).toBe(201);
    }
    expect((await client.delete(`/api/masters/hotels/${first.body.data.id}`)).status).toBe(200);
    expect((await createHotel(client, ids, 'Hotel 11', true)).status).toBe(201);
  });
});
