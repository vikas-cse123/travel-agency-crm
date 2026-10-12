import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
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

async function owner(email = 'owner@preview.test', companyName = 'Preview Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

type Client = Awaited<ReturnType<typeof owner>>;

const leadPayload = (customerName: string) => ({
  customerName,
  phone: '+91 90000 10001',
  leadSource: 'REFERRAL',
  leadType: 'WARM',
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

/** Lead → quotation → finalized version → provisioned public token. */
async function finalizedQuotation(client: Client, customerName: string) {
  const lead = (await client.post('/api/queries', leadPayload(customerName))).body.data as {
    id: string;
  };
  const created = (await client.post('/api/quotations', { queryId: lead.id })).body.data as {
    id: string;
  };
  const details = (await client.get(`/api/quotations/${created.id}`)).body.data as {
    versions: { id: string }[];
  };
  const versionId = details.versions[0]!.id;
  await client.post(`/api/quotations/${created.id}/versions/${versionId}/finalize`);
  const row = await db.quotation.findUniqueOrThrow({ where: { id: created.id } });
  expect(row.publicToken).toBeTruthy();
  return { leadId: lead.id, quotationId: created.id, token: row.publicToken as string };
}

const previewOf = (token: string) => request(app).get(`/api/public/quotations/${token}/preview`);

describe('Quotation link preview metadata', () => {
  it('serves personalized titles for different leads in the initial HTML', async () => {
    const client = await owner();
    const first = await finalizedQuotation(client, 'Praveena');
    const second = await finalizedQuotation(client, 'Rahul Sharma');

    for (const [entry, name] of [
      [first, 'Praveena'],
      [second, 'Rahul Sharma'],
    ] as const) {
      const res = await previewOf(entry.token);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      const html = res.text;
      // Exact required format in both the document title and OG tag.
      expect(html).toContain(`<title>Personalized Travel Quotation – ${name}</title>`);
      expect(html).toContain(
        `<meta property="og:title" content="Personalized Travel Quotation – ${name}">`,
      );
      expect(html).toContain(`<meta property="og:url" content="`);
      expect(html).toContain(`/q/${entry.token}`);
      // No description, no generic branding anywhere in the preview.
      expect(html).not.toContain('og:description');
      expect(html).not.toContain('name="description"');
      expect(html).not.toContain('Travel Agency CRM');
    }
  });

  it('falls back to the base title when the lead name is blank', async () => {
    const client = await owner();
    const { leadId, token } = await finalizedQuotation(client, 'Nameless');
    await db.query.update({ where: { id: leadId }, data: { customerName: '' } });

    const res = await previewOf(token);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<meta property="og:title" content="Personalized Travel Quotation">');
    expect(res.text).not.toContain('Personalized Travel Quotation –');
  });

  it('escapes hostile lead names instead of injecting markup', async () => {
    const client = await owner();
    const { leadId, token } = await finalizedQuotation(client, 'Victim');
    await db.query.update({
      where: { id: leadId },
      data: { customerName: '<script>alert("x")</script>' },
    });

    const res = await previewOf(token);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<script>alert');
    expect(res.text).toContain('&lt;script&gt;');
  });

  it('returns a generic 404 for unknown and revoked links', async () => {
    const client = await owner();
    const { quotationId, token } = await finalizedQuotation(client, 'Praveena');
    expect((await previewOf('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);

    await db.quotation.update({
      where: { id: quotationId },
      data: { publicToken: null, publicTokenHash: null },
    });
    const revoked = await previewOf(token);
    expect(revoked.status).toBe(404);
    expect(revoked.text).not.toContain('Personalized Travel Quotation');
  });

  it('writes nothing while serving previews', async () => {
    const client = await owner();
    const { quotationId, token } = await finalizedQuotation(client, 'Praveena');
    const before = await db.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    expect((await previewOf(token)).status).toBe(200);
    expect((await previewOf(token)).status).toBe(200);

    const after = await db.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    expect(after.status).toBe(before.status);
    expect(after.firstViewedAt).toEqual(before.firstViewedAt);
    expect(await db.quotationWeblinkView.count({ where: { quotationId } })).toBe(0);
  });

  it('serves slug previews with canonical slug URLs', async () => {
    const client = await owner();
    const lead = (await client.post('/api/queries', leadPayload('Praveena'))).body.data as {
      id: string;
    };
    const created = (await client.post('/api/quotations', { queryId: lead.id })).body.data as {
      id: string;
    };
    const details = (await client.get(`/api/quotations/${created.id}`)).body.data as {
      versions: { id: string }[];
    };
    await client.post(`/api/quotations/${created.id}/versions/${details.versions[0]!.id}/finalize`);
    await client.patch(`/api/quotations/${created.id}/weblink-name`, { publicSlug: 'praveena-goa' });

    const res = await request(app).get('/api/public/quotations/by-slug/praveena-goa/preview');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain(
      '<meta property="og:title" content="Personalized Travel Quotation – Praveena">',
    );
    expect(res.text).toContain('/praveena-goa');
    expect(res.text).not.toContain('og:description');

    expect(
      (await request(app).get('/api/public/quotations/by-slug/no-such-slug-xyz/preview')).status,
    ).toBe(404);
  });

  it('isolates tenants across custom domains', async () => {
    const alpha = await owner('alpha@preview.test', 'Alpha Preview');
    await owner('beta@preview.test', 'Beta Preview');
    const { token } = await finalizedQuotation(alpha, 'Praveena');
    const alphaCompany = await db.user.findUniqueOrThrow({
      where: { normalizedEmail: 'alpha@preview.test' },
    });
    const betaCompany = await db.user.findUniqueOrThrow({
      where: { normalizedEmail: 'beta@preview.test' },
    });
    await db.customDomain.create({
      data: { companyId: alphaCompany.companyId, hostname: 'quotation.alphaprev.test', status: 'ACTIVE' },
    });
    await db.customDomain.create({
      data: { companyId: betaCompany.companyId, hostname: 'quotation.betaprev.test', status: 'ACTIVE' },
    });

    // Another tenant's domain never resolves alpha's link.
    expect(
      (await request(app).get(`/api/public/quotations/${token}/preview`).set('Host', 'quotation.betaprev.test'))
        .status,
    ).toBe(404);
    // The owning tenant's domain serves it.
    const own = await request(app)
      .get(`/api/public/quotations/${token}/preview`)
      .set('Host', 'quotation.alphaprev.test');
    expect(own.status).toBe(200);
    expect(own.text).toContain('Personalized Travel Quotation – Praveena');
  });
});
