import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { fetchPublicToken } from './helpers/public-token.js';
import { createAuthClient, registrationPayload, TEST_ORIGIN } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { resetSystemCompanyIdCache } from '../src/modules/masters/master-visibility.js';
import { mintStaffViewToken, STAFF_VIEW_TTL_SECONDS } from '../src/modules/quotations/staff-view-token.js';

/**
 * Regression coverage for weblink visit classification (HOME vs EXTERNAL).
 *
 * Root cause being guarded: `Home` used to depend solely on the session cookie,
 * which the browser never sends to the apex marketing domain or a customer's
 * custom domain — so a signed-in team member's own preview was recorded as an
 * EXTERNAL customer visit. The fix adds a short-lived, signed, company+quotation
 * bound staff-view signal, and makes classification promote-only.
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
  resetSystemCompanyIdCache();
});

async function owner(email = 'owner@alpha.test', companyName = 'Alpha Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
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
  travelStartDate: '2026-09-10',
  travelEndDate: '2026-09-14',
  rooms: 1,
  adults: 2,
  childrenWithBed: 1,
  childrenWithoutBed: 0,
  infants: 0,
  extraBeds: 0,
  currency: 'INR',
  services: ['HOTEL', 'SIGHTSEEING'],
  itinerary: [{ country: 'India', destination: 'Goa', nights: 4, sequence: 1 }],
});

const templatePayload = () => ({
  name: 'Goa family escape',
  description: 'A relaxed coastal package.',
  destinationSummary: 'Goa • Calangute • Panjim',
  durationDays: 5,
  durationNights: 4,
  baseCurrency: 'INR',
  adultBasePrice: 35000,
  childWithBedBasePrice: 22000,
  childWithoutBedBasePrice: 12000,
  infantBasePrice: 2500,
  status: 'ACTIVE',
  itinerary: [
    {
      dayNumber: 1,
      title: 'Arrival and check-in',
      destination: 'Calangute',
      description: 'Private transfer to the hotel.',
      meals: 'Breakfast',
      overnightLocation: 'Calangute',
      sequence: 1,
    },
  ],
  hotels: [
    {
      city: 'Calangute',
      hotelName: 'Coastal Bay Resort',
      category: '4 star',
      roomType: 'Deluxe',
      mealPlan: 'Breakfast',
      rooms: 1,
      nights: 4,
      internalCost: 10000.1,
      sellingPrice: 12500.25,
      selected: true,
      sequence: 1,
    },
  ],
  services: [
    {
      serviceType: 'SIGHTSEEING',
      name: 'North Goa tour',
      city: 'Goa',
      dayNumber: 2,
      quantity: 2,
      internalCost: 500.15,
      sellingPrice: 750.25,
      sequence: 1,
    },
  ],
  inclusions: [{ content: 'Daily breakfast', sequence: 1 }],
  exclusions: [{ content: 'Personal expenses', sequence: 1 }],
  terms: [{ content: 'Subject to availability', sequence: 1 }],
});

async function readyQuotation() {
  const client = await owner();
  const lead = (await client.post('/api/queries', leadPayload())).body.data;
  const template = (await client.post('/api/quotation-templates', templatePayload())).body.data;
  const quotation = (
    await client.post('/api/quotations', { queryId: lead.id, templateId: template.id })
  ).body.data;
  const version = quotation.versions[0];
  await client.post(`/api/quotations/${quotation.id}/versions/${version.id}/finalize`);
  const link = await client.post(`/api/quotations/${quotation.id}/public-link`, {
    quotationVersionId: version.id,
  });
  const token = await fetchPublicToken(db, quotation.id);
  const row = await db.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
  return {
    client,
    quotation,
    version,
    token,
    companyId: row.companyId,
    url: link.body.data.url as string,
  };
}

const TEST_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const publicGet = (token: string, ip: string, stv?: string) => {
  const req = request(app)
    .get(`/api/public/quotations/${token}`)
    .set('User-Agent', TEST_UA)
    .set('X-Forwarded-For', ip);
  return stv ? req.query({ stv }) : req;
};

const publicTrack = (token: string, ip: string, body: Record<string, unknown> = {}) =>
  request(app)
    .post(`/api/public/quotations/${token}/track`)
    .set('Origin', TEST_ORIGIN)
    .set('User-Agent', TEST_UA)
    .set('X-Forwarded-For', ip)
    .send(body);

const onlyView = async () => (await db.quotationWeblinkView.findMany())[0]!;

describe('weblink analytics classification', () => {
  it('classifies an anonymous customer view as EXTERNAL', async () => {
    const { token } = await readyQuotation();
    const res = await publicGet(token, '203.0.113.10');
    expect(res.status).toBe(200);
    const row = await onlyView();
    expect(row).toMatchObject({ ipAddress: '203.0.113.10', type: 'EXTERNAL', viewCount: 1 });
  });

  it('classifies a same-company authenticated session as HOME', async () => {
    const { client, token } = await readyQuotation();
    const res = await client.get(`/api/public/quotations/${token}`);
    expect(res.status).toBe(200);
    expect((await onlyView()).type).toBe('HOME');
  });

  it('classifies a different-company authenticated session as EXTERNAL', async () => {
    const { token } = await readyQuotation();
    const other = await owner('other@tenant.test', 'Other Travel');
    const res = await other.get(`/api/public/quotations/${token}`);
    expect(res.status).toBe(200);
    expect((await onlyView()).type).toBe('EXTERNAL');
  });

  it('classifies a valid staff-view signal as HOME even without a session', async () => {
    const { token, companyId, quotation } = await readyQuotation();
    const stv = mintStaffViewToken({
      userId: '5eed5eed-0000-4000-8000-000000000001',
      companyId,
      quotationId: quotation.id,
    });
    const res = await publicGet(token, '203.0.113.11', stv);
    expect(res.status).toBe(200);
    expect((await onlyView()).type).toBe('HOME');
  });

  it('rejects a staff-view signal bound to a different company', async () => {
    const { token, quotation } = await readyQuotation();
    const stv = mintStaffViewToken({
      userId: '5eed5eed-0000-4000-8000-000000000002',
      companyId: '00000000-0000-4000-8000-00000000dead',
      quotationId: quotation.id,
    });
    const res = await publicGet(token, '203.0.113.12', stv);
    expect(res.status).toBe(200);
    expect((await onlyView()).type).toBe('EXTERNAL');
  });

  it('rejects a staff-view signal bound to a different quotation', async () => {
    const { token, companyId } = await readyQuotation();
    const stv = mintStaffViewToken({
      userId: '5eed5eed-0000-4000-8000-000000000003',
      companyId,
      quotationId: '00000000-0000-4000-8000-00000000beef',
    });
    const res = await publicGet(token, '203.0.113.13', stv);
    expect(res.status).toBe(200);
    expect((await onlyView()).type).toBe('EXTERNAL');
  });

  it('rejects a tampered staff-view signal', async () => {
    const { token, companyId, quotation } = await readyQuotation();
    const stv = mintStaffViewToken({
      userId: '5eed5eed-0000-4000-8000-000000000004',
      companyId,
      quotationId: quotation.id,
    });
    const [body] = stv.split('.');
    const tampered = `${body}.${'A'.repeat(43)}`;
    const res = await publicGet(token, '203.0.113.14', tampered);
    expect(res.status).toBe(200);
    expect((await onlyView()).type).toBe('EXTERNAL');
  });

  it('rejects an expired staff-view signal', async () => {
    const { token, companyId, quotation } = await readyQuotation();
    const stv = mintStaffViewToken({
      userId: '5eed5eed-0000-4000-8000-000000000005',
      companyId,
      quotationId: quotation.id,
      now: new Date(Date.now() - (STAFF_VIEW_TTL_SECONDS + 60) * 1000),
    });
    const res = await publicGet(token, '203.0.113.15', stv);
    expect(res.status).toBe(200);
    expect((await onlyView()).type).toBe('EXTERNAL');
  });

  it('promotes a previously-EXTERNAL row to HOME on a staff beacon, never demotes', async () => {
    const { token, companyId, quotation } = await readyQuotation();
    // Customer views first → EXTERNAL row for this IP.
    await publicGet(token, '203.0.113.16');
    expect((await onlyView()).type).toBe('EXTERNAL');
    // Staff beacon from the same host/IP carries a valid signed signal.
    const stv = mintStaffViewToken({
      userId: '5eed5eed-0000-4000-8000-000000000006',
      companyId,
      quotationId: quotation.id,
    });
    const trackRes = await publicTrack(token, '203.0.113.16', {
      staffViewToken: stv,
      platform: 'web',
    });
    expect(trackRes.status).toBe(200);
    expect((await onlyView()).type).toBe('HOME');
    // A later anonymous customer view must NOT demote the HOME row.
    await publicGet(token, '203.0.113.16');
    expect((await onlyView()).type).toBe('HOME');
  });

  it('skips rich profiling for a HOME staff visit', async () => {
    const { token, companyId, quotation } = await readyQuotation();
    const ipOf = (ipAddress: string) => ({
      quotationId_ipAddress: { quotationId: quotation.id, ipAddress },
    });
    // Control: a plain EXTERNAL beacon DOES capture the rich visitor snapshot.
    await publicGet(token, '203.0.113.20');
    await publicTrack(token, '203.0.113.20', { platform: 'web' });
    const external = await db.quotationWeblinkView.findUniqueOrThrow({
      where: ipOf('203.0.113.20'),
    });
    expect(external.userAgent).toBeTruthy();

    // Staff: the HOME load + beacon is never profiled.
    const stv = mintStaffViewToken({
      userId: '5eed5eed-0000-4000-8000-000000000007',
      companyId,
      quotationId: quotation.id,
    });
    await publicGet(token, '203.0.113.17', stv);
    const track = await publicTrack(token, '203.0.113.17', { staffViewToken: stv, platform: 'web' });
    expect(track.status).toBe(200);
    const home = await db.quotationWeblinkView.findUniqueOrThrow({ where: ipOf('203.0.113.17') });
    expect(home.type).toBe('HOME');
    expect(home.userAgent).toBeNull();
    expect(home.browser).toBeNull();
  });

  it('keeps the customer link URL unchanged and only mints staffViewUrl on opt-in', async () => {
    const { client, quotation, version, token } = await readyQuotation();
    const plain = await client.post(`/api/quotations/${quotation.id}/public-link`, {
      quotationVersionId: version.id,
    });
    expect(plain.body.data.url).toBeTruthy();
    expect(plain.body.data.url).not.toContain('stv=');
    expect(plain.body.data.staffViewUrl).toBeUndefined();

    const staff = await client.post(`/api/quotations/${quotation.id}/public-link`, {
      quotationVersionId: version.id,
      staffView: true,
    });
    expect(staff.body.data.url).toBe(plain.body.data.url);
    const staffUrl = staff.body.data.staffViewUrl as string;
    expect(staffUrl).toContain('stv=');
    const stv = new URL(staffUrl).searchParams.get('stv');
    expect(stv).toBeTruthy();

    // The minted signal round-trips through a public load → HOME.
    const res = await publicGet(token, '203.0.113.18', stv!);
    expect(res.status).toBe(200);
    expect((await onlyView()).type).toBe('HOME');
  });
});
