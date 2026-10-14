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

type Client = ReturnType<typeof createAuthClient>;

async function owner(email = 'owner@sum.test', companyName = 'Sight Summary Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

async function createGeo(client: Client, cityName: string, destinationName: string) {
  const city = await client.post('/api/masters/cities', {
    countryCode: 'SG',
    name: cityName,
    status: 'ACTIVE',
  });
  expect(city.status).toBe(201);
  const cityId = city.body.data.id as string;
  const destination = await client.post('/api/masters/destinations', {
    countryCode: 'SG',
    name: destinationName,
    destinationType: 'INTERNATIONAL',
    cityIds: [cityId],
    status: 'ACTIVE',
  });
  expect(destination.status).toBe(201);
  return { cityId, destinationId: destination.body.data.id as string };
}

async function createSightseeing(
  client: Client,
  geo: { destinationId: string; cityId: string },
  overrides: Record<string, unknown> = {},
) {
  const response = await client.post('/api/masters/sightseeing', {
    destinationId: geo.destinationId,
    cityId: geo.cityId,
    title: `Tour ${Math.random().toString(36).slice(2, 10)}`,
    sequence: 1,
    status: 'ACTIVE',
    ...overrides,
  });
  expect(response.status).toBe(201);
  return response.body.data as { id: string; title: string };
}

describe('Sightseeing summary statistics', () => {
  it('counts unique attractions, destinations, cities and images over large sets', async () => {
    const client = await owner();
    const geoA = await createGeo(client, 'Singapore', 'Singapore');
    const geoB = await createGeo(client, 'Sentosa', 'Sentosa Island');

    // 105 rows: forces more than one server page (pageSize max 100) so the
    // summary must reflect the whole filtered set, not the first page.
    const first: string[] = [];
    for (let i = 0; i < 70; i += 1) {
      const row = await createSightseeing(client, geoA, { title: `Merlion Tour ${i}` });
      if (i === 0) first.push(row.id);
    }
    for (let i = 0; i < 30; i += 1) {
      await createSightseeing(client, geoB, { title: `Beach Tour ${i}` });
    }
    for (let i = 0; i < 5; i += 1) {
      await createSightseeing(client, geoA, { title: `Night Tour ${i}`, status: 'INACTIVE' });
    }

    const summary = await client.get('/api/masters/sightseeing/summary?pageSize=100');
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({
      totalAttractions: 105,
      destinations: 2,
      citiesCovered: 2,
      withImages: 0,
    });

    // Marking one row as imaged is reflected in withImages only.
    await db.sightseeing.update({
      where: { id: first[0] },
      data: { imageObjectKey: 'companies/x/masters/img.jpg', imageConfirmedAt: new Date() },
    });
    const imaged = await client.get('/api/masters/sightseeing/summary');
    expect(imaged.body.data).toMatchObject({ totalAttractions: 105, withImages: 1 });

    // Filters scope the summary exactly like the list.
    const active = await client.get('/api/masters/sightseeing/summary?status=ACTIVE');
    expect(active.body.data).toMatchObject({
      totalAttractions: 100,
      destinations: 2,
      citiesCovered: 2,
    });
    const inactive = await client.get('/api/masters/sightseeing/summary?status=INACTIVE');
    expect(inactive.body.data).toMatchObject({
      totalAttractions: 5,
      destinations: 1,
      citiesCovered: 1,
    });
    const byDestination = await client.get(
      `/api/masters/sightseeing/summary?destinationId=${geoB.destinationId}`,
    );
    expect(byDestination.body.data).toMatchObject({
      totalAttractions: 30,
      destinations: 1,
      citiesCovered: 1,
    });
    const byCity = await client.get(`/api/masters/sightseeing/summary?cityId=${geoA.cityId}`);
    expect(byCity.body.data).toMatchObject({ totalAttractions: 75 });
    const bySearch = await client.get('/api/masters/sightseeing/summary?search=beach tour 1');
    expect((bySearch.body.data.totalAttractions as number)).toBeGreaterThan(0);
    expect((bySearch.body.data.totalAttractions as number)).toBeLessThan(105);

    // The list total agrees with the summary total for the same filter.
    const list = await client.get('/api/masters/sightseeing?pageSize=100&status=ACTIVE');
    expect(list.body.data.pagination.total).toBe(100);
  });

  it('summary is tenant-scoped', async () => {
    const alpha = await owner('owner@alpha-sum.test', 'Alpha Summary');
    const geo = await createGeo(alpha, 'Singapore', 'Singapore');
    await createSightseeing(alpha, geo, { title: 'Alpha Tour' });
    const beta = await owner('owner@beta-sum.test', 'Beta Summary');
    const summary = await beta.get('/api/masters/sightseeing/summary');
    expect(summary.body.data).toMatchObject({ totalAttractions: 0, destinations: 0 });
  });
});
