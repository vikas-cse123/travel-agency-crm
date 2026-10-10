import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { storageService } from '../src/services/storage/storage.service.js';
import {
  resolveVoucherPrimary,
  resolveVoucherTheme,
  voucherPrimaryForeground,
} from '../src/modules/hotel-vouchers/hotel-voucher-pdf.service.js';

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

async function owner(email = 'owner@vouchers.test', companyName = 'Voucher Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

type Client = Awaited<ReturnType<typeof owner>>;

async function setupHotel(client: Client) {
  const cityResponse = await client.post('/api/masters/cities', {
    countryCode: 'IN',
    name: 'Jaipur',
    status: 'ACTIVE',
  });
  expect(cityResponse.status, JSON.stringify(cityResponse.body)).toBe(201);
  const city = cityResponse.body.data as { id: string };
  const destination = (
    await client.post('/api/masters/destinations', {
      countryCode: 'IN',
      name: 'Rajasthan',
      destinationType: 'DOMESTIC',
      cityIds: [city.id],
      status: 'ACTIVE',
    })
  ).body.data as { id: string };
  const hotel = (
    await client.post('/api/masters/hotels', {
      destinationId: destination.id,
      cityId: city.id,
      name: 'Shah Palace Hotel',
      starCategory: 4,
      address: 'Palace Road, Jaipur',
      phone: '+91 14100 00000',
      email: 'stay@shahpalace.test',
      status: 'ACTIVE',
    })
  ).body.data as { id: string };
  return { city, destination, hotel };
}

const voucherPayload = (overrides: Record<string, unknown> = {}) => ({
  guestName: 'Aarav Mehta',
  guestPhone: '+91 90000 00000',
  guestEmail: 'aarav@example.test',
  adults: 2,
  children: 1,
  hotelName: 'Shah Palace Hotel',
  hotelAddress: 'Palace Road, Jaipur',
  hotelCity: 'Jaipur',
  hotelPhone: '+91 14100 00000',
  hotelEmail: 'stay@shahpalace.test',
  hotelStarRating: '4 Star',
  checkIn: '2026-11-10',
  checkOut: '2026-11-13',
  roomTypeName: 'Deluxe',
  rooms: 1,
  mealPlanName: 'Breakfast',
  confirmationNumber: 'CONF-1',
  specialRequests: 'High floor',
  remarks: 'Honeymoon',
  termsSnapshot: 'Non-refundable after check-in.',
  ...overrides,
});

async function createVoucher(client: Client, overrides: Record<string, unknown> = {}) {
  const response = await client.post('/api/hotel-vouchers', voucherPayload(overrides));
  expect(response.status).toBe(201);
  return response.body.data as {
    id: string;
    voucherNumber: string;
    confirmationNumber?: string | null;
    bookingId?: string | null;
    confirmationNumberLabel?: string | null;
    bookingIdLabel?: string | null;
  };
}

/** Visible text extraction via poppler's pdftotext. */
function pdfText(buffer: Buffer): string {
  return execFileSync('pdftotext', ['-layout', '-', '-'], {
    input: buffer,
    maxBuffer: 16 * 1024 * 1024,
  }).toString('utf8');
}

/** Downgrade a fresh voucher to a legacy status record for compatibility tests. */
async function legacyStatus(
  client: Client,
  status: 'DRAFT' | 'ISSUED' | 'CANCELLED',
  overrides: Record<string, unknown> = {},
) {
  const created = await createVoucher(client, overrides);
  await db.hotelVoucher.update({
    where: { id: created.id },
    data: status === 'DRAFT' ? { status, issueDate: null } : { status },
  });
  return created;
}

/** Downgrade a fresh voucher to a legacy draft (pre-workflow-change record). */
async function legacyDraft(client: Client, overrides: Record<string, unknown> = {}) {
  return legacyStatus(client, 'DRAFT', overrides);
}

describe('Hotel Vouchers (standalone, no Booking dependency)', () => {
  it('creates a voucher directly with a company-scoped HV number', async () => {
    const client = await owner();
    const created = await createVoucher(client);
    expect(created.voucherNumber).toMatch(/^HV-000001$/);
    const second = await createVoucher(client);
    expect(second.voucherNumber).toBe('HV-000002');
    const row = await db.hotelVoucher.findUniqueOrThrow({ where: { id: created.id } });
    // No draft step: usable immediately, with a real issuance timestamp.
    expect(row.issueDate).not.toBeNull();
    expect(await db.activityLog.count({ where: { entityId: created.id } })).toBe(1);
    // No status is exposed to API consumers.
    const details = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(details).not.toHaveProperty('status');
  });

  it('lists up to 20 vouchers per page by default', async () => {
    const client = await owner();
    for (let i = 0; i < 21; i += 1) {
      await createVoucher(client, { guestName: `Guest ${i + 1} Name` });
    }
    const first = await client.get('/api/hotel-vouchers');
    expect(first.body.data.pagination).toMatchObject({ page: 1, pageSize: 20, total: 21 });
    expect(first.body.data.data).toHaveLength(20);
    const second = await client.get('/api/hotel-vouchers?page=2');
    expect(second.body.data.pagination).toMatchObject({ page: 2, pageSize: 20, total: 21 });
    expect(second.body.data.data).toHaveLength(1);
  });

  it('returns the original creator in list rows and preserves it on edit', async () => {
    const client = await owner();
    const created = await createVoucher(client);
    const listedBody = (await client.get('/api/hotel-vouchers')).body.data as {
      data: Array<{ id: string; createdBy: { id: string; fullName: string } | null }>;
    };
    const row = listedBody.data.find((entry) => entry.id === created.id);
    expect(row?.createdBy?.fullName).toBeTruthy();
    const creatorId = row?.createdBy?.id;
    expect(creatorId).toBeTruthy();
    await client.patch(`/api/hotel-vouchers/${created.id}`, { guestName: 'Aarav Updated' });
    const relistedBody = (await client.get('/api/hotel-vouchers')).body.data as {
      data: Array<{ id: string; createdBy: { id: string; fullName: string } | null }>;
    };
    expect(relistedBody.data.find((entry) => entry.id === created.id)?.createdBy?.id).toBe(
      creatorId,
    );
  });

  it('rejects invalid payloads (dates, counts, email, lengths, ids)', async () => {
    const client = await owner();
    expect(
      (await client.post('/api/hotel-vouchers', voucherPayload({ checkOut: '2026-11-10' }))).status,
    ).toBe(400);
    expect((await client.post('/api/hotel-vouchers', voucherPayload({ adults: 0 }))).status).toBe(
      201,
    );
    expect(
      (await client.post('/api/hotel-vouchers', voucherPayload({ guestEmail: 'nope' }))).status,
    ).toBe(400);
    expect(
      (await client.post('/api/hotel-vouchers', voucherPayload({ guestName: 'x' }))).status,
    ).toBe(400);
    expect(
      (await client.post('/api/hotel-vouchers', voucherPayload({ hotelId: 'not-a-uuid' }))).status,
    ).toBe(400);
    expect(
      (
        await client.post(
          '/api/hotel-vouchers',
          voucherPayload({ customerId: '00000000-0000-0000-0000-000000000000' }),
        )
      ).status,
    ).toBe(400);
  });

  it('links optional customer, lead and hotel refs, and survives their deletion', async () => {
    const client = await owner();
    const { hotel } = await setupHotel(client);
    const company = await db.company.findFirstOrThrow({
      select: { id: true, users: { take: 1, select: { id: true } } },
    });
    const customer = await db.customer.create({
      data: {
        companyId: company.id,
        customerNumber: 'CUS-000001',
        displayName: 'Aarav Mehta',
        normalizedName: 'aarav mehta',
        primaryPhone: '9876543210',
        normalizedPhone: '919876543210',
        email: 'aarav@example.test',
        normalizedEmail: 'aarav@example.test',
        createdById: company.users[0]!.id,
      },
    });
    const leadResponse = await client.post('/api/queries', {
      customerName: 'Aarav Mehta',
      phone: '+91 90000 00001',
      email: 'aarav@example.test',
      leadSource: 'REFERRAL',
      rooms: 1,
      adults: 2,
      currency: 'INR',
      services: ['HOTEL'],
      itinerary: [{ country: 'India', destination: 'Goa', nights: 3, sequence: 1 }],
    });
    expect(leadResponse.status, JSON.stringify(leadResponse.body)).toBe(201);
    const lead = leadResponse.body.data as { id: string };
    const created = await createVoucher(client, {
      customerId: customer.id,
      queryId: lead.id,
      hotelId: hotel.id,
    });
    const details = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(details.customer.id).toBe(customer.id);
    expect(details.query.id).toBe(lead.id);
    expect(details.hotel.id).toBe(hotel.id);
    // Deleting referenced masters/leads nulls the link; the voucher survives.
    await db.customer.delete({ where: { id: customer.id } });
    await db.query.delete({ where: { id: lead.id } });
    await db.hotel.delete({ where: { id: hotel.id } });
    const after = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(after.customer).toBeNull();
    expect(after.query).toBeNull();
    expect(after.hotel).toBeNull();
    expect(after.guestName).toBe('Aarav Mehta');
    expect(after.hotelName).toBe('Shah Palace Hotel');
  });

  it('resolves linked hotel data live: later master edits are reflected without rewriting the voucher', async () => {
    const client = await owner();
    const { hotel } = await setupHotel(client);
    const created = await createVoucher(client, { hotelId: hotel.id });
    await client.patch(`/api/masters/hotels/${hotel.id}`, { name: 'Renamed Palace' });
    const details = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(details.hotelName).toBe('Renamed Palace');
    // The stored snapshot row itself is untouched — only reads resolve live.
    const stored = await db.hotelVoucher.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.hotelName).toBe('Shah Palace Hotel');
  });
  it('edits vouchers of any status and keeps validating the payload', async () => {    const client = await owner();
    const created = await createVoucher(client);
    const updated = await client.patch(`/api/hotel-vouchers/${created.id}`, {
      confirmationNumber: 'CONF-9',
      rooms: 2,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.confirmationNumber).toBe('CONF-9');
    // Legacy statuses stay editable too; unrelated fields are untouched.
    for (const legacy of ['DRAFT', 'ISSUED', 'CANCELLED'] as const) {
      const row = await legacyStatus(client, legacy);
      const edited = await client.patch(`/api/hotel-vouchers/${row.id}`, {
        hotelCity: 'Udaipur',
      });
      expect(edited.status, legacy).toBe(200);
      expect(edited.body.data.hotelCity).toBe('Udaipur');
      expect(edited.body.data.confirmationNumber).toBe('CONF-1');
    }
    // Validation still applies on every edit.
    expect(
      (await client.patch(`/api/hotel-vouchers/${created.id}`, { checkOut: '2026-11-09' })).status,
    ).toBe(400);
  });

  it('updates reference links through relation writes, including clears', async () => {
    // Regression: the edit form always submits customer/query/hotel keys
    // (null or id). The checked Prisma update input exposes only relation
    // operations for these — passing the scalars threw
    // PrismaClientValidationError (HTTP 500) on every save.
    const client = await owner();
    const { hotel } = await setupHotel(client);
    const created = await createVoucher(client, { hotelId: hotel.id });
    const linked = await client.patch(`/api/hotel-vouchers/${created.id}`, {
      hotelId: hotel.id,
      queryId: null,
      customerId: null,
      guestName: 'Aarav Mehta',
    });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.data.hotelId).toBe(hotel.id);
    const row = await db.hotelVoucher.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.hotelId).toBe(hotel.id);
    // Clearing works the same way and leaves snapshots untouched.
    const cleared = await client.patch(`/api/hotel-vouchers/${created.id}`, { hotelId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.hotelId).toBeNull();
    expect(cleared.body.data.hotelName).toBe('Shah Palace Hotel');
    // Unknown ids are still rejected with a validation error, not a 500.
    expect(
      (
        await client.patch(`/api/hotel-vouchers/${created.id}`, {
          hotelId: '00000000-0000-4000-8000-000000000000',
        })
      ).status,
    ).toBe(400);
  });

  it('keeps legacy records fully usable without any status transition', async () => {
    const client = await owner();
    for (const legacy of ['DRAFT', 'ISSUED', 'CANCELLED'] as const) {
      const row = await legacyStatus(client, legacy);
      expect((await client.get(`/api/hotel-vouchers/${row.id}`)).status, legacy).toBe(200);
      expect(
        (await client.patch(`/api/hotel-vouchers/${row.id}`, { rooms: 2 })).status,
        legacy,
      ).toBe(200);
      expect(
        (await client.post(`/api/hotel-vouchers/${row.id}/generate-pdf`, {})).status,
        legacy,
      ).toBe(200);
      expect(
        (
          await client.post(`/api/hotel-vouchers/${row.id}/send-email`, {
            recipientEmail: 'guest@example.test',
          })
        ).status,
        legacy,
      ).toBe(200);
    }
  });

  it('stores an optional booking id separately from the confirmation number', async () => {
    const client = await owner();
    // With a booking id: persists and reads back; confirmation untouched.
    const created = await createVoucher(client, { bookingId: 'BK-AGODA-7788' });
    expect(created).toMatchObject({ bookingId: 'BK-AGODA-7788', confirmationNumber: 'CONF-1' });
    const row = await db.hotelVoucher.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.bookingId).toBe('BK-AGODA-7788');
    expect(row.confirmationNumber).toBe('CONF-1');

    // Without one: saves successfully and stays null.
    const plain = await createVoucher(client);
    expect(plain).toMatchObject({ confirmationNumber: 'CONF-1' });
    expect(plain.bookingId).toBeNull();

    // Draft edits can add, change, and clear it.
    const added = await client.patch(`/api/hotel-vouchers/${plain.id}`, { bookingId: 'BK-1' });
    expect(added.status).toBe(200);
    expect(added.body.data.bookingId).toBe('BK-1');
    const changed = await client.patch(`/api/hotel-vouchers/${plain.id}`, { bookingId: 'BK-2' });
    expect(changed.body.data.bookingId).toBe('BK-2');
    expect(changed.body.data.confirmationNumber).toBe('CONF-1');
    const cleared = await client.patch(`/api/hotel-vouchers/${plain.id}`, { bookingId: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.bookingId).toBeNull();
  });

  it('shows the booking id in the generated PDF and omits it when absent', async () => {
    const client = await owner();
    const created = await createVoucher(client, { bookingId: 'BK-AGODA-7788' });
    expect((await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {})).status).toBe(
      200,
    );
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).toContain('Booking ID');
    expect(text).toContain('BK-AGODA-7788');
    // Confirmation number stays separate and present.
    expect(text).toContain('CONF-1');

    // Regeneration after an edit shows the latest saved value.
    const draft = await createVoucher(client, { bookingId: 'BK-OLD' });
    await client.patch(`/api/hotel-vouchers/${draft.id}`, { bookingId: 'BK-NEW' });
    await client.post(`/api/hotel-vouchers/${draft.id}/generate-pdf`, {});
    const restored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: draft.id },
    });
    const reobject = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(restored.objectKey);
    const retext = pdfText(reobject ?? Buffer.alloc(0));
    expect(retext).toContain('BK-NEW');
    expect(retext).not.toContain('BK-OLD');

    // No booking id: the label is omitted, never a placeholder.
    const plain = await createVoucher(client);
    await client.post(`/api/hotel-vouchers/${plain.id}/generate-pdf`, {});
    const plainStored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: plain.id },
    });
    const plainObject = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(plainStored.objectKey);
    expect(pdfText(plainObject ?? Buffer.alloc(0))).not.toContain('Booking ID');
  });

  it('stores custom reference labels and renders them in the PDF with fallbacks', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      bookingId: 'BK-AGODA-7788',
      confirmationNumberLabel: 'Hotel Confirmation No.',
      bookingIdLabel: 'Supplier Booking Reference',
    });
    expect(created).toMatchObject({
      confirmationNumberLabel: 'Hotel Confirmation No.',
      bookingIdLabel: 'Supplier Booking Reference',
    });
    // Labels survive an unrelated edit.
    await client.patch(`/api/hotel-vouchers/${created.id}`, { rooms: 2 });
    const reloaded = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(reloaded).toMatchObject({
      confirmationNumberLabel: 'Hotel Confirmation No.',
      bookingIdLabel: 'Supplier Booking Reference',
      bookingId: 'BK-AGODA-7788',
      confirmationNumber: 'CONF-1',
    });
    await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    // The booking label renders beside its value in Hotel Details; the
    // custom confirmation label renders in the top-right header card above
    // the confirmation value itself.
    expect(text).toContain('Supplier Booking Reference');
    expect(text).toContain('BK-AGODA-7788');
    expect(text).toContain('Hotel Confirmation No.');
    expect(text).toContain('CONF-1');
    // Exactly once: header card only, never repeated in Hotel Details.
    expect(text.split('CONF-1').length - 1).toBe(1);

    // Legacy vouchers (null labels) and blank labels fall back to defaults.
    const legacy = await createVoucher(client, { bookingId: 'BK-1' });
    await client.post(`/api/hotel-vouchers/${legacy.id}/generate-pdf`, {});
    const legacyStored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: legacy.id },
    });
    const legacyObject = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(legacyStored.objectKey);
    const legacyText = pdfText(legacyObject ?? Buffer.alloc(0));
    expect(legacyText).toContain('Confirmation No.');
    expect(legacyText).toContain('Booking ID');

    const blanked = await createVoucher(client, {
      bookingId: 'BK-2',
      confirmationNumberLabel: '   ',
      bookingIdLabel: '',
    });
    expect(blanked.confirmationNumberLabel).toBeNull();
    expect(blanked.bookingIdLabel).toBeNull();
  });

  it('regenerates the PDF with edited custom labels instead of serving the stale file', async () => {
    const client = await owner();
    const created = await createVoucher(client, { bookingId: 'BK-AGODA-7788' });
    await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    const before = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const beforeObject = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(before.objectKey);
    expect(pdfText(beforeObject ?? Buffer.alloc(0))).toContain('Confirmation No.');

    // Edit labels → save → reload → generate: the PDF must match the form.
    await client.patch(`/api/hotel-vouchers/${created.id}`, {
      confirmationNumberLabel: 'confo id',
      bookingIdLabel: 'secret id',
    });
    const reloaded = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(reloaded).toMatchObject({
      confirmationNumberLabel: 'confo id',
      bookingIdLabel: 'secret id',
      confirmationNumber: 'CONF-1',
      bookingId: 'BK-AGODA-7788',
    });
    await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    const after = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id, deletedAt: null },
    });
    const afterObject = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(after.objectKey);
    const text = pdfText(afterObject ?? Buffer.alloc(0));
    expect(text).toContain('confo id');
    expect(text).toContain('secret id');
    expect(text).not.toContain('Confirmation No.');
    // Values themselves are unchanged.
    expect(text).toContain('CONF-1');
    expect(text).toContain('BK-AGODA-7788');
  });

  it('resolves linked hotel data live in details, list and PDF', async () => {
    const client = await owner();
    const { hotel } = await setupHotel(client);
    const created = await createVoucher(client, {
      hotelId: hotel.id,
      hotelName: 'Stale Snapshot Name',
      hotelPhone: '+91 00000 00000',
      hotelCity: 'Stale City',
      hotelStarRating: '1 Star',
    });
    // Stored snapshots stay as saved, but reads overlay the live master.
    const stored = await db.hotelVoucher.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.hotelName).toBe('Stale Snapshot Name');

    await db.hotel.update({
      where: { id: hotel.id },
      data: { name: 'Renamed Palace Hotel', phone: '+91 99999 99999' },
    });

    const details = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(details.hotelName).toBe('Renamed Palace Hotel');
    expect(details.hotelPhone).toBe('+91 99999 99999');
    expect(details.hotelCity).toBe('Jaipur');
    expect(details.hotelStarRating).toBe('4 Star');

    const listed = (await client.get('/api/hotel-vouchers')).body.data;
    const row = listed.data.find((entry: { id: string }) => entry.id === created.id);
    expect(row.hotelName).toBe('Renamed Palace Hotel');

    await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    const doc = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id, deletedAt: null },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(doc.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).toContain('Renamed Palace Hotel');
    expect(text).toContain('+91 99999 99999');
    expect(text).not.toContain('Stale Snapshot Name');
  });

  it('keeps snapshot values for standalone vouchers and missing masters', async () => {
    const client = await owner();
    // No linked master: the voucher's own fields are authoritative.
    const standalone = await createVoucher(client, {
      hotelName: 'Independent Stay Inn',
      hotelPhone: '+91 11111 11111',
    });
    const details = (await client.get(`/api/hotel-vouchers/${standalone.id}`)).body.data;
    expect(details.hotelName).toBe('Independent Stay Inn');
    expect(details.hotelPhone).toBe('+91 11111 11111');

    // A deleted master nulls the link (SetNull); the stored snapshot keeps
    // the voucher usable and the PDF still generates.
    const { hotel } = await setupHotel(client);
    const linked = await createVoucher(client, {
      hotelId: hotel.id,
      hotelName: 'Snapshot Kept Name',
    });
    await db.hotel.delete({ where: { id: hotel.id } });
    const reloaded = await client.get(`/api/hotel-vouchers/${linked.id}`);
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.data.hotelName).toBe('Snapshot Kept Name');
    expect((await client.post(`/api/hotel-vouchers/${linked.id}/generate-pdf`, {})).status).toBe(
      200,
    );
  });

  it('never leaks another tenant hotel through the live overlay', async () => {
    const client = await owner();
    const other = await owner('other-overlay@test.com', 'Other Overlay Travel');
    const { hotel: otherHotel } = await setupHotel(other);
    await db.hotel.update({ where: { id: otherHotel.id }, data: { name: 'Other Tenant Hotel' } });
    const created = await createVoucher(client, { hotelName: 'Own Snapshot Name' });
    // Forced cross-tenant link (bypasses validation, as a hostile write would
    // have to): reads must fall back to the snapshot, never the foreign name.
    await db.hotelVoucher.update({ where: { id: created.id }, data: { hotelId: otherHotel.id } });
    const details = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(details.hotelName).toBe('Own Snapshot Name');
    expect(JSON.stringify(details)).not.toContain('Other Tenant Hotel');
  });

  it('shows edited terms in the PDF after save, with no stale copy retained', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      termsSnapshot: '<p>Original terms line.</p>',
    });
    await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    // Opening uses the stored PDF; after an edit it must regenerate instead.
    const editedHtml =
      '<p>Updated terms with a list:</p><ol><li>First rule</li><li>Second rule</li></ol><ul><li>Note item</li></ul><p>Keep <strong>bold</strong> breaks.</p>';
    const patched = await client.patch(`/api/hotel-vouchers/${created.id}`, {
      termsSnapshot: editedHtml,
    });
    expect(patched.status).toBe(200);
    // Identity and numbering survive the edit.
    expect(patched.body.data.id).toBe(created.id);
    expect(patched.body.data.voucherNumber).toBe(created.voucherNumber);
    // Saved HTML round-trips byte-identical through reload.
    const reloaded = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(reloaded.termsSnapshot).toBe(editedHtml);
    // The pre-edit stored PDF is retired at save time: details carry no
    // document, so Open/Download regenerate from the saved edit.
    expect(reloaded.documents).toEqual([]);
    expect(
      await db.hotelVoucherDocument.count({
        where: { voucherId: created.id, deletedAt: null },
      }),
    ).toBe(0);

    await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    const live = await db.hotelVoucherDocument.findMany({
      where: { voucherId: created.id, deletedAt: null },
    });
    expect(live).toHaveLength(1);
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(live[0]!.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).toContain('Updated terms with a list:');
    expect(text).toContain('1. First rule');
    expect(text).toContain('2. Second rule');
    expect(text).toContain('Note item');
    expect(text).toContain('Keep bold breaks.');
    expect(text).not.toContain('Original terms line.');
  });

  it('deleting a voucher removes its stored PDF bytes as well as its rows', async () => {
    const client = await owner();
    const created = await createVoucher(client);
    await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    const doc = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id, deletedAt: null },
    });
    const reader = storageService as unknown as {
      read: (key: string) => Buffer | undefined;
    };
    expect(reader.read(doc.objectKey)?.length).toBeGreaterThan(0);
    expect((await client.delete(`/api/hotel-vouchers/${created.id}`)).status).toBe(200);
    expect(
      await db.hotelVoucherDocument.count({
        where: { voucherId: created.id, deletedAt: null },
      }),
    ).toBe(0);
    expect(reader.read(doc.objectKey)).toBeUndefined();
  });

  it('edits update the same record and preserve identity and creator', async () => {    const client = await owner();
    const created = await createVoucher(client);
    const before = await db.hotelVoucher.findUniqueOrThrow({ where: { id: created.id } });
    for (const guestName of ['First Edit', 'Second Edit', 'Third Edit']) {
      const response = await client.patch(`/api/hotel-vouchers/${created.id}`, {
        guestName,
      });
      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(created.id);
      expect(response.body.data.voucherNumber).toBe(created.voucherNumber);
    }
    expect(await db.hotelVoucher.count({ where: { id: created.id } })).toBe(1);
    expect(await db.hotelVoucher.count()).toBe(1);
    const after = await db.hotelVoucher.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.voucherNumber).toBe(before.voucherNumber);
    expect(after.createdById).toBe(before.createdById);
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
    expect(after.guestName).toBe('Third Edit');
  });

  it('repeated PDF generation keeps one live document and one stored object', async () => {
    const client = await owner();
    const created = await createVoucher(client);
    // Legacy version-specific object left by the previous storage scheme.
    const legacyKey = `companies/x/hotel-vouchers/${created.id}/documents/legacy-doc/hotel-voucher-old.pdf`;
    await storageService.putObject({
      key: legacyKey,
      body: Buffer.from('stale-bytes'),
      contentType: 'application/pdf',
    });
    await db.hotelVoucherDocument.create({
      data: {
        companyId: (await db.hotelVoucher.findUniqueOrThrow({ where: { id: created.id } }))
          .companyId,
        voucherId: created.id,
        documentType: 'VOUCHER',
        storageProvider: 'MEMORY',
        bucket: 'memory',
        objectKey: legacyKey,
        fileName: 'hotel-voucher-old.pdf',
        mimeType: 'application/pdf',
        fileSize: 11,
        uploadStatus: 'AVAILABLE',
        visibility: 'CUSTOMER_VISIBLE',
        uploadedById: (
          await db.hotelVoucher.findUniqueOrThrow({ where: { id: created.id } })
        ).createdById,
      },
    });

    const first = await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    expect(first.status).toBe(200);
    const second = await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    // One live row; legacy rows and their bytes are gone.
    expect(
      await db.hotelVoucherDocument.count({
        where: { voucherId: created.id, deletedAt: null },
      }),
    ).toBe(1);
    const reader = storageService as unknown as {
      read: (key: string) => Buffer | undefined;
    };
    expect(reader.read(legacyKey)).toBeUndefined();
    const live = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id, deletedAt: null },
    });
    expect(reader.read(live.objectKey)?.length).toBeGreaterThan(0);
    expect(live.id).toBe(second.body.data.id);
  });

  it('no longer exposes issue or cancel endpoints', async () => {
    const client = await owner();
    const created = await createVoucher(client);
    // The status workflows are removed: both former endpoints are gone.
    expect((await client.post(`/api/hotel-vouchers/${created.id}/cancel`, {})).status).toBe(404);
    expect((await client.post(`/api/hotel-vouchers/${created.id}/issue`, {})).status).toBe(404);
    // Editing still works on every voucher.
    expect((await client.patch(`/api/hotel-vouchers/${created.id}`, { remarks: 'x' })).status).toBe(
      200,
    );
    // Deletion is status-independent.
    expect((await client.delete(`/api/hotel-vouchers/${created.id}`)).status).toBe(200);
  });

  it('deletes vouchers regardless of their former status', async () => {
    const client = await owner();
    const draft = await legacyDraft(client);
    expect((await client.delete(`/api/hotel-vouchers/${draft.id}`)).status).toBe(200);
    expect((await client.get(`/api/hotel-vouchers/${draft.id}`)).status).toBe(404);
    const created = await createVoucher(client);
    expect((await client.delete(`/api/hotel-vouchers/${created.id}`)).status).toBe(200);
    expect((await client.get(`/api/hotel-vouchers/${created.id}`)).status).toBe(404);
    const cancelled = await legacyStatus(client, 'CANCELLED');
    expect((await client.delete(`/api/hotel-vouchers/${cancelled.id}`)).status).toBe(200);
  });

  it('isolates tenants: numbers, reads, writes and cross-company access', async () => {
    const alpha = await owner('alpha@vouchers.test', 'Alpha Travel');
    const beta = await owner('beta@vouchers.test', 'Beta Travel');
    const first = await createVoucher(alpha);
    expect(first.voucherNumber).toBe('HV-000001');
    const betaFirst = await createVoucher(beta);
    expect(betaFirst.voucherNumber).toBe('HV-000001');
    expect((await beta.get(`/api/hotel-vouchers/${first.id}`)).status).toBe(404);
    expect((await beta.patch(`/api/hotel-vouchers/${first.id}`, { remarks: 'x' })).status).toBe(
      404,
    );
    expect((await beta.delete(`/api/hotel-vouchers/${first.id}`)).status).toBe(404);
    expect((await beta.post(`/api/hotel-vouchers/${first.id}/issue`, {})).status).toBe(404);
    expect((await beta.post(`/api/hotel-vouchers/${first.id}/generate-pdf`, {})).status).toBe(404);
    const list = await beta.get('/api/hotel-vouchers?page=1&pageSize=10');
    expect(list.body.data.data.map((row: { id: string }) => row.id)).toEqual([betaFirst.id]);
  });

  it('lists with search, status filter and pagination', async () => {
    const client = await owner();
    await createVoucher(client, { guestName: 'Aarav Mehta', hotelName: 'Shah Palace Hotel' });
    await createVoucher(client, { guestName: 'Diya Shah', hotelName: 'Lake Resort' });
    const search = await client.get('/api/hotel-vouchers?search=lake&page=1&pageSize=10');
    expect(search.body.data.data.map((row: { guestName: string }) => row.guestName)).toEqual([
      'Diya Shah',
    ]);
    // No status filter exists: a stray status param is ignored, not an error.
    const unfiltered = await client.get('/api/hotel-vouchers?status=ISSUED&page=1&pageSize=10');
    expect(unfiltered.status).toBe(200);
    expect(unfiltered.body.data.pagination.total).toBe(2);
  });

  it('renders the reference hotel-voucher layout: sections, totals, pagination, no banned content', async () => {
    const client = await owner();
    // Check-in is a Monday so the weekday-absence check is a real one.
    const created = await createVoucher(client, {
      checkIn: '2026-11-09',
      checkOut: '2026-11-12',
      pricing: [
        {
          roomType: 'Single Room',
          unit: 1,
          quantity: 2,
          gst: 18,
          amount: 16850,
          taxablePay: 16850,
          gstService: 19883,
        },
        {
          roomType: 'Double Room',
          unit: 1,
          quantity: 1,
          gst: 18,
          amount: 11000,
          taxablePay: 11000,
          gstService: 12980,
        },
      ],
      guests: [
        { guestName: 'Dilip Vaid', age: 63, sex: 'M', paxType: 'ADULT' },
        { guestName: 'Neelam Vaid', age: 55, sex: 'F', paxType: 'ADULT' },
        { guestName: 'Arika Vaid', age: 12, sex: 'F', paxType: 'CHILD' },
      ],
    });
    const generated = await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    expect(generated.status).toBe(200);
    expect(generated.body.data.fileName).toBe(`hotel-voucher-${created.voucherNumber}.pdf`);
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    expect(stored.uploadStatus).toBe('AVAILABLE');
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    // Present: branded title block with the voucher's own confirmation
    // number, all remaining sections, guest rows, pagination. Pricing left
    // the voucher workflow: stored rows never render (see the banned list).
    for (const expected of [
      'HOTEL VOUCHER',
      'Please present this voucher at the hotel upon arrival.',
      'Confirmation No.',
      'CONF-1',
      'HOTEL DETAILS',
      'GUEST DETAILS',
      'STAY DETAILS',
      'GUEST INFORMATION',
      'TERMS & CONDITIONS',
      'Dilip Vaid',
      'Shah Palace Hotel',
      'Non-refundable after check-in.',
      'Page 1 of 2',
    ]) {
      expect(text, `missing ${expected}`).toContain(expected);
    }
    // Absent (16): no voucher-number/status/issue-date metadata, no weekday
    // names, no stars, no Optional/Special Requests/Remarks content, and no
    // pricing remnants even though the saved voucher carries pricing rows.
    // The system voucher number stays out even though the hotel confirmation
    // number is shown.
    for (const banned of [
      'CONFIRMED HOTEL RESERVATION',
      'VOUCHER NUMBER',
      'ISSUE DATE',
      'STATUS',
      created.voucherNumber,
      'Optional',
      'Special Requests',
      'High floor',
      'Remarks',
      'Honeymoon',
      'Monday',
      '4 Star',
      'PRICING',
      'Total Payable Amount',
      '32,863',
      '19,883',
    ]) {
      expect(text, `leaked ${banned}`).not.toContain(banned);
    }
    // Long remarks must not crash the renderer.
    const longRemarks = await createVoucher(client, { remarks: 'Note. '.repeat(200) });
    expect(
      (await client.post(`/api/hotel-vouchers/${longRemarks.id}/generate-pdf`, {})).status,
    ).toBe(200);
    const download = await client.get(
      `/api/hotel-vouchers/${created.id}/documents/${generated.body.data.id}/download-url`,
    );
    expect(download.status).toBe(200);
    expect(download.body.data.url).toBeTruthy();
    expect(download.body.data.expiresInSeconds).toBeGreaterThan(0);
  });

  it('renders legacy cancelled records like any other voucher, with no notice', async () => {
    const client = await owner();
    const created = await legacyStatus(client, 'CANCELLED');
    expect((await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {})).status).toBe(
      200,
    );
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).not.toContain('cancelled');
    expect(text).not.toContain('STATUS');
    expect(text).toContain('Shah Palace Hotel');
  });

  it('emails the PDF for any voucher without a status gate', async () => {
    const client = await owner();
    const created = await createVoucher(client);
    const sent = await client.post(`/api/hotel-vouchers/${created.id}/send-email`, {
      recipientEmail: 'guest@example.test',
      subject: 'Your stay',
    });
    expect(sent.status).toBe(200);
    const mail = getMemoryEmailProvider()?.last('guest@example.test');
    expect(mail?.subject).toBe('Your stay');
    expect(mail?.attachments?.[0]?.fileName).toContain('hotel-voucher-');
    // Legacy statuses share exactly like new vouchers.
    const draft = await legacyDraft(client);
    expect(
      (
        await client.post(`/api/hotel-vouchers/${draft.id}/send-email`, {
          recipientEmail: 'guest@example.test',
        })
      ).status,
    ).toBe(200);
  });

  it('requires authentication and permissions on every endpoint', async () => {
    const client = await owner();
    const created = await createVoucher(client);
    const unauth = createAuthClient(app);
    expect((await unauth.get('/api/hotel-vouchers')).status).toBe(401);
    expect((await unauth.get(`/api/hotel-vouchers/${created.id}`)).status).toBe(401);
  });

  it('creates vouchers without pricing or guest rows', async () => {
    const client = await owner();
    const created = await createVoucher(client);
    const details = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(details.pricing).toEqual([]);
    expect(details.guests).toEqual([]);
    expect(details.packageIncludes).toEqual([]);
  });

  it('creates vouchers with multiple pricing and guest rows in order', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      pricing: [
        {
          roomType: 'Single Room',
          unit: 1,
          quantity: 2,
          gst: 18,
          amount: 16850,
          taxablePay: 16850,
          gstService: 19883,
        },
        {
          roomType: 'Double Room',
          unit: 1,
          quantity: 1,
          gst: 18,
          amount: 11000,
          taxablePay: 11000,
          gstService: 12980,
        },
      ],
      guests: [
        { guestName: 'Dilip Vaid', age: 63, sex: 'M', paxType: 'ADULT' },
        { guestName: 'Neelam Vaid', age: 55, sex: 'F', paxType: 'ADULT' },
        { guestName: 'Arika Vaid', age: 12, sex: 'F', paxType: 'CHILD' },
      ],
    });
    const details = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(details.pricing.map((row: { roomType: string }) => row.roomType)).toEqual([
      'Single Room',
      'Double Room',
    ]);
    expect(details.pricing[0]).toMatchObject({ unit: 1, quantity: 2, gst: 18, amount: 16850 });
    expect(details.guests.map((row: { guestName: string }) => row.guestName)).toEqual([
      'Dilip Vaid',
      'Neelam Vaid',
      'Arika Vaid',
    ]);
    expect(details.guests[2]).toMatchObject({ age: 12, sex: 'F', paxType: 'CHILD' });
    const stored = await db.hotelVoucherPricing.findMany({
      where: { voucherId: created.id },
      orderBy: { sequence: 'asc' },
    });
    expect(stored.map((row) => row.sequence)).toEqual([0, 1]);
  });

  it('renders one guest information row per saved guest entry', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      guests: [
        { guestName: 'Adult One', age: 40, sex: 'M', paxType: 'ADULT' },
        { guestName: 'Adult Two', age: 38, sex: 'F', paxType: 'ADULT' },
        { guestName: 'Child One', age: 9, sex: 'M', paxType: 'CHILD' },
        { guestName: 'Child Two', age: 6, sex: 'F', paxType: 'CHILD' },
      ],
    });
    await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).toContain('GUEST INFORMATION');
    for (const name of ['Adult One', 'Adult Two', 'Child One', 'Child Two']) {
      expect(text, `missing ${name}`).toContain(name);
    }
    // Age and Sex are gone from the Guest Information table entirely.
    expect(text).not.toContain('Age');
    expect(text).not.toContain('Sex');
    expect(text).toContain('Adult / Child');
    expect(text).not.toContain('No of Pax');
  });

  it('renders room details without Child w/o Bed and Remark columns', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      stayRooms: [
        {
          roomType: 'Superior Room',
          rooms: 2,
          extraBedQuantity: 1,
          childWithoutBedQuantity: 1,
          notes: 'High floor',
        },
        {
          roomType: 'Premier Room',
          rooms: 4,
          extraBedQuantity: 0,
          childWithoutBedQuantity: 2,
          notes: null,
        },
      ],
    });
    await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    // Kept headers and values render in order.
    for (const expected of ['ROOM DETAILS', '#', 'Room Type', 'Rooms', 'Extra Bed']) {
      expect(text, `missing ${expected}`).toContain(expected);
    }
    expect(text).toContain('Superior Room');
    expect(text).toContain('Premier Room');
    // Removed columns never render — headings, values, or remarks.
    expect(text).not.toContain('Child w/o Bed');
    expect(text).not.toContain('Remark');
    expect(text).not.toContain('High floor');
    // The underlying data stays saved and editable.
    const details = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(details.stayRooms).toMatchObject([
      { roomType: 'Superior Room', rooms: 2, extraBedQuantity: 1 },
      { roomType: 'Premier Room', rooms: 4, extraBedQuantity: 0 },
    ]);
    const persisted = await db.hotelVoucherStayRoom.findMany({
      where: { voucherId: created.id },
      orderBy: { sequence: 'asc' },
    });
    expect(persisted.map((row) => row.childWithoutBedQuantity)).toEqual([1, 2]);
    expect(persisted.map((row) => row.notes)).toEqual(['High floor', null]);
    const edited = await client.patch(`/api/hotel-vouchers/${created.id}`, {
      stayRooms: [
        { roomType: 'Superior Room', rooms: 3, childWithoutBedQuantity: 0, notes: 'Sea view' },
        { roomType: 'Premier Room', rooms: 4 },
      ],
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const reloaded = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(reloaded.stayRooms[0]).toMatchObject({
      rooms: 3,
      childWithoutBedQuantity: 0,
      notes: 'Sea view',
    });
  });

  it('omits the confirmation card when no confirmation number is saved', async () => {
    const client = await owner();
    const created = await createVoucher(client, { confirmationNumber: null });
    await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).toContain('HOTEL VOUCHER');
    expect(text).not.toContain('Confirmation No.');
  });

  it('folds a city already contained in the address instead of repeating it', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      hotelName: 'Seaside Resort',
      hotelAddress: '12 Marine Drive, Mumbai 400020',
      hotelCity: 'Mumbai',
    });
    await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).toContain('Seaside Resort');
    // Once inside the address line, never again as a separate line.
    expect(text.split('Mumbai').length - 1).toBe(1);
  });

  it('resolves the voucher theme from the saved branding with safe fallbacks', () => {
    // Built-in purple default when nothing (or garbage) is configured.
    expect(resolveVoucherTheme(null)).toEqual({ primary: '#3d2352', onPrimary: '#ffffff' });
    expect(resolveVoucherTheme('not-a-color')).toEqual({
      primary: '#3d2352',
      onPrimary: '#ffffff',
    });
    // Company override wins, normalized to lowercase.
    expect(resolveVoucherTheme('#B4232A')).toEqual({ primary: '#b4232a', onPrimary: '#ffffff' });
    // Light themes get dark-navy foreground so headings stay readable.
    expect(resolveVoucherPrimary('#F5E9A8')).toBe('#f5e9a8');
    expect(voucherPrimaryForeground('#f5e9a8')).toBe('#1f2a5c');
    expect(voucherPrimaryForeground('#1e40af')).toBe('#ffffff');
  });

  it('creates vouchers with multiple stay rooms and meals in order', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      roomTypeName: 'Superior Room',
      rooms: 6,
      mealPlanName: 'Breakfast only',
      checkIn: '2026-11-01',
      checkOut: '2026-11-07',
      stayRooms: [
        {
          roomType: 'Superior Room',
          rooms: 2,
          extraBedQuantity: 1,
          childWithoutBedQuantity: 0,
          notes: 'High floor',
        },
        {
          roomType: 'Premier Room',
          rooms: 4,
          extraBedQuantity: 0,
          childWithoutBedQuantity: 1,
          notes: null,
        },
      ],
      stayMeals: [{ mealPlan: 'Breakfast only' }, { mealPlan: 'Dinner' }],
    });
    const details = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(details.stayRooms.map((row: { roomType: string }) => row.roomType)).toEqual([
      'Superior Room',
      'Premier Room',
    ]);
    expect(details.stayRooms[0]).toMatchObject({
      rooms: 2,
      extraBedQuantity: 1,
      childWithoutBedQuantity: 0,
      notes: 'High floor',
    });
    expect(details.stayRooms[1]).toMatchObject({
      rooms: 4,
      extraBedQuantity: 0,
      childWithoutBedQuantity: 1,
      notes: null,
    });
    expect(details.stayMeals.map((row: { mealPlan: string }) => row.mealPlan)).toEqual([
      'Breakfast only',
      'Dinner',
    ]);
    // Document total and scalar mirrors stay consistent.
    expect(details.rooms).toBe(6);
    expect(details.roomTypeName).toBe('Superior Room');
    expect(details.mealPlanName).toBe('Breakfast only');
    expect(details.nights).toBe(6);
    const storedRooms = await db.hotelVoucherStayRoom.findMany({
      where: { voucherId: created.id },
      orderBy: { sequence: 'asc' },
    });
    expect(storedRooms.map((row) => row.sequence)).toEqual([0, 1]);
    const storedMeals = await db.hotelVoucherStayMeal.findMany({
      where: { voucherId: created.id },
      orderBy: { sequence: 'asc' },
    });
    expect(storedMeals.map((row) => row.mealPlan)).toEqual(['Breakfast only', 'Dinner']);
  });

  it('mirrors scalar room and meal names when stay rows arrive without them', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      roomTypeName: undefined,
      mealPlanName: undefined,
      rooms: 6,
      stayRooms: [
        { roomType: 'Superior Room', rooms: 2 },
        { roomType: 'Premier Room', rooms: 4 },
      ],
      stayMeals: [{ mealPlan: 'Breakfast only' }, { mealPlan: 'Dinner' }],
    });
    const details = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(details.roomTypeName).toBe('Superior Room');
    expect(details.mealPlanName).toBe('Breakfast only');
    expect(details.rooms).toBe(6);
  });

  it('updates one stay row without discarding the others', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      rooms: 6,
      stayRooms: [
        { roomType: 'Superior Room', rooms: 2 },
        { roomType: 'Premier Room', rooms: 4 },
      ],
      stayMeals: [{ mealPlan: 'Breakfast only' }, { mealPlan: 'Dinner' }],
    });
    const updated = await client.patch(`/api/hotel-vouchers/${created.id}`, {
      stayRooms: [
        { roomType: 'Superior Room', rooms: 3, notes: 'High floor' },
        { roomType: 'Premier Room', rooms: 4 },
      ],
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    const reloaded = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(reloaded.stayRooms.map((row: { rooms: number }) => row.rooms)).toEqual([3, 4]);
    expect(reloaded.stayRooms[0]).toMatchObject({ roomType: 'Superior Room', notes: 'High floor' });
    // Untouched collections survive a partial update.
    expect(reloaded.stayMeals.map((row: { mealPlan: string }) => row.mealPlan)).toEqual([
      'Breakfast only',
      'Dinner',
    ]);
    expect(reloaded.roomTypeName).toBe('Superior Room');
    // A follow-up edit without stay keys leaves every row intact.
    const untouched = await client.patch(`/api/hotel-vouchers/${created.id}`, {
      remarks: 'Late checkout requested',
    });
    expect(untouched.status, JSON.stringify(untouched.body)).toBe(200);
    const stable = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(stable.stayRooms).toHaveLength(2);
    expect(stable.stayMeals).toHaveLength(2);
  });

  it('renders every stay room and meal plan in the generated PDF', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      rooms: 6,
      checkIn: '2026-11-01',
      checkOut: '2026-11-07',
      stayRooms: [
        { roomType: 'Superior Room', rooms: 2 },
        { roomType: 'Premier Room', rooms: 4 },
      ],
      stayMeals: [{ mealPlan: 'Breakfast only' }, { mealPlan: 'Dinner' }],
      termsSnapshot: 'Non-refundable after check-in.',
    });
    await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).toContain('ROOM DETAILS');
    for (const expected of ['Superior Room', 'Premier Room', 'Breakfast only', 'Dinner']) {
      expect(text, `missing ${expected}`).toContain(expected);
    }
    // Stay facts stay consistent with the saved voucher.
    expect(text).toContain('6 Rooms');
    expect(text).toContain('2 Plans');
    expect(text).toContain('01 NOV 2026');
    expect(text).toContain('07 NOV 2026');
  });

  it('renders legacy scalar-only vouchers in the PDF without stay rows', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      roomTypeName: 'Deluxe',
      rooms: 2,
      mealPlanName: 'Breakfast',
    });
    const details = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(details.stayRooms).toEqual([]);
    expect(details.stayMeals).toEqual([]);
    await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).toContain('ROOM DETAILS');
    expect(text).toContain('Deluxe');
    expect(text).toContain('Breakfast');
    expect(text).toContain('2 Rooms');
  });

  it('stores calendar dates exactly as submitted across save, reload, and re-edit', async () => {
    const client = await owner();
    // Regression: server-local midnight parsing shifted every date back one
    // day east of Greenwich (2026-11-01 was stored as 2026-10-31).
    const created = await client.post(
      '/api/hotel-vouchers',
      voucherPayload({ checkIn: '2026-11-01', checkOut: '2026-11-04' }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.checkIn).toBe('2026-11-01');
    expect(created.body.data.checkOut).toBe('2026-11-04');
    expect(created.body.data.nights).toBe(3);
    const id = created.body.data.id as string;
    const stored = await db.hotelVoucher.findUniqueOrThrow({ where: { id } });
    expect(stored.checkIn.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(stored.checkOut.toISOString().slice(0, 10)).toBe('2026-11-04');
    // Reload echoes the same calendar days.
    const reloaded = (await client.get(`/api/hotel-vouchers/${id}`)).body.data;
    expect(reloaded.checkIn).toBe('2026-11-01');
    expect(reloaded.checkOut).toBe('2026-11-04');
    expect(reloaded.nights).toBe(3);
    // Manual edits keep exact days, and re-edits without dates never drift.
    const updated = await client.patch(`/api/hotel-vouchers/${id}`, {
      checkIn: '2026-11-05',
      checkOut: '2026-11-07',
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    const afterEdit = (await client.get(`/api/hotel-vouchers/${id}`)).body.data;
    expect(afterEdit.checkIn).toBe('2026-11-05');
    expect(afterEdit.checkOut).toBe('2026-11-07');
    expect(afterEdit.nights).toBe(2);
    const untouched = await client.patch(`/api/hotel-vouchers/${id}`, {
      remarks: 'Late checkout requested',
    });
    expect(untouched.status, JSON.stringify(untouched.body)).toBe(200);
    const stable = (await client.get(`/api/hotel-vouchers/${id}`)).body.data;
    expect(stable.checkIn).toBe('2026-11-05');
    expect(stable.checkOut).toBe('2026-11-07');
    // The generated PDF renders the saved days.
    await client.post(`/api/hotel-vouchers/${id}/generate-pdf`, {});
    const document = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(document.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).toContain('05 NOV 2026');
    expect(text).toContain('07 NOV 2026');
  });

  it('edits and removes child rows without leaving stale records', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      pricing: [
        {
          roomType: 'Single Room',
          unit: 1,
          quantity: 2,
          gst: 18,
          amount: 16850,
          taxablePay: 16850,
          gstService: 19883,
        },
        {
          roomType: 'Double Room',
          unit: 1,
          quantity: 1,
          gst: 18,
          amount: 11000,
          taxablePay: 11000,
          gstService: 12980,
        },
      ],
      guests: [
        { guestName: 'Dilip Vaid', age: 63, sex: 'M', paxType: 'ADULT' },
        { guestName: 'Neelam Vaid', age: 55, sex: 'F', paxType: 'ADULT' },
      ],
    });
    // Edit one row, drop the other, add a new one.
    const updated = await client.patch(`/api/hotel-vouchers/${created.id}`, {
      pricing: [
        {
          roomType: 'Single Room',
          unit: 1,
          quantity: 3,
          gst: 18,
          amount: 16850,
          taxablePay: 16850,
          gstService: 19883,
        },
        {
          roomType: 'Suite',
          unit: 1,
          quantity: 1,
          gst: 28,
          amount: 25000,
          taxablePay: 25000,
          gstService: 32000,
        },
      ],
      guests: [{ guestName: 'Neelam Vaid', age: 56, sex: 'F', paxType: 'ADULT' }],
    });
    expect(updated.status).toBe(200);
    const details = updated.body.data;
    expect(details.pricing.map((row: { roomType: string }) => row.roomType)).toEqual([
      'Single Room',
      'Suite',
    ]);
    expect(details.pricing[0].quantity).toBe(3);
    expect(details.guests.map((row: { guestName: string }) => row.guestName)).toEqual([
      'Neelam Vaid',
    ]);
    expect(details.guests[0].age).toBe(56);
    expect(await db.hotelVoucherPricing.count({ where: { voucherId: created.id } })).toBe(2);
    expect(await db.hotelVoucherGuest.count({ where: { voucherId: created.id } })).toBe(1);
    // Removing every row leaves none behind.
    await client.patch(`/api/hotel-vouchers/${created.id}`, { pricing: [], guests: [] });
    const cleared = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(cleared.pricing).toEqual([]);
    expect(cleared.guests).toEqual([]);
  });

  it('rejects invalid pricing and guest rows', async () => {
    const client = await owner();
    expect(
      (
        await client.post(
          '/api/hotel-vouchers',
          voucherPayload({ pricing: [{ roomType: '', unit: 1, quantity: 1 }] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post(
          '/api/hotel-vouchers',
          voucherPayload({ pricing: [{ roomType: 'X', gst: 101 }] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post(
          '/api/hotel-vouchers',
          voucherPayload({ guests: [{ guestName: 'A', age: 5, sex: 'M', paxType: 'ADULT' }] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post(
          '/api/hotel-vouchers',
          voucherPayload({ guests: [{ guestName: 'Kid', age: 200, sex: 'F', paxType: 'CHILD' }] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post(
          '/api/hotel-vouchers',
          voucherPayload({ guests: [{ guestName: 'Kid', age: 5, sex: 'X', paxType: 'CHILD' }] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await client.post('/api/hotel-vouchers', voucherPayload({ pricing: 'nope' }))).status,
    ).toBe(400);
    expect(
      (await client.post('/api/hotel-vouchers', voucherPayload({ packageIncludes: ['   '] })))
        .status,
    ).toBe(400);
    expect(
      (
        await client.post(
          '/api/hotel-vouchers',
          voucherPayload({ packageIncludes: ['x'.repeat(201)] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await client.post('/api/hotel-vouchers', voucherPayload({ packageIncludes: 'nope' })))
        .status,
    ).toBe(400);
  });

  it('saves package includes in order and replaces them wholesale on update', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      packageIncludes: ['Breakfast', '  Pool  ', 'Wifi'],
    });
    const details = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    // Stored trimmed, order preserved.
    expect(details.packageIncludes).toEqual(['Breakfast', 'Pool', 'Wifi']);
    const stored = await db.hotelVoucherPackageInclude.findMany({
      where: { voucherId: created.id },
      orderBy: { sequence: 'asc' },
    });
    expect(stored.map((row) => [row.sequence, row.item])).toEqual([
      [0, 'Breakfast'],
      [1, 'Pool'],
      [2, 'Wifi'],
    ]);
    // Edit one item, drop one, reorder the rest.
    const updated = await client.patch(`/api/hotel-vouchers/${created.id}`, {
      packageIncludes: ['Wifi', 'Daily House Keeping'],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.packageIncludes).toEqual(['Wifi', 'Daily House Keeping']);
    expect(await db.hotelVoucherPackageInclude.count({ where: { voucherId: created.id } })).toBe(2);
    // Updates without the key leave includes untouched.
    await client.patch(`/api/hotel-vouchers/${created.id}`, { rooms: 2 });
    const untouched = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(untouched.packageIncludes).toEqual(['Wifi', 'Daily House Keeping']);
    expect(untouched.rooms).toBe(2);
    // Removing every item leaves none behind.
    await client.patch(`/api/hotel-vouchers/${created.id}`, { packageIncludes: [] });
    const cleared = (await client.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(cleared.packageIncludes).toEqual([]);
    expect(await db.hotelVoucherPackageInclude.count({ where: { voucherId: created.id } })).toBe(0);
  });

  it('renders saved package includes in the generated PDF', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      packageIncludes: ['Breakfast', 'Pool', 'Daily House Keeping'],
    });
    expect((await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {})).status).toBe(
      200,
    );
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).toContain('PACKAGE INCLUDES');
    expect(text).toContain('Breakfast');
    expect(text).toContain('Pool');
    expect(text).toContain('Daily House Keeping');
    // A voucher without includes omits the section entirely.
    const plain = await createVoucher(client);
    await client.post(`/api/hotel-vouchers/${plain.id}/generate-pdf`, {});
    const plainStored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: plain.id },
    });
    const plainObject = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(plainStored.objectKey);
    expect(pdfText(plainObject ?? Buffer.alloc(0))).not.toContain('PACKAGE INCLUDES');
  });

  it('flattens formatted terms and package items in the generated PDF', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      termsSnapshot:
        '<p>Non-refundable after <strong>check-in</strong>.</p><ul><li>No smoking</li><li>No pets</li></ul>',
      packageIncludes: ['<p><strong>Breakfast</strong> &amp; Pool</p>', '<p>Daily House Keeping</p>'],
    });
    expect((await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {})).status).toBe(
      200,
    );
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    // Visible text survives; markup never leaks into the document.
    for (const expected of [
      'Non-refundable after check-in.',
      'No smoking',
      'No pets',
      'Breakfast & Pool',
      'Daily House Keeping',
    ]) {
      expect(text, `missing ${expected}`).toContain(expected);
    }
    for (const banned of ['<p>', '</p>', '<strong>', '<ul>', '<li>', '&amp;']) {
      expect(text, `leaked ${banned}`).not.toContain(banned);
    }
  });

  it('renders terms verbatim without automatic numbering', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      termsSnapshot: 'Check-in after 2 PM.\nNo smoking in rooms.',
    });
    expect((await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {})).status).toBe(
      200,
    );
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).toContain('Check-in after 2 PM.');
    expect(text).toContain('No smoking in rooms.');
    expect(text).not.toContain('1. Check-in after 2 PM.');
    expect(text).not.toContain('2. No smoking in rooms.');
  });

  it('preserves user-typed numbering in terms without doubling it', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      termsSnapshot: '1. Check-in after 2 PM.\n2. No smoking in rooms.',
    });
    expect((await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {})).status).toBe(
      200,
    );
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).toContain('1. Check-in after 2 PM.');
    expect(text).toContain('2. No smoking in rooms.');
    expect(text).not.toContain('1. 1.');
    expect(text).not.toContain('2. 2.');
  });

  it('renders saved ordered lists with sequential numbers and no doubling', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      termsSnapshot:
        '<p>House rules:</p><ol><li>Check-in after 2 PM.</li><li>No smoking in rooms.</li></ol>',
    });
    expect((await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {})).status).toBe(
      200,
    );
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).toContain('House rules:');
    expect(text).toContain('1. Check-in after 2 PM.');
    expect(text).toContain('2. No smoking in rooms.');
    expect(text).not.toContain('1. 1.');
    for (const banned of ['<ol>', '<li>', '</ol>']) {
      expect(text, `leaked ${banned}`).not.toContain(banned);
    }
  });

  it('renders saved unordered lists as bullets without adding numbers', async () => {
    const client = await owner();
    const created = await createVoucher(client, {
      termsSnapshot: '<p>Notes:</p><ul><li>No smoking</li><li>No pets</li></ul>',
    });
    expect((await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {})).status).toBe(
      200,
    );
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    expect(text).toContain('No smoking');
    expect(text).toContain('No pets');
    expect(text).not.toMatch(/1\.\s*No smoking/);
    expect(text).not.toMatch(/2\.\s*No pets/);
  });

  it('ignores booking references: vouchers stay booking-free', async () => {
    const client = await owner();
    // `bookingId` is now a supported free-text field (see the booking-id
    // tests above), so this probes a genuinely unknown booking linkage key.
    const response = await client.post(
      '/api/hotel-vouchers',
      voucherPayload({ bookingReference: 'bbbbbbbb-2222-4222-8222-222222222222' }),
    );
    expect(response.status).toBe(201);
    expect(response.body.data).not.toHaveProperty('bookingReference');
    expect(response.body.data).not.toHaveProperty('booking');
    expect(response.body.data.bookingId).toBeNull();
    const details = (await client.get(`/api/hotel-vouchers/${response.body.data.id}`)).body.data;
    expect(details).not.toHaveProperty('bookingReference');
    expect(details).not.toHaveProperty('booking');
  });

  it('flows content without forced breaks and keeps bars with their first rows', async () => {
    const client = await owner();
    // Short voucher: content flows onto the first page instead of being
    // forced onto a near-empty second page. No room/meal info, so no
    // detail tables are rendered either.
    const compact = await createVoucher(client, {
      termsSnapshot: null,
      guests: [],
      roomTypeName: null,
      mealPlanName: null,
      pricing: [{ roomType: 'Single Room', unit: 1, quantity: 1 }],
    });
    await client.post(`/api/hotel-vouchers/${compact.id}/generate-pdf`, {});
    const compactStored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: compact.id },
    });
    const compactObject = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(compactStored.objectKey);
    const compactText = pdfText(compactObject ?? Buffer.alloc(0));
    expect(compactText).toContain('Page 1 of 1');
    expect(compactText).not.toContain('Page 2 of');
    // Stored pricing rows never render, even on a compact voucher.
    expect(compactText).not.toContain('PRICING');
    expect(compactText).not.toContain('Total Payable Amount');

    // Long terms: the section bar shares a page with its first rows and the
    // list continues onto the next page — never a stranded header.
    const long = await createVoucher(client, {
      termsSnapshot: Array.from({ length: 40 }, (_, i) => `Term ${i + 1}: pack bags early.`).join(
        '\n',
      ),
    });
    await client.post(`/api/hotel-vouchers/${long.id}/generate-pdf`, {});
    const longStored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: long.id },
    });
    const longObject = (
      storageService as unknown as {
        read: (key: string) => Buffer | undefined;
      }
    ).read(longStored.objectKey);
    const pages = pdfText(longObject ?? Buffer.alloc(0))
      .split('\f')
      .map((page) => page.trim())
      .filter((page) => page.length > 0);
    expect(pages.length).toBeGreaterThan(1);
    // The terms bar shares a page with its first rows wherever the section
    // starts — never a stranded header — and the list runs to the last page.
    const termsPage = pages.find((page) => page.includes('TERMS & CONDITIONS'));
    expect(termsPage).toBeDefined();
    expect(termsPage).toContain('Term 1: pack bags early.');
    expect(pages[pages.length - 1]).toContain('Term 40: pack bags early.');
  });

  it('recovers an issued voucher missing its PDF without touching the voucher', async () => {
    const client = await owner();
    const created = await createVoucher(client);
    // Freshly issued: no documents row at all.
    expect(
      await db.hotelVoucherDocument.count({ where: { voucherId: created.id } }),
    ).toBe(0);
    const before = await db.hotelVoucher.findUniqueOrThrow({ where: { id: created.id } });
    const first = await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    expect(first.status).toBe(200);
    expect(first.body.data.fileName).toBe(`hotel-voucher-${created.voucherNumber}.pdf`);
    // Reference persisted exactly once; voucher row itself untouched.
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const after = await db.hotelVoucher.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.status).toBe(before.status);
    expect(after.voucherNumber).toBe(before.voucherNumber);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    // A second generation re-renders into the same single current document:
    // same row id, no duplicates, always fresh content.
    const second = await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(stored.id);
    expect(second.body.data.reused).toBe(false);
    expect(
      await db.hotelVoucherDocument.count({ where: { voucherId: created.id } }),
    ).toBe(1);
    // The stored reference resolves through the signed download URL.
    const download = await client.get(
      `/api/hotel-vouchers/${created.id}/documents/${stored.id}/download-url`,
    );
    expect(download.status).toBe(200);
    expect(download.body.data.url).toBeTruthy();
  });

  it('serves downloads under a friendly lead-hotel filename', async () => {
    const client = await owner();
    // No linked lead: falls back to the guest snapshot name.
    const created = await createVoucher(client, {
      guestName: 'Aarav Mehta',
      hotelName: 'Shah Palace Hotel',
    });
    await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {});
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const download = await client.get(
      `/api/hotel-vouchers/${created.id}/documents/${stored.id}/download-url`,
    );
    expect(download.status).toBe(200);
    expect(download.body.data.fileName).toBe('Aarav Mehta - Shah Palace Hotel.pdf');
    // The stored row keeps its internal document name; only the served
    // filename is friendly.
    expect(stored.fileName).toBe(`hotel-voucher-${created.voucherNumber}.pdf`);
  });

  it('keeps child rows tenant-isolated', async () => {    const alpha = await owner('alpha@vouchers.test', 'Alpha Travel');
    const beta = await owner('beta@vouchers.test', 'Beta Travel');
    const created = await createVoucher(alpha, {
      pricing: [{ roomType: 'Single Room', unit: 1, quantity: 1 }],
      guests: [{ guestName: 'Guest One', age: 30, sex: 'M', paxType: 'ADULT' }],
      packageIncludes: ['Breakfast', 'Pool'],
    });
    const betaView = await beta.get(`/api/hotel-vouchers/${created.id}`);
    expect(betaView.status).toBe(404);
    expect(betaView.body.data?.pricing ?? []).toEqual([]);
    const alphaView = (await alpha.get(`/api/hotel-vouchers/${created.id}`)).body.data;
    expect(alphaView.packageIncludes).toEqual(['Breakfast', 'Pool']);
  });
});
