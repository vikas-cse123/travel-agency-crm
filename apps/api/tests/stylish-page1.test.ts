import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeStylishPdfPage1 } from '@interscale/shared';
import {
  fitDisplaySize,
  renderStylishQuotationPdf,
  resolveStylishPage1Cards,
  resolveStylishPage1DefaultCards,
} from '../src/modules/quotations/stylish-pdf.service.js';
import { renderQuotationPdf } from '../src/modules/quotations/pdf.service.js';

/**
 * Stylish PDF Page 1 (cover-only redesign). Guards the brochure cover:
 * dynamic destination hero, serif lead name, SERVICES INCLUDE row, exactly
 * three image-only sightseeing cards from three DIFFERENT activities with
 * per-slot CUSTOM overrides, navy consultant footer — and none of the
 * removed marketing copy. Later pages are covered by pdf-rendering.test.ts.
 */

const isPdf = (buffer: Buffer) => buffer.subarray(0, 5).toString('latin1') === '%PDF-';
const pageCount = (buffer: Buffer) =>
  (buffer.toString('latin1').match(/\/Type\s*\/Page(?![sR])/g) ?? []).length;
const pageMediaBoxes = (buffer: Buffer): Array<{ width: number; height: number }> => {
  const raw = buffer.toString('latin1');
  const re = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g;
  const boxes: Array<{ width: number; height: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    boxes.push({ width: Number(match[1]), height: Number(match[2]) });
  }
  return boxes;
};

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_1PX_RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);
const PNG_1PX_BLUE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAACMBAQCB4a3yAAAAAElFTkSuQmCC',
  'base64',
);
const PNG_1PX_GREEN = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4D8AAACMBAQCBRi4rAAAAAElFTkSuQmCC',
  'base64',
);
const PNG_1PX_GOLD = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8DA8AMBAQCSH6rFAAAAAElFTkSuQmCC',
  'base64',
);

const company = {
  name: 'Travel Enfield',
  email: 'care@travelenfield.example',
  phone: '+91 91100 00001',
  website: 'https://travelenfield.example',
  address: null,
  primaryColor: '#17386f',
  operatingSinceYear: 2016,
  tripsSold: 1200,
  tan: 'ABCD12345E',
  taxRegistrationNumber: '29ABCDE1234F1Z5',
  logo: PNG_1PX_GOLD,
};
const consultant = { name: 'Aditi Rao', phone: '+911100000001', email: 'owner@interscale.local' };

const quotation = {
  quotationNumber: 'QT-SG-2531',
  customerName: 'Pintu Kumar',
  customerEmail: null,
  customerPhone: '+91 90000 00000',
  destinationSummary: 'Singapore',
  destinations: 'Singapore',
  travelStartDate: new Date('2026-10-05'),
  travelEndDate: new Date('2026-10-10'),
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  rooms: 1,
  validUntil: null,
};

const sightseeingDetails = {
  include: true,
  sectionTitle: 'Sightseeing',
  amount: '0',
  description: null,
  days: [
    {
      dayNumber: 1,
      title: 'Day 1',
      city: 'Singapore',
      date: '2026-10-05',
      activities: [
        { name: 'Gardens by the Bay', sightseeingId: 'sight-1', description: 'Supertrees.' },
        { name: 'Marina Bay', sightseeingId: 'sight-1-dup', description: 'Bay views.' },
      ],
    },
    {
      dayNumber: 2,
      title: 'Day 2',
      city: 'Singapore',
      date: '2026-10-06',
      activities: [{ name: 'Merlion Park', sightseeingId: 'sight-2', description: 'Merlion.' }],
    },
    {
      dayNumber: 3,
      title: 'Day 3',
      city: 'Sentosa',
      date: '2026-10-07',
      activities: [{ name: 'Sentosa Cable Car', sightseeingId: 'sight-3', description: 'Cable car.' }],
    },
  ],
};

const version = {
  versionNumber: 1,
  title: 'Singapore Package',
  introduction: null,
  currency: 'INR',
  finalAmount: '100000',
  notes: null,
  perAdultPrice: '50000',
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
  flightDetails: { include: true, sectionTitle: 'Flights' },
  sightseeingDetails,
  hotels: [
    {
      city: 'Singapore',
      hotelName: 'Marina Bay Sands',
      category: '5',
      roomType: 'Deluxe',
      mealPlan: 'Breakfast',
      nights: 5,
      selected: true,
      notes: null,
    },
  ],
  itinerary: [],
  services: [{ serviceType: 'TRANSFER' }, { serviceType: 'CRUISE' }],
  inclusions: [],
  exclusions: [],
  terms: [],
};

