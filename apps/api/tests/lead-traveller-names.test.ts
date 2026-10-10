import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';

/**
 * Optional per-traveller names on leads, carried into quotations.
 * Positional string arrays parallel to the passenger counts; blanks stay
 * blank, legacy rows stay null.
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

async function owner(email = 'owner@travellers.test', companyName = 'Traveller Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

const leadPayload = (overrides: Record<string, unknown> = {}) => ({
  customerName: 'Aarav Mehta',
  phone: '+91 98765 43210',
  leadSource: 'REFERRAL',
  leadType: 'HOT',
  leadStage: 'NEW_LEAD',
  priority: 'HIGH',
  rooms: 1,
  adults: 3,
  childrenWithBed: 2,
  childrenWithoutBed: 2,
  infants: 1,
  extraBeds: 0,
  currency: 'INR',
  services: ['HOTEL'],
  itinerary: [{ country: 'India', destination: 'Goa', nights: 4, sequence: 1 }],
  ...overrides,
});

const fullNames = {
  adultNames: ['Rahul Sharma', 'Priya Sharma', ''],
  childWithBedNames: ['Aarav Sharma', ''],
  childWithoutBedNames: ['', 'Anaya Sharma'],
  infantNames: ['Ira Sharma'],
};

describe('lead traveller names', () => {
  it('creates a lead with all traveller names blank', async () => {
    const client = await owner();
    const res = await client.post('/api/queries', leadPayload());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.data.id as string;
    const row = await db.query.findUniqueOrThrow({ where: { id } });
    // Fresh rows store empty lists (same convention as the ages arrays).
    expect(row.adultNames).toEqual([]);
    expect(row.childWithBedNames).toEqual([]);
    expect(row.childWithoutBedNames).toEqual([]);
    expect(row.infantNames).toEqual([]);
  });

  it('reads legacy leads with null name columns and accepts new names', async () => {
    const client = await owner();
    const res = await client.post('/api/queries', leadPayload());
    const id = res.body.data.id as string;
    await db.query.update({
      where: { id },
      data: {
        adultNames: Prisma.DbNull,
        childWithBedNames: Prisma.DbNull,
        childWithoutBedNames: Prisma.DbNull,
        infantNames: Prisma.DbNull,
      },
    });
    const reloaded = await client.get(`/api/queries/${id}`);
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.data.adultNames).toBeNull();
    expect(reloaded.body.data.infantNames).toBeNull();
    const updated = await client.patch(`/api/queries/${id}`, { adultNames: ['Rahul Sharma'] });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data.adultNames).toEqual(['Rahul Sharma']);
  });

  it('persists names for every passenger category and reloads them', async () => {
    const client = await owner();
    const res = await client.post('/api/queries', leadPayload(fullNames));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.data.id as string;
    expect(res.body.data).toMatchObject(fullNames);

    const reloaded = await client.get(`/api/queries/${id}`);
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.data).toMatchObject(fullNames);

    const row = await db.query.findUniqueOrThrow({ where: { id } });
    expect(row.adultNames).toEqual(fullNames.adultNames);
    expect(row.infantNames).toEqual(fullNames.infantNames);
  });

  it('updates names without touching counts or ages', async () => {
    const client = await owner();
    const created = await client.post('/api/queries', leadPayload(fullNames));
    const id = created.body.data.id as string;
    const updated = await client.patch(`/api/queries/${id}`, {
      adultNames: ['Rahul Sharma', 'Priya Sharma', 'Karan Sharma'],
      infantNames: [],
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data.adultNames).toEqual(['Rahul Sharma', 'Priya Sharma', 'Karan Sharma']);
    expect(updated.body.data.infantNames).toEqual([]);
    // Untouched categories survive a partial update.
    expect(updated.body.data.childWithBedNames).toEqual(fullNames.childWithBedNames);
    const row = await db.query.findUniqueOrThrow({ where: { id } });
    expect(row.adults).toBe(3);
    expect(row.childWithBedNames).toEqual(fullNames.childWithBedNames);
  });

  it('rejects an overlong traveller name', async () => {
    const client = await owner();
    const res = await client.post('/api/queries', leadPayload({ adultNames: ['x'.repeat(121)] }));
    expect(res.status).toBe(400);
  });
});

describe('quotation traveller names', () => {
  it('carries lead names into the quotation on creation', async () => {
    const client = await owner();
    const lead = await client.post('/api/queries', leadPayload(fullNames));
    expect(lead.status).toBe(201);
    const quotation = await client.post('/api/quotations', { queryId: lead.body.data.id });
    expect(quotation.status, JSON.stringify(quotation.body)).toBe(201);
    expect(quotation.body.data).toMatchObject(fullNames);
  });

  it('lets explicit input override the carried lead names', async () => {
    const client = await owner();
    const lead = await client.post('/api/queries', leadPayload(fullNames));
    const quotation = await client.post('/api/quotations', {
      queryId: lead.body.data.id,
      adultNames: ['Override One'],
    });
    expect(quotation.status, JSON.stringify(quotation.body)).toBe(201);
    expect(quotation.body.data.adultNames).toEqual(['Override One']);
    // Non-overridden categories still come from the lead.
    expect(quotation.body.data.childWithBedNames).toEqual(fullNames.childWithBedNames);
  });

  it('updates quotation names without touching the lead', async () => {
    const client = await owner();
    const lead = await client.post('/api/queries', leadPayload(fullNames));
    const quotation = (
      await client.post('/api/quotations', { queryId: lead.body.data.id })
    ).body.data as { id: string };
    const updated = await client.patch(`/api/quotations/${quotation.id}`, {
      infantNames: ['Ira Updated'],
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data.infantNames).toEqual(['Ira Updated']);
    expect(updated.body.data.adultNames).toEqual(fullNames.adultNames);
    // The lead keeps its own copy.
    const reloadedLead = await client.get(`/api/queries/${lead.body.data.id}`);
    expect(reloadedLead.body.data.infantNames).toEqual(fullNames.infantNames);
  });

  it('leaves legacy quotations without names untouched and compatible', async () => {
    const client = await owner();
    const lead = await client.post('/api/queries', leadPayload());
    const quotation = (
      await client.post('/api/quotations', { queryId: lead.body.data.id })
    ).body.data as { id: string; adultNames: unknown };
    expect(quotation.adultNames).toBeNull();
    const reloaded = await client.get(`/api/quotations/${quotation.id}`);
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.data.adultNames).toBeNull();
  });
});
