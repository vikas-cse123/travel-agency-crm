import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { normalizeFlightDetails } from '@interscale/shared';

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

async function owner(email = 'owner@flights.test', companyName = 'Flight Records Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

type Client = Awaited<ReturnType<typeof owner>>;

const leadPayload = (overrides: Record<string, unknown> = {}) => ({
  customerName: 'Flight Customer',
  phone: '+91 90000 10001',
  leadSource: 'REFERRAL',
  leadType: 'WARM',
  leadStage: 'NEW_LEAD',
  priority: 'MEDIUM',
  rooms: 1,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  extraBeds: 0,
  currency: 'INR',
  services: ['FLIGHT'],
  itinerary: [{ country: 'India', destination: 'Goa', nights: 3, sequence: 1 }],
  ...overrides,
});

const segment = (flightNumber: string, from: string, to: string) => ({
  airlineName: 'Test Airways',
  flightNumber,
  travelClass: 'Economy',
  from,
  to,
  departureDate: '2026-09-05',
  departureTime: '10:00',
  arrivalDate: '2026-09-05',
  arrivalTime: '13:00',
  duration: '3h 0m',
  cabinLuggage: '7kg',
  checkInLuggage: '20kg',
  notes: null,
  connectionVia: null,
});

const flightRecord = (bookmarkCode: string | null, flightNumber: string, from: string, to: string) => ({
  bookmarkCode,
  journeyType: 'ONEWAY_OUTBOUND',
  outbound: { fromCity: from, toCity: to, travelClass: 'Economy', segments: [segment(flightNumber, from, to)] },
  returnJourney: { segments: [] },
});

async function readyQuotation(client: Client) {
  const lead = (await client.post('/api/queries', leadPayload())).body.data as { id: string };
  const created = (await client.post('/api/quotations', { queryId: lead.id })).body.data as {
    id: string;
    versions: { id: string }[];
  };
  return { lead, quotationId: created.id, versionId: created.versions[0]!.id };
}

async function versionOf(client: Client, quotationId: string) {
  const res = await client.get(`/api/quotations/${quotationId}`);
  expect(res.status).toBe(200);
  return res.body.data.versions[0] as { flightDetails: Record<string, unknown> | null };
}

describe('Quotation multiple flight records', () => {
  it('saves and reopens several flights with bookmark codes intact', async () => {
    const client = await owner();
    const { quotationId, versionId } = await readyQuotation(client);
    const saved = await client.patch(`/api/quotations/${quotationId}/versions/${versionId}`, {
      flightDetails: {
        include: true,
        flights: [
          flightRecord('FLT-000001', 'AI101', 'DEL', 'BOM'),
          flightRecord('FLT-000002', '6E202', 'BOM', 'GOI'),
        ],
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    const version = await versionOf(client, quotationId);
    const flights = (version.flightDetails as { flights?: unknown[] })?.flights ?? [];
    expect(flights).toHaveLength(2);
    expect(flights[0]).toMatchObject({ bookmarkCode: 'FLT-000001' });
    expect(flights[1]).toMatchObject({ bookmarkCode: 'FLT-000002' });
    const numbers = flights.flatMap((flight) =>
      ((flight as { outbound?: { segments?: { flightNumber?: string }[] } }).outbound?.segments ?? []).map(
        (row) => row.flightNumber,
      ),
    );
    expect(numbers).toEqual(['AI101', '6E202']);

    // Stored rows keep the canonical multi shape (no legacy mirrors).
    const row = await db.quotationVersion.findUniqueOrThrow({ where: { id: versionId } });
    const stored = normalizeFlightDetails(row.flightDetails) as { flights?: unknown[] };
    expect(stored.flights).toHaveLength(2);
  });

  it('normalizes a legacy single-flight write into one record', async () => {
    const client = await owner();
    const { quotationId, versionId } = await readyQuotation(client);
    const saved = await client.patch(`/api/quotations/${quotationId}/versions/${versionId}`, {
      flightDetails: {
        include: true,
        journeyType: 'ONEWAY_OUTBOUND',
        outbound: {
          fromCity: 'DEL',
          toCity: 'BOM',
          segments: [segment('AI101', 'DEL', 'BOM')],
        },
        returnJourney: { segments: [] },
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    const version = await versionOf(client, quotationId);
    const flights = (version.flightDetails as { flights?: unknown[] })?.flights ?? [];
    expect(flights).toHaveLength(1);
    expect(flights[0]).toMatchObject({ journeyType: 'ONEWAY_OUTBOUND' });
  });

  it('keeps tenant airline validation across every flight', async () => {
    const client = await owner();
    const { quotationId, versionId } = await readyQuotation(client);
    // Unknown airline ids are rejected no matter which flight carries them.
    const saved = await client.patch(`/api/quotations/${quotationId}/versions/${versionId}`, {
      flightDetails: {
        include: true,
        flights: [
          {
            ...flightRecord('FLT-000001', 'AI101', 'DEL', 'BOM'),
            outbound: {
              fromCity: 'DEL',
              toCity: 'BOM',
              segments: [
                { ...segment('AI101', 'DEL', 'BOM'), airlineId: '00000000-0000-4000-8000-000000000000' },
              ],
            },
          },
        ],
      },
    });
    expect(saved.status).toBe(400);
  });
});
