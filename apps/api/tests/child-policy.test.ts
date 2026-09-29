import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { renderQuotationPdf } from '../src/modules/quotations/pdf.service.js';
import { renderStylishQuotationPdf } from '../src/modules/quotations/stylish-pdf.service.js';

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

async function owner(email = 'owner@childpolicy.test') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

const pdfText = (buffer: Buffer) =>
  execFileSync('pdftotext', ['-layout', '-', '-'], {
    input: buffer,
    maxBuffer: 16 * 1024 * 1024,
  })
    .toString('utf8')
    .replace(/\s+/g, ' ');

const pdfCompany = () => ({
  name: 'Alpha Travel',
  email: '',
  phone: null,
  website: null,
  address: null,
  primaryColor: '#2563eb',
  operatingSinceYear: null,
  tripsSold: null,
  tan: null,
  taxRegistrationNumber: null,
  logo: null,
});

const pdfQuotation = () => ({
  quotationNumber: 'QT-CHILD-0001',
  customerName: 'Mira Shah',
  customerEmail: null,
  customerPhone: '+91 90000 00000',
  destinationSummary: 'Kerala',
  travelStartDate: null,
  travelEndDate: null,
  adults: 2,
  childrenWithBed: 1,
  childrenWithoutBed: 0,
  infants: 0,
  rooms: 1,
  validUntil: null,
});

const pdfVersion = (overrides: Record<string, unknown> = {}) => ({
  versionNumber: 1,
  title: 'Kerala Escape',
  introduction: null,
  currency: 'INR',
  finalAmount: '100',
  notes: null,
  perAdultPrice: '50',
  perChildWithBedPrice: '0',
  perChildWithoutBedPrice: '0',
  perInfantPrice: '0',
  taxNote: null,
  initialPaymentAmount: '0',
  paymentLink: null,
  inclusionsHtml: null,
  exclusionsHtml: null,
  paymentPolicies: null,
  cancellationPolicies: null,
  bookingTerms: null,
  childPolicy: null,
  includeVisa: false,
  visaSectionTitle: null,
  visaAmount: '0',
  visaDestination: null,
  visaType: null,
  visaServiceCharge: '0',
  visaGstPercent: '0',
  visaVfsCharge: '0',
  flightDetails: null,
  sightseeingDetails: null,
  hotels: [],
  itinerary: [],
  services: [],
  inclusions: [],
  exclusions: [],
  terms: [],
  ...overrides,
});

const CHILD_HTML =
  '<p>Children below 5 stay <strong>free</strong> without extra bed.</p><ul><li>Age 5-11 charged at child rate</li><li>Proof of age required at check-in</li></ul>';

