import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { storageService } from '../src/services/storage/storage.service.js';

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

type Client = ReturnType<typeof createAuthClient>;

async function owner(email = 'owner@qv.test', companyName = 'Quotation Voucher Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

async function companyIdOf(email: string) {
  const user = await db.user.findUniqueOrThrow({ where: { normalizedEmail: email } });
  return user.companyId as string;
}

const leadPayload = (overrides: Record<string, unknown> = {}) => ({
  customerName: 'Voucher Customer',
  phone: '+91 90000 12345',
  email: 'voucher.customer@example.test',
  leadSource: 'REFERRAL',
  leadType: 'WARM',
  priority: 'MEDIUM',
  rooms: 1,
  adults: 2,
  childrenWithBed: 1,
  childrenWithoutBed: 0,
  infants: 0,
  extraBeds: 0,
  currency: 'INR',
  services: ['HOTEL'],
  itinerary: [{ country: 'India', destination: 'Goa', nights: 4, sequence: 1 }],
  ...overrides,
});

const templatePayload = (name = 'Voucher source package') => ({
  name,
  destinationSummary: 'Goa',
  durationDays: 5,
  durationNights: 4,
  baseCurrency: 'INR',
  status: 'ACTIVE',
  itinerary: [
    {
      dayNumber: 1,
      title: 'Arrival',
      destination: 'Goa',
      description: 'Airport transfer and hotel check-in.',
      sequence: 1,
    },
  ],
  hotels: [
    {
      city: 'Goa',
      hotelName: 'Harbour Hotel',
      rooms: 1,
      nights: 4,
      internalCost: 20000,
      sellingPrice: 26000,
      selected: true,
      sequence: 1,
    },
  ],
  services: [],
  inclusions: [],
  exclusions: [],
  terms: [],
});

const voucherPayload = (overrides: Record<string, unknown> = {}) => ({
  guestName: 'Voucher Customer',
  guestPhone: '+91 90000 12345',
  guestEmail: 'voucher.customer@example.test',
  adults: 2,
  children: 1,
  hotelName: 'Harbour Hotel',
  hotelAddress: null,
  hotelCity: 'Goa',
  hotelPhone: null,
  hotelEmail: null,
  hotelStarRating: null,
  checkIn: '2026-11-10',
  checkOut: '2026-11-14',
  roomTypeName: null,
  rooms: 1,
  mealPlanName: null,
  confirmationNumber: null,
  specialRequests: null,
  remarks: null,
  termsSnapshot: null,
  pricing: [],
  guests: [],
  packageIncludes: [],
  ...overrides,
});

/** Visible text extraction via poppler's pdftotext. */
function pdfText(buffer: Buffer): string {
  return execFileSync('pdftotext', ['-layout', '-', '-'], {
    input: buffer,
    maxBuffer: 16 * 1024 * 1024,
  }).toString('utf8');
}

async function setupHotelMaster(client: Client) {
  const city = (
    await client.post('/api/masters/cities', { countryCode: 'IN', name: 'Jaipur', status: 'ACTIVE' })
  ).body.data as { id: string };
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
      name: 'Palace View Hotel',
      starCategory: 4,
      address: 'Palace Road, Jaipur',
      phone: '+91 14100 00000',
      email: 'stay@palaceview.test',
      status: 'ACTIVE',
    })
  ).body.data as { id: string };
  return { city, destination, hotel };
}

/** Lead + template quotation (initial version inherits the template hotel). */
async function readyQuotation(client: Client, companyId: string) {
  const lead = (await client.post('/api/queries', leadPayload())).body.data as { id: string };
  expect(lead.id).toBeTruthy();
  const template = (await client.post('/api/quotation-templates', templatePayload())).body.data as {
    id: string;
  };
  const created = (await client.post('/api/quotations', { queryId: lead.id, templateId: template.id }))
    .body.data as { id: string };
  const quotation = (await client.get(`/api/quotations/${created.id}`)).body.data as {
    id: string;
    queryId: string;
    customer: { id: string } | null;
    customerName: string;
    customerPhone: string;
    customerEmail: string | null;
    adults: number;
    childrenWithBed: number;
    childrenWithoutBed: number;
    rooms: number;
    currentVersionId: string | null;
    versions: { id: string; versionNumber: number }[];
  };
  // A second, master-linked hotel option with stay facts on the same version.
  const versionId = (quotation.currentVersionId ?? quotation.versions[0]!.id) as string;
  const { hotel } = await setupHotelMaster(client);
  const linked = await db.quotationVersionHotelOption.create({
    data: {
      companyId,
      quotationVersionId: versionId,
      hotelId: hotel.id,
      city: 'Jaipur',
      hotelName: 'Palace View Hotel',
      roomType: 'Deluxe',
      mealPlan: 'Breakfast',
      rooms: 2,
      nights: 4,
      checkInDate: new Date('2026-11-10T00:00:00'),
      checkOutDate: new Date('2026-11-14T00:00:00'),
      selected: true,
      sequence: 2,
    },
  });
  const refreshed = (await client.get(`/api/quotations/${created.id}`)).body.data as typeof quotation & {
    versions: (typeof quotation.versions)[number][];
  };
  return { lead, quotation: refreshed, versionId, masterHotelId: hotel.id, linkedOptionId: linked.id };
}

