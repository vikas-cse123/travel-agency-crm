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

async function owner(email = 'owner@payments.test', companyName = 'Payments Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

const bookingPayload = (suffix = '', totalSellingAmount = 300000) => ({
  customerName: `Akash Sahni ${suffix}`.trim(),
  customerEmail: `akash${suffix || '0'}@example.test`,
  customerPhone: `90000123${suffix || '00'}`,
  destinationSummary: `Singapore Family Trip ${suffix}`.trim(),
  travelStartDate: '2026-11-01',
  travelEndDate: '2026-11-05',
  rooms: 1,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  currency: 'INR',
  totalSellingAmount,
  manualCreationReason: 'Ledger test booking',
  services: [],
  itinerary: [],
  paymentSchedule: [],
});

type Client = Awaited<ReturnType<typeof owner>>;

async function createBooking(client: Client, suffix = '', total = 300000) {
  const response = await client.post('/api/bookings', bookingPayload(suffix, total));
  expect(response.status).toBe(201);
  return response.body.data as { id: string; bookingNumber: string };
}

async function recordPayment(
  client: Client,
  bookingId: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await client.post(`/api/bookings/${bookingId}/payments`, {
    amount: 10000,
    currency: 'INR',
    paymentMethod: 'UPI',
    paymentStatus: 'RECEIVED',
    receivedAt: '2026-10-09',
    referenceNumber: 'UPI123',
    notes: 'Ledger test payment',
    ...overrides,
  });
  expect(response.status).toBe(201);
  return response.body.data as { id: string; paymentNumber: string };
}

async function salesClient(companyOwnerEmail: string) {
  const email = 'sales@payments.test';
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
      username: 'salespayments',
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

describe('Cross-booking payments ledger (read view over BookingPayment)', () => {
  it('lists existing payments with customer and trip context plus a summary', async () => {
    const client = await owner();
    const booking = await createBooking(client);
    await recordPayment(client, booking.id);
    await recordPayment(client, booking.id, {
      amount: 50000,
      paymentMethod: 'BANK_TRANSFER',
      receivedAt: '2026-11-01',
      referenceNumber: 'TXN456',
    });
    const ledger = await client.get('/api/bookings/payments?page=1&pageSize=10');
    expect(ledger.status).toBe(200);
    expect(ledger.body.data.pagination.total).toBe(2);
    const rows = ledger.body.data.data as Array<Record<string, unknown>>;
    // Newest first.
    expect(rows[0]).toMatchObject({ referenceNumber: 'TXN456', paymentMethod: 'BANK_TRANSFER' });
    expect(rows[1]).toMatchObject({ referenceNumber: 'UPI123', paymentMethod: 'UPI' });
    for (const row of rows) {
      const bookingCtx = row.booking as Record<string, unknown>;
      expect(bookingCtx.bookingNumber).toBe(booking.bookingNumber);
      expect(bookingCtx.customerName).toContain('Akash Sahni');
      expect(bookingCtx.destinationSummary).toContain('Singapore Family Trip');
      expect(row.paymentNumber).toMatch(/^PAY-00000[12]$/);
      expect(row.amount).toMatch(/^\d+\.00$/);
    }
    expect(ledger.body.data.summary).toMatchObject({
      totalCollected: '60000.00',
      paymentCount: 2,
    });
    expect(ledger.body.data.summary.receivedToday).toMatch(/^\d+\.00$/);
    expect(ledger.body.data.summary.receivedThisMonth).toMatch(/^\d+\.00$/);
  });

  it('searches by customer, booking number, trip and reference', async () => {
    const client = await owner();
    const booking = await createBooking(client);
    await recordPayment(client, booking.id);
    const other = await createBooking(client, 'b', 50000);
    await recordPayment(client, other.id, {
      amount: 5000,
      paymentMethod: 'CASH',
      receivedAt: '2026-10-10',
      referenceNumber: 'CASH-9',
    });
    const byCustomer = await client.get('/api/bookings/payments?search=Akash%20Sahni%20b');
    expect(byCustomer.body.data.pagination.total).toBe(1);
    expect(byCustomer.body.data.data[0]).toMatchObject({ referenceNumber: 'CASH-9' });
    const byBooking = await client.get(`/api/bookings/payments?search=${booking.bookingNumber}`);
    expect(byBooking.body.data.pagination.total).toBe(1);
    const byReference = await client.get('/api/bookings/payments?search=UPI123');
    expect(byReference.body.data.pagination.total).toBe(1);
    const byTrip = await client.get('/api/bookings/payments?search=Singapore%20Family');
    expect(byTrip.body.data.pagination.total).toBe(2);
  });

  it('filters by method, status, date range and booking', async () => {
    const client = await owner();
    const booking = await createBooking(client);
    await recordPayment(client, booking.id);
    const second = await recordPayment(client, booking.id, {
      amount: 50000,
      paymentMethod: 'BANK_TRANSFER',
      receivedAt: '2026-11-01',
      referenceNumber: 'TXN456',
    });
    expect(
      (await client.get('/api/bookings/payments?paymentMethod=UPI')).body.data.pagination.total,
    ).toBe(1);
    expect(
      (await client.get('/api/bookings/payments?paymentMethod=CASH')).body.data.pagination.total,
    ).toBe(0);
    expect(
      (await client.get('/api/bookings/payments?paymentStatus=RECEIVED')).body.data.pagination
        .total,
    ).toBe(2);
    expect(
      (await client.get('/api/bookings/payments?dateFrom=2026-11-01&dateTo=2026-11-30')).body.data
        .pagination.total,
    ).toBe(1);
    expect(
      (await client.get(`/api/bookings/payments?bookingId=${booking.id}`)).body.data.pagination
        .total,
    ).toBe(2);
    // Reverse one payment: it stays listed with reversal context but leaves the collected total.
    await client.post(`/api/bookings/${booking.id}/payments/${second.id}/reverse`, {
      reason: 'Duplicate transfer, re-recorded offline',
    });
    const reversed = await client.get('/api/bookings/payments?paymentStatus=REVERSED');
    expect(reversed.body.data.pagination.total).toBe(1);
    expect(reversed.body.data.data[0]).toMatchObject({
      paymentNumber: second.paymentNumber,
      paymentStatus: 'REVERSED',
      reversalReason: 'Duplicate transfer, re-recorded offline',
    });
    expect(reversed.body.data.data[0].reversedAt).toBeTruthy();
    expect(reversed.body.data.data[0].reversedBy).toBeTruthy();
    expect(reversed.body.data.summary.totalCollected).toBe('10000.00');
  });

  it('records payments through the existing endpoint and refreshes booking rollups', async () => {
    const client = await owner();
    const booking = await createBooking(client);
    await recordPayment(client, booking.id, { amount: 10000 });
    let details = (await client.get(`/api/bookings/${booking.id}`)).body.data;
    expect(details).toMatchObject({
      totalPayable: '300000.00',
      totalCustomerPaid: '10000.00',
      totalCustomerOutstanding: '290000.00',
      paymentStatus: 'PARTIALLY_PAID',
    });
    await recordPayment(client, booking.id, {
      amount: 50000,
      paymentMethod: 'BANK_TRANSFER',
      receivedAt: '2026-11-01',
      referenceNumber: 'TXN456',
    });
    details = (await client.get(`/api/bookings/${booking.id}`)).body.data;
    expect(details).toMatchObject({
      totalPayable: '300000.00',
      totalCustomerPaid: '60000.00',
      totalCustomerOutstanding: '240000.00',
      paymentStatus: 'PARTIALLY_PAID',
    });
    // Same-day second payment is allowed and listed separately.
    await recordPayment(client, booking.id, {
      amount: 5000,
      paymentMethod: 'CASH',
      receivedAt: '2026-11-01',
      referenceNumber: 'CASH-1',
    });
    const ledger = await client.get('/api/bookings/payments?page=1&pageSize=10');
    expect(ledger.body.data.pagination.total).toBe(3);
    const ids = (ledger.body.data.data as Array<{ id: string }>).map((row) => row.id);
    expect(new Set(ids).size).toBe(3);
    expect(await db.bookingPayment.count({ where: { bookingId: booking.id } })).toBe(3);
  });

  it('keeps bookings separated: per-booking outstanding comes from booking rollups', async () => {
    const client = await owner();
    const tripA = await createBooking(client, 'a', 300000);
    const tripB = await createBooking(client, 'b', 50000);
    await recordPayment(client, tripA.id, { amount: 60000 });
    await recordPayment(client, tripB.id, { amount: 5000, referenceNumber: 'B-1' });
    const ledger = await client.get('/api/bookings/payments?page=1&pageSize=10');
    const rows = ledger.body.data.data as Array<{
      booking: { bookingNumber: string; totalCustomerOutstanding: string };
      referenceNumber: string;
    }>;
    expect(rows).toHaveLength(2);
    const forA = rows.find((row) => row.booking.bookingNumber === tripA.bookingNumber)!;
    const forB = rows.find((row) => row.booking.bookingNumber === tripB.bookingNumber)!;
    expect(forA.booking.totalCustomerOutstanding).toBe('240000.00');
    expect(forB.booking.totalCustomerOutstanding).toBe('45000.00');
    expect(forA.referenceNumber).not.toBe(forB.referenceNumber);
  });

  it('reuses booking payment validation (amount, method, overpayment)', async () => {
    const client = await owner();
    const booking = await createBooking(client);
    expect(
      (
        await client.post(`/api/bookings/${booking.id}/payments`, {
          amount: 0,
          currency: 'INR',
          paymentMethod: 'UPI',
          receivedAt: '2026-10-09',
          notes: 'zero',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post(`/api/bookings/${booking.id}/payments`, {
          amount: 100,
          currency: 'INR',
          paymentMethod: 'CHEQUEBOOK',
          receivedAt: '2026-10-09',
          notes: 'bad method',
        })
      ).status,
    ).toBe(400);
    // Existing overpayment policy is unchanged: 409, nothing stored.
    expect(
      (
        await client.post(`/api/bookings/${booking.id}/payments`, {
          amount: 300001,
          currency: 'INR',
          paymentMethod: 'UPI',
          receivedAt: '2026-10-09',
          notes: 'too much',
        })
      ).status,
    ).toBe(409);
    expect(await db.bookingPayment.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it('rejects payments for unknown or cross-company bookings', async () => {
    const client = await owner();
    const missing = await client.post(
      '/api/bookings/00000000-0000-0000-0000-000000000000/payments',
      {
        amount: 10000,
        currency: 'INR',
        paymentMethod: 'UPI',
        receivedAt: '2026-10-08',
        notes: 'nowhere to post',
      },
    );
    expect(missing.status).toBe(404);
    const beta = await owner('beta@payments.test', 'Beta Travel');
    const booking = await createBooking(client);
    const cross = await beta.post(`/api/bookings/${booking.id}/payments`, {
      amount: 10000,
      currency: 'INR',
      paymentMethod: 'UPI',
      receivedAt: '2026-10-08',
      notes: 'wrong company',
    });
    expect(cross.status).toBe(404);
    expect(await db.bookingPayment.count()).toBe(0);
  });

  it('isolates tenants and enforces financial permissions', async () => {
    const alpha = await owner('alpha@payments.test', 'Alpha Travel');
    const beta = await owner('beta@payments.test', 'Beta Travel');
    const booking = await createBooking(alpha);
    await recordPayment(alpha, booking.id);
    const betaLedger = await beta.get('/api/bookings/payments');
    expect(betaLedger.status).toBe(200);
    expect(betaLedger.body.data.pagination.total).toBe(0);
    expect(betaLedger.body.data.summary.totalCollected).toBe('0.00');
    expect((await beta.get(`/api/bookings/${booking.id}`)).status).toBe(404);
    // Sales role has bookings.view but not view_financials: ledger is forbidden.
    const sales = await salesClient('alpha@payments.test');
    expect((await sales.get('/api/bookings/payments')).status).toBe(403);
    expect(
      (
        await sales.post(`/api/bookings/${booking.id}/payments`, {
          amount: 100,
          currency: 'INR',
          paymentMethod: 'CASH',
          receivedAt: '2026-10-09',
          notes: 'no permission',
        })
      ).status,
    ).toBe(403);
  });
});