const imagesForCards = {
  sightseeing: {
    'sight-1': PNG_1PX,
    'sight-1-dup': PNG_1PX_RED,
    'sight-2': PNG_1PX_BLUE,
    'sight-3': PNG_1PX_GREEN,
  },
};

type StylishInput = Parameters<typeof renderStylishQuotationPdf>[0];
const page1Input = (overrides?: Partial<StylishInput>): StylishInput => ({
  company,
  consultant,
  quotation: { ...quotation },
  version: { ...version } as unknown as StylishInput['version'],
  images: { cover: PNG_1PX_GOLD, ...imagesForCards },
  ...overrides,
} as unknown as StylishInput);

describe('stylish Page 1 card selection', () => {
  it('takes the first image from three different sightseeing activities in order', () => {
    const cards = resolveStylishPage1DefaultCards(sightseeingDetails.days, imagesForCards);
    expect(cards).toHaveLength(3);
    expect(cards[0]).toBe(PNG_1PX);
    expect(cards[1]).toBe(PNG_1PX_RED);
    expect(cards[2]).toBe(PNG_1PX_BLUE);
  });

  it('uses the same master only once across activities', () => {
    const days = [
      { activities: [{ sightseeingId: 'same' }, { sightseeingId: 'same' }] },
      { activities: [{ sightseeingId: 'other' }] },
    ];
    const cards = resolveStylishPage1DefaultCards(days, {
      sightseeing: { same: PNG_1PX, other: PNG_1PX_RED },
    });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toBe(PNG_1PX);
    expect(cards[1]).toBe(PNG_1PX_RED);
  });

  it('skips activities without usable images and never falls back to the cover', () => {
    const days = [{ activities: [{ sightseeingId: 'ghost' }, { name: 'No image' }] }];
    const cards = resolveStylishPage1DefaultCards(days, {
      cover: PNG_1PX_GOLD,
      sightseeing: {},
    } as never);
    expect(cards).toHaveLength(0);
  });

  it('resolves document and snapshot URL images before master images', () => {
    const days = [{ activities: [{ imageDocumentId: 'doc-1', sightseeingId: 'sight-1' }] }];
    const cards = resolveStylishPage1DefaultCards(days, {
      itineraryDocuments: { 'doc-1': PNG_1PX_RED },
      sightseeing: { 'sight-1': PNG_1PX },
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toBe(PNG_1PX_RED);
  });

  it('merges per-slot overrides over defaults, sparsely', () => {
    const defaults = [PNG_1PX, PNG_1PX_BLUE, PNG_1PX_GREEN];
    expect(resolveStylishPage1Cards(defaults, [])).toEqual(defaults);
    expect(resolveStylishPage1Cards(defaults, [PNG_1PX_RED])).toEqual([
      PNG_1PX_RED,
      PNG_1PX_BLUE,
      PNG_1PX_GREEN,
    ]);
    // Mixed default + override: middle stays default.
    expect(resolveStylishPage1Cards(defaults, [PNG_1PX_RED, null, PNG_1PX_GOLD])).toEqual([
      PNG_1PX_RED,
      PNG_1PX_BLUE,
      PNG_1PX_GOLD,
    ]);
    // All three overrides.
    expect(resolveStylishPage1Cards(defaults, [PNG_1PX_RED, PNG_1PX_RED, PNG_1PX_RED])).toEqual([
      PNG_1PX_RED,
      PNG_1PX_RED,
      PNG_1PX_RED,
    ]);
    // Missing defaults render as null placeholders, never duplicates.
    expect(resolveStylishPage1Cards([PNG_1PX], [])).toEqual([PNG_1PX, null, null]);
  });
});

describe('stylish Page 1 persisted selections', () => {
  it('treats absent config as all defaults', () => {
    expect(normalizeStylishPdfPage1(null)).toBeNull();
    expect(normalizeStylishPdfPage1(undefined)).toBeNull();
  });

  it('demotes CUSTOM slots without an object key back to DEFAULT', () => {
    expect(normalizeStylishPdfPage1({ hero: { mode: 'CUSTOM' } })).toEqual({
      hero: { mode: 'DEFAULT' },
      cards: [null, null, null],
    });
  });

  it('preserves valid hero + mixed cards and truncates to three', () => {
    const custom = (key: string) => ({
      mode: 'CUSTOM' as const,
      objectKey: key,
      fileName: 'card.png',
      mimeType: 'image/png',
      fileSize: 100,
    });
    expect(
      normalizeStylishPdfPage1({
        hero: custom('companies/c/q/v/stylish-page1/hero/a.png'),
        cards: [custom('k1'), { mode: 'DEFAULT' }, custom('k3'), custom('k4-extra')],
      }),
    ).toEqual({
      hero: {
        mode: 'CUSTOM',
        objectKey: 'companies/c/q/v/stylish-page1/hero/a.png',
        fileName: 'card.png',
        mimeType: 'image/png',
        fileSize: 100,
      },
      cards: [
        { mode: 'CUSTOM', objectKey: 'k1', fileName: 'card.png', mimeType: 'image/png', fileSize: 100 },
        { mode: 'DEFAULT' },
        { mode: 'CUSTOM', objectKey: 'k3', fileName: 'card.png', mimeType: 'image/png', fileSize: 100 },
      ],
    });
  });
});

describe('stylish Page 1 lead-name sizing', () => {
  const measure = (text: string, size: number) => text.length * size * 0.55;
  it('keeps short names at display size', () => {
    expect(fitDisplaySize(measure, 'Rahul', 455, 54, 30)).toBe(54);
  });
  it('shrinks medium names in 2pt steps', () => {
    expect(fitDisplaySize(measure, 'Pintu Kumar', 455, 54, 30)).toBeLessThanOrEqual(54);
  });
  it('floors long names at the minimum without breaking layout', () => {
    expect(fitDisplaySize(measure, 'Rahul Kumar Sharma Extended Family Name', 455, 54, 30)).toBe(
      30,
    );
  });
});

describe('stylish Page 1 render', () => {
  it('renders a valid cover-first PDF on the existing A4 page size', async () => {
    const pdf = await renderStylishQuotationPdf(page1Input());
    expect(isPdf(pdf)).toBe(true);
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(2);
    const boxes = pageMediaBoxes(pdf);
    expect(boxes[0]?.width).toBeCloseTo(595.28, 1);
    expect(boxes[0]?.height).toBeCloseTo(841.89, 1);
  });

  it('renders short, medium and long lead names without breaking', async () => {
    for (const customerName of ['Rahul', 'Pintu Kumar', 'Rahul Kumar Sharma']) {
      const pdf = await renderStylishQuotationPdf(
        page1Input({ quotation: { ...quotation, customerName } }),
      );
      expect(isPdf(pdf)).toBe(true);
      expect(pageCount(pdf)).toBeGreaterThanOrEqual(2);
    }
  });

  it('prefers the Page 1 hero override over the destination cover', async () => {
    const baseline = await renderStylishQuotationPdf(page1Input());
    const overridden = await renderStylishQuotationPdf(
      page1Input({ images: { cover: PNG_1PX_GOLD, ...imagesForCards, page1Hero: PNG_1PX_RED } }),
    );
    expect(isPdf(overridden)).toBe(true);
    expect(overridden.equals(baseline)).toBe(false);
  });

  it('renders with card overrides and with missing sightseeing images', async () => {
    const withOverrides = await renderStylishQuotationPdf(
      page1Input({ images: { cover: PNG_1PX_GOLD, page1Cards: [PNG_1PX_RED, null, PNG_1PX_BLUE] } }),
    );
    expect(isPdf(withOverrides)).toBe(true);
    const withoutSightseeing = await renderStylishQuotationPdf(
      page1Input({
        version: { ...version, sightseeingDetails: null } as unknown as StylishInput['version'],
        images: { cover: PNG_1PX_GOLD },
      }),
    );
    expect(isPdf(withoutSightseeing)).toBe(true);
  });

  it('leaves the Classic PDF render working with Page 1 fields present', async () => {
    const pdf = await renderQuotationPdf(
      page1Input({
        images: { cover: PNG_1PX_GOLD, ...imagesForCards, page1Hero: PNG_1PX_RED },
      }) as unknown as Parameters<typeof renderQuotationPdf>[0],
    );
    expect(isPdf(pdf)).toBe(true);
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
  });

  it('never draws card captions on the cover source', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/modules/quotations/stylish-pdf.service.ts'),
      'utf8',
    );
    const coverBlock = source.slice(source.indexOf('// Cover (Page 1)'), source.indexOf('// Overview'));
    for (const banned of [
      'CITY OF POSSIBILITIES',
      'MORE THAN TRIPS',
      'MEMORIES FOR LIFE',
      'DREAM · EXPLORE',
      'Explore Iconic Places',
      'Experience More',
      'Create Lasting Memories',
      'Good Vibes',
    ]) {
      expect(coverBlock).not.toContain(banned);
    }
    expect(coverBlock).toContain('SERVICES INCLUDE');
  });
});
