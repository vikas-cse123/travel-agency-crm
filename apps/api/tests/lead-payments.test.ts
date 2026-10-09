import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { hashPassword } from '../src/utils/crypto.js';

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

async function owner(email = 'owner@leadpay.test', companyName = 'Lead Pay Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

type Client = Awaited<ReturnType<typeof owner>>;

const leadPayload = (phone = '+91 98765 43210') => ({
  customerName: 'Vikas Sahni',
  phone,
  leadSource: 'REFERRAL',
  leadType: 'HOT',
  leadStage: 'NEW_LEAD',
  priority: 'HIGH',
  rooms: 1,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  extraBeds: 0,
  currency: 'INR',
  services: ['HOTEL'],
  itinerary: [{ country: 'Singapore', destination: 'Singapore', nights: 4, sequence: 1 }],
});

async function leadWithQuotation(
  client: Client,
  options: { finalAmount?: number; currency?: string; destination?: string; phone?: string } = {},
) {
  const { finalAmount = 600000, currency = 'INR', destination = 'Singapore', phone } = options;
  const lead = (
    await client.post('/api/queries', leadPayload(phone ?? `+91 98${Math.floor(100000 + Math.random() * 899999)}`))
  ).body.data;
  const quotation = (await client.post('/api/quotations', { queryId: lead.id })).body.data;
  const version = quotation.versions[0];
  await db.quotationVersion.update({
    where: { id: version.id },
    data: { finalAmount, currency },
  });
  await db.quotation.update({
    where: { id: quotation.id },
    data: { destinationSummary: destination },
  });
  return { lead, quotation, version };
}

async function restrictedClient(ownerEmail: string, keys: string[], email: string) {
  const ownerUser = await db.user.findUniqueOrThrow({ where: { normalizedEmail: ownerEmail } });
  const role = await db.role.create({
    data: {
      companyId: ownerUser.companyId,
      name: `Restricted ${email.split('@')[0]}`,
      description: 'Test role',
      hierarchyLevel: 10,
      isSystem: false,
    },
  });
  for (const key of keys) {
    const permission = await db.permission.findUniqueOrThrow({ where: { key } });
    await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  }
  await db.user.create({
    data: {
      companyId: ownerUser.companyId,
      roleId: role.id,
      username: email.split('@')[0]!,
      fullName: 'Restricted User',
      email,
      normalizedEmail: email,
      passwordHash: await hashPassword('Sales@2026'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const client = createAuthClient(app);
  expect(
    (await client.post('/api/auth/login', { email, password: 'Sales@2026', rememberMe: false }))
      .status,
  ).toBe(200);
  return client;
}

describe('Lead payment cases (record payment from lead)', () => {
  it('creates a case from the linked quotation with derived title, amount and currency', async () => {
    const client = await owner();
    const { lead, quotation } = await leadWithQuotation(client);
    const response = await client.post('/api/payments/cases/for-lead', { queryId: lead.id });
    expect(response.status).toBe(201);
    expect(response.body.data.created).toBe(true);
    expect(response.body.data.lead).toMatchObject({ id: lead.id });
    expect(response.body.data.quotation).toMatchObject({
      id: quotation.id,
      quotationNumber: quotation.quotationNumber,
    });
    const trip = response.body.data.case;
    expect(trip.queryId).toBe(lead.id);
    expect(trip.customerName).toBe('Vikas Sahni');
    expect(trip.title).toContain('Singapore');
    expect(trip.tripAmount).toBe('600000.00');
    expect(trip.currency).toBe('INR');
    expect(trip.collected).toBe('0.00');
    expect(trip.outstanding).toBe('600000.00');
    expect(trip.payments).toEqual([]);
    const row = await db.paymentCase.findFirstOrThrow({ where: { queryId: lead.id } });
    expect(row.id).toBe(trip.id);
  });

  it('reuses the existing case without creating duplicates', async () => {
    const client = await owner();
    const { lead } = await leadWithQuotation(client);
    const first = await client.post('/api/payments/cases/for-lead', { queryId: lead.id });
    const second = await client.post('/api/payments/cases/for-lead', { queryId: lead.id });
    expect(second.status).toBe(200);
    expect(second.body.data.created).toBe(false);
    expect(second.body.data.case.id).toBe(first.body.data.case.id);
    expect(await db.paymentCase.count({ where: { queryId: lead.id } })).toBe(1);
  });

  it('creates exactly one case under concurrent requests', async () => {
    const client = await owner();
    const { lead } = await leadWithQuotation(client);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        client.post('/api/payments/cases/for-lead', { queryId: lead.id }),
      ),
    );
    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    const ids = new Set(results.map((r) => r.body.data.case.id));
    expect(ids.size).toBe(1);
    expect(await db.paymentCase.count({ where: { queryId: lead.id } })).toBe(1);
  });

  it('asks for the amount when the lead has no usable quotation amount', async () => {
    const client = await owner();
    const lead = (
      await client.post('/api/queries', leadPayload('+91 98111 22222'))
    ).body.data;
    const response = await client.post('/api/payments/cases/for-lead', { queryId: lead.id });
    expect(response.status).toBe(200);
    expect(response.body.data.created).toBe(false);
    expect(response.body.data.case).toBeNull();
    expect(response.body.data.requiresAmount).toBe(true);
    expect(response.body.data.suggestion.currency).toBe('INR');
    expect(response.body.data.suggestion.title).toContain('Singapore');
    // Caller-supplied values create the case; nothing is invented.
    const created = await client.post('/api/payments/cases/for-lead', {
      queryId: lead.id,
      title: 'Vikas Sahni – Singapore',
      tripAmount: 250000,
      currency: 'INR',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.case.tripAmount).toBe('250000.00');
  });

  it('rejects invalid caller-supplied amounts', async () => {
    const client = await owner();
    const lead = (
      await client.post('/api/queries', leadPayload('+91 98111 33333'))
    ).body.data;
    expect(
      (
        await client.post('/api/payments/cases/for-lead', {
          queryId: lead.id,
          tripAmount: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post('/api/payments/cases/for-lead', {
          queryId: '00000000-0000-0000-0000-000000000000',
        })
      ).status,
    ).toBe(404);
  });

  it('prefers the latest quotation when several exist and ignores deleted ones', async () => {
    const client = await owner();
    const lead = (
      await client.post('/api/queries', leadPayload('+91 98111 44444'))
    ).body.data;
    const first = (await client.post('/api/quotations', { queryId: lead.id })).body.data;
    await db.quotationVersion.update({
      where: { id: first.versions[0].id },
      data: { finalAmount: 100000 },
    });
    const second = (await client.post('/api/quotations', { queryId: lead.id })).body.data;
    await db.quotationVersion.update({
      where: { id: second.versions[0].id },
      data: { finalAmount: 750000 },
    });
    await db.quotation.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    const response = await client.post('/api/payments/cases/for-lead', { queryId: lead.id });
    expect(response.body.data.quotation.quotationNumber).toBe(second.quotationNumber);
    expect(response.body.data.case.tripAmount).toBe('750000.00');
  });

  it('records and tracks payments against the lead case with receipts', async () => {
    const client = await owner();
    const { lead } = await leadWithQuotation(client);
    const trip = (await client.post('/api/payments/cases/for-lead', { queryId: lead.id })).body
      .data.case;
    const first = await client.post('/api/payments', {
      caseId: trip.id,
      amount: 200000,
      currency: 'INR',
      paymentMethod: 'UPI',
      receivedAt: '2026-10-09',
      referenceNumber: 'UPI123',
    });
    expect(first.status).toBe(201);
    expect(first.body.data.paymentNumber).toMatch(/^PAY-000001$/);
    const second = await client.post('/api/payments', {
      caseId: trip.id,
      amount: 400000,
      currency: 'INR',
      paymentMethod: 'BANK_TRANSFER',
      receivedAt: '2026-10-10',
    });
    expect(second.status).toBe(201);
    const state = (
      await client.get(`/api/payments/cases/by-lead/${lead.id}`)
    ).body.data;
    expect(state.case.collected).toBe('600000.00');
    expect(state.case.outstanding).toBe('0.00');
    expect(state.case.payments).toHaveLength(2);
    const voucher = await client.post(`/api/payments/${first.body.data.id}/receipt`);
    expect(voucher.status).toBe(200);
    expect(voucher.body.data.receiptNumber).toMatch(/^RCP-000001$/);
    const download = await client.get(
      `/api/payments/${first.body.data.id}/receipt/download-url`,
    );
    expect(download.status).toBe(200);
    expect(download.body.data.url).toBeTruthy();
    // Fully paid: further collections are rejected.
    expect(
      (
        await client.post('/api/payments', {
          caseId: trip.id,
          amount: 100,
          currency: 'INR',
          paymentMethod: 'CASH',
          receivedAt: '2026-10-11',
        })
      ).status,
    ).toBe(409);
    // Invalid amounts are rejected.
    expect(
      (
        await client.post('/api/payments', {
          caseId: trip.id,
          amount: 0,
          currency: 'INR',
          paymentMethod: 'CASH',
          receivedAt: '2026-10-11',
        })
      ).status,
    ).toBe(400);
  });

  it('exposes the case on the Payments page ledger search', async () => {
    const client = await owner();
    const { lead } = await leadWithQuotation(client);
    const trip = (await client.post('/api/payments/cases/for-lead', { queryId: lead.id })).body
      .data.case;
    await client.post('/api/payments', {
      caseId: trip.id,
      amount: 10000,
      currency: 'INR',
      paymentMethod: 'UPI',
      receivedAt: '2026-10-09',
      referenceNumber: 'UPI123',
    });
    const ledger = await client.get('/api/payments?search=Vikas');
    expect(ledger.status).toBe(200);
    expect(
      ledger.body.data.data.some(
        (row: { paymentCase: { id: string } }) => row.paymentCase.id === trip.id,
      ),
    ).toBe(true);
  });

  it('enforces permissions and tenant isolation', async () => {
    const client = await owner('owner@leadpay.test', 'Lead Pay Travel');
    const { lead } = await leadWithQuotation(client);
    const restricted = await restrictedClient('owner@leadpay.test', ['queries.view'], 'noview@leadpay.test');
    expect(
      (await restricted.post('/api/payments/cases/for-lead', { queryId: lead.id })).status,
    ).toBe(403);
    expect((await restricted.get(`/api/payments/cases/by-lead/${lead.id}`)).status).toBe(403);
    const other = await owner('owner@other.test', 'Other Travel');
    expect(
      (await other.post('/api/payments/cases/for-lead', { queryId: lead.id })).status,
    ).toBe(404);
    expect((await other.get(`/api/payments/cases/by-lead/${lead.id}`)).status).toBe(404);
  });
});
