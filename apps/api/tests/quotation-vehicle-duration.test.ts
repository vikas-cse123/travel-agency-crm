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

async function owner(email = 'owner@vehicle-duration.test') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

const leadPayload = () => ({
  customerName: 'Meera Nair',
  phone: '+91 98765 43210',
  email: 'meera@example.test',
  leadSource: 'REFERRAL',
  leadType: 'HOT',
  leadStage: 'QUALIFIED',
  priority: 'HIGH',
  travelStartDate: '2026-09-05',
  travelEndDate: '2026-09-09',
  rooms: 1,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  extraBeds: 0,
  currency: 'INR',
  services: ['VEHICLE_TRANSFER'],
  itinerary: [{ country: 'Singapore', destination: 'Singapore', nights: 4, sequence: 1 }],
});

async function setup() {
  const client = await owner();
  const lead = await client.post('/api/queries', leadPayload());
  expect(lead.status, JSON.stringify(lead.body)).toBe(201);
  const quotation = (await client.post('/api/quotations', { queryId: lead.body.data.id })).body.data;
  return { client, quotation, version: quotation.versions[0] as { id: string } };
}

const vehicleService = (overrides: Record<string, unknown> = {}) => ({
  serviceType: 'VEHICLE_TRANSFER',
  name: 'Toyota Innova Crysta',
  city: 'SUV',
  quantity: 1,
  sellingPrice: 0,
  sequence: 1,
  ...overrides,
});

describe('vehicle usage and duration persistence', () => {
  it('saves Usage and Duration independently and reloads both', async () => {
    const { client, quotation, version } = await setup();

    const res = await client.patch(`/api/quotations/${quotation.id}/versions/${version.id}`, {
      services: [vehicleService({ notes: 'Airport transfers', duration: '3 days' })],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.services[0].notes).toBe('Airport transfers');
    expect(res.body.data.services[0].duration).toBe('3 days');

    const dbRow = await db.quotationVersionService.findFirstOrThrow({
      where: { quotationVersionId: version.id },
    });
    expect(dbRow.notes).toBe('Airport transfers');
    expect(dbRow.duration).toBe('3 days');

    const reloaded = (await client.get(`/api/quotations/${quotation.id}`)).body.data.versions.find(
      (v: { id: string }) => v.id === version.id,
    );
    expect(reloaded.services[0].notes).toBe('Airport transfers');
    expect(reloaded.services[0].duration).toBe('3 days');
  });

  it('treats a missing Duration as null and never overwrites Usage', async () => {
    const { client, quotation, version } = await setup();

    const res = await client.patch(`/api/quotations/${quotation.id}/versions/${version.id}`, {
      services: [vehicleService({ notes: 'City tour' })],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.services[0].notes).toBe('City tour');
    expect(res.body.data.services[0].duration ?? null).toBeNull();

    const dbRow = await db.quotationVersionService.findFirstOrThrow({
      where: { quotationVersionId: version.id },
    });
    expect(dbRow.notes).toBe('City tour');
    expect(dbRow.duration).toBeNull();

    // Editing Usage alone must not fabricate a Duration.
    const edited = await client.patch(`/api/quotations/${quotation.id}/versions/${version.id}`, {
      services: [vehicleService({ notes: 'City tour (updated)' })],
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.data.services[0].duration ?? null).toBeNull();
    expect(edited.body.data.services[0].notes).toBe('City tour (updated)');
  });

  it('preserves independent values across multiple vehicles', async () => {
    const { client, quotation, version } = await setup();

    const res = await client.patch(`/api/quotations/${quotation.id}/versions/${version.id}`, {
      services: [
        vehicleService({ name: 'Innova', notes: 'Airport transfer', duration: '1 day', sequence: 1 }),
        vehicleService({ name: 'Tempo Traveller', notes: 'Sightseeing', duration: '4 days', sequence: 2 }),
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.services.map((s: { notes: string | null }) => s.notes)).toEqual([
      'Airport transfer',
      'Sightseeing',
    ]);
    expect(res.body.data.services.map((s: { duration: string | null }) => s.duration)).toEqual([
      '1 day',
      '4 days',
    ]);

    const reloaded = (await client.get(`/api/quotations/${quotation.id}`)).body.data.versions.find(
      (v: { id: string }) => v.id === version.id,
    );
    expect(reloaded.services.map((s: { notes: string | null }) => s.notes)).toEqual([
      'Airport transfer',
      'Sightseeing',
    ]);
    expect(reloaded.services.map((s: { duration: string | null }) => s.duration)).toEqual([
      '1 day',
      '4 days',
    ]);
  });
});