describe('Hotel Vouchers from Quotation', () => {
  it('names downloads after the linked lead and hotel', async () => {
    const client = await owner();
    const companyId = await companyIdOf('owner@qv.test');
    const { lead, quotation, masterHotelId, linkedOptionId } = await readyQuotation(client, companyId);
    const res = await client.post(
      '/api/hotel-vouchers',
      voucherPayload({
        queryId: lead.id,
        hotelId: masterHotelId,
        quotationId: quotation.id,
        quotationHotelOptionId: linkedOptionId,
        hotelName: 'Palace View Hotel',
        hotelCity: 'Jaipur',
        checkIn: '2026-11-10',
        checkOut: '2026-11-14',
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await client.post(`/api/hotel-vouchers/${res.body.data.id}/generate-pdf`, {});
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: res.body.data.id },
    });
    const download = await client.get(
      `/api/hotel-vouchers/${res.body.data.id}/documents/${stored.id}/download-url`,
    );
    expect(download.status).toBe(200);
    // Lead name comes from the linked lead, not the guest snapshot.
    expect(download.body.data.fileName).toBe('Voucher Customer - Palace View Hotel.pdf');
  });

  it('creates a voucher from a valid quotation with refs and snapshots saved', async () => {
    const client = await owner();
    const companyId = await companyIdOf('owner@qv.test');
    const { lead, quotation, masterHotelId, linkedOptionId } = await readyQuotation(client, companyId);
    const res = await client.post(
      '/api/hotel-vouchers',
      voucherPayload({
        queryId: lead.id,
        hotelId: masterHotelId,
        quotationId: quotation.id,
        quotationHotelOptionId: linkedOptionId,
        hotelName: 'Palace View Hotel',
        hotelAddress: 'Palace Road, Jaipur',
        hotelCity: 'Jaipur',
        hotelPhone: '+91 14100 00000',
        hotelEmail: 'stay@palaceview.test',
        roomTypeName: 'Deluxe',
        rooms: 2,
        mealPlanName: 'Breakfast',
        checkIn: '2026-11-10',
        checkOut: '2026-11-14',
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await db.hotelVoucher.findUniqueOrThrow({ where: { id: res.body.data.id } });
    // Existing references are stored; provenance ids are validation-only.
    expect(row.queryId).toBe(lead.id);
    expect(row.hotelId).toBe(masterHotelId);
    expect(row).toMatchObject({
      guestName: 'Voucher Customer',
      adults: 2,
      children: 1,
      hotelName: 'Palace View Hotel',
      hotelCity: 'Jaipur',
      roomTypeName: 'Deluxe',
      rooms: 2,
      mealPlanName: 'Breakfast',
    });
  });

  it('accepts each of several hotel options of the same quotation', async () => {
    const client = await owner();
    const companyId = await companyIdOf('owner@qv.test');
    const { quotation, linkedOptionId } = await readyQuotation(client, companyId);
    const templateOption = (
      await db.quotationVersionHotelOption.findMany({
        where: { quotationVersionId: { in: quotation.versions.map((v) => v.id) } },
        orderBy: { sequence: 'asc' },
      })
    )[0]!;
    expect(templateOption.id).not.toBe(linkedOptionId);
    const first = await client.post(
      '/api/hotel-vouchers',
      voucherPayload({
        queryId: quotation.queryId,
        quotationId: quotation.id,
        quotationHotelOptionId: templateOption.id,
        hotelName: 'Harbour Hotel',
        hotelCity: 'Goa',
      }),
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await client.post(
      '/api/hotel-vouchers',
      voucherPayload({
        queryId: quotation.queryId,
        quotationId: quotation.id,
        quotationHotelOptionId: linkedOptionId,
        hotelName: 'Palace View Hotel',
        hotelCity: 'Jaipur',
        checkIn: '2026-11-10',
        checkOut: '2026-11-14',
      }),
    );
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(first.body.data.id).not.toBe(second.body.data.id);
  });

  it('creates a quotation-linked voucher without a hotel option', async () => {
    const client = await owner();
    const companyId = await companyIdOf('owner@qv.test');
    const { lead, quotation } = await readyQuotation(client, companyId);
    // Quotation with no hotel entries: manual hotel fields still work.
    const res = await client.post(
      '/api/hotel-vouchers',
      voucherPayload({ queryId: lead.id, quotationId: quotation.id }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.queryId).toBe(lead.id);
  });

  it('leaves missing optional fields blank instead of fabricating data', async () => {
    const client = await owner();
    const companyId = await companyIdOf('owner@qv.test');
    const { quotation } = await readyQuotation(client, companyId);
    const templateOption = await db.quotationVersionHotelOption.findFirstOrThrow({
      where: { hotelName: 'Harbour Hotel', companyId },
    });
    // Template option carries no master link, dates, room type, or contacts.
    const res = await client.post(
      '/api/hotel-vouchers',
      voucherPayload({
        queryId: quotation.queryId,
        quotationId: quotation.id,
        quotationHotelOptionId: templateOption.id,
        hotelName: 'Harbour Hotel',
        hotelCity: 'Goa',
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await db.hotelVoucher.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.hotelId).toBeNull();
    expect(row.hotelAddress).toBeNull();
    expect(row.hotelPhone).toBeNull();
    expect(row.hotelEmail).toBeNull();
    expect(row.roomTypeName).toBeNull();
    expect(row.mealPlanName).toBeNull();
    expect(row.confirmationNumber).toBeNull();
  });

  it('rejects a hotel option from another quotation (tampered request)', async () => {
    const client = await owner();
    const companyId = await companyIdOf('owner@qv.test');
    const first = await readyQuotation(client, companyId);
    const leadB = (await client.post('/api/queries', leadPayload({ customerName: 'Second Lead' })))
      .body.data as { id: string };
    const templateB = (
      await client.post('/api/quotation-templates', templatePayload('Second source package'))
    ).body.data as {
      id: string;
    };
    const quotationB = (
      await client.post('/api/quotations', { queryId: leadB.id, templateId: templateB.id })
    ).body.data as { id: string };    const detailsB = (await client.get(`/api/quotations/${quotationB.id}`)).body.data as {
      versions: { id: string }[];
    };
    const foreignOption = await db.quotationVersionHotelOption.findFirstOrThrow({
      where: { quotationVersionId: detailsB.versions[0]!.id },
    });
    const res = await client.post(
      '/api/hotel-vouchers',
      voucherPayload({
        queryId: first.lead.id,
        quotationId: first.quotation.id,
        quotationHotelOptionId: foreignOption.id,
        hotelName: 'Harbour Hotel',
        hotelCity: 'Goa',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects an option id without a quotation and an option off the applicable version', async () => {
    const client = await owner();
    const companyId = await companyIdOf('owner@qv.test');
    const { quotation, linkedOptionId } = await readyQuotation(client, companyId);
    const orphan = await client.post(
      '/api/hotel-vouchers',
      voucherPayload({ queryId: quotation.queryId, quotationHotelOptionId: linkedOptionId }),
    );
    expect(orphan.status).toBe(400);
    // Option on a superseded version: revising repoints currentVersionId to
    // v2, so v1's option is no longer applicable.
    const v1TemplateOption = await db.quotationVersionHotelOption.findFirstOrThrow({
      where: { hotelName: 'Harbour Hotel', companyId },
    });
    const v1 = (
      await client.get(`/api/quotations/${quotation.id}`)
    ).body.data as { currentVersionId: string | null };
    const revision = (
      await client.post(`/api/quotations/${quotation.id}/versions`, { sourceVersionId: v1.currentVersionId })
    ).body.data as { id: string };
    expect(revision.id).toBeTruthy();
    const stale = await client.post(
      '/api/hotel-vouchers',
      voucherPayload({
        queryId: quotation.queryId,
        quotationId: quotation.id,
        quotationHotelOptionId: v1TemplateOption.id,
      }),
    );
    expect(stale.status).toBe(400);
  });

  it('rejects mismatched lead/customer refs and cross-company access', async () => {
    const client = await owner();
    const companyId = await companyIdOf('owner@qv.test');
    const { lead, quotation, linkedOptionId } = await readyQuotation(client, companyId);
    const otherLead = (await client.post('/api/queries', leadPayload({ customerName: 'Other Lead' })))
      .body.data as { id: string };
    const mismatchedLead = await client.post(
      '/api/hotel-vouchers',
      voucherPayload({
        queryId: otherLead.id,
        quotationId: quotation.id,
        quotationHotelOptionId: linkedOptionId,
      }),
    );
    expect(mismatchedLead.status).toBe(400);

    const beta = await owner('owner@qv-beta.test', 'QV Beta Travel');
    const betaCompanyId = await companyIdOf('owner@qv-beta.test');
    const betaLead = (await beta.post('/api/queries', leadPayload())).body.data as { id: string };
    // Same-company scoping: alpha's quotation/option/lead are invisible to beta.
    for (const payload of [
      voucherPayload({ queryId: betaLead.id, quotationId: quotation.id }),
      voucherPayload({ queryId: betaLead.id, quotationId: quotation.id, quotationHotelOptionId: linkedOptionId }),
      voucherPayload({ queryId: lead.id, quotationId: quotation.id }),
    ]) {
      expect((await beta.post('/api/hotel-vouchers', payload)).status).toBe(400);
    }
    // And beta's own quotation cannot be borrowed by alpha.
    const betaTemplate = (await beta.post('/api/quotation-templates', templatePayload())).body.data as {
      id: string;
    };
    const betaQuotation = (
      await beta.post('/api/quotations', { queryId: betaLead.id, templateId: betaTemplate.id })
    ).body.data as { id: string };
    expect(
      (
        await client.post(
          '/api/hotel-vouchers',
          voucherPayload({ queryId: lead.id, quotationId: betaQuotation.id }),
        )
      ).status,
    ).toBe(400);
    expect(betaCompanyId).not.toBe(companyId);
  });

  it('manual creation without quotation fields still works', async () => {
    const client = await owner();
    const res = await client.post('/api/hotel-vouchers', voucherPayload());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.voucherNumber).toMatch(/^HV-000001$/);
  });

  it('keeps PDF output unchanged for the same saved voucher data', async () => {
    const client = await owner();
    const companyId = await companyIdOf('owner@qv.test');
    const { lead, quotation, linkedOptionId } = await readyQuotation(client, companyId);
    const created = (
      await client.post(
        '/api/hotel-vouchers',
        voucherPayload({
          queryId: lead.id,
          quotationId: quotation.id,
          quotationHotelOptionId: linkedOptionId,
          hotelName: 'Palace View Hotel',
          hotelCity: 'Jaipur',
          roomTypeName: 'Deluxe',
          confirmationNumber: 'CONF-Q1',
          pricing: [
            {
              roomType: 'Deluxe',
              unit: 1,
              quantity: 1,
              gst: 18,
              amount: 11000,
              taxablePay: 11000,
              gstService: 12980,
            },
          ],
          guests: [{ guestName: 'Voucher Customer', age: 30, sex: 'M', paxType: 'ADULT' }],
          termsSnapshot: 'Non-refundable after check-in.',
        }),
      )
    ).body.data as { id: string; voucherNumber: string };
    expect(
      (await client.post(`/api/hotel-vouchers/${created.id}/generate-pdf`, {})).status,
    ).toBe(200);
    const stored = await db.hotelVoucherDocument.findFirstOrThrow({
      where: { voucherId: created.id },
    });
    const object = (
      storageService as unknown as { read: (key: string) => Buffer | undefined }
    ).read(stored.objectKey);
    const text = pdfText(object ?? Buffer.alloc(0));
    for (const expected of [
      'HOTEL VOUCHER',
      'Confirmation No.',
      'Palace View Hotel',
      'Total Payable Amount',
      '12,980',
      'Page 1 of 2',
    ]) {
      expect(text, `missing ${expected}`).toContain(expected);
    }
    // The system voucher number stays out of the document.
    expect(text).not.toContain(created.voucherNumber);
    expect(text).not.toContain('STATUS');
  });
});
