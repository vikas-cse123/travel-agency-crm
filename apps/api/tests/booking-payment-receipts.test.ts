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

async function owner(email = 'owner@receipts.test', companyName = 'Receipts Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

const bookingPayload = () => ({
  customerName: 'Akash Sahni',
  customerEmail: 'akash@example.test',
  customerPhone: '9000012300',
  destinationSummary: 'Singapore Family Trip',
  travelStartDate: '2026-11-01',
  travelEndDate: '2026-11-05',
  rooms: 1,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  currency: 'INR',
  totalSellingAmount: 300000,
  manualCreationReason: 'Receipt test booking',
  services: [],
  itinerary: [],
  paymentSchedule: [],
});

type Client = Awaited<ReturnType<typeof owner>>;

async function createBooking(client: Client) {
  const response = await client.post('/api/bookings', bookingPayload());
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
    notes: 'Receipt test payment',
    ...overrides,
  });
  expect(response.status).toBe(201);
  return response.body.data as { id: string; paymentNumber: string };
}

async function receiptPdfText(paymentId: string): Promise<string> {
  const receipt = await db.bookingPaymentReceipt.findUniqueOrThrow({ where: { paymentId } });
  const object = (storageService as unknown as { read: (key: string) => Buffer | undefined }).read(
    receipt.objectKey,
  );
  return execFileSync('pdftotext', ['-layout', '-', '-'], {
    input: object ?? Buffer.alloc(0),
    maxBuffer: 16 * 1024 * 1024,
  }).toString('utf8');
}

