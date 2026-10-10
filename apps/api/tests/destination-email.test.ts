import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';

/**
 * Destination Master optional vendor email: persistence, validation and
 * tenant isolation for the field the itinerary-email workflow reads.
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

async function owner(email = 'owner@destination-email.test', companyName = 'Destination Mail Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

async function createCity(client: Client, name = 'Jaipur') {
  const response = await client.post('/api/masters/cities', {
    countryCode: 'IN',
    name,
    airportCode: name === 'Jaipur' ? 'JAI' : null,
    status: 'ACTIVE',
  });
  expect(response.status).toBe(201);
  return response.body.data as { id: string };
}

const destinationPayload = (cityIds: string[], overrides: Record<string, unknown> = {}) => ({
  countryCode: 'IN',
  name: 'Rajasthan Highlights',
  destinationType: 'DOMESTIC',
  cityIds,
  inclusions: null,
  exclusions: null,
  paymentPolicies: null,
  cancellationPolicies: null,
  bookingTerms: null,
  status: 'ACTIVE',
  ...overrides,
});

describe('destination vendor email', () => {
  it('creates a destination with an email and returns it on details', async () => {
    const client = await owner();
    const city = await createCity(client);
    const created = await client.post(
      '/api/masters/destinations',
      destinationPayload([city.id], { email: 'reservations@example.test' }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.email).toBe('reservations@example.test');

    const details = await client.get(`/api/masters/destinations/${created.body.data.id}`);
    expect(details.status).toBe(200);
    expect(details.body.data.email).toBe('reservations@example.test');

    const row = await db.destination.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(row.email).toBe('reservations@example.test');
  });

  it('stores null when no email is supplied and clears it on blank update', async () => {
    const client = await owner();
    const city = await createCity(client);
    const created = await client.post('/api/masters/destinations', destinationPayload([city.id]));
    expect(created.status).toBe(201);
    expect(created.body.data.email).toBeNull();

    const updated = await client.patch(`/api/masters/destinations/${created.body.data.id}`, {
      email: 'vendor@example.test',
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data.email).toBe('vendor@example.test');

    const cleared = await client.patch(`/api/masters/destinations/${created.body.data.id}`, {
      email: '   ',
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.email).toBeNull();
  });

  it('rejects a malformed email without touching the stored value', async () => {
    const client = await owner();
    const city = await createCity(client);
    const created = await client.post(
      '/api/masters/destinations',
      destinationPayload([city.id], { email: 'vendor@example.test' }),
    );
    expect(created.status).toBe(201);

    expect(
      (await client.post('/api/masters/destinations', destinationPayload([city.id], { email: 'not-an-email' })))
        .status,
    ).toBe(400);
    expect(
      (
        await client.patch(`/api/masters/destinations/${created.body.data.id}`, {
          email: 'missing-at-sign',
        })
      ).status,
    ).toBe(400);

    const reloaded = await client.get(`/api/masters/destinations/${created.body.data.id}`);
    expect(reloaded.body.data.email).toBe('vendor@example.test');
  });

  it('keeps destination email tenant-isolated', async () => {
    const client = await owner();
    const city = await createCity(client);
    const created = await client.post(
      '/api/masters/destinations',
      destinationPayload([city.id], { email: 'reservations@example.test' }),
    );
    expect(created.status).toBe(201);

    const other = await owner('other@destination-email.test', 'Other Mail Travel');
    expect((await other.get(`/api/masters/destinations/${created.body.data.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await other.patch(`/api/masters/destinations/${created.body.data.id}`, {
          email: 'intruder@example.test',
        })
      ).status,
    ).toBe(404);

    const reloaded = await client.get(`/api/masters/destinations/${created.body.data.id}`);
    expect(reloaded.body.data.email).toBe('reservations@example.test');
  });
});
