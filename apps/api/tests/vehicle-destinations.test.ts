import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';

/**
 * Destination assignments for vehicle masters (0–10 destinations per vehicle).
 *
 * IDs stay authoritative (resolved through the ordered vehicle_destinations
 * link); the 10-cap is enforced server-side on create and update.
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
  await client.post('/api/auth/register', registrationPayload({ email: 'owner@vehicles.test' }));
  await client.post('/api/auth/verify-email', {
    otp: getMemoryEmailProvider()?.lastOtp('owner@vehicles.test'),
  });
  return client;
}

async function createDestination(client: Client, name: string, countryCode = 'IN') {
  const city = await client.post('/api/masters/cities', {
    countryCode,
    name: `${name} City`,
    status: 'ACTIVE',
  });
  expect(city.status).toBe(201);
  const response = await client.post('/api/masters/destinations', {
    countryCode,
    name,
    destinationType: countryCode === 'IN' ? 'DOMESTIC' : 'INTERNATIONAL',
    cityIds: [city.body.data.id],
    status: 'ACTIVE',
  });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function createVehicle(
  client: Client,
  name: string,
  extra: Record<string, unknown> = {},
) {
  return client.post('/api/masters/vehicles', {
    name,
    vehicleType: 'SUV',
    status: 'ACTIVE',
    ...extra,
  });
}

describe('Vehicle destination assignments', () => {
  it('1. a vehicle can have 0 destinations', async () => {
    const client = await owner();
    const created = await createVehicle(client, 'Toyota Innova');
    expect(created.status).toBe(201);
    expect(created.body.data.destinations).toEqual([]);
  });

  it('2. a vehicle can have 1 destination', async () => {
    const client = await owner();
    const kashmir = await createDestination(client, 'Kashmir');
    const created = await createVehicle(client, 'Toyota Innova', { destinationIds: [kashmir] });
    expect(created.status).toBe(201);
    expect(created.body.data.destinations).toEqual([{ id: kashmir, name: 'Kashmir' }]);
  });

  it('3. a vehicle can have multiple destinations in selection order', async () => {
    const client = await owner();
    const kashmir = await createDestination(client, 'Kashmir');
    const delhi = await createDestination(client, 'Delhi');
    const agra = await createDestination(client, 'Agra');
    const created = await createVehicle(client, 'Toyota Innova', {
      destinationIds: [kashmir, delhi, agra],
    });
    expect(created.status).toBe(201);
    expect(created.body.data.destinations.map((d: { id: string }) => d.id)).toEqual([
      kashmir,
      delhi,
      agra,
    ]);
  });

  it('4. a vehicle can have exactly 10 destinations', async () => {
    const client = await owner();
    const ids: string[] = [];
    for (let i = 1; i <= 10; i++) ids.push(await createDestination(client, `Place ${i}`));
    const created = await createVehicle(client, 'Big Bus', { destinationIds: ids });
    expect(created.status).toBe(201);
    expect(created.body.data.destinations).toHaveLength(10);
  });

  it('5. the 11th destination is rejected on create and on update', async () => {
    const client = await owner();
    const ids: string[] = [];
    for (let i = 1; i <= 11; i++) ids.push(await createDestination(client, `Place ${i}`));
    const rejected = await createVehicle(client, 'Big Bus', { destinationIds: ids });
    expect(rejected.status).toBe(400);
    expect(String(rejected.body.error.message)).toContain('10');

    const ok = await createVehicle(client, 'Small Van', { destinationIds: ids.slice(0, 10) });
    expect(ok.status).toBe(201);
    const overUpdate = await client.patch(`/api/masters/vehicles/${ok.body.data.id}`, {
      destinationIds: ids,
    });
    expect(overUpdate.status).toBe(400);
    expect(String(overUpdate.body.error.message)).toContain('10');
  });

  it('6. destination assignments are stored as IDs and survive reload', async () => {
    const client = await owner();
    const kashmir = await createDestination(client, 'Kashmir');
    const delhi = await createDestination(client, 'Delhi');
    const created = await createVehicle(client, 'Tempo Traveller', {
      destinationIds: [kashmir, delhi],
    });
    expect(created.status).toBe(201);
    const detail = await client.get(`/api/masters/vehicles/${created.body.data.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.destinations).toEqual([
      { id: kashmir, name: 'Kashmir' },
      { id: delhi, name: 'Delhi' },
    ]);
  });

  it('6b. unknown destination IDs are rejected', async () => {
    const client = await owner();
    const rejected = await createVehicle(client, 'Ghost Van', {
      destinationIds: ['11111111-1111-4111-8111-111111111111'],
    });
    expect(rejected.status).toBe(400);
  });

  it('6c. update replaces the assignment set (deduplicated, order preserved)', async () => {
    const client = await owner();
    const kashmir = await createDestination(client, 'Kashmir');
    const delhi = await createDestination(client, 'Delhi');
    const agra = await createDestination(client, 'Agra');
    const created = await createVehicle(client, 'Toyota Innova', {
      destinationIds: [kashmir, delhi],
    });
    const updated = await client.patch(`/api/masters/vehicles/${created.body.data.id}`, {
      destinationIds: [agra, agra, kashmir],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.destinations.map((d: { id: string }) => d.id)).toEqual([
      agra,
      kashmir,
    ]);
    // Omitting destinationIds leaves assignments untouched.
    const renamed = await client.patch(`/api/masters/vehicles/${created.body.data.id}`, {
      name: 'Toyota Innova Plus',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.destinations.map((d: { id: string }) => d.id)).toEqual([
      agra,
      kashmir,
    ]);
    // Explicit empty array clears all assignments.
    const cleared = await client.patch(`/api/masters/vehicles/${created.body.data.id}`, {
      destinationIds: [],
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.destinations).toEqual([]);
  });

  it('7. existing vehicles without destinations remain backward compatible', async () => {
    const client = await owner();
    const created = await createVehicle(client, 'Old Faithful');
    expect(created.status).toBe(201);
    // Legacy update payloads without destinationIds keep working.
    const renamed = await client.patch(`/api/masters/vehicles/${created.body.data.id}`, {
      vehicleType: 'Sedan',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.destinations).toEqual([]);
    // List + lookups include the (empty) destinations shape.
    const list = await client.get('/api/masters/vehicles?pageSize=20');
    expect(list.status).toBe(200);
    expect(list.body.data.data[0].destinations).toEqual([]);
    const lookups = await client.get('/api/masters/vehicles/lookups');
    expect(lookups.status).toBe(200);
    expect(lookups.body.data.vehicles[0].destinations).toEqual([]);
  });

  it('list filters vehicles by destinationId', async () => {
    const client = await owner();
    const kashmir = await createDestination(client, 'Kashmir');
    const delhi = await createDestination(client, 'Delhi');
    await createVehicle(client, 'Kashmir Cab', { destinationIds: [kashmir] });
    await createVehicle(client, 'Delhi Cab', { destinationIds: [delhi] });
    await createVehicle(client, 'Nowhere Cab');
    const filtered = await client.get(
      `/api/masters/vehicles?destinationId=${kashmir}&pageSize=20`,
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.data.map((v: { name: string }) => v.name)).toEqual(['Kashmir Cab']);
    // The builder matches on these IDs without extra requests.
    expect(filtered.body.data.data[0].destinations).toEqual([{ id: kashmir, name: 'Kashmir' }]);
  });
});