async function salesClient(companyOwnerEmail: string) {
  const email = 'sales@receipts.test';
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
      username: 'salesreceipts',
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

describe('Payment receipts (document over BookingPayment)', () => {
  it('generates a receipt with an RCP number for a valid payment', async () => {
    const client = await owner();
    const booking = await createBooking(client);
    const payment = await recordPayment(client, booking.id);
    const generated = await client.post(
      `/api/bookings/${booking.id}/payments/${payment.id}/receipt`,
      {},
    );
    expect(generated.status).toBe(200);
    expect(generated.body.data.receiptNumber).toBe('RCP-000001');
    expect(generated.body.data.reused).toBe(false);
    expect(generated.body.data.fileName).toBe('receipt-RCP-000001.pdf');
    expect(generated.body.data).not.toHaveProperty('objectKey');
    expect(generated.body.data).not.toHaveProperty('companyId');
    const stored = await db.bookingPaymentReceipt.findUniqueOrThrow({
      where: { paymentId: payment.id },
    });
    expect(stored.uploadStatus).toBe('AVAILABLE');
    expect(stored.receiptNumber).toBe('RCP-000001');
    expect(stored.objectKey).toContain(`/payments/${payment.id}/receipts/`);
    // Metadata endpoint exposes the same receipt.
    const meta = await client.get(`/api/bookings/${booking.id}/payments/${payment.id}/receipt`);
    expect(meta.status).toBe(200);
    expect(meta.body.data.receiptNumber).toBe('RCP-000001');
    // Signed download URL works.
    const download = await client.get(
      `/api/bookings/${booking.id}/payments/${payment.id}/receipt/download-url`,
    );
    expect(download.status).toBe(200);
    expect(download.body.data.url).toBeTruthy();
    expect(download.body.data.fileName).toBe('receipt-RCP-000001.pdf');
    expect(download.body.data.expiresInSeconds).toBeGreaterThan(0);
  });

  it('increments receipt numbers across payments and reuses per payment', async () => {
    const client = await owner();
    const booking = await createBooking(client);
    const first = await recordPayment(client, booking.id);
    const second = await recordPayment(client, booking.id, {
      amount: 50000,
      paymentMethod: 'BANK_TRANSFER',
      receivedAt: '2026-11-01',
      referenceNumber: 'TXN456',
    });
    const one = await client.post(`/api/bookings/${booking.id}/payments/${first.id}/receipt`, {});
    const two = await client.post(`/api/bookings/${booking.id}/payments/${second.id}/receipt`, {});
    expect(one.body.data.receiptNumber).toBe('RCP-000001');
    expect(two.body.data.receiptNumber).toBe('RCP-000002');
    // Repeat generation reuses the same receipt: no duplicates, no new numbers.
    const again = await client.post(`/api/bookings/${booking.id}/payments/${first.id}/receipt`, {});
    expect(again.body.data.receiptNumber).toBe('RCP-000001');
    expect(again.body.data.reused).toBe(true);
    expect(await db.bookingPaymentReceipt.count({ where: { bookingId: booking.id } })).toBe(2);
  });

  it('renders the agreed receipt content without internal data', async () => {
    const client = await owner();
    const booking = await createBooking(client);
    const payment = await recordPayment(client, booking.id);
    await client.post(`/api/bookings/${booking.id}/payments/${payment.id}/receipt`, {});
    const text = await receiptPdfText(payment.id);
    for (const expected of [
      'PAYMENT RECEIPT',
      'RCP-000001',
      payment.paymentNumber,
      'Akash Sahni',
      booking.bookingNumber,
      'Singapore Family Trip',
      '9 Oct 2026',
      'UPI',
      'UPI123',
      '₹10,000.00',
      '₹3,00,000.00',
      '₹0.00',
      '₹2,90,000.00',
      'PARTIALLY PAID',
      'PAYMENT DETAILS',
      'TRIP PAYMENT SUMMARY',
      'PAYMENT STATUS',
      'Receipt No.',
      'Payment No.',
      'Amount Received',
      'Total Payable',
      'Previously Paid',
      'This Payment',
      'Total Paid',
      'Balance Outstanding',
      'Receipts Travel',
    ]) {
      expect(text, `missing ${expected}`).toContain(expected);
    }
    for (const banned of [
      'undefined',
      'null',
      '[object Object]',
      'Optional',
      payment.id,
      booking.id,
      'bookingId',
      'objectKey',
      'companies/',
      'PAYMENT_RECEIPT',
      'attachment;',
    ]) {
      expect(text, `leaked ${banned}`).not.toContain(banned);
    }
  });

  it('shows running balances across sequential payments', async () => {
    const client = await owner();
    const booking = await createBooking(client);
    const first = await recordPayment(client, booking.id);
    const second = await recordPayment(client, booking.id, {
      amount: 50000,
      paymentMethod: 'BANK_TRANSFER',
      receivedAt: '2026-11-01',
      referenceNumber: 'TXN456',
    });
    await client.post(`/api/bookings/${booking.id}/payments/${first.id}/receipt`, {});
    await client.post(`/api/bookings/${booking.id}/payments/${second.id}/receipt`, {});
    const secondText = await receiptPdfText(second.id);
    expect(secondText).toContain('RCP-000002');
    expect(secondText).toContain('₹50,000.00');
    // Previously paid reflects the first payment; totals come from rollups.
    expect(secondText).toContain('₹10,000.00');
    expect(secondText).toContain('₹60,000.00');
    expect(secondText).toContain('₹2,40,000.00');
  });

  it('regenerates under the same number when the payment is edited', async () => {
    const client = await owner();
    const booking = await createBooking(client);
    const payment = await recordPayment(client, booking.id);
    await client.post(`/api/bookings/${booking.id}/payments/${payment.id}/receipt`, {});
    await client.patch(`/api/bookings/${booking.id}/payments/${payment.id}`, {
      referenceNumber: 'UPI999',
    });
    const again = await client.post(
      `/api/bookings/${booking.id}/payments/${payment.id}/receipt`,
      {},
    );
    expect(again.body.data.receiptNumber).toBe('RCP-000001');
    expect(again.body.data.reused).toBe(false);
    expect(await db.bookingPaymentReceipt.count({ where: { paymentId: payment.id } })).toBe(1);
    expect(await receiptPdfText(payment.id)).toContain('UPI999');
  });

  it('refuses receipts for non-collected payments, including after reversal', async () => {
    const client = await owner();
    const booking = await createBooking(client);
    const pending = await recordPayment(client, booking.id, {
      amount: 5000,
      paymentStatus: 'PENDING_CLEARANCE',
      referenceNumber: 'PEND-1',
    });
    expect(
      (await client.post(`/api/bookings/${booking.id}/payments/${pending.id}/receipt`, {})).status,
    ).toBe(409);
    const payment = await recordPayment(client, booking.id, { referenceNumber: 'OK-1' });
    await client.post(`/api/bookings/${booking.id}/payments/${payment.id}/receipt`, {});
    await client.post(`/api/bookings/${booking.id}/payments/${payment.id}/reverse`, {
      reason: 'Duplicate entry',
    });
    // No new receipt, and the old bytes are no longer served.
    expect(
      (await client.post(`/api/bookings/${booking.id}/payments/${payment.id}/receipt`, {})).status,
    ).toBe(409);
    expect(
      (await client.get(`/api/bookings/${booking.id}/payments/${payment.id}/receipt/download-url`))
        .status,
    ).toBe(409);
  });

  it('gives every payment its own receipt, including same-day payments', async () => {
    const client = await owner();
    const booking = await createBooking(client);
    const first = await recordPayment(client, booking.id, { referenceNumber: 'D-1' });
    const second = await recordPayment(client, booking.id, {
      amount: 7000,
      referenceNumber: 'D-2',
    });
    const one = await client.post(`/api/bookings/${booking.id}/payments/${first.id}/receipt`, {});
    const two = await client.post(`/api/bookings/${booking.id}/payments/${second.id}/receipt`, {});
    expect(one.body.data.receiptNumber).not.toBe(two.body.data.receiptNumber);
    expect(await receiptPdfText(first.id)).toContain('D-1');
    expect(await receiptPdfText(second.id)).toContain('D-2');
  });

  it('collapses concurrent first-time generates onto one receipt', async () => {
    const client = await owner();
    const booking = await createBooking(client);
    const payment = await recordPayment(client, booking.id);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        client.post(`/api/bookings/${booking.id}/payments/${payment.id}/receipt`, {}),
      ),
    );
    expect(results.every((response) => response.status === 200)).toBe(true);
    const numbers = results.map((response) => response.body.data.receiptNumber);
    // All callers collapse onto the single winner (a raced loser may waste its
    // allocated number — gaps under concurrency match counter conventions).
    expect(new Set(numbers).size).toBe(1);
    expect(numbers[0]).toMatch(/^RCP-\d{6}$/);
    expect(await db.bookingPaymentReceipt.count({ where: { paymentId: payment.id } })).toBe(1);
  });

  it('isolates tenants, scopes numbering per company and enforces permissions', async () => {
    const alpha = await owner('alpha@receipts.test', 'Alpha Travel');
    const beta = await owner('beta@receipts.test', 'Beta Travel');
    const booking = await createBooking(alpha);
    const payment = await recordPayment(alpha, booking.id);
    await alpha.post(`/api/bookings/${booking.id}/payments/${payment.id}/receipt`, {});
    // Another company cannot see, generate or download it.
    expect(
      (await beta.post(`/api/bookings/${booking.id}/payments/${payment.id}/receipt`, {})).status,
    ).toBe(404);
    expect(
      (await beta.get(`/api/bookings/${booking.id}/payments/${payment.id}/receipt/download-url`))
        .status,
    ).toBe(404);
    expect(
      (await beta.get(`/api/bookings/${booking.id}/payments/${payment.id}/receipt`)).status,
    ).toBe(404);
    // Numbering is per company: beta's first receipt is also RCP-000001.
    const betaBooking = await createBooking(beta);
    const betaPayment = await recordPayment(beta, betaBooking.id);
    const betaReceipt = await beta.post(
      `/api/bookings/${betaBooking.id}/payments/${betaPayment.id}/receipt`,
      {},
    );
    expect(betaReceipt.body.data.receiptNumber).toBe('RCP-000001');
    // Sales role without financial access is forbidden everywhere.
    const sales = await salesClient('alpha@receipts.test');
    expect(
      (await sales.post(`/api/bookings/${booking.id}/payments/${payment.id}/receipt`, {})).status,
    ).toBe(403);
    expect(
      (await sales.get(`/api/bookings/${booking.id}/payments/${payment.id}/receipt/download-url`))
        .status,
    ).toBe(403);
  });

  it('exposes receipt state on the payments ledger', async () => {
    const client = await owner();
    const booking = await createBooking(client);
    const payment = await recordPayment(client, booking.id);
    const before = await client.get('/api/bookings/payments');
    expect(before.body.data.data[0].receipt).toBeNull();
    await client.post(`/api/bookings/${booking.id}/payments/${payment.id}/receipt`, {});
    const after = await client.get('/api/bookings/payments');
    expect(after.body.data.data[0].receipt).toMatchObject({
      receiptNumber: 'RCP-000001',
      uploadStatus: 'AVAILABLE',
    });
  });
});