describe('Destination Child Policy', () => {
  it('creates a destination with rich-text Child Policy and returns it on fetch', async () => {
    const client = await owner();
    const city = await client.post('/api/masters/cities', {
      countryCode: 'IN',
      name: 'Jaipur',
      airportCode: 'JAI',
      status: 'ACTIVE',
    });
    expect(city.status).toBe(201);

    const created = await client.post('/api/masters/destinations', {
      countryCode: 'IN',
      name: 'Rajasthan Highlights',
      destinationType: 'DOMESTIC',
      cityIds: [city.body.data.id],
      inclusions: '<p>Breakfast</p>',
      exclusions: null,
      paymentPolicies: null,
      cancellationPolicies: null,
      bookingTerms: null,
      childPolicy: CHILD_HTML,
      status: 'ACTIVE',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.childPolicy).toContain('Children below 5 stay');
    expect(created.body.data.childPolicy).toContain('<strong>free</strong>');
    expect(created.body.data.childPolicy).toContain('<li>');

    const fetched = await client.get(`/api/masters/destinations/${created.body.data.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.childPolicy).toBe(created.body.data.childPolicy);
    // Existing fields untouched.
    expect(fetched.body.data.inclusions).toContain('Breakfast');
  });

  it('updates Child Policy on edit and loads the saved value', async () => {
    const client = await owner('owner2@childpolicy.test');
    const city = await client.post('/api/masters/cities', {
      countryCode: 'IN',
      name: 'Udaipur',
      airportCode: null,
      status: 'ACTIVE',
    });
    const created = await client.post('/api/masters/destinations', {
      countryCode: 'IN',
      name: 'Udaipur Retreat',
      destinationType: 'DOMESTIC',
      cityIds: [city.body.data.id],
      status: 'ACTIVE',
    });
    expect(created.body.data.childPolicy).toBeNull();

    const updated = await client.patch(`/api/masters/destinations/${created.body.data.id}`, {
      childPolicy: '<p>Updated <strong>child</strong> terms.</p>',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.childPolicy).toContain('Updated');

    const refetched = await client.get(`/api/masters/destinations/${created.body.data.id}`);
    expect(refetched.body.data.childPolicy).toContain('Updated');
  });

  it('sanitizes unsafe markup in Child Policy like the other policy fields', async () => {
    const client = await owner('owner3@childpolicy.test');
    const city = await client.post('/api/masters/cities', {
      countryCode: 'IN',
      name: 'Goa',
      airportCode: 'GOI',
      status: 'ACTIVE',
    });
    const created = await client.post('/api/masters/destinations', {
      countryCode: 'IN',
      name: 'Goa Beaches',
      destinationType: 'DOMESTIC',
      cityIds: [city.body.data.id],
      childPolicy: '<p>Safe</p><script>alert(1)</script>',
      status: 'ACTIVE',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.childPolicy).toContain('Safe');
    expect(created.body.data.childPolicy).not.toContain('<script>');
  });

  it('keeps destinations without Child Policy working (NULL by default)', async () => {
    const client = await owner('owner4@childpolicy.test');
    const city = await client.post('/api/masters/cities', {
      countryCode: 'IN',
      name: 'Kochi',
      airportCode: 'COK',
      status: 'ACTIVE',
    });
    const created = await client.post('/api/masters/destinations', {
      countryCode: 'IN',
      name: 'Kochi Backwaters',
      destinationType: 'DOMESTIC',
      cityIds: [city.body.data.id],
      inclusions: '<p>Houseboat</p>',
      status: 'ACTIVE',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.childPolicy).toBeNull();
    expect(created.body.data.inclusions).toContain('Houseboat');
  });

  it('renders Child Policy in the CLASSIC PDF and omits the section when empty', async () => {
    const withChild = await renderQuotationPdf({
      company: pdfCompany(),
      quotation: pdfQuotation(),
      version: pdfVersion({
        inclusionsHtml: '<p>Breakfast included</p>',
        exclusionsHtml: '<p>Flights excluded</p>',
        childPolicy: CHILD_HTML,
        paymentPolicies: '<p>50 percent advance</p>',
        cancellationPolicies: '<p>Free up to 7 days</p>',
        bookingTerms: '<p>Valid for dates shown</p>',
      }),
      images: {},
    });
    const text = pdfText(withChild);
    expect(text).toContain('CHILD POLICY');
    expect(text).toContain('Children below 5 stay');
    // Required display order: Inclusions, Exclusions, Child Policy,
    // Payment Policies, Cancellation Policies, Booking Terms.
    const order = [
      'INCLUSIONS',
      'EXCLUSIONS',
      'CHILD POLICY',
      'PAYMENT POLICIES',
      'CANCELLATION POLICIES',
      'BOOKING TERMS',
    ].map((heading) => text.indexOf(heading));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const withoutChild = await renderQuotationPdf({
      company: pdfCompany(),
      quotation: pdfQuotation(),
      version: pdfVersion(),
      images: {},
    });
    expect(pdfText(withoutChild)).not.toContain('CHILD POLICY');
  });

  it('renders Child Policy in the STYLISH PDF and paginates long content', async () => {
    const longChild = `<p>${'Child stays free below age five. '.repeat(120)}</p><ul><li>${'Age proof required. '.repeat(40)}</li></ul>`;
    const rendered = await renderStylishQuotationPdf({
      company: pdfCompany(),
      quotation: pdfQuotation(),
      version: pdfVersion({
        inclusionsHtml: '<p>Breakfast included</p>',
        exclusionsHtml: '<p>Flights excluded</p>',
        childPolicy: longChild,
        paymentPolicies: '<p>50 percent advance</p>',
        cancellationPolicies: '<p>Free up to 7 days</p>',
        bookingTerms: '<p>Valid for dates shown</p>',
      }),
      images: {},
    });
    const text = pdfText(rendered);
    expect(text).toContain('CHILD POLICY');
    expect(text).toContain('Child stays free');
    const order = [
      'INCLUSIONS',
      'EXCLUSIONS',
      'CHILD POLICY',
      'PAYMENT POLICIES',
      'CANCELLATION POLICIES',
      'BOOKING TERMS',
    ].map((heading) => text.indexOf(heading));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const empty = await renderStylishQuotationPdf({
      company: pdfCompany(),
      quotation: pdfQuotation(),
      version: pdfVersion(),
      images: {},
    });
    expect(pdfText(empty)).not.toContain('CHILD POLICY');
  });
});
