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

async function owner(email = 'owner@bookingterms.test') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

const leadPayload = (phone = '+91 98765 43210') => ({
  customerName: 'Akash Testing',
  phone,
  email: 'akash@example.test',
  leadSource: 'REFERRAL',
  leadType: 'HOT',
  leadStage: 'QUALIFIED',
  priority: 'HIGH',
  travelStartDate: '2026-09-10',
  travelEndDate: '2026-09-15',
  rooms: 1,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  extraBeds: 0,
  currency: 'INR',
  services: ['HOTEL', 'SIGHTSEEING'],
  itinerary: [{ country: 'Vietnam', destination: 'Hanoi', nights: 5, sequence: 1 }],
});

// Rich-text payload of EXACTLY `length` characters (tags included, matching
// the app-level raw-length validation).
const terms = (length: number) => `<p>${'a'.repeat(length - 7)}</p>`;

describe('Quotation bookingTerms 20,000-character limit', () => {
  it('saves bookingTerms under the old 8,000 cap on a quotation version', async () => {
    const client = await owner();
    const lead = (await client.post('/api/queries', leadPayload())).body.data;
    const created = await client.post('/api/quotations', { queryId: lead.id });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const quotationId = created.body.data.id as string;
    const versionId = created.body.data.versions[0].id as string;
    const updated = await client.patch(`/api/quotations/${quotationId}/versions/${versionId}`, {
      bookingTerms: terms(7250),
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    const detail = await client.get(`/api/quotations/${quotationId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.versions[0].bookingTerms).toHaveLength(7250);
  });

  it('creates and edits a quotation with bookingTerms between 8,000 and 20,000', async () => {
    const client = await owner('owner2@bookingterms.test');
    const lead = (await client.post('/api/queries', leadPayload('+91 98765 43211'))).body.data;
    const created = await client.post('/api/quotations', {
      queryId: lead.id,
      version: {
        title: 'Hanoi Package',
        destinationSummary: 'Hanoi',
        currency: 'INR',
        bookingTerms: terms(15000),
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const quotationId = created.body.data.id as string;
    const versionId = created.body.data.versions[0].id as string;

    // Edit the same version with longer terms — no data loss.
    const updated = await client.patch(`/api/quotations/${quotationId}/versions/${versionId}`, {
      bookingTerms: terms(19000),
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data.bookingTerms).toHaveLength(terms(19000).length);

    // Stored value round-trips intact.
    const detail = await client.get(`/api/quotations/${quotationId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.versions[0].bookingTerms).toHaveLength(terms(19000).length);
  });

  it('saves a new version with long bookingTerms and rejects content over the new limit', async () => {
    const client = await owner('owner3@bookingterms.test');
    const lead = (await client.post('/api/queries', leadPayload('+91 98765 43212'))).body.data;
    const created = await client.post('/api/quotations', {
      queryId: lead.id,
      version: {
        title: 'Hanoi Package',
        destinationSummary: 'Hanoi',
        currency: 'INR',
        bookingTerms: terms(9000),
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const quotationId = created.body.data.id as string;

    const next = await client.post(`/api/quotations/${quotationId}/versions`, {
      version: {
        title: 'Hanoi Package',
        destinationSummary: 'Hanoi',
        currency: 'INR',
        bookingTerms: terms(19999),
      },
    });
    expect(next.status, JSON.stringify(next.body)).toBe(201);
    expect(next.body.data.bookingTerms).toHaveLength(terms(19999).length);

    // Public weblink payload carries the stored long terms without truncation.
    const weblink = await client.get(
      `/api/quotations/${quotationId}/versions/${next.body.data.id}`,
    );
    expect(weblink.status).toBe(200);
    expect(weblink.body.data.bookingTerms).toHaveLength(terms(19999).length);

    const over = await client.post(`/api/quotations/${quotationId}/versions`, {
      version: {
        title: 'Hanoi Package',
        destinationSummary: 'Hanoi',
        currency: 'INR',
        bookingTerms: terms(20001),
      },
    });
    expect(over.status).toBe(400);
    expect(JSON.stringify(over.body)).toContain('20000');
  });
});
