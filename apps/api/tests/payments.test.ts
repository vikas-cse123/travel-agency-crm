import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { storageService } from '../src/services/storage/storage.service.js';
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

async function owner(email = 'owner@pay.test', companyName = 'Pay Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

type Client = Awaited<ReturnType<typeof owner>>;

const tripPayload = (overrides: Record<string, unknown> = {}) => ({
  customerName: 'Mohan',
  customerPhone: '+91 98989 89898',
  title: 'Singapore Family Trip',
  tripAmount: 300000,
  currency: 'INR',
  ...overrides,
});

async function createTrip(client: Client, overrides: Record<string, unknown> = {}) {
  const response = await client.post('/api/payments/cases', tripPayload(overrides));
  expect(response.status).toBe(201);
  return response.body.data as { id: string };
}

const paymentPayload = (caseId: string, overrides: Record<string, unknown> = {}) => ({
  caseId,
  amount: 10000,
  currency: 'INR',
  paymentMethod: 'UPI',
  paymentStatus: 'RECEIVED',
  receivedAt: '2026-10-09',
  referenceNumber: 'UPI123',
  notes: 'Advance',
  ...overrides,
});

async function recordPayment(
  client: Client,
  caseId: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await client.post('/api/payments', paymentPayload(caseId, overrides));
  expect(response.status).toBe(201);
  return response.body.data as { id: string; paymentNumber: string };
}

async function voucherText(paymentId: string): Promise<string> {
  const stored = await db.paymentReceipt.findUniqueOrThrow({ where: { paymentId } });
  const object = (storageService as unknown as { read: (key: string) => Buffer | undefined }).read(
    stored.objectKey,
  );
  return execFileSync('pdftotext', ['-layout', '-', '-'], {
    input: object ?? Buffer.alloc(0),
    maxBuffer: 16 * 1024 * 1024,
  }).toString('utf8');
}

async function salesClient(companyOwnerEmail: string) {
  const email = 'sales@pay.test';
  const ownerUser = await db.user.findUniqueOrThrow({
    where: { normalizedEmail: companyOwnerEmail },
  });
  const role = await db.role.findFirstOrThrow({
    where: { companyId: ownerUser.companyId, name: 'Sales Executive' },
  });
  await db.user.create({
    data: {
      companyId: ownerUser.companyId,
      roleId: role.id,
      username: 'salespay',
      fullName: 'Sales User',
      email,
      normalizedEmail: email,
      passwordHash: await hashPassword('Sales@2026'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const client = createAuthClient(app);
  const login = await client.post('/api/auth/login', {
    email,
    password: 'Sales@2026',
    rememberMe: false,
  });
  expect(login.status).toBe(200);
  return client;
}

describe('Standalone payments (no Booking dependency)', () => {
  it('creates a payment with no booking anywhere in the model', async () => {
    const client = await owner();
    const trip = await createTrip(client);
    const payment = await recordPayment(client, trip.id);
    expect(payment.paymentNumber).toMatch(/^PAY-000001$/);
    const details = (await client.get(`/api/payments/${payment.id}`)).body.data;
    expect(details).not.toHaveProperty('bookingId');
    expect(details).not.toHaveProperty('booking');
    expect(details).not.toHaveProperty('bookingNumber');
    expect(details.paymentCase).toMatchObject({ title: 'Singapore Family Trip' });
    expect(details.paymentCase).not.toHaveProperty('bookingId');
    const row = await db.customerPayment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.caseId).toBe(trip.id);
  });

  it('requires a trip case and validates it', async () => {
    const client = await owner();
    expect(
      (
        await client.post('/api/payments', {
          amount: 100,
          currency: 'INR',
          paymentMethod: 'CASH',
          receivedAt: '2026-10-09',
        })
      ).status,
    ).toBe(400);
    expect(
      (await client.post('/api/payments', paymentPayload('00000000-0000-0000-0000-000000000000')))
        .status,
    ).toBe(404);
    expect((await client.post('/api/payments/cases', tripPayload({ title: '' }))).status).toBe(400);
    expect((await client.post('/api/payments/cases', tripPayload({ tripAmount: -5 }))).status).toBe(
      400,
    );
  });

  it('links customer and lead masters with snapshots', async () => {
    const client = await owner();
    const company = await db.company.findFirstOrThrow({
      select: { id: true, users: { take: 1, select: { id: true } } },
    });
    const customer = await db.customer.create({
      data: {
        companyId: company.id,
        customerNumber: 'CUS-000001',
        displayName: 'Mohan Master',
        normalizedName: 'mohan master',
        primaryPhone: '9876543210',
        normalizedPhone: '919876543210',
        createdById: company.users[0]!.id,
      },
    });
    const lead = (
      await client.post('/api/queries', {
        customerName: 'Mohan Master',
        phone: '+91 98765 43210',
        leadSource: 'REFERRAL',
        rooms: 1,
        adults: 2,
        currency: 'INR',
        services: ['HOTEL'],
        itinerary: [{ country: 'India', destination: 'Goa', nights: 3, sequence: 1 }],
      })
    ).body.data as { id: string };
    const trip = await createTrip(client, {
      customerId: customer.id,
      queryId: lead.id,
      customerName: 'Ignored Name',
      title: 'Goa Trip',
      tripAmount: 200000,
    });
    const details = (await client.get(`/api/payments/cases/${trip.id}`)).body.data;
    // Master data wins over typed text for the snapshot.
    expect(details.customerName).toBe('Mohan Master');
    expect(details.customer?.id).toBe(customer.id);
    expect(details.query?.id).toBe(lead.id);
  });

  it('supports multiple payments per trip with running totals', async () => {
    const client = await owner();
    const trip = await createTrip(client);
    await recordPayment(client, trip.id, { amount: 10000 });
    await recordPayment(client, trip.id, {
      amount: 50000,
      paymentMethod: 'BANK_TRANSFER',
      receivedAt: '2026-11-01',
      referenceNumber: 'NEFT123',
    });
    await recordPayment(client, trip.id, {
      amount: 25000,
      paymentMethod: 'CASH',
      receivedAt: '2026-11-01',
      referenceNumber: 'CASH-1',
    });
    const details = (await client.get(`/api/payments/cases/${trip.id}`)).body.data;
    expect(details).toMatchObject({
      tripAmount: '300000.00',
      collected: '85000.00',
      outstanding: '215000.00',
      paymentCount: 3,
      status: 'PARTIALLY_PAID',
    });
    expect(details.payments).toHaveLength(3);
    // Same-day payments coexist as independent rows.
    expect(
      details.payments.filter(
        (row: { receivedAt: string }) => String(row.receivedAt).slice(0, 10) === '2026-11-01',
      ),
    ).toHaveLength(2);
  });

  it('keeps trips separated per customer', async () => {
    const client = await owner();
    const singapore = await createTrip(client);
    const dubai = await createTrip(client, { title: 'Dubai Family Trip', tripAmount: 200000 });
    await recordPayment(client, singapore.id, { amount: 60000 });
    await recordPayment(client, dubai.id, { amount: 50000 });
    const first = (await client.get(`/api/payments/cases/${singapore.id}`)).body.data;
    const second = (await client.get(`/api/payments/cases/${dubai.id}`)).body.data;
    expect(first).toMatchObject({ collected: '60000.00', outstanding: '240000.00' });
    expect(second).toMatchObject({ collected: '50000.00', outstanding: '150000.00' });
    const history = (await client.get(`/api/payments?caseId=${singapore.id}`)).body.data;
    expect(history.pagination.total).toBe(1);
  });

  it('excludes reversed payments from collected totals', async () => {
    const client = await owner();
    const trip = await createTrip(client);
    const payment = await recordPayment(client, trip.id, { amount: 60000 });
    await client.post(`/api/payments/${payment.id}/reverse`, { reason: 'Duplicate entry' });
    const details = (await client.get(`/api/payments/cases/${trip.id}`)).body.data;
    expect(details).toMatchObject({
      collected: '0.00',
      outstanding: '300000.00',
      status: 'UNPAID',
    });
    const ledger = await client.get('/api/payments');
    expect(ledger.body.data.data[0]).toMatchObject({ paymentStatus: 'REVERSED' });
    expect(ledger.body.data.summary.totalCollected).toBe('0.00');
  });

  it('rejects overpayment against the outstanding trip balance', async () => {
    const client = await owner();
    const trip = await createTrip(client, { tripAmount: 50000 });
    await recordPayment(client, trip.id, { amount: 30000 });
    const tooMuch = await client.post('/api/payments', paymentPayload(trip.id, { amount: 20001 }));
    expect(tooMuch.status).toBe(409);
    expect(await db.customerPayment.count({ where: { caseId: trip.id } })).toBe(1);
    // Exact payoff is allowed.
    await recordPayment(client, trip.id, { amount: 20000, referenceNumber: 'FULL' });
    const details = (await client.get(`/api/payments/cases/${trip.id}`)).body.data;
    expect(details).toMatchObject({ collected: '50000.00', outstanding: '0.00', status: 'PAID' });
  });

  it('reuses booking validation rules (amount, method, currency)', async () => {
    const client = await owner();
    const trip = await createTrip(client);
    expect(
      (await client.post('/api/payments', paymentPayload(trip.id, { amount: 0 }))).status,
    ).toBe(400);
    expect(
      (await client.post('/api/payments', paymentPayload(trip.id, { paymentMethod: 'CHEQUEBOOK' })))
        .status,
    ).toBe(400);
    expect(
      (await client.post('/api/payments', paymentPayload(trip.id, { currency: 'USD' }))).status,
    ).toBe(400);
  });

  it('generates sequentially numbered vouchers, one per payment', async () => {
    const client = await owner();
    const trip = await createTrip(client);
    const first = await recordPayment(client, trip.id);
    const second = await recordPayment(client, trip.id, {
      amount: 50000,
      paymentMethod: 'BANK_TRANSFER',
      receivedAt: '2026-11-01',
      referenceNumber: 'NEFT123',
    });
    const one = await client.post(`/api/payments/${first.id}/receipt`, {});
    const two = await client.post(`/api/payments/${second.id}/receipt`, {});
    expect(one.body.data.receiptNumber).toBe('RCP-000001');
    expect(two.body.data.receiptNumber).toBe('RCP-000002');
    const again = await client.post(`/api/payments/${first.id}/receipt`, {});
    expect(again.body.data.receiptNumber).toBe('RCP-000001');
    expect(again.body.data.reused).toBe(true);
    expect(await db.paymentReceipt.count({ where: { paymentId: first.id } })).toBe(1);
    const download = await client.get(`/api/payments/${first.id}/receipt/download-url`);
    expect(download.status).toBe(200);
    expect(download.body.data.url).toBeTruthy();
  });

  it('renders voucher PDFs with trip content and no booking information', async () => {
    const client = await owner();
    const trip = await createTrip(client);
    const payment = await recordPayment(client, trip.id);
    await client.post(`/api/payments/${payment.id}/receipt`, {});
    const text = await voucherText(payment.id);
    for (const expected of [
      'PAYMENT VOUCHER',
      'RCP-000001',
      payment.paymentNumber,
      'Mohan',
      'Singapore Family Trip',
      '9 Oct 2026',
      'UPI',
      'UPI123',
      '₹10,000.00',
      '₹3,00,000.00',
      '₹0.00',
      '₹2,90,000.00',
      'PARTIALLY PAID',
      'Total Trip Amount',
      'Previously Paid',
      'This Payment',
      'Total Paid',
      'Balance Remaining',
    ]) {
      expect(text, `missing ${expected}`).toContain(expected);
    }
    for (const banned of [
      'undefined',
      'null',
      '[object Object]',
      'Optional',
      'Booking Number',
      'Booking Status',
      'bookingId',
      'BookingPayment',
      'objectKey',
      'companies/',
      payment.id,
    ]) {
      expect(text, `leaked ${banned}`).not.toContain(banned);
    }
    expect(text).not.toMatch(/BK-\d{6}/);
  });

  it('runs the mohan end-to-end scenario without any booking', async () => {
    const client = await owner('mohan@pay.test', 'Mohan Travel');
    const trip = await createTrip(client);
    expect(await db.booking.count()).toBe(0);
    await recordPayment(client, trip.id, {
      amount: 10000,
      paymentMethod: 'UPI',
      receivedAt: '2026-10-09',
      referenceNumber: 'UPI123',
    });
    await recordPayment(client, trip.id, {
      amount: 50000,
      paymentMethod: 'BANK_TRANSFER',
      receivedAt: '2026-11-01',
      referenceNumber: 'NEFT123',
    });
    const details = (await client.get(`/api/payments/cases/${trip.id}`)).body.data;
    expect(details).toMatchObject({
      tripAmount: '300000.00',
      collected: '60000.00',
      outstanding: '240000.00',
    });
    const first = await db.customerPayment.findFirstOrThrow({
      where: { caseId: trip.id },
      orderBy: { receivedAt: 'asc' },
    });
    const second = await db.customerPayment.findFirstOrThrow({
      where: { caseId: trip.id, paymentNumber: { not: first.paymentNumber } },
    });
    const one = await client.post(`/api/payments/${first.id}/receipt`, {});
    const two = await client.post(`/api/payments/${second.id}/receipt`, {});
    expect(one.body.data.receiptNumber).toBe('RCP-000001');
    expect(two.body.data.receiptNumber).toBe('RCP-000002');
    for (const row of [first, second]) {
      const text = await voucherText(row.id);
      expect(text).toContain('PAYMENT VOUCHER');
      expect(text).not.toMatch(/BK-\d{6}/);
      expect(text).not.toContain('Booking');
    }
    // Still no booking anywhere: the flow never needed one.
    expect(await db.booking.count()).toBe(0);
  });

  it('isolates tenants and enforces standalone permissions', async () => {
    const alpha = await owner('alpha@pay.test', 'Alpha Travel');
    const beta = await owner('beta@pay.test', 'Beta Travel');
    const trip = await createTrip(alpha);
    const payment = await recordPayment(alpha, trip.id);
    const betaList = await beta.get('/api/payments');
    expect(betaList.status).toBe(200);
    expect(betaList.body.data.pagination.total).toBe(0);
    expect((await beta.get(`/api/payments/${payment.id}`)).status).toBe(404);
    expect((await beta.post(`/api/payments/${payment.id}/receipt`, {})).status).toBe(404);
    const betaTrip = await createTrip(beta, { title: 'Beta Trip', tripAmount: 10000 });
    const betaReceipt = await beta.post(
      `/api/payments/${(await recordPayment(beta, betaTrip.id, { amount: 1000 })).id}/receipt`,
      {},
    );
    expect(betaReceipt.body.data.receiptNumber).toBe('RCP-000001');
    // Sales can view, record and generate, but not reverse or edit.
    const sales = await salesClient('alpha@pay.test');
    expect((await sales.get('/api/payments')).status).toBe(200);
    expect(
      (
        await sales.post(
          '/api/payments',
          paymentPayload(trip.id, { amount: 100, referenceNumber: 'S-1' }),
        )
      ).status,
    ).toBe(201);
    expect(
      (await sales.post(`/api/payments/${payment.id}/reverse`, { reason: 'nope nope' })).status,
    ).toBe(403);
    expect(
      (await sales.patch(`/api/payments/${payment.id}`, { referenceNumber: 'x' })).status,
    ).toBe(403);
    // Cross-company access is denied even for another company's owner.
    const outsider = await owner('outsider@pay.test', 'Outsider Travel');
    expect((await outsider.get('/api/payments')).status).toBe(200);
    expect((await outsider.get(`/api/payments/${payment.id}`)).status).toBe(404);
  });

  it('keeps payments valid when bookings change elsewhere', async () => {
    const client = await owner();
    const trip = await createTrip(client);
    const payment = await recordPayment(client, trip.id);
    const manual = await client.post('/api/bookings', {
      customerName: 'Unrelated Customer',
      customerEmail: 'unrelated@example.test',
      customerPhone: '9000090000',
      destinationSummary: 'Elsewhere',
      currency: 'INR',
      totalSellingAmount: 50000,
      manualCreationReason: 'Unrelated booking must not affect standalone payments',
      services: [],
      itinerary: [],
      paymentSchedule: [],
    });
    expect(manual.status).toBe(201);
    const details = (await client.get(`/api/payments/${payment.id}`)).body.data;
    expect(details.paymentCase).toMatchObject({ title: 'Singapore Family Trip' });
    expect(details.amount).toBe('10000.00');
  });

  it('lists with search, filters and a collected summary', async () => {
    const client = await owner();
    const trip = await createTrip(client);
    await recordPayment(client, trip.id);
    await recordPayment(client, trip.id, {
      amount: 50000,
      paymentMethod: 'BANK_TRANSFER',
      receivedAt: '2026-11-01',
      referenceNumber: 'NEFT123',
    });
    expect((await client.get('/api/payments?search=Mohan')).body.data.pagination.total).toBe(2);
    expect(
      (await client.get('/api/payments?search=Singapore%20Family')).body.data.pagination.total,
    ).toBe(2);
    expect((await client.get('/api/payments?search=NEFT123')).body.data.pagination.total).toBe(1);
    expect((await client.get('/api/payments?paymentMethod=UPI')).body.data.pagination.total).toBe(
      1,
    );
    expect(
      (await client.get('/api/payments?paymentStatus=RECEIVED')).body.data.pagination.total,
    ).toBe(2);
    expect(
      (await client.get('/api/payments?dateFrom=2026-11-01&dateTo=2026-11-30')).body.data.pagination
        .total,
    ).toBe(1);
    const ledger = await client.get('/api/payments');
    expect(ledger.body.data.summary).toMatchObject({
      totalCollected: '60000.00',
      paymentCount: 2,
    });
  });
});
