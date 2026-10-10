import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';

/**
 * Hotel-email reads must stay tenant-isolated: the composer resolves its
 * quotation (with hotel options) and the hotel master email through the
 * existing authenticated endpoints, so a cross-company id must reveal
 * nothing — the same 404-without-confirmation contract the quotation and
 * masters suites already assert for their own reads.
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

async function owner(email: string) {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

const leadPayload = () => ({
  customerName: 'Aarav Mehta',
  phone: '+91 98765 43210',
  email: 'aarav@example.test',
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
  services: ['HOTEL'],
  itinerary: [{ country: 'India', destination: 'Goa', nights: 4, sequence: 1 }],
});

async function setupHotelMaster(client: Client) {
  const city = await client.post('/api/masters/cities', {
    countryCode: 'AZ',
    name: 'Baku',
    status: 'ACTIVE',
  });
  const destination = await client.post('/api/masters/destinations', {
    countryCode: 'AZ',
    name: 'Baku',
    destinationType: 'INTERNATIONAL',
    cityIds: [city.body.data.id],
    status: 'ACTIVE',
  });
  const hotel = await client.post('/api/masters/hotels', {
    destinationId: destination.body.data.id,
    cityId: city.body.data.id,
    name: "Copthorne King's Hotel Singapore",
    price: 10000,
    currency: 'INR',
    status: 'ACTIVE',
    email: 'reservations@example.test',
  });
  expect(hotel.status).toBe(201);
  return hotel.body.data.id as string;
}

describe('hotel email reads stay tenant-isolated', () => {
  it('rejects another company quotation and hotel master without confirming them', async () => {
    const alpha = await owner('alpha@hotel-mail.test');
    const lead = await alpha.post('/api/queries', leadPayload());
    expect(lead.status).toBe(201);
    const quotation = (
      await alpha.post('/api/quotations', { queryId: lead.body.data.id })
    ).body.data;
    const hotelId = await setupHotelMaster(alpha);

    const beta = await owner('beta@hotel-mail.test');
    // Listings never surface the other tenant's records.
    const list = await beta.get('/api/quotations?pageSize=20');
    expect(list.status).toBe(200);
    expect(
      (list.body.data.data as Array<{ id: string }>).some((row) => row.id === quotation.id),
    ).toBe(false);
    // Direct reads 404 rather than leaking existence.
    expect((await beta.get(`/api/quotations/${quotation.id}`)).status).toBe(404);
    expect((await beta.get(`/api/masters/hotels/${hotelId}`)).status).toBe(404);
  });

  it('lets the owning company read the quotation hotels and master email', async () => {
    const alpha = await owner('owner@hotel-mail.test');
    const lead = await alpha.post('/api/queries', leadPayload());
    const quotation = (
      await alpha.post('/api/quotations', { queryId: lead.body.data.id })
    ).body.data;
    const hotelId = await setupHotelMaster(alpha);

    const detail = await alpha.get(`/api/quotations/${quotation.id}`);
    expect(detail.status).toBe(200);
    expect(Array.isArray(detail.body.data.versions)).toBe(true);
    const master = await alpha.get(`/api/masters/hotels/${hotelId}`);
    expect(master.status).toBe(200);
    expect(master.body.data.email).toBe('reservations@example.test');
  });
});
