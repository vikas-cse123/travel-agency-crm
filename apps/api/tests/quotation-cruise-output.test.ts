import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { renderQuotationPdf } from '../src/modules/quotations/pdf.service.js';
import { renderStylishQuotationPdf } from '../src/modules/quotations/stylish-pdf.service.js';

/**
 * Cruise room/night display in generated outputs (classic + stylish PDFs).
 *
 * - An explicitly saved `cruiseRoomLines: []` means zero rooms: neither PDF
 *   may invent a room ("Room", "ROOM 1", "1 room").
 * - Missing/invalid `cruiseNights` (null/omitted/zero/negative) must not
 *   display a cruise duration; valid nights (>= 1) keep the existing
 *   "X Nights · Y Days" convention.
 * - Key-less legacy rows keep their scalar fallbacks (room name, notes).
 */

function pdfText(buffer: Buffer): string {
  return execFileSync('pdftotext', ['-layout', '-', '-'], {
    input: buffer,
    maxBuffer: 16 * 1024 * 1024,
  }).toString('utf8');
}

const company = () => ({
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

const quotation = () => ({
  quotationNumber: 'QT-CRUISE-0001',
  customerName: 'Mira Shah',
  customerEmail: null,
  customerPhone: '+91 90000 00000',
  destinationSummary: 'Singapore',
  travelStartDate: null,
  travelEndDate: null,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  rooms: 1,
  validUntil: null,
});

const baseVersion = () => ({
  versionNumber: 1,
  title: 'Singapore Cruise',
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
});

const cruiseService = (overrides: Record<string, unknown> = {}) => ({
  serviceType: 'CRUISE',
  name: 'Genting Dream',
  description: null,
  dayNumber: null,
  city: null,
  quantity: 1,
  unitSellingPrice: 0,
  taxCategory: 'Cruise Details',
  notes: null,
  cruiseNights: 3,
  cruiseRoomLines: [],
  sequence: 1,
  ...overrides,
});

const inputFor = (services: unknown[]) => ({
  company: company(),
  quotation: quotation(),
  version: { ...baseVersion(), services },
});

describe('cruise rooms in generated PDFs', () => {
  it('omits room info for an explicitly roomless cruise in both styles', async () => {
    const input = inputFor([cruiseService({ cruiseNights: 3 })]);
    for (const pdf of [await renderQuotationPdf(input as never), await renderStylishQuotationPdf(input as never)]) {
      const text = pdfText(pdf);
      expect(text).toContain('Genting Dream');
      // No invented room: no badge, no fallback room words from lines.
      expect(text).not.toMatch(/ROOM 1/i);
      expect(text).not.toContain('Cabin:');
      // The valid nights duration still displays.
      expect(text).toContain('3 Nights');
    }
  });

  it('renders explicitly added rooms in both styles', async () => {
    const input = inputFor([
      cruiseService({
        cruiseNights: 2,
        cruiseRoomLines: [
          { cruiseRoomTypeId: null, roomType: 'Interior', rooms: 2, roomRate: 1000, sellingPrice: 1000, internalCost: null, notes: null },
          { cruiseRoomTypeId: null, roomType: 'Oceanview', rooms: 1, roomRate: 2000, sellingPrice: 2000, internalCost: null, notes: null },
        ],
      }),
    ]);
    for (const pdf of [await renderQuotationPdf(input as never), await renderStylishQuotationPdf(input as never)]) {
      const text = pdfText(pdf);
      expect(text).toContain('Interior');
      expect(text).toContain('Oceanview');
      expect(text).toContain('2 Nights');
    }
  });

  it('keeps scalar fallbacks for key-less legacy cruises in the classic PDF', async () => {
    const { cruiseRoomLines: _lines, cruiseNights: _nights, ...legacy } = cruiseService({
      city: 'Deluxe Cabin',
      notes: '2 Nights',
    }) as Record<string, unknown>;
    void _lines;
    void _nights;
    const pdf = await renderQuotationPdf(inputFor([legacy]) as never);
    const text = pdfText(pdf);
    expect(text).toContain('Deluxe Cabin');
    expect(text).toContain('2 Nights');
  });
});

describe('cruise nights in generated PDFs', () => {
  it.each([null, 0, -2])('omits the cruise duration for nights=%s in both styles', async (cruiseNights) => {
    const input = inputFor([
      cruiseService({
        cruiseNights,
        cruiseRoomLines: [
          { cruiseRoomTypeId: null, roomType: 'Interior', rooms: 1, roomRate: 1000, sellingPrice: 1000, internalCost: null, notes: null },
        ],
      }),
    ]);
    for (const pdf of [await renderQuotationPdf(input as never), await renderStylishQuotationPdf(input as never)]) {
      const text = pdfText(pdf);
      expect(text).not.toMatch(/Nights?\s*·/);
    }
  });

  it('omits the cruise duration when nights are omitted', async () => {
    const { cruiseNights: _dropped, ...row } = cruiseService({
      cruiseRoomLines: [
        { cruiseRoomTypeId: null, roomType: 'Interior', rooms: 1, roomRate: 1000, sellingPrice: 1000, internalCost: null, notes: null },
      ],
    }) as Record<string, unknown>;
    void _dropped;
    for (const pdf of [await renderQuotationPdf(inputFor([row]) as never), await renderStylishQuotationPdf(inputFor([row]) as never)]) {
      expect(pdfText(pdf)).not.toMatch(/Nights?\s*·/);
    }
  });

  it('keeps the existing convention for valid nights (1 and more)', async () => {
    for (const [cruiseNights, expected] of [
      [1, '1 Nights'],
      [3, '3 Nights'],
    ] as const) {
      const input = inputFor([cruiseService({ cruiseNights })]);
      for (const pdf of [await renderQuotationPdf(input as never), await renderStylishQuotationPdf(input as never)]) {
        expect(pdfText(pdf)).toContain(expected);
      }
    }
  });
});
