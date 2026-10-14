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

async function owner(email = 'owner@golink.test', companyName = 'Goa Link Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

type Client = Awaited<ReturnType<typeof owner>>;

async function city(client: Client, name: string, countryCode = 'IN') {
  const res = await client.post('/api/masters/cities', { countryCode, name, status: 'ACTIVE' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

async function destination(
  client: Client,
  name: string,
  cityIds: string[],
  countryCode = 'IN',
) {
  const res = await client.post('/api/masters/destinations', {
    countryCode,
    name,
    destinationType: 'DOMESTIC',
    cityIds,
    status: 'ACTIVE',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

const LINK_MESSAGE = 'The selected city must be linked to the selected destination.';

/**
 * Regression: editing a Sightseeing Master must validate the submitted
 * destination/city ID pair — accepting the record's own consistent pair
 * (e.g. GOA + its linked city) while still rejecting genuinely unlinked
 * pairs. The backend check is ID-based; duplicate display names never make
 * one destination interchangeable with another.
 */
describe('Sightseeing edit destination/city validation', () => {
  it('edits a valid GOA record with its own IDs', async () => {
    const client = await owner();
    const calanguate = await city(client, 'Calanguate');
    await city(client, 'CALANGUTE');
    const goa = await destination(client, 'GOA', [calanguate.id]);

    const created = await client.post('/api/masters/sightseeing', {
      destinationId: goa.id,
      cityId: calanguate.id,
      title: 'NORTH GOA SIGHTSEEING',
      sequence: 1,
      status: 'ACTIVE',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const sightId = created.body.data.id as string;

    const updated = await client.patch(`/api/masters/sightseeing/${sightId}`, {
      destinationId: goa.id,
      cityId: calanguate.id,
      title: 'NORTH GOA SIGHTSEEING',
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data.destinationId).toBe(goa.id);
    expect(updated.body.data.cityId).toBe(calanguate.id);

    const details = await client.get(`/api/masters/sightseeing/${sightId}`);
    expect(details.status).toBe(200);
    expect(details.body.data.destination.id).toBe(goa.id);
    expect(details.body.data.city.id).toBe(calanguate.id);
  });

  it('rejects a genuinely unlinked destination/city pair with a clear message', async () => {
    const client = await owner();
    const linked = await city(client, 'Calanguate');
    const unlinked = await city(client, 'CALANGUTE');
    const goa = await destination(client, 'GOA', [linked.id]);

    const created = await client.post('/api/masters/sightseeing', {
      destinationId: goa.id,
      cityId: linked.id,
      title: 'NORTH GOA SIGHTSEEING',
      sequence: 1,
      status: 'ACTIVE',
    });
    const sightId = created.body.data.id as string;

    const rejected = await client.patch(`/api/masters/sightseeing/${sightId}`, {
      destinationId: goa.id,
      cityId: unlinked.id,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.message).toBe(LINK_MESSAGE);

    const stored = await db.sightseeing.findUniqueOrThrow({ where: { id: sightId } });
    expect(stored.cityId).toBe(linked.id);
  });

  it('keeps duplicate display names distinct by ID', async () => {
    const client = await owner();
    const cityIn = await city(client, 'Panjim', 'IN');
    const cityNp = await city(client, 'Panjim', 'NP');
    const goaIn = await destination(client, 'Goa', [cityIn.id], 'IN');
    const goaNp = await destination(client, 'Goa', [cityNp.id], 'NP');

    const created = await client.post('/api/masters/sightseeing', {
      destinationId: goaNp.id,
      cityId: cityNp.id,
      title: 'Mirror Attraction',
      sequence: 1,
      status: 'ACTIVE',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const sightId = created.body.data.id as string;

    const sameName = await client.patch(`/api/masters/sightseeing/${sightId}`, {
      destinationId: goaNp.id,
      cityId: cityNp.id,
      title: 'Mirror Attraction v2',
    });
    expect(sameName.status, JSON.stringify(sameName.body)).toBe(200);

    const crossed = await client.patch(`/api/masters/sightseeing/${sightId}`, {
      destinationId: goaIn.id,
      cityId: cityNp.id,
    });
    expect(crossed.status).toBe(400);
    expect(crossed.body.error.message).toBe(LINK_MESSAGE);
  });

  it('preserves the pair on a partial update that omits destination and city', async () => {
    const client = await owner();
    const calanguate = await city(client, 'Calanguate');
    const goa = await destination(client, 'GOA', [calanguate.id]);

    const created = await client.post('/api/masters/sightseeing', {
      destinationId: goa.id,
      cityId: calanguate.id,
      title: 'NORTH GOA SIGHTSEEING',
      sequence: 1,
      status: 'ACTIVE',
    });
    const sightId = created.body.data.id as string;

    const updated = await client.patch(`/api/masters/sightseeing/${sightId}`, {
      title: 'NORTH GOA SIGHTSEEING v2',
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    const stored = await db.sightseeing.findUniqueOrThrow({ where: { id: sightId } });
    expect(stored.destinationId).toBe(goa.id);
    expect(stored.cityId).toBe(calanguate.id);
  });
});
