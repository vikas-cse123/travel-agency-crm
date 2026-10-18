import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { quotationItinerarySchema, quotationVersionUpdateSchema } from '@interscale/shared';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';

/**
 * Regression: a quotation created from a lead whose itinerary carries a Master
 * Destination but no city must still produce a valid quotation itinerary.
 *
 * The lead itinerary stores the Master Destination in `country` and an optional
 * city in `destination`. Create Lead no longer collects a city, so `destination`
 * is blank on every new lead. The legacy quotation itinerary requires a
 * non-empty `title` and `destination` (quotationItinerarySchema), so the
 * creation mapping must fall back to the Master Destination name instead of
 * copying the blank city — otherwise every save of the new quotation fails with
 * "itinerary.title / itinerary.destination must contain at least 1 character".
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

async function owner() {
  const email = 'owner@itinerary.test';
  const client = createAuthClient(app);
  await client.post(
    '/api/auth/register',
    registrationPayload({ email, companyName: 'Itinerary Travel' }),
  );
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

const leadPayload = (itinerary: unknown) => ({
  customerName: 'Aarav Mehta',
  phone: '+91 98765 43210',
  email: 'aarav@example.test',
  leadSource: 'REFERRAL',
  leadType: 'HOT',
  leadStage: 'QUALIFIED',
  priority: 'HIGH',
  travelStartDate: '2026-09-10',
  travelEndDate: '2026-09-14',
  rooms: 1,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  extraBeds: 0,
  currency: 'INR',
  services: ['HOTEL'],
  itinerary,
});

async function createQuotation(client: Awaited<ReturnType<typeof owner>>, itinerary: unknown) {
  const lead = await client.post('/api/queries', leadPayload(itinerary));
  expect(lead.status).toBe(201);
  const quotation = await client.post('/api/quotations', { queryId: lead.body.data.id });
  expect(quotation.status).toBe(201);
  return quotation.body.data as {
    id: string;
    destinationSummary: string;
    versions: Array<{
      id: string;
      destinationSummary: string;
      itinerary: Array<Record<string, unknown>>;
    }>;
  };
}

describe('Quotation itinerary prefill from a lead', () => {
  it('fills title and destination from the Master Destination when the lead has no city', async () => {
    const client = await owner();
    // Create Lead collects only a Destination (stored in `country`); no city.
    const quotation = await createQuotation(client, [
      { country: 'Azerbaijan', nights: 4, sequence: 1 },
    ]);

    const itinerary = quotation.versions[0]!.itinerary;
    expect(itinerary).toHaveLength(1);
    const row = itinerary[0]!;

    expect(row.title).toBe('Azerbaijan');
    expect(row.destination).toBe('Azerbaijan');
    expect(row.overnightLocation).toBe('Azerbaijan');
    expect(String(row.description)).toContain('Azerbaijan');

    // The generated row satisfies the shared schema, so the builder's next save
    // (validation reuses the same schema) cannot fail on these required fields.
    expect(quotationItinerarySchema.safeParse(row).success).toBe(true);

    // The destination summary is derived from the lead's Master Destination, not
    // the blank city, so the required version field is populated at creation.
    expect(quotation.destinationSummary).toBe('Azerbaijan');
    expect(quotation.versions[0]!.destinationSummary).toBe('Azerbaijan');
  });

  it('keeps the city when a legacy lead still carries one', async () => {
    const client = await owner();
    const quotation = await createQuotation(client, [
      { country: 'Azerbaijan', destination: 'Baku', nights: 4, sequence: 1 },
    ]);

    const row = quotation.versions[0]!.itinerary[0]!;
    expect(row.title).toBe('Baku');
    expect(row.destination).toBe('Baku');
    expect(row.overnightLocation).toBe('Baku');
    expect(quotationItinerarySchema.safeParse(row).success).toBe(true);
    expect(quotation.versions[0]!.destinationSummary).toBe('Baku');
  });

  it('joins every stay so a multi-destination blank-city lead never yields an empty summary', async () => {
    const client = await owner();
    // Previously each blank city joined to " • " (1 char after trim), failing
    // the min-2 destinationSummary rule. The Master Destination must be used.
    const quotation = await createQuotation(client, [
      { country: 'Azerbaijan', nights: 3, sequence: 1 },
      { country: 'Georgia', nights: 4, sequence: 2 },
    ]);

    expect(quotation.versions[0]!.destinationSummary).toBe('Azerbaijan • Georgia');
  });

  it('saves a quotation version with an empty destination summary', async () => {
    const client = await owner();
    const quotation = await createQuotation(client, [
      { country: 'Azerbaijan', nights: 4, sequence: 1 },
    ]);
    const versionId = quotation.versions[0]!.id;

    const saved = await client.patch(
      `/api/quotations/${quotation.id}/versions/${versionId}`,
      { destinationSummary: '' },
    );

    expect(saved.status).toBe(200);
    expect(saved.body.data.destinationSummary).toBe('');
  });

  it('treats the destination summary as optional in the update schema', () => {
    expect(quotationVersionUpdateSchema.safeParse({ destinationSummary: '' }).success).toBe(true);
    expect(
      quotationVersionUpdateSchema.safeParse({ destinationSummary: 'Azerbaijan' }).success,
    ).toBe(true);
  });
});
